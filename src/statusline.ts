import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STATUS_CACHE_PATH = join(homedir(), '.cognitive-surrender', 'status.json');

function summarize(counts: Record<string, number>): { reviewed: number; surrendered: number; auto: number; prompted: number; surrenderPct: number } {
  const reviewed = counts['reviewed'] ?? 0;
  const surrendered = counts['rubber_stamped'] ?? 0;
  const auto = counts['bypassed'] ?? 0;
  const prompted = reviewed + surrendered;
  const total = prompted + auto;
  const surrenderPct = total > 0 ? Math.round(((surrendered + auto) / total) * 100) : 0;
  return { reviewed, surrendered, auto, prompted, surrenderPct };
}

function dot(pct: number): string {
  return pct < 30 ? '●' : pct < 60 ? '◐' : '○';
}

function main() {
  process.stdin.resume();
  process.stdin.on('data', () => {});
  process.stdin.on('end', () => {
    if (!existsSync(STATUS_CACHE_PATH)) {
      process.stdout.write('cs: no data yet\n');
      process.exit(0);
    }

    let dayCounts: Record<string, number> = {};
    let sessionCounts: Record<string, number> = {};
    try {
      const parsed = JSON.parse(readFileSync(STATUS_CACHE_PATH, 'utf8'));
      dayCounts = parsed.dayCounts ?? parsed.counts ?? {};
      sessionCounts = parsed.sessionCounts ?? {};
    } catch {
      process.exit(0);
    }

    const day = summarize(dayCounts);
    const sess = summarize(sessionCounts);

    const dayTotal = day.prompted + day.auto;
    const sessTotal = sess.prompted + sess.auto;

    if (dayTotal === 0) {
      process.stdout.write('cs: no activity today\n');
      process.exit(0);
    }

    // Session line (only show if there's data)
    const sessLine = sessTotal > 0
      ? `${dot(sess.surrenderPct)} session ${sess.reviewed}/${sess.prompted} reviewed  ${sess.auto} auto`
      : null;

    // Day line
    const dayLine = `${dot(day.surrenderPct)} today ${day.reviewed}/${day.prompted} reviewed  ${day.auto} auto  (${day.surrenderPct}% surrender)`;

    process.stdout.write(sessLine ? `${sessLine}  │  ${dayLine}\n` : `${dayLine}\n`);
    process.exit(0);
  });
}

main();
