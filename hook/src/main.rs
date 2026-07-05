use chrono::Utc;
use hex::encode as hex_encode;
use sha2::{Digest, Sha256};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

// ── Data structures ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct HookInput {
    hook_event_name: Option<String>,
    tool_name: Option<String>,
    tool_input: Option<Value>,
    session_id: Option<String>,
    cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PendingEvent {
    ts: i64,
    tool: String,
    input_hash: String,
    summary: String,
    input_len: usize,
}

#[derive(Debug, Serialize)]
struct Decision {
    ts: i64,
    sid: String,
    tool: String,
    summary: String,
    len: usize,
    time_ms: Option<i64>,
    complexity: f64,
    threshold_ms: i64,
    verdict: String,
    user: String,
    cwd: Option<String>,
    bypass_rule: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StatusCache {
    day_counts: HashMap<String, u32>,
    session_counts: HashMap<String, u32>,
    updated_at: i64,
}

// ── Tool weight & scoring ────────────────────────────────────────────────────

fn tool_weight(name: &str) -> f64 {
    match name {
        "Bash" => 0.85,
        "Write" => 0.75,
        "MultiEdit" => 0.70,
        "Edit" => 0.65,
        "WebFetch" => 0.25,
        "WebSearch" => 0.15,
        "Read" => 0.10,
        "Glob" | "Grep" | "LS" => 0.05,
        _ => 0.30,
    }
}

const CODE_PATTERN: &str = "function|class|import|export|const |let |def |async |await ";

fn compute_complexity(tool: &str, input: &str) -> f64 {
    let mut score = tool_weight(tool);
    if input.len() > 500 { score += 0.10; }
    if input.len() > 2000 { score += 0.10; }
    if CODE_PATTERN.split('|').any(|kw| input.contains(kw)) { score += 0.05; }
    score.min(1.0)
}

fn threshold_ms(complexity: f64) -> i64 {
    (1000.0 + complexity * 5000.0).round() as i64
}

// ── Bypass rule detection ────────────────────────────────────────────────────

fn load_allow_rules(home: &Path) -> Vec<(String, String)> {
    // Returns vec of (pattern, source_file)
    // Order: local overrides first, then user, then managed (corp policy)
    let files = [
        (home.join(".claude/settings.local.json"), "settings.local.json"),
        (home.join(".claude/settings.json"), "settings.json"),
        (home.join(".claude/managed-settings.json"), "managed-settings.json"),
    ];
    let mut rules = Vec::new();
    for (path, label) in &files {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(v) = serde_json::from_str::<Value>(&content) {
                // Explicit allow rules
                if let Some(allow) = v.get("permissions").and_then(|p| p.get("allow")).and_then(|a| a.as_array()) {
                    for rule in allow {
                        if let Some(s) = rule.as_str() {
                            rules.push((s.to_string(), label.to_string()));
                        }
                    }
                }
                // defaultMode: auto-accept acts as a wildcard allow for everything
                if v.get("defaultMode").and_then(|m| m.as_str()) == Some("auto-accept") {
                    rules.push(("*(auto-accept mode)".to_string(), label.to_string()));
                }
                // sandbox.autoAllowBashIfSandboxed: true auto-allows all Bash when sandboxed
                if v.get("sandbox")
                    .and_then(|s| s.get("autoAllowBashIfSandboxed"))
                    .and_then(|b| b.as_bool())
                    == Some(true)
                {
                    rules.push(("Bash(*) [sandbox autoAllow]".to_string(), label.to_string()));
                }
            }
        }
    }
    rules
}

fn match_bypass_rule(tool: &str, input: &str, rules: &[(String, String)]) -> Option<String> {
    // Build a representation like "Bash(git status)" to match against rules
    let tool_call = format!("{}({})", tool, input.chars().take(200).collect::<String>());

    for (pattern, source) in rules {
        if pattern_matches(pattern, &tool_call) {
            return Some(format!("{} in {}", pattern, source));
        }
    }
    None
}

fn pattern_matches(pattern: &str, _tool_call: &str) -> bool {
    // Auto-accept mode sentinel matches everything
    if pattern.starts_with("*(") { return true; }

    let tool_call = _tool_call;
    if pattern.ends_with("(*)") {
        // e.g. "Bash(*)" — match any Bash call
        let prefix = &pattern[..pattern.len() - 3];
        tool_call.starts_with(&format!("{}(", prefix))
    } else if pattern.ends_with('*') {
        // e.g. "mcp__playwright__*"
        tool_call.starts_with(&pattern[..pattern.len() - 1])
    } else {
        tool_call == pattern || tool_call.starts_with(&format!("{}(", pattern.split('(').next().unwrap_or("")))
    }
}

// ── Path helpers ─────────────────────────────────────────────────────────────

fn data_dir(home: &Path) -> PathBuf {
    home.join(".cognitive-surrender")
}

fn decisions_dir(home: &Path) -> PathBuf {
    data_dir(home).join("decisions")
}

fn pending_dir(home: &Path) -> PathBuf {
    data_dir(home).join("pending")
}

fn decisions_file(home: &Path) -> PathBuf {
    let today = Utc::now().format("%Y-%m-%d").to_string();
    decisions_dir(home).join(format!("{}.jsonl", today))
}

fn pending_file(home: &Path, session_id: &str) -> PathBuf {
    // Sanitize session_id for use as filename
    let safe: String = session_id.chars().filter(|c| c.is_alphanumeric() || *c == '-').take(40).collect();
    pending_dir(home).join(format!("{}.jsonl", safe))
}

fn status_file(home: &Path) -> PathBuf {
    data_dir(home).join("status.json")
}

// ── Input hash ───────────────────────────────────────────────────────────────

fn input_hash(input: &str) -> String {
    let truncated = &input[..input.len().min(500)];
    let mut hasher = Sha256::new();
    hasher.update(truncated.as_bytes());
    hex_encode(&hasher.finalize()[..8]) // 8 bytes = 16 hex chars, plenty for correlation
}

fn input_summary(input: &str) -> String {
    input.chars().take(120).collect::<String>().replace('\n', " ").replace('\t', " ")
}

fn get_user() -> String {
    std::process::Command::new("git")
        .args(["config", "user.name"])
        .output()
        .ok()
        .and_then(|o| if o.status.success() { Some(String::from_utf8_lossy(&o.stdout).trim().to_string()) } else { None })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| std::env::var("USER").unwrap_or_else(|_| "unknown".to_string()))
}

// ── Status cache ──────────────────────────────────────────────────────────────

fn update_status(home: &Path, session_id: &str, verdict: &str) {
    let path = status_file(home);
    let mut cache: StatusCache = fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    // Day counts are for today; reset if stale
    let today_key = Utc::now().format("%Y-%m-%d").to_string();
    let cache_date = if cache.updated_at > 0 {
        chrono::DateTime::from_timestamp_millis(cache.updated_at)
            .map(|dt: chrono::DateTime<Utc>| dt.format("%Y-%m-%d").to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };
    if cache_date != today_key {
        cache.day_counts.clear();
        // Don't clear session counts — those are per-session not per-day
    }

    *cache.day_counts.entry(verdict.to_string()).or_insert(0) += 1;
    *cache.session_counts.entry(format!("{}:{}", session_id, verdict)).or_insert(0) += 1;

    // Build simplified session counts (just the current session's verdicts)
    let mut session_verdicts: HashMap<String, u32> = HashMap::new();
    for (k, v) in &cache.session_counts {
        if k.starts_with(&format!("{}:", session_id)) {
            let verd = k.splitn(2, ':').nth(1).unwrap_or("");
            *session_verdicts.entry(verd.to_string()).or_insert(0) += v;
        }
    }

    let out = json!({
        "dayCounts": cache.day_counts,
        "sessionCounts": session_verdicts,
        "updatedAt": Utc::now().timestamp_millis(),
    });

    if let Ok(mut f) = File::create(&path) {
        let _ = write!(f, "{}", out);
    }
}

// ── Core logic ───────────────────────────────────────────────────────────────

fn handle_permission_request(home: &Path, input: &HookInput, input_str: &str, now: i64) {
    let tool = input.tool_name.as_deref().unwrap_or("Unknown");
    let session_id = input.session_id.as_deref().unwrap_or("unknown");
    let hash = input_hash(input_str);
    let summary = input_summary(input_str);
    let len = input_str.len();

    let event = PendingEvent { ts: now, tool: tool.to_string(), input_hash: hash, summary, input_len: len };

    let pdir = pending_dir(home);
    let _ = fs::create_dir_all(&pdir);
    let pfile = pending_file(home, session_id);

    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&pfile) {
        if let Ok(line) = serde_json::to_string(&event) {
            let _ = writeln!(f, "{}", line);
        }
    }
}

// Tools that only emit PermissionRequest + PostToolUse (no PreToolUse).
// For these, PostToolUse is used as the completion signal instead of PreToolUse.
fn is_meta_tool(tool: &str) -> bool {
    matches!(tool, "AskUserQuestion" | "ExitPlanMode" | "Skill" | "EnterPlanMode")
}

fn handle_pre_tool_use(home: &Path, input: &HookInput, input_str: &str, now: i64, rules: &[(String, String)]) {
    let tool = input.tool_name.as_deref().unwrap_or("Unknown");

    // Meta-tools don't get PreToolUse — their decisions are recorded by handle_post_tool_use.
    if is_meta_tool(tool) { return; }

    let session_id = input.session_id.as_deref().unwrap_or("unknown");
    let hash = input_hash(input_str);
    let complexity = compute_complexity(tool, input_str);
    let thresh = threshold_ms(complexity);
    let user = get_user();
    let cwd = input.cwd.clone();

    // Try to correlate with a pending PermissionRequest
    let pfile = pending_file(home, session_id);
    let matched = find_and_remove_pending(&pfile, tool, &hash);

    let (time_ms, verdict, bypass_rule) = if let Some(pending) = matched {
        let delta = now - pending.ts;
        let v = if delta >= thresh { "reviewed" } else { "rubber_stamped" };
        (Some(delta), v.to_string(), None)
    } else {
        // No prompt was shown — bypassed by config
        let rule = match_bypass_rule(tool, input_str, rules);
        (None, "bypassed".to_string(), rule)
    };

    let decision = Decision {
        ts: now,
        sid: session_id.to_string(),
        tool: tool.to_string(),
        summary: input_summary(input_str),
        len: input_str.len(),
        time_ms,
        complexity,
        threshold_ms: thresh,
        verdict: verdict.clone(),
        user,
        cwd,
        bypass_rule,
    };

    // Append to daily JSONL
    let ddir = decisions_dir(home);
    let _ = fs::create_dir_all(&ddir);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(decisions_file(home)) {
        if let Ok(line) = serde_json::to_string(&decision) {
            let _ = writeln!(f, "{}", line);
        }
    }

    // Update status cache
    update_status(home, session_id, &verdict);
}

fn handle_post_tool_use(home: &Path, input: &HookInput, input_str: &str, now: i64) {
    let tool = input.tool_name.as_deref().unwrap_or("Unknown");

    // Only handle meta-tools here; regular tools are handled by PreToolUse.
    if !is_meta_tool(tool) { return; }

    let session_id = input.session_id.as_deref().unwrap_or("unknown");
    let hash = input_hash(input_str);
    let complexity = compute_complexity(tool, input_str);
    let thresh = threshold_ms(complexity);
    let user = get_user();
    let cwd = input.cwd.clone();

    let pfile = pending_file(home, session_id);
    let matched = find_and_remove_pending(&pfile, tool, &hash);

    // Meta-tools are never auto-bypassed — if there's no pending event, skip recording.
    // (Means the hook missed the PermissionRequest, e.g. hook wasn't running yet.)
    let Some(pending) = matched else { return };

    let delta = now - pending.ts;
    let verdict = if delta >= thresh { "reviewed" } else { "rubber_stamped" };

    let decision = Decision {
        ts: now,
        sid: session_id.to_string(),
        tool: tool.to_string(),
        summary: input_summary(input_str),
        len: input_str.len(),
        time_ms: Some(delta),
        complexity,
        threshold_ms: thresh,
        verdict: verdict.to_string(),
        user,
        cwd,
        bypass_rule: None,
    };

    let ddir = decisions_dir(home);
    let _ = fs::create_dir_all(&ddir);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(decisions_file(home)) {
        if let Ok(line) = serde_json::to_string(&decision) {
            let _ = writeln!(f, "{}", line);
        }
    }

    update_status(home, session_id, verdict);
}

const PENDING_TTL_MS: i64 = 30 * 60 * 1000; // 30 minutes

fn find_and_remove_pending(pfile: &Path, tool: &str, hash: &str) -> Option<PendingEvent> {
    if !pfile.exists() { return None; }

    let content = fs::read_to_string(pfile).ok()?;
    let now = Utc::now().timestamp_millis();

    // Parse all lines, dropping malformed and expired entries
    let parsed: Vec<(usize, PendingEvent)> = content.lines().enumerate()
        .filter_map(|(i, line)| {
            let ev: PendingEvent = serde_json::from_str(line).ok()?;
            if now - ev.ts > PENDING_TTL_MS { return None; } // expired
            Some((i, ev))
        })
        .collect();

    // Find the most recent matching event among the live ones
    let match_idx = parsed.iter().rev()
        .find(|(_, ev)| ev.tool == tool && ev.input_hash == hash)
        .map(|(i, _)| *i);

    let matched_orig_idx = match_idx?;
    let matched = parsed.iter().find(|(i, _)| *i == matched_orig_idx)
        .map(|(_, ev)| ev.clone())?;

    // Rewrite file: keep live entries except the matched one
    let remaining: Vec<String> = parsed.iter()
        .filter(|(i, _)| *i != matched_orig_idx)
        .map(|(_, ev)| serde_json::to_string(ev).unwrap_or_default())
        .collect();

    if remaining.is_empty() {
        let _ = fs::remove_file(pfile);
    } else {
        let _ = fs::write(pfile, remaining.join("\n") + "\n");
    }

    Some(matched)
}

// ── Main ──────────────────────────────────────────────────────────────────────

fn main() {
    let home = dirs_home();

    // Read stdin
    let mut raw = String::new();
    let _ = io::stdin().read_to_string(&mut raw);

    let input: HookInput = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return,
    };

    let event = match input.hook_event_name.as_deref() {
        Some(e) => e,
        None => return,
    };

    if !["PermissionRequest", "PreToolUse", "PostToolUse"].contains(&event) {
        return;
    }

    let now = Utc::now().timestamp_millis();

    // Flatten tool_input to a string
    let input_str = match &input.tool_input {
        Some(Value::String(s)) => s.clone(),
        Some(v) => v.to_string(),
        None => String::new(),
    };

    // Load allow rules once (not needed for PostToolUse but cheap)
    let rules = load_allow_rules(&home);

    // Ensure base dirs exist
    let _ = fs::create_dir_all(data_dir(&home));

    match event {
        "PermissionRequest" => handle_permission_request(&home, &input, &input_str, now),
        "PreToolUse" => handle_pre_tool_use(&home, &input, &input_str, now, &rules),
        "PostToolUse" => handle_post_tool_use(&home, &input, &input_str, now),
        _ => {}
    }
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}
