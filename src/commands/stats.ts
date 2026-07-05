import chalk from 'chalk';
import { readDecisions, type Decision } from '../storage.js';
import { calculateCSI, csiLabel } from '../scoring.js';
import {
  gradientBar, sparkChar, divider, table, padLeft, padRight, stripAnsi
} from '../render.js';

interface ToolStat {
  tool: string;
  total: number;
  reviewed: number;
  rubber_stamped: number;
  bypassed: number;
  avgTimeMs: number | null;
}

export function statsCommand(days: number) {
  const decisions = readDecisions({ days });

  if (decisions.length === 0) {
    console.log(chalk.dim(`No data for the last ${days} day(s). Run 'cs install' then use Claude Code.`));
    return;
  }

  const csi = calculateCSI(decisions);
  const label = csiLabel(csi);

  // Header box
  const title = 'C O G N I T I V E   S U R R E N D E R   I N D E X';
  const boxWidth = stripAnsi(title).length + 4;
  const hLine = '─'.repeat(boxWidth);
  console.log('');
  console.log(chalk.dim(`  ╭${hLine}╮`));
  console.log(`  │  ${chalk.bold(title)}  ${chalk.dim('│')}`);
  console.log(chalk.dim(`  ╰${hLine}╯`));
  console.log('');

  // CSI bar
  const bar = gradientBar(csi, 100, 40);
  console.log(`  ${bar}  ${chalk.bold(String(csi))}/100`);
  console.log(`  ${chalk.dim(`"${label}"`)}`);
  console.log('');

  const totalBypassed = decisions.filter(d => d.verdict === 'bypassed').length;
  const totalRubberStamped = decisions.filter(d => d.verdict === 'rubber_stamped').length;
  const totalReviewed = decisions.filter(d => d.verdict === 'reviewed').length;
  const total = decisions.length;

  // Summary with proportional mini-bars
  const bypassBar = totalBypassed > 0 ? chalk.dim(sparkChar(totalBypassed / total).repeat(Math.max(1, Math.round((totalBypassed / total) * 8)))) : '';
  const rsBar = totalRubberStamped > 0 ? chalk.red(sparkChar(totalRubberStamped / total).repeat(Math.max(1, Math.round((totalRubberStamped / total) * 8)))) : '';
  const revBar = totalReviewed > 0 ? chalk.rgb(34, 197, 94)(sparkChar(totalReviewed / total).repeat(Math.max(1, Math.round((totalReviewed / total) * 8)))) : '';

  const countW = String(total).length;
  console.log(`  ${chalk.bold(padLeft(String(total), countW))} total tool calls`);
  console.log(`  ${chalk.dim(padLeft(String(totalBypassed), countW))} bypassed          ${bypassBar}  ${chalk.dim('(auto-allowed by your rules)')}`);
  console.log(`  ${chalk.red(padLeft(String(totalRubberStamped), countW))} rubber-stamped    ${rsBar}  ${chalk.dim('(approved without real review)')}`);
  console.log(`  ${chalk.rgb(34, 197, 94)(padLeft(String(totalReviewed), countW))} actually reviewed ${revBar}`);
  console.log('');

  const byTool = groupByTool(decisions);

  const headers = ['Tool', 'Total', 'Reviewed', 'Rubber-Stamped', 'Bypassed', 'Avg Time', ''];
  const rows = byTool.map(s => {
    const prompted = s.total - s.bypassed;
    const rsRate = prompted > 0 ? s.rubber_stamped / prompted : 0;
    const revRate = prompted > 0 ? s.reviewed / prompted : 0;
    const sparkRs = rsRate > 0 ? chalk.red(sparkChar(rsRate)) : chalk.dim('▁');
    const sparkRev = revRate > 0 ? chalk.rgb(34, 197, 94)(sparkChar(revRate)) : '';
    const indicator = sparkRs + sparkRev;
    return [
      s.tool,
      String(s.total),
      `${s.reviewed} (${pct(s.reviewed, prompted)}%)`,
      chalk.red(`${s.rubber_stamped} (${pct(s.rubber_stamped, prompted)}%)`),
      chalk.dim(String(s.bypassed)),
      s.avgTimeMs !== null ? `${(s.avgTimeMs / 1000).toFixed(1)}s` : chalk.dim('—'),
      indicator,
    ];
  });

  console.log(table(headers, rows, { rightAlign: [1, 2, 3, 4, 5], alternateRows: true }));

  const totalHuman = decisions.filter(d => d.verdict !== 'bypassed').length;
  const humanTimes = decisions.filter(d => d.time_ms !== null).map(d => d.time_ms!);
  const avgTime = humanTimes.length > 0 ? humanTimes.reduce((a, b) => a + b, 0) / humanTimes.length : null;
  const maxTime = humanTimes.length > 0 ? Math.max(...humanTimes) : null;

  console.log('');
  console.log(
    `  Total: ${chalk.bold(String(total))}  ` +
    `Prompted: ${totalHuman}  ` +
    chalk.red(`Rubber-stamped: ${totalRubberStamped}`) + `  ` +
    chalk.dim(`Bypassed: ${totalBypassed}`)
  );
  if (avgTime !== null) {
    console.log(chalk.dim(`  Avg decision time: ${(avgTime / 1000).toFixed(1)}s  Longest: ${maxTime !== null ? (maxTime / 1000).toFixed(1) + 's' : '—'}`));
  }

  // Bypass rules breakdown
  const bypassRules = new Map<string, number>();
  for (const d of decisions) {
    if (d.verdict === 'bypassed' && d.bypass_rule) {
      bypassRules.set(d.bypass_rule, (bypassRules.get(d.bypass_rule) ?? 0) + 1);
    }
  }
  const unknownBypassed = decisions.filter(d => d.verdict === 'bypassed' && !d.bypass_rule).length;

  if (bypassRules.size > 0 || unknownBypassed > 0) {
    console.log('');
    console.log(divider(65, 'dashed'));
    console.log(chalk.dim('  Bypassed by rule:'));
    const sorted = [...bypassRules.entries()].sort((a, b) => b[1] - a[1]);
    const maxCount = Math.max(...sorted.map(([, c]) => c), unknownBypassed);
    for (const [rule, count] of sorted) {
      const barLen = Math.max(1, Math.round((count / maxCount) * 10));
      const miniBar = chalk.dim('▇'.repeat(barLen));
      console.log(`    ${chalk.dim(padRight(rule, 42))} ${padLeft(String(count), 4)}  ${miniBar}`);
    }
    if (unknownBypassed > 0) {
      const barLen = Math.max(1, Math.round((unknownBypassed / maxCount) * 10));
      const miniBar = chalk.dim('▇'.repeat(barLen));
      console.log(`    ${chalk.dim(padRight('(unknown rule)', 42))} ${padLeft(String(unknownBypassed), 4)}  ${miniBar}`);
    }
  }

  console.log('');
}

function pct(n: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((n / total) * 100);
}

function groupByTool(decisions: Decision[]): ToolStat[] {
  const map = new Map<string, ToolStat>();
  for (const d of decisions) {
    if (!map.has(d.tool)) {
      map.set(d.tool, { tool: d.tool, total: 0, reviewed: 0, rubber_stamped: 0, bypassed: 0, avgTimeMs: null });
    }
    const s = map.get(d.tool)!;
    s.total++;
    if (d.verdict === 'reviewed') s.reviewed++;
    else if (d.verdict === 'rubber_stamped') s.rubber_stamped++;
    else s.bypassed++;
  }
  for (const [, s] of map) {
    const times = decisions.filter(d => d.tool === s.tool && d.time_ms !== null).map(d => d.time_ms!);
    s.avgTimeMs = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null;
  }
  return [...map.values()].sort((a, b) => b.rubber_stamped - a.rubber_stamped);
}
