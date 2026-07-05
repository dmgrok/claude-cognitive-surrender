import chalk from 'chalk';
import { readDecisions } from '../storage.js';
import { flameBar, gradientBar, divider, stripAnsi } from '../render.js';

export function streakCommand() {
  const decisions = readDecisions({}).sort((a, b) => b.ts - a.ts).slice(0, 500);

  if (decisions.length === 0) {
    console.log(chalk.dim('No data yet. Run "cs install" then use Claude Code.'));
    return;
  }

  let currentStreak = 0;
  for (const d of decisions) {
    if (d.verdict === 'reviewed') break;
    currentStreak++;
  }

  let longestStreak = 0;
  let longestStreakStart: number | null = null;
  let run = 0;
  let runStart: number | null = null;
  for (const d of [...decisions].reverse()) {
    if (d.verdict !== 'reviewed') {
      if (run === 0) runStart = d.ts;
      run++;
      if (run > longestStreak) { longestStreak = run; longestStreakStart = runStart; }
    } else {
      run = 0; runStart = null;
    }
  }

  const lastReview = decisions.find(d => d.verdict === 'reviewed');

  console.log('');

  if (currentStreak === 0) {
    console.log(chalk.rgb(34, 197, 94)('  ✓ No active streak — you\'re reviewing.'));
  } else {
    const streakColor = currentStreak >= 10 ? chalk.red : currentStreak >= 5 ? chalk.hex('#f59e0b') : chalk.yellow;
    const fire = flameBar(Math.min(currentStreak, 20), 20);
    const streakNum = streakColor(String(currentStreak));

    // Line 1: fire bar + count
    const line1Content = `  ${fire}  ${streakNum} consecutive`;
    const line2Content = '  non-reviews';
    const innerWidth = Math.max(stripAnsi(line1Content).length, stripAnsi(line2Content).length) + 2;
    const hLine = '━'.repeat(innerWidth);

    function boxRow(content: string): string {
      const contentLen = stripAnsi(content).length;
      const pad = ' '.repeat(Math.max(0, innerWidth - contentLen));
      return chalk.dim('  ┃') + content + pad + chalk.dim('┃');
    }

    console.log(chalk.dim(`  ┏${hLine}┓`));
    console.log(boxRow(''));
    console.log(boxRow(line1Content));
    console.log(boxRow(line2Content));
    console.log(boxRow(''));
    console.log(chalk.dim(`  ┗${hLine}┛`));
  }

  // Comparison bars
  if (longestStreak > 0) {
    console.log('');
    const BAR_WIDTH = 20;
    const currentBar = currentStreak === 0
      ? chalk.rgb(34, 197, 94)('░'.repeat(BAR_WIDTH))
      : gradientBar(currentStreak, longestStreak, BAR_WIDTH);
    const longestBar = chalk.dim('█'.repeat(BAR_WIDTH));

    console.log(`  ${chalk.dim('Current')}  ${currentBar}  ${currentStreak > 0 ? String(currentStreak) : chalk.rgb(34, 197, 94)('0')}`);

    let longestLine = `  ${chalk.dim('Longest')}  ${longestBar}  ${chalk.bold(String(longestStreak))}`;
    if (longestStreakStart) {
      const when = new Date(longestStreakStart).toLocaleDateString('en-US', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
      longestLine += chalk.dim(`  (started ${when})`);
    }
    console.log(longestLine);
  }

  if (lastReview) {
    const ago = formatAgo(Date.now() - lastReview.ts);
    const summary = (lastReview.summary ?? lastReview.tool).slice(0, 60);
    const timeSpent = lastReview.time_ms ? ` — ${(lastReview.time_ms / 1000).toFixed(1)}s` : '';
    console.log('');
    console.log(divider(50, 'dashed'));
    console.log(`  Last actual review: ${chalk.dim(ago)}`);
    console.log(`    ${chalk.dim('→')} ${lastReview.tool}: ${chalk.dim(summary)}${chalk.rgb(34, 197, 94)(timeSpent)}`);
  }

  console.log('');
}

function formatAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m !== 1 ? 's' : ''} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h !== 1 ? 's' : ''} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d !== 1 ? 's' : ''} ago`;
}
