import { Command } from 'commander';
import { statsCommand } from './commands/stats.js';
import { streakCommand } from './commands/streak.js';
import { challengeCommand } from './commands/challenge.js';
import { installCommand, uninstallCommand } from './commands/install.js';
import { exportCommand } from './commands/export.js';

const program = new Command();

program
  .name('cs')
  .description('Cognitive Surrender — measure how much you rubber-stamp Claude Code')
  .version('0.1.0');

program
  .command('stats')
  .description('Show surrender rate and breakdown by tool')
  .option('-d, --days <n>', 'Number of days to look back', '7')
  .action((opts) => {
    statsCommand(parseInt(opts.days, 10));
  });

program
  .command('streak')
  .description('Show current and longest rubber-stamp streak')
  .action(() => {
    streakCommand();
  });

program
  .command('challenge')
  .description('Provocative summary of your approval behavior')
  .option('-d, --days <n>', 'Number of days to look back', '1')
  .action((opts) => {
    challengeCommand(parseInt(opts.days, 10));
  });

program
  .command('export')
  .description('Export stats as CSV, JSON, or Markdown')
  .option('-p, --period <period>', 'daily or monthly', 'daily')
  .option('-f, --format <format>', 'csv, json, or md', 'md')
  .option('-o, --output <file>', 'output file (defaults to stdout)')
  .action((opts) => {
    const period = opts.period === 'monthly' ? 'monthly' : 'daily';
    const format = ['csv', 'json', 'md'].includes(opts.format) ? opts.format : 'md';
    exportCommand(period, format, opts.output);
  });

program
  .command('install')
  .description('Add cognitive-surrender hooks to ~/.claude/settings.json')
  .option('--hook-path <path>', 'Path to hook.js (auto-detected by default)')
  .action((opts) => {
    installCommand(opts.hookPath ?? '');
  });

program
  .command('uninstall')
  .description('Remove cognitive-surrender hooks from ~/.claude/settings.json')
  .action(() => {
    uninstallCommand();
  });

program.parse();
