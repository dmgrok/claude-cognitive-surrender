// Statusline script for Claude Code — queries the DB and outputs a single line.
// Called after each assistant message with JSON on stdin (ignored, we just query the DB).
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DB_PATH = join(homedir(), '.cognitive-surrender', 'data.db');

interface Row { verdict: string; count: number }

function main() {
  // Read stdin (required, but we don't use the Claude context data)
  let _input = '';
  process.stdin.resume();
  process.stdin.on('data', (d) => { _input += d; });
  process.stdin.on('end', () => {
    if (!existsSync(DB_PATH)) {
      process.stdout.write('cs: no data — run "cs install"\n');
      process.exit(0);
    }

    let db: Database.Database;
    try {
      db = new Database(DB_PATH, { readonly: true });
    } catch {
      process.exit(0);
    }

    const since = Date.now() - 24 * 60 * 60 * 1000; // last 24h

    const rows = db.prepare(`
      SELECT verdict, COUNT(*) as count
      FROM decisions
      WHERE timestamp_ms >= ?
      GROUP BY verdict
    `).all(since) as Row[];

    db.close();

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.verdict] = r.count;

    const reviewed = counts['reviewed'] ?? 0;
    const surrendered = counts['surrendered'] ?? 0;
    const auto = counts['auto_approved'] ?? 0;
    const prompted = reviewed + surrendered;
    const total = prompted + auto;

    if (total === 0) {
      process.stdout.write('cs: no activity today\n');
      process.exit(0);
    }

    const surrenderPct = prompted > 0 ? Math.round((surrendered / prompted) * 100) : 0;

    // Traffic light: green if <30% surrender, yellow if <60%, red otherwise
    const dot = surrenderPct < 30 ? '●' : surrenderPct < 60 ? '◐' : '○';

    process.stdout.write(
      `${dot} ${reviewed}/${prompted} reviewed  ${auto} auto  (${surrenderPct}% surrender today)\n`
    );

    process.exit(0);
  });
}

main();
