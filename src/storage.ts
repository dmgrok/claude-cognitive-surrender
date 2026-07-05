import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export const DATA_DIR = join(homedir(), '.cognitive-surrender');
export const DECISIONS_DIR = join(DATA_DIR, 'decisions');

export type Verdict = 'reviewed' | 'rubber_stamped' | 'bypassed';

export interface Decision {
  ts: number;
  sid: string;
  tool: string;
  summary: string | null;
  len: number;
  time_ms: number | null;
  complexity: number;
  threshold_ms: number;
  verdict: Verdict;
  user: string;
  cwd: string | null;
  bypass_rule: string | null;
}

export interface ReadOptions {
  days?: number;       // look back N days from today
  since?: number;      // epoch ms lower bound
  sessionId?: string;  // filter to one session
}

export function readDecisions(opts: ReadOptions = {}): Decision[] {
  if (!existsSync(DECISIONS_DIR)) return [];

  const files = readdirSync(DECISIONS_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .sort(); // YYYY-MM-DD order

  // Compute date lower bound
  let sinceMs = opts.since ?? 0;
  if (opts.days !== undefined && opts.since === undefined) {
    sinceMs = Date.now() - opts.days * 24 * 60 * 60 * 1000;
  }

  const sinceDate = sinceMs > 0
    ? new Date(sinceMs).toISOString().slice(0, 10)
    : null;

  const results: Decision[] = [];

  for (const file of files) {
    const date = file.replace('.jsonl', '');
    if (sinceDate && date < sinceDate) continue;

    const path = join(DECISIONS_DIR, file);
    const content = readFileSync(path, 'utf8');

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line) as Decision;
        if (d.ts < sinceMs) continue;
        if (opts.sessionId && d.sid !== opts.sessionId) continue;
        results.push(d);
      } catch { /* skip malformed lines */ }
    }
  }

  return results;
}

export function readDecisionsAll(): Decision[] {
  return readDecisions({});
}
