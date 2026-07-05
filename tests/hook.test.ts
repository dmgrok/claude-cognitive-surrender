import { describe, it, expect } from 'vitest';
import { classifyVerdict, computeComplexity } from '../src/scoring.js';

describe('hook event classification', () => {
  it('PreToolUse with no prior PermissionRequest → bypassed via null time', () => {
    expect(classifyVerdict(null, 0.5)).toBe('bypassed');
  });
});

describe('verdict thresholds match intent', () => {
  it('a 500ms Bash approval is rubber_stamped', () => {
    const complexity = computeComplexity('Bash', 'rm -rf node_modules');
    expect(classifyVerdict(500, complexity)).toBe('rubber_stamped');
  });

  it('a 10s Write approval is reviewed', () => {
    const complexity = computeComplexity('Write', 'x'.repeat(1000));
    expect(classifyVerdict(10000, complexity)).toBe('reviewed');
  });
});
