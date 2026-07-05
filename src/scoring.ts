import type { Decision, Verdict } from './storage.js';

const TOOL_WEIGHTS: Record<string, number> = {
  Bash: 0.85,
  Write: 0.75,
  Edit: 0.65,
  MultiEdit: 0.70,
  WebFetch: 0.25,
  WebSearch: 0.15,
  Read: 0.10,
  Glob: 0.05,
  Grep: 0.05,
  LS: 0.05,
};

const CODE_KEYWORDS = /\b(function|class|import|export|const |let |def |async |await )\b/;

export function computeComplexity(toolName: string, inputStr: string): number {
  let score = TOOL_WEIGHTS[toolName] ?? 0.30;
  if (inputStr.length > 500) score += 0.10;
  if (inputStr.length > 2000) score += 0.10;
  if (CODE_KEYWORDS.test(inputStr)) score += 0.05;
  return Math.min(score, 1.0);
}

export function getThresholdMs(complexity: number): number {
  return Math.round(1000 + complexity * 5000);
}

export function classifyVerdict(decisionTimeMs: number | null, complexity: number): Verdict {
  if (decisionTimeMs === null) return 'bypassed';
  const threshold = getThresholdMs(complexity);
  return decisionTimeMs >= threshold ? 'reviewed' : 'rubber_stamped';
}

export function calculateCSI(decisions: Decision[]): number {
  if (decisions.length === 0) return 0;

  const now = Date.now();
  const halfLifeMs = 7 * 24 * 60 * 60 * 1000;
  let weightedRubberStamps = 0;
  let totalWeight = 0;

  for (const d of decisions) {
    if (d.verdict === 'bypassed') continue;

    const ageMs = now - d.ts;
    const recencyWeight = Math.exp(-ageMs / halfLifeMs);
    const complexityWeight = 0.5 + d.complexity;
    const weight = recencyWeight * complexityWeight;

    totalWeight += weight;
    if (d.verdict === 'rubber_stamped') weightedRubberStamps += weight;
  }

  if (totalWeight === 0) return 0;
  return Math.round((weightedRubberStamps / totalWeight) * 100);
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
