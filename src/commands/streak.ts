import chalk from 'chalk';
import { readDecisions, type Decision } from '../storage.js';

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
    console.log(chalk.green('  No active rubber-stamp streak. You\'re reviewing.'));
  } else if (currentStreak < 5) {
    console.log(`  Current streak: ${chalk.yellow(currentStreak)} consecutive non-reviews`);
  } else {
    console.log(`  Current streak: ${chalk.red(currentStreak)} consecutive non-reviews`);
  }

  if (longestStreak > 0 && longestStreakStart) {
    const when = new Date(longestStreakStart).toLocaleDateString('en-US', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
    console.log(`  Longest ever: ${chalk.bold(longestStreak)} (started ${when})`);
  }

  if (lastReview) {
    const ago = formatAgo(Date.now() - lastReview.ts);
    const summary = (lastReview.summary ?? lastReview.tool).slice(0, 60);
    const timeSpent = lastReview.time_ms ? ` — ${(lastReview.time_ms / 1000).toFixed(1)}s` : '';
    console.log('');
    console.log(`  Last actual review: ${chalk.dim(ago)}`);
    console.log(`    ${chalk.dim('→')} ${lastReview.tool}: ${chalk.dim(summary)}${chalk.green(timeSpent)}`);
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
