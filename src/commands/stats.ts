import chalk from 'chalk';
import { readDecisions, type Decision } from '../storage.js';
import { calculateCSI, csiLabel } from '../scoring.js';

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

  const bar = buildCsiBar(csi);
  console.log('');
  console.log(chalk.bold('  COGNITIVE SURRENDER INDEX'));
  console.log(`  ${bar}  ${chalk.bold(csi)}/100`);
  console.log(`  ${chalk.dim(`"${label}"`)}`);
  console.log('');

  const totalBypassed = decisions.filter(d => d.verdict === 'bypassed').length;
  const totalRubberStamped = decisions.filter(d => d.verdict === 'rubber_stamped').length;
  const totalReviewed = decisions.filter(d => d.verdict === 'reviewed').length;

  console.log(`  ${chalk.bold(`– ${decisions.length} total tool calls`)}`);
  console.log(`  – ${chalk.dim(`${totalBypassed} bypassed`)} ${chalk.dim('(auto-allowed by your rules)')}`);
  console.log(`  – ${chalk.red(`${totalRubberStamped} rubber-stamped`)} ${chalk.dim('(approved without real review)')}`);
  console.log(`  – ${chalk.green(`${totalReviewed} actually reviewed`)}`);
  console.log('');

  const byTool = groupByTool(decisions);
  const header = ['Tool', 'Total', 'Reviewed', 'Rubber-Stamped', 'Bypassed', 'Avg Time'];
  const rows = byTool.map(s => [
    s.tool,
    String(s.total),
    `${s.reviewed} (${pct(s.reviewed, s.total - s.bypassed)}%)`,
    chalk.red(`${s.rubber_stamped} (${pct(s.rubber_stamped, s.total - s.bypassed)}%)`),
    chalk.dim(String(s.bypassed)),
    s.avgTimeMs !== null ? `${(s.avgTimeMs / 1000).toFixed(1)}s` : chalk.dim('—'),
  ]);

  printTable(header, rows);

  const totalHuman = decisions.filter(d => d.verdict !== 'bypassed').length;
  const humanTimes = decisions.filter(d => d.time_ms !== null).map(d => d.time_ms!);
  const avgTime = humanTimes.length > 0 ? humanTimes.reduce((a, b) => a + b, 0) / humanTimes.length : null;
  const maxTime = humanTimes.length > 0 ? Math.max(...humanTimes) : null;

  console.log('');
  console.log(
    `  Total: ${decisions.length}  ` +
    `Prompted: ${totalHuman}  ` +
    chalk.red(`Rubber-stamped: ${totalRubberStamped}`) + `  ` +
    chalk.dim(`Bypassed: ${totalBypassed}`)
  );
  if (avgTime !== null) {
    console.log(`  Avg decision time: ${(avgTime / 1000).toFixed(1)}s  Longest: ${maxTime !== null ? (maxTime / 1000).toFixed(1) + 's' : '—'}`);
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
    console.log(chalk.dim('  Bypassed by rule:'));
    const sorted = [...bypassRules.entries()].sort((a, b) => b[1] - a[1]);
    for (const [rule, count] of sorted) {
      console.log(`    ${chalk.dim(rule.padEnd(40))} ${count}`);
    }
    if (unknownBypassed > 0) {
      console.log(`    ${chalk.dim('(unknown rule)'.padEnd(40))} ${unknownBypassed}`);
    }
  }

  console.log('');
}

function buildCsiBar(csi: number): string {
  const filled = Math.round(csi / 5);
  const empty = 20 - filled;
  return `[${chalk.red('█'.repeat(filled))}${chalk.dim('░'.repeat(empty))}]`;
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

function printTable(headers: string[], rows: string[][]) {
  const allRows = [headers, ...rows];
  const colWidths = headers.map((_, i) =>
    Math.max(...allRows.map(r => stripAnsi(r[i] ?? '').length))
  );
  const separator = '  ' + colWidths.map(w => '─'.repeat(w)).join('─┼─');
  const fmt = (row: string[], bold = false) =>
    '  ' + row.map((cell, i) => {
      const pad = ' '.repeat(colWidths[i] - stripAnsi(cell).length);
      return bold ? chalk.bold(cell) + pad : cell + pad;
    }).join(' │ ');

  console.log(fmt(headers, true));
  console.log(separator);
  for (const row of rows) console.log(fmt(row));
}

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}
