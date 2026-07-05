// Hook entry point — called by Claude Code on PermissionRequest, PreToolUse, PostToolUse.
// Must be fast: reads stdin, writes to SQLite, exits. No async overhead.
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import Database from 'better-sqlite3';

const STATUS_CACHE_PATH = join(homedir(), '.cognitive-surrender', 'status.json');

const DATA_DIR = join(homedir(), '.cognitive-surrender');
const DB_PATH = join(DATA_DIR, 'data.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp_ms INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  hook_event TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input_hash TEXT NOT NULL,
  tool_input_summary TEXT,
  raw_input_length INTEGER,
  cwd TEXT,
  user TEXT NOT NULL,
  matched INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input_summary TEXT,
  input_length INTEGER,
  decision_time_ms INTEGER,
  complexity REAL NOT NULL,
  threshold_ms INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  user TEXT NOT NULL,
  cwd TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_session_tool ON events(session_id, tool_name, hook_event);
CREATE INDEX IF NOT EXISTS idx_decisions_user ON decisions(user);
`;

const TOOL_WEIGHTS: Record<string, number> = {
  Bash: 0.7, Write: 0.6, Edit: 0.5, MultiEdit: 0.55,
  WebFetch: 0.2, WebSearch: 0.15, Read: 0.1, Glob: 0.05, Grep: 0.05, LS: 0.05,
};

function computeComplexity(toolName: string, input: string): number {
  let score = TOOL_WEIGHTS[toolName] ?? 0.3;
  if (input.length > 500) score += 0.15;
  if (input.length > 2000) score += 0.1;
  if (/\b(function|class|import|export|const|let|def |async |await )\b/.test(input)) score += 0.1;
  return Math.min(score, 1.0);
}

function getThreshold(complexity: number): number {
  return Math.round(1000 + complexity * 5000);
}

function getUser(): string {
  try { return execSync('git config user.name', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim(); }
  catch { return process.env.USER ?? 'unknown'; }
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;

  let data: Record<string, unknown>;
  try { data = JSON.parse(raw); }
  catch { process.exit(0); }

  const event = data.hook_event_name as string;
  if (!['PermissionRequest', 'PreToolUse', 'PostToolUse'].includes(event)) process.exit(0);

  const toolName = (data.tool_name as string) ?? 'Unknown';
  const toolInput = data.tool_input;
  const inputStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput ?? '');
  const inputHash = createHash('sha256').update(inputStr.slice(0, 500)).digest('hex');
  const inputSummary = inputStr.slice(0, 120).replace(/\s+/g, ' ');
  const sessionId = (data.session_id as string) ?? 'unknown';
  const cwd = (data.cwd as string) ?? null;
  const now = Date.now();
  const user = getUser();

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA);

  if (event === 'PermissionRequest') {
    db.prepare(`
      INSERT INTO events (timestamp_ms, session_id, hook_event, tool_name, tool_input_hash,
        tool_input_summary, raw_input_length, cwd, user)
      VALUES (?, ?, 'PermissionRequest', ?, ?, ?, ?, ?, ?)
    `).run(now, sessionId, toolName, inputHash, inputSummary, inputStr.length, cwd, user);

  } else if (event === 'PreToolUse') {
    // Check if there's a pending PermissionRequest to correlate
    const pending = db.prepare(`
      SELECT id, timestamp_ms FROM events
      WHERE session_id = ? AND tool_name = ? AND tool_input_hash = ?
        AND hook_event = 'PermissionRequest' AND matched = 0
      ORDER BY timestamp_ms DESC LIMIT 1
    `).get(sessionId, toolName, inputHash) as { id: number; timestamp_ms: number } | undefined;

    const complexity = computeComplexity(toolName, inputStr);
    const threshold = getThreshold(complexity);

    if (pending) {
      const decisionTimeMs = now - pending.timestamp_ms;
      const verdict = decisionTimeMs >= threshold ? 'reviewed' : 'rubber_stamped';

      db.prepare('UPDATE events SET matched = 1 WHERE id = ?').run(pending.id);
      db.prepare(`
        INSERT INTO decisions (session_id, timestamp_ms, tool_name, tool_input_summary,
          input_length, decision_time_ms, complexity, threshold_ms, verdict, user, cwd)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sessionId, now, toolName, inputSummary, inputStr.length,
             decisionTimeMs, complexity, threshold, verdict, user, cwd);
    } else {
      // No preceding PermissionRequest — auto-approved by settings or hooks
      db.prepare(`
        INSERT INTO decisions (session_id, timestamp_ms, tool_name, tool_input_summary,
          input_length, decision_time_ms, complexity, threshold_ms, verdict, user, cwd)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'bypassed', ?, ?)
      `).run(sessionId, now, toolName, inputSummary, inputStr.length,
             complexity, threshold, user, cwd);
    }
  }
  // PostToolUse: no action needed for now (reserved for future duration tracking)

  // After every PreToolUse decision, refresh the status cache so the statusline
  // always shows current counts without re-querying SQLite.
  if (event === 'PreToolUse') {
    try {
      const since = now - 24 * 60 * 60 * 1000;

      const dayRows = db.prepare(`
        SELECT verdict, COUNT(*) as count FROM decisions
        WHERE timestamp_ms >= ? GROUP BY verdict
      `).all(since) as Array<{ verdict: string; count: number }>;

      const sessionRows = db.prepare(`
        SELECT verdict, COUNT(*) as count FROM decisions
        WHERE session_id = ? GROUP BY verdict
      `).all(sessionId) as Array<{ verdict: string; count: number }>;

      const dayCounts: Record<string, number> = {};
      for (const r of dayRows) dayCounts[r.verdict] = r.count;

      const sessionCounts: Record<string, number> = {};
      for (const r of sessionRows) sessionCounts[r.verdict] = r.count;

      writeFileSync(STATUS_CACHE_PATH, JSON.stringify({
        dayCounts,
        sessionCounts,
        updatedAt: now,
      }));
    } catch { /* non-fatal */ }
  }

  db.close();
}

main().catch(() => process.exit(0));
