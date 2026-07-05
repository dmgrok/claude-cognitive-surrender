import chalk from 'chalk';
import { readDecisions, type Decision } from '../storage.js';
import { calculateCSI, csiLabel } from '../scoring.js';
import { getProvocation } from '../provocations.js';
import { gradientBar, flameBar, highlightNumbers, stripAnsi, padLeft, padRight } from '../render.js';

interface ToolStat {
  tool: string;
  total: number;
  reviewed: number;
  rubber_stamped: number;
  bypassed: number;
  avgTimeMs: number | null;
}

// ── Dashboard constants ───────────────────────────────────────────────────────

const W = 76; // inner panel width (between │ chars)
const INDENT = ' ';

// ── Panel helpers ─────────────────────────────────────────────────────────────

function row(content: string, dimBorder = false): string {
  const v = dimBorder ? chalk.dim('│') : chalk.dim('│');
  const contentLen = stripAnsi(content).length;
  const rpad = ' '.repeat(Math.max(0, W - contentLen));
  return `${INDENT}${v}${content}${rpad}${v}`;
}

function borderTop(title?: string): string {
  if (title) {
    const t = ` ${title} `;
    const tlen = stripAnsi(t).length;
    const left = Math.floor((W - tlen) / 2);
    const right = W - tlen - left;
    const fill = chalk.dim('─'.repeat(left)) + chalk.bold.hex('#a78bfa')(t) + chalk.dim('─'.repeat(right));
    return `${INDENT}${chalk.dim('╭')}${fill}${chalk.dim('╮')}`;
  }
  return `${INDENT}${chalk.dim('╭' + '─'.repeat(W) + '╮')}`;
}

function borderMid(label?: string): string {
  if (label) {
    const t = ` ${label} `;
    const tlen = stripAnsi(t).length;
    const left = 2;
    const right = W - tlen - left;
    const fill = chalk.dim('─'.repeat(left)) + chalk.dim(t) + chalk.dim('─'.repeat(right));
    return `${INDENT}${chalk.dim('├')}${fill}${chalk.dim('┤')}`;
  }
  return `${INDENT}${chalk.dim('├' + '─'.repeat(W) + '┤')}`;
}

function borderBot(): string {
  return `${INDENT}${chalk.dim('╰' + '─'.repeat(W) + '╯')}`;
}

function blank(): string {
  return row('');
}

// ── Distribution bar: reviewed │ rubber_stamped │ bypassed ───────────────────

function distBar(reviewed: number, rubberStamped: number, bypassed: number, width: number): string {
  const total = reviewed + rubberStamped + bypassed;
  if (total === 0) return chalk.dim('░'.repeat(width));
  // Give at least 1 char to non-zero categories so they're always visible
  let rLen = reviewed > 0 ? Math.max(1, Math.round((reviewed / total) * width)) : 0;
  let rsLen = rubberStamped > 0 ? Math.max(1, Math.round((rubberStamped / total) * width)) : 0;
  const bLen = Math.max(0, width - rLen - rsLen);
  return (
    chalk.rgb(34, 197, 94)('█'.repeat(rLen)) +
    chalk.rgb(239, 68, 68)('█'.repeat(rsLen)) +
    chalk.rgb(60, 60, 60)('░'.repeat(bLen))
  );
}

// ── Tool chart row ────────────────────────────────────────────────────────────

function toolChartRow(s: ToolStat, maxTotal: number, labelWidth: number): string {
  const BAR_WIDTH = 28;
  const label = padRight(s.tool.replace('mcp__playwright__', 'pw:'), labelWidth);
  const bar = distBar(s.reviewed, s.rubber_stamped, s.bypassed, BAR_WIDTH);
  const countStr = padLeft(String(s.total), 4);
  const prompted = s.total - s.bypassed;
  const rsRate = prompted > 0 ? Math.round((s.rubber_stamped / prompted) * 100) : null;
  const rateStr = rsRate !== null
    ? (rsRate >= 80 ? chalk.red(padLeft(`${rsRate}%`, 4)) : rsRate === 0 ? chalk.rgb(34, 197, 94)(padLeft(`${rsRate}%`, 4)) : chalk.hex('#f59e0b')(padLeft(`${rsRate}%`, 4)))
    : chalk.dim(padLeft('—', 4));
  const avgStr = s.avgTimeMs !== null ? chalk.dim(padLeft(`${(s.avgTimeMs / 1000).toFixed(1)}s`, 6)) : chalk.dim(padLeft('—', 6));
  return row(` ${chalk.dim(label)}  ${bar}  ${chalk.dim(countStr)}  ${rateStr}  ${avgStr}`);
}

// ── Stacked distribution strip (full-width) ───────────────────────────────────

function fullDistStrip(reviewed: number, rubberStamped: number, bypassed: number): string {
  const bar = distBar(reviewed, rubberStamped, bypassed, W - 2);
  return row(` ${bar} `);
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function statsCommand(days: number) {
  const decisions = readDecisions({ days });

  if (decisions.length === 0) {
    console.log(chalk.dim(`No data for the last ${days} day(s). Run 'cs install' then use Claude Code.`));
    return;
  }

  const csi = calculateCSI(decisions);
  const label = csiLabel(csi);
  const total = decisions.length;
  const totalBypassed = decisions.filter(d => d.verdict === 'bypassed').length;
  const totalRS = decisions.filter(d => d.verdict === 'rubber_stamped').length;
  const totalReviewed = decisions.filter(d => d.verdict === 'reviewed').length;
  const byTool = groupByTool(decisions);

  // Streak calc
  const allDecisions = readDecisions({}).sort((a, b) => b.ts - a.ts).slice(0, 500);
  let currentStreak = 0;
  for (const d of allDecisions) {
    if (d.verdict === 'reviewed') break;
    currentStreak++;
  }
  let longestStreak = 0;
  let run = 0;
  for (const d of [...allDecisions].reverse()) {
    if (d.verdict !== 'reviewed') { run++; if (run > longestStreak) longestStreak = run; }
    else run = 0;
  }

  const humanTimes = decisions.filter(d => d.time_ms !== null).map(d => d.time_ms!);
  const avgTime = humanTimes.length > 0 ? humanTimes.reduce((a, b) => a + b, 0) / humanTimes.length : null;
  const maxTime = humanTimes.length > 0 ? Math.max(...humanTimes) : null;

  const lines: string[] = [];
  lines.push('');

  // ── TOP BORDER ──
  lines.push(borderTop('COGNITIVE SURRENDER'));

  // ── CSI SCORECARD ──
  lines.push(blank());

  const csiBar = gradientBar(csi, 100, 40);
  const [r, g, b] = csi >= 75 ? [239, 68, 68] : csi >= 45 ? [234, 179, 8] : [34, 197, 94];
  const csiNum = chalk.bold.rgb(r, g, b)(String(csi));
  lines.push(row(`  ${csiBar}  ${csiNum}/100`));
  lines.push(row(`  ${chalk.dim(`"${label}"`)}`));
  lines.push(blank());

  // Distribution strip
  lines.push(row(` ${chalk.rgb(34, 197, 94)('█')} reviewed  ${chalk.rgb(239, 68, 68)('█')} rubber-stamped  ${chalk.rgb(60, 60, 60)('░')} bypassed`));
  lines.push(fullDistStrip(totalReviewed, totalRS, totalBypassed));
  lines.push(blank());

  // Summary counts inline
  const human = total - totalBypassed;
  const rsRatePct = human > 0 ? Math.round((totalRS / human) * 100) : 0;
  const line1 = `  ${chalk.bold(String(total))} calls  ·  ${chalk.dim(String(totalBypassed))} bypassed  ·  ${chalk.red(String(totalRS))} rubber-stamped  ·  ${chalk.rgb(34, 197, 94)(String(totalReviewed))} reviewed`;
  lines.push(row(line1));
  const line2parts = [`  ${chalk.dim(String(human))} prompted  ·  ${chalk.bold(String(rsRatePct) + '% rs rate')}`];
  if (avgTime !== null) line2parts.push(`  ·  avg ${(avgTime / 1000).toFixed(1)}s  longest ${maxTime !== null ? (maxTime / 1000).toFixed(1) + 's' : '—'}`);
  lines.push(row(line2parts.join('')));

  // ── TOOL CHART ──
  lines.push(borderMid('by tool'));

  const labelWidth = Math.min(24, Math.max(...byTool.map(s => s.tool.replace('mcp__playwright__', 'pw:').length)));
  const maxTotal = Math.max(...byTool.map(s => s.total));

  // chart header
  lines.push(row(` ${chalk.dim(padRight('', labelWidth))}  ${chalk.dim(padRight('reviewed ░ rubber ░ bypassed', 28))}  ${chalk.dim('   n   %rs     avg')}`));

  for (const s of byTool) {
    lines.push(toolChartRow(s, maxTotal, labelWidth));
  }

  // ── STREAK ──
  lines.push(borderMid('streak'));
  lines.push(blank());

  if (currentStreak === 0) {
    lines.push(row(`  ${chalk.rgb(34, 197, 94)('✓')} No active streak — you're reviewing.`));
  } else {
    const fire = flameBar(Math.min(currentStreak, 32), 32);
    const streakColor = currentStreak >= 20 ? chalk.red : currentStreak >= 5 ? chalk.hex('#f59e0b') : chalk.yellow;
    lines.push(row(`  ${fire}  ${streakColor.bold(String(currentStreak))} ${chalk.dim('/ ' + String(longestStreak) + ' longest')}`));
  }
  lines.push(blank());

  // ── CHALLENGE ──
  lines.push(borderMid('today'));
  lines.push(blank());

  const rubberStamped = decisions.filter(d => d.verdict === 'rubber_stamped');
  const bypassed = decisions.filter(d => d.verdict === 'bypassed');
  const reviewed = decisions.filter(d => d.verdict === 'reviewed');
  const fastestRS = rubberStamped.length > 0
    ? rubberStamped.reduce((a, b) => (a.time_ms ?? Infinity) < (b.time_ms ?? Infinity) ? a : b)
    : null;
  const toolCounts = new Map<string, number>();
  for (const d of rubberStamped) toolCounts.set(d.tool, (toolCounts.get(d.tool) ?? 0) + 1);
  const worstTool = toolCounts.size > 0 ? [...toolCounts.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;

  const provocation = getProvocation({
    csi,
    totalDecisions: total,
    rubberStampedCount: rubberStamped.length,
    bypassedCount: bypassed.length,
    reviewedCount: reviewed.length,
    fastestRubberStamp: fastestRS ? { tool: fastestRS.tool, ms: fastestRS.time_ms!, summary: fastestRS.summary ?? '' } : null,
    worstTool,
    avgDecisionTime: avgTime,
  });

  const maxContent = W - 2;
  for (const line of provocation.split('\n')) {
    if (line === '') { lines.push(blank()); continue; }
    const words = highlightNumbers(line).split(' ');
    let cur = '';
    let curRaw = '';
    for (const word of words) {
      const wordRaw = stripAnsi(word);
      if (curRaw.length + wordRaw.length + (curRaw ? 1 : 0) > maxContent - 2) {
        if (cur) lines.push(row(`  ${cur}`));
        cur = word; curRaw = wordRaw;
      } else {
        cur = cur ? `${cur} ${word}` : word;
        curRaw = curRaw ? `${curRaw} ${wordRaw}` : wordRaw;
      }
    }
    if (cur) lines.push(row(`  ${cur}`));
  }

  lines.push(blank());
  lines.push(borderBot());
  lines.push('');

  console.log(lines.join('\n'));
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
  return [...map.values()].sort((a, b) => b.total - a.total);
}
