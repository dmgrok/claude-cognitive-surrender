import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
const HOOK_MARKER = 'cognitive-surrender';

export function installCommand(hookPath: string) {
  const resolvedHook = hookPath || getDefaultHookPath();

  if (!existsSync(resolvedHook)) {
    console.error(chalk.red(`Hook script not found at: ${resolvedHook}`));
    console.error(chalk.dim('Run "npm run build" first, then "cs install".'));
    process.exit(1);
  }

  let settings: Record<string, unknown> = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    } catch {
      console.error(chalk.red(`Could not parse ${SETTINGS_PATH}`));
      process.exit(1);
    }
  }

  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }
  const hooks = settings.hooks as Record<string, unknown[]>;

  const hookCommand = `node ${resolvedHook}`;
  const hookEntry = {
    type: 'command',
    command: hookCommand,
    timeout: 3,
  };

  let installed = 0;
  for (const event of ['PermissionRequest', 'PreToolUse', 'PostToolUse']) {
    if (!Array.isArray(hooks[event])) hooks[event] = [];

    const alreadyInstalled = (hooks[event] as unknown[]).some((group: unknown) => {
      if (typeof group !== 'object' || group === null) return false;
      const g = group as Record<string, unknown>;
      return Array.isArray(g.hooks) &&
        (g.hooks as unknown[]).some((h: unknown) => {
          if (typeof h !== 'object' || h === null) return false;
          const hh = h as Record<string, unknown>;
          return typeof hh.command === 'string' && hh.command.includes(HOOK_MARKER);
        });
    });

    if (!alreadyInstalled) {
      (hooks[event] as unknown[]).push({ matcher: '', hooks: [hookEntry] });
      installed++;
    }
  }

  if (installed === 0) {
    console.log(chalk.yellow('Hooks already installed. Nothing to do.'));
    return;
  }

  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
  console.log(chalk.green(`✓ Installed ${installed} hook(s) into ${SETTINGS_PATH}`));
  console.log(chalk.dim(`  Hook script: ${resolvedHook}`));
  console.log(chalk.dim('  Restart Claude Code for hooks to take effect.'));
}

export function uninstallCommand() {
  if (!existsSync(SETTINGS_PATH)) {
    console.log(chalk.dim('No settings.json found. Nothing to uninstall.'));
    return;
  }

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    console.error(chalk.red(`Could not parse ${SETTINGS_PATH}`));
    process.exit(1);
  }

  if (!settings.hooks || typeof settings.hooks !== 'object') {
    console.log(chalk.dim('No hooks configured. Nothing to uninstall.'));
    return;
  }

  const hooks = settings.hooks as Record<string, unknown[]>;
  let removed = 0;

  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue;
    const before = (hooks[event] as unknown[]).length;
    hooks[event] = (hooks[event] as unknown[]).filter((group: unknown) => {
      if (typeof group !== 'object' || group === null) return true;
      const g = group as Record<string, unknown>;
      if (!Array.isArray(g.hooks)) return true;
      const hasOurs = (g.hooks as unknown[]).some((h: unknown) => {
        if (typeof h !== 'object' || h === null) return false;
        const hh = h as Record<string, unknown>;
        return typeof hh.command === 'string' && hh.command.includes(HOOK_MARKER);
      });
      return !hasOurs;
    });
    removed += before - (hooks[event] as unknown[]).length;
  }

  if (removed === 0) {
    console.log(chalk.dim('No cognitive-surrender hooks found. Nothing to remove.'));
    return;
  }

  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
  console.log(chalk.green(`✓ Removed ${removed} hook group(s) from ${SETTINGS_PATH}`));
}

function getDefaultHookPath(): string {
  return join(__dirname, 'hook.cjs');
}
