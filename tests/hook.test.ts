import { describe, it, expect } from 'vitest';
import { classifyVerdict, computeComplexity } from '../src/scoring.js';

describe('hook event classification', () => {
  it('PreToolUse with no prior PermissionRequest → auto_approved via null time', () => {
    expect(classifyVerdict(null, 0.5)).toBe('auto_approved');
  });
});

describe('verdict thresholds match intent', () => {
  it('a 500ms Bash approval is surrendered', () => {
    const complexity = computeComplexity('Bash', 'rm -rf node_modules');
    expect(classifyVerdict(500, complexity)).toBe('surrendered');
  });

  it('a 10s Write approval is reviewed', () => {
    const complexity = computeComplexity('Write', 'x'.repeat(1000));
    expect(classifyVerdict(10000, complexity)).toBe('reviewed');
  });
});
