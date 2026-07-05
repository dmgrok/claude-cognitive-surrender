import chalk from 'chalk';
import { readDecisions } from '../storage.js';
import { calculateCSI } from '../scoring.js';
import { getProvocation } from '../provocations.js';
import { box, highlightNumbers } from '../render.js';

export function challengeCommand(days: number) {
  const decisions = readDecisions({ days });

  if (decisions.length === 0) {
    console.log(chalk.dim(`No data for the last ${days} day(s). Run 'cs install' then use Claude Code.`));
    return;
  }

  const csi = calculateCSI(decisions);
  const rubberStamped = decisions.filter(d => d.verdict === 'rubber_stamped');
  const bypassed = decisions.filter(d => d.verdict === 'bypassed');
  const reviewed = decisions.filter(d => d.verdict === 'reviewed');

  const fastestRubberStamp = rubberStamped.length > 0
    ? rubberStamped.reduce((a, b) => (a.time_ms ?? Infinity) < (b.time_ms ?? Infinity) ? a : b)
    : null;

  const toolCounts = new Map<string, number>();
  for (const d of rubberStamped) toolCounts.set(d.tool, (toolCounts.get(d.tool) ?? 0) + 1);
  const worstTool = toolCounts.size > 0 ? [...toolCounts.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;

  const humanTimes = decisions.filter(d => d.time_ms !== null).map(d => d.time_ms!);
  const avgTime = humanTimes.length > 0 ? humanTimes.reduce((a, b) => a + b, 0) / humanTimes.length : null;

  const provocation = getProvocation({
    csi,
    totalDecisions: decisions.length,
    rubberStampedCount: rubberStamped.length,
    bypassedCount: bypassed.length,
    reviewedCount: reviewed.length,
    fastestRubberStamp: fastestRubberStamp ? {
      tool: fastestRubberStamp.tool,
      ms: fastestRubberStamp.time_ms!,
      summary: fastestRubberStamp.summary ?? '',
    } : null,
    worstTool,
    avgDecisionTime: avgTime,
  });

  const header = chalk.bold.hex('#f59e0b')('⚠  DAILY CHALLENGE');
  const headerSep = chalk.dim('─'.repeat(63));

  const contentLines: string[] = [
    header,
    headerSep,
    ...provocation.split('\n').map(line => highlightNumbers(line)),
  ];

  console.log('');
  console.log(box(contentLines, { style: 'double', gradientBorder: true, width: 65 }));
  console.log('');
}
