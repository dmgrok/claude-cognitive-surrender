// Statusline script for Claude Code — reads the pre-computed status cache written
// by hook.ts after every decision, so counts are always current.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DATA_DIR = join(homedir(), '.cognitive-surrender');
const STATUS_CACHE_PATH = join(DATA_DIR, 'status.json');

function main() {
  // Drain stdin (Claude Code requires it)
  process.stdin.resume();
  process.stdin.on('data', () => {});
  process.stdin.on('end', () => {
    if (!existsSync(STATUS_CACHE_PATH)) {
      process.stdout.write('cs: no data yet\n');
      process.exit(0);
    }

    let counts: Record<string, number> = {};
    try {
      const parsed = JSON.parse(readFileSync(STATUS_CACHE_PATH, 'utf8'));
      counts = parsed.counts ?? {};
    } catch {
      process.exit(0);
    }

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

    // Traffic light: green <30%, yellow <60%, red ≥60%
    const dot = surrenderPct < 30 ? '●' : surrenderPct < 60 ? '◐' : '○';

    process.stdout.write(
      `${dot} ${reviewed}/${prompted} reviewed  ${auto} auto  (${surrenderPct}% surrender today)\n`
    );

    process.exit(0);
  });
}

main();
