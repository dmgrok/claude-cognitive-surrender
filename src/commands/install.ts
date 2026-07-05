import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import chalk from 'chalk';
import { DATA_DIR, DECISIONS_DIR } from '../storage.js';

const _require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));

const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
const HOOK_MARKER = 'cognitive-surrender';

export function installCommand(hookPath: string) {
  const resolvedHook = hookPath || getDefaultHookPath();
  const resolvedStatusline = join(__dirname, 'statusline.cjs');

  if (!existsSync(resolvedHook)) {
    console.error(chalk.red(`Hook binary not found at: ${resolvedHook}`));
    console.error(chalk.dim('Run "cd hook && cargo build --release" first, then "cs install".'));
    process.exit(1);
  }

  let settings: Record<string, unknown> = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    } catch {
      console.error(chalk.red(`Could not parse ${SETTINGS_PATH}`));
      process.exit(1);
    }
  }

  // Install hooks
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
  const hooks = settings.hooks as Record<string, unknown[]>;

  const hookEntry = { type: 'command', command: resolvedHook, timeout: 3 };
  let installed = 0;

  for (const event of ['PermissionRequest', 'PreToolUse', 'PostToolUse']) {
    if (!Array.isArray(hooks[event])) hooks[event] = [];
    const alreadyInstalled = (hooks[event] as unknown[]).some((group: unknown) => {
      if (typeof group !== 'object' || group === null) return false;
      const g = group as Record<string, unknown>;
      return Array.isArray(g.hooks) && (g.hooks as unknown[]).some((h: unknown) => {
        if (typeof h !== 'object' || h === null) return false;
        const hh = h as Record<string, unknown>;
        return typeof hh.command === 'string' && hh.command.includes(HOOK_MARKER);
      });
    });
    if (!alreadyInstalled) {
      (hooks[event] as unknown[]).push({ matcher: '', hooks: [hookEntry] });
      installed++;
    }
  }

  // Install statusline
  let statuslineInstalled = false;
  if (existsSync(resolvedStatusline)) {
    const existing = settings.statusLine as Record<string, unknown> | undefined;
    if (!existing?.command || !(existing.command as string).includes(HOOK_MARKER)) {
      settings.statusLine = { type: 'command', command: `node ${resolvedStatusline}` };
      statuslineInstalled = true;
    }
  }

  if (installed === 0 && !statuslineInstalled) {
    console.log(chalk.yellow('Already installed. Nothing to do.'));
  } else {
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
    if (installed > 0) {
      console.log(chalk.green(`✓ Installed ${installed} hook(s) into ${SETTINGS_PATH}`));
      console.log(chalk.dim(`  Hook binary: ${resolvedHook}`));
    }
    if (statuslineInstalled) {
      console.log(chalk.green('✓ Installed status line'));
      console.log(chalk.dim(`  Statusline: ${resolvedStatusline}`));
    }
    console.log(chalk.dim('  Restart Claude Code for changes to take effect.'));
  }

  // Migrate from SQLite v1 if data.db exists
  migrateFromSqlite();
}

export function uninstallCommand() {
  if (!existsSync(SETTINGS_PATH)) {
    console.log(chalk.dim('No settings.json found. Nothing to uninstall.'));
    return;
  }

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    console.error(chalk.red(`Could not parse ${SETTINGS_PATH}`));
    process.exit(1);
  }

  if (!settings.hooks || typeof settings.hooks !== 'object') {
    console.log(chalk.dim('No hooks configured. Nothing to uninstall.'));
    return;
  }

  const hooks = settings.hooks as Record<string, unknown[]>;
  let removed = 0;

  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue;
    const before = (hooks[event] as unknown[]).length;
    hooks[event] = (hooks[event] as unknown[]).filter((group: unknown) => {
      if (typeof group !== 'object' || group === null) return true;
      const g = group as Record<string, unknown>;
      if (!Array.isArray(g.hooks)) return true;
      return !(g.hooks as unknown[]).some((h: unknown) => {
        if (typeof h !== 'object' || h === null) return false;
        const hh = h as Record<string, unknown>;
        return typeof hh.command === 'string' && hh.command.includes(HOOK_MARKER);
      });
    });
    removed += before - (hooks[event] as unknown[]).length;
  }

  let statuslineRemoved = false;
  const sl = settings.statusLine as Record<string, unknown> | undefined;
  if (sl && typeof sl.command === 'string' && sl.command.includes(HOOK_MARKER)) {
    delete settings.statusLine;
    statuslineRemoved = true;
  }

  if (removed === 0 && !statuslineRemoved) {
    console.log(chalk.dim('No cognitive-surrender config found. Nothing to remove.'));
    return;
  }

  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
  if (removed > 0) console.log(chalk.green(`✓ Removed ${removed} hook group(s)`));
  if (statuslineRemoved) console.log(chalk.green('✓ Removed status line'));
}

function getDefaultHookPath(): string {
  // __dirname is dist/ at runtime; project root is one level up
  const projectRoot = join(__dirname, '..');
  return join(projectRoot, 'hook', 'target', 'release', 'cs-hook');
}

function migrateFromSqlite() {
  const dbPath = join(DATA_DIR, 'data.db');
  if (!existsSync(dbPath)) return;

  console.log(chalk.dim('\n  Migrating v1 SQLite data to JSONL...'));

  try {
    const Database = _require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });

    const rows = db.prepare('SELECT * FROM decisions ORDER BY timestamp_ms ASC').all() as any[];
    db.close();

    if (rows.length === 0) {
      console.log(chalk.dim('  No v1 data to migrate.'));
    } else {
      mkdirSync(DECISIONS_DIR, { recursive: true });
      let count = 0;

      for (const row of rows) {
        const date = new Date(row.timestamp_ms).toISOString().slice(0, 10);
        const file = join(DECISIONS_DIR, `${date}.jsonl`);
        const decision = {
          ts: row.timestamp_ms,
          sid: row.session_id,
          tool: row.tool_name,
          summary: row.tool_input_summary,
          len: row.input_length ?? 0,
          time_ms: row.decision_time_ms,
          complexity: row.complexity,
          threshold_ms: row.threshold_ms,
          verdict: row.verdict,
          user: row.user,
          cwd: row.cwd,
          bypass_rule: null,
        };
        appendFileSync(file, JSON.stringify(decision) + '\n');
        count++;
      }

      renameSync(dbPath, dbPath + '.migrated');
      console.log(chalk.green(`  ✓ Migrated ${count} decisions. Old DB → data.db.migrated`));
    }
  } catch (e: any) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.message?.includes('better-sqlite3')) {
      console.log(chalk.yellow('  better-sqlite3 not installed — skipping v1 migration.'));
      console.log(chalk.dim('  (Install it temporarily with: npm install better-sqlite3)'));
    } else {
      console.log(chalk.yellow(`  Migration failed: ${e?.message ?? e}`));
    }
  }
}
