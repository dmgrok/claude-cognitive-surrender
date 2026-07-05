import chalk from 'chalk';
import { openDb, type Decision } from '../db.js';
import { calculateCSI, csiLabel } from '../scoring.js';

interface ToolStat {
  tool: string;
  total: number;
  reviewed: number;
  surrendered: number;
  auto_approved: number;
  avgTimeMs: number | null;
}

export function statsCommand(days: number) {
  const db = openDb();
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const decisions = db.prepare(`
    SELECT * FROM decisions WHERE timestamp_ms >= ? ORDER BY timestamp_ms DESC
  `).all(since) as Decision[];

  db.close();

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

  const byTool = groupByTool(decisions);

  const header = ['Tool', 'Total', 'Reviewed', 'Surrendered', 'Auto', 'Avg Time'];
  const rows = byTool.map(s => [
    s.tool,
    String(s.total),
    `${s.reviewed} (${pct(s.reviewed, s.total - s.auto_approved)}%)`,
    chalk.red(`${s.surrendered} (${pct(s.surrendered, s.total - s.auto_approved)}%)`),
    chalk.dim(String(s.auto_approved)),
    s.avgTimeMs !== null ? `${(s.avgTimeMs / 1000).toFixed(1)}s` : chalk.dim('—'),
  ]);

  printTable(header, rows);

  const totalHuman = decisions.filter(d => d.verdict !== 'auto_approved').length;
  const totalSurrendered = decisions.filter(d => d.verdict === 'surrendered').length;
  const totalAuto = decisions.filter(d => d.verdict === 'auto_approved').length;
  const humanTimes = decisions.filter(d => d.decision_time_ms !== null).map(d => d.decision_time_ms!);
  const avgTime = humanTimes.length > 0 ? humanTimes.reduce((a, b) => a + b, 0) / humanTimes.length : null;
  const maxTime = humanTimes.length > 0 ? Math.max(...humanTimes) : null;

  console.log('');
  console.log(
    `  Total: ${decisions.length}  ` +
    `Prompted: ${totalHuman}  ` +
    chalk.red(`Surrendered: ${totalSurrendered}`) + `  ` +
    chalk.dim(`Auto: ${totalAuto}`)
  );
  if (avgTime !== null) {
    console.log(`  Avg decision time: ${(avgTime / 1000).toFixed(1)}s  Longest: ${maxTime !== null ? (maxTime / 1000).toFixed(1) + 's' : '—'}`);
  }
  console.log('');
}

function buildCsiBar(csi: number): string {
  const filled = Math.round(csi / 5);
  const empty = 20 - filled;
  const bar = chalk.red('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
  return `[${bar}]`;
}

function pct(n: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((n / total) * 100);
}

function groupByTool(decisions: Decision[]): ToolStat[] {
  const map = new Map<string, ToolStat>();

  for (const d of decisions) {
    if (!map.has(d.tool_name)) {
      map.set(d.tool_name, { tool: d.tool_name, total: 0, reviewed: 0, surrendered: 0, auto_approved: 0, avgTimeMs: null });
    }
    const s = map.get(d.tool_name)!;
    s.total++;
    if (d.verdict === 'reviewed') s.reviewed++;
    else if (d.verdict === 'surrendered') s.surrendered++;
    else s.auto_approved++;
  }

  for (const [, s] of map) {
    const times = decisions
      .filter(d => d.tool_name === s.tool && d.decision_time_ms !== null)
      .map(d => d.decision_time_ms!);
    s.avgTimeMs = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null;
  }

  return [...map.values()].sort((a, b) => b.surrendered - a.surrendered);
}

function printTable(headers: string[], rows: string[][]) {
  const allRows = [headers, ...rows];
  const colWidths = headers.map((_, i) =>
    Math.max(...allRows.map(r => stripAnsi(r[i] ?? '').length))
  );

  const separator = '  ' + colWidths.map(w => '─'.repeat(w)).join('─┼─');
  const fmt = (row: string[], bold = false) =>
    '  ' + row.map((cell, i) => {
      const plain = stripAnsi(cell);
      const pad = ' '.repeat(colWidths[i] - plain.length);
      return bold ? chalk.bold(cell) + pad : cell + pad;
    }).join(' │ ');

  console.log(fmt(headers, true));
  console.log(separator);
  for (const row of rows) console.log(fmt(row));
}

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}
