import chalk from 'chalk';
import { openDb, type Decision } from '../db.js';
import { calculateCSI } from '../scoring.js';
import { getProvocation } from '../provocations.js';

export function challengeCommand(days: number) {
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
  const rubberStamped = decisions.filter(d => d.verdict === 'rubber_stamped');
  const bypassed = decisions.filter(d => d.verdict === 'bypassed');
  const reviewed = decisions.filter(d => d.verdict === 'reviewed');

  const fastestRubberStamp = rubberStamped.length > 0
    ? rubberStamped.reduce((a, b) =>
        (a.decision_time_ms ?? Infinity) < (b.decision_time_ms ?? Infinity) ? a : b)
    : null;

  const toolCounts = new Map<string, number>();
  for (const d of rubberStamped) {
    toolCounts.set(d.tool_name, (toolCounts.get(d.tool_name) ?? 0) + 1);
  }
  const worstTool = toolCounts.size > 0
    ? [...toolCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  const humanTimes = decisions.filter(d => d.decision_time_ms !== null).map(d => d.decision_time_ms!);
  const avgTime = humanTimes.length > 0
    ? humanTimes.reduce((a, b) => a + b, 0) / humanTimes.length
    : null;

  const provocation = getProvocation({
    csi,
    totalDecisions: decisions.length,
    rubberStampedCount: rubberStamped.length,
    bypassedCount: bypassed.length,
    reviewedCount: reviewed.length,
    fastestRubberStamp: fastestRubberStamp ? {
      tool: fastestRubberStamp.tool_name,
      ms: fastestRubberStamp.decision_time_ms!,
      summary: fastestRubberStamp.tool_input_summary ?? '',
    } : null,

    worstTool,
    avgDecisionTime: avgTime,
  });

  const width = 65;
  const border = '─'.repeat(width);
  console.log('');
  console.log(`  ┌${border}┐`);
  console.log(`  │${' '.repeat(width)}│`);
  for (const line of provocation.split('\n')) {
    const chunks = wrapLine(line, width - 2);
    for (const chunk of chunks) {
      const pad = width - 2 - chunk.length;
      console.log(`  │ ${chunk}${' '.repeat(pad)} │`);
    }
  }
  console.log(`  │${' '.repeat(width)}│`);
  console.log(`  └${border}┘`);
  console.log('');
}

function wrapLine(line: string, maxWidth: number): string[] {
  if (line.length === 0) return [''];
  if (line.length <= maxWidth) return [line];
  const words = line.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + (current ? 1 : 0) > maxWidth) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
