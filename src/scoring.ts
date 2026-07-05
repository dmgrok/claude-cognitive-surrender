import type { Decision, Verdict } from './db.js';

const TOOL_WEIGHTS: Record<string, number> = {
  Bash: 0.7,
  Write: 0.6,
  Edit: 0.5,
  MultiEdit: 0.55,
  WebFetch: 0.2,
  WebSearch: 0.15,
  Read: 0.1,
  Glob: 0.05,
  Grep: 0.05,
  LS: 0.05,
};

const CODE_KEYWORDS = /\b(function|class|import|export|const|let|var|def |async |await |return |if\s*\(|for\s*\(|while\s*\()\b/;

export function computeComplexity(toolName: string, inputStr: string): number {
  let score = TOOL_WEIGHTS[toolName] ?? 0.3;

  if (inputStr.length > 500) score += 0.15;
  if (inputStr.length > 2000) score += 0.1;

  if (CODE_KEYWORDS.test(inputStr)) score += 0.1;

  return Math.min(score, 1.0);
}

export function getThresholdMs(complexity: number): number {
  return Math.round(1000 + complexity * 5000);
}

export function classifyVerdict(decisionTimeMs: number | null, complexity: number): Verdict {
  if (decisionTimeMs === null) return 'auto_approved';
  const threshold = getThresholdMs(complexity);
  return decisionTimeMs >= threshold ? 'reviewed' : 'surrendered';
}

export function calculateCSI(decisions: Decision[]): number {
  if (decisions.length === 0) return 0;

  const now = Date.now();
  const halfLifeMs = 7 * 24 * 60 * 60 * 1000;
  let weightedSurrenders = 0;
  let totalWeight = 0;

  for (const d of decisions) {
    if (d.verdict === 'auto_approved') continue;

    const ageMs = now - d.timestamp_ms;
    const recencyWeight = Math.exp(-ageMs / halfLifeMs);
    const complexityWeight = 0.5 + d.complexity;
    const weight = recencyWeight * complexityWeight;

    totalWeight += weight;
    if (d.verdict === 'surrendered') weightedSurrenders += weight;
  }

  if (totalWeight === 0) return 0;
  return Math.round((weightedSurrenders / totalWeight) * 100);
}

export function csiLabel(csi: number): string {
  if (csi >= 90) return 'AUTOPILOT ENGAGED';
  if (csi >= 75) return 'basically a rubber stamp with legs';
  if (csi >= 60) return 'trust issues... in the wrong direction';
  if (csi >= 45) return 'questionable oversight';
  if (csi >= 30) return 'cautiously curious';
  if (csi >= 15) return 'genuinely reviewing';
  return 'trust issues (good ones)';
}
