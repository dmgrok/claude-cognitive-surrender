import { describe, it, expect } from 'vitest';
import { computeComplexity, getThresholdMs, classifyVerdict, calculateCSI, csiLabel } from '../src/scoring.js';
import type { Decision } from '../src/storage.js';

describe('computeComplexity', () => {
  it('assigns high weight to Bash', () => {
    expect(computeComplexity('Bash', 'ls')).toBeCloseTo(0.85, 1);
  });

  it('scales up for long inputs', () => {
    const short = computeComplexity('Bash', 'ls');
    const long = computeComplexity('Bash', 'x'.repeat(600));
    expect(long).toBeGreaterThan(short);
  });

  it('caps at 1.0', () => {
    const score = computeComplexity('Bash', 'function foo() { class Bar { import x } const y = 1; }'.repeat(100));
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('assigns low weight to Read', () => {
    expect(computeComplexity('Read', '/some/file')).toBeLessThan(0.3);
  });
});

describe('getThresholdMs', () => {
  it('returns at least 1000ms for zero complexity', () => {
    expect(getThresholdMs(0)).toBe(1000);
  });

  it('returns at most 6000ms for full complexity', () => {
    expect(getThresholdMs(1.0)).toBe(6000);
  });
});

describe('classifyVerdict', () => {
  it('returns bypassed for null decision time', () => {
    expect(classifyVerdict(null, 0.5)).toBe('bypassed');
  });

  it('returns rubber_stamped when under threshold', () => {
    const complexity = 0.5;
    const threshold = getThresholdMs(complexity);
    expect(classifyVerdict(threshold - 1, complexity)).toBe('rubber_stamped');
  });

  it('returns reviewed when at or above threshold', () => {
    const complexity = 0.5;
    const threshold = getThresholdMs(complexity);
    expect(classifyVerdict(threshold, complexity)).toBe('reviewed');
  });
});

describe('calculateCSI', () => {
  it('returns 0 for empty decisions', () => {
    expect(calculateCSI([])).toBe(0);
  });

  it('returns 0 for all bypassed decisions', () => {
    const decisions: Decision[] = [{
      ts: Date.now(), sid: 's1', tool: 'Bash', summary: 'ls', len: 2,
      time_ms: null, complexity: 0.7, threshold_ms: 4500,
      verdict: 'bypassed', user: 'test', cwd: null, bypass_rule: 'Bash(*) in settings.local.json',
    }];
    expect(calculateCSI(decisions)).toBe(0);
  });

  it('returns 100 for all rubber_stamped decisions', () => {
    const decisions: Decision[] = Array.from({ length: 5 }, (_, i) => ({
      ts: Date.now() - i * 1000, sid: 's1', tool: 'Bash', summary: 'rm -rf', len: 6,
      time_ms: 500, complexity: 0.7, threshold_ms: 4500,
      verdict: 'rubber_stamped' as const, user: 'test', cwd: null, bypass_rule: null,
    }));
    expect(calculateCSI(decisions)).toBe(100);
  });

  it('returns 0 for all reviewed decisions', () => {
    const decisions: Decision[] = Array.from({ length: 5 }, (_, i) => ({
      ts: Date.now() - i * 1000, sid: 's1', tool: 'Edit', summary: 'change x', len: 8,
      time_ms: 8000, complexity: 0.5, threshold_ms: 3500,
      verdict: 'reviewed' as const, user: 'test', cwd: null, bypass_rule: null,
    }));
    expect(calculateCSI(decisions)).toBe(0);
  });
});

describe('csiLabel', () => {
  it('returns a string for any score', () => {
    for (const n of [0, 25, 50, 75, 100]) {
      expect(typeof csiLabel(n)).toBe('string');
    }
  });
});
