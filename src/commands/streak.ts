import chalk from 'chalk';
import { openDb, type Decision } from '../db.js';

export function streakCommand() {
  const db = openDb();

  const decisions = db.prepare(`
    SELECT * FROM decisions ORDER BY timestamp_ms DESC LIMIT 500
  `).all() as Decision[];

  db.close();

  if (decisions.length === 0) {
    console.log(chalk.dim('No data yet. Run "cs install" then use Claude Code.'));
    return;
  }

  // Current streak: consecutive rubber_stamped/bypassed from most recent
  let currentStreak = 0;
  for (const d of decisions) {
    if (d.verdict === 'reviewed') break;
    currentStreak++;
  }

  // Longest streak ever
  let longestStreak = 0;
  let longestStreakStart: number | null = null;
  let run = 0;
  let runStart: number | null = null;
  for (const d of [...decisions].reverse()) {
    if (d.verdict !== 'reviewed') {
      if (run === 0) runStart = d.timestamp_ms;
      run++;
      if (run > longestStreak) {
        longestStreak = run;
        longestStreakStart = runStart;
      }
    } else {
      run = 0;
      runStart = null;
    }
  }

  // Last actual review
  const lastReview = decisions.find(d => d.verdict === 'reviewed');

  console.log('');

  if (currentStreak === 0) {
    console.log(chalk.green('  No active surrender streak. You\'re reviewing.'));
  } else if (currentStreak < 5) {
    console.log(`  Current streak: ${chalk.yellow(currentStreak)} consecutive rubber stamps`);
  } else {
    console.log(`  Current streak: ${chalk.red(currentStreak)} consecutive rubber stamps`);
  }

  if (longestStreak > 0 && longestStreakStart) {
    const when = new Date(longestStreakStart).toLocaleDateString('en-US', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
    console.log(`  Longest ever: ${chalk.bold(longestStreak)} (started ${when})`);
  }

  if (lastReview) {
    const ago = formatAgo(Date.now() - lastReview.timestamp_ms);
    const summary = lastReview.tool_input_summary
      ? lastReview.tool_input_summary.slice(0, 60)
      : lastReview.tool_name;
    const timeSpent = lastReview.decision_time_ms
      ? ` — ${(lastReview.decision_time_ms / 1000).toFixed(1)}s`
      : '';
    console.log('');
    console.log(`  Last actual review: ${chalk.dim(ago)}`);
    console.log(`    ${chalk.dim('→')} ${lastReview.tool_name}: ${chalk.dim(summary)}${chalk.green(timeSpent)}`);
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
