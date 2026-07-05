import { describe, it, expect } from 'vitest';
import { computeComplexity, getThresholdMs, classifyVerdict, calculateCSI, csiLabel } from '../src/scoring.js';
import type { Decision } from '../src/db.js';

describe('computeComplexity', () => {
  it('assigns high weight to Bash', () => {
    expect(computeComplexity('Bash', 'ls')).toBeCloseTo(0.7, 1);
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
  it('returns auto_approved for null decision time', () => {
    expect(classifyVerdict(null, 0.5)).toBe('auto_approved');
  });

  it('returns surrendered when under threshold', () => {
    const complexity = 0.5;
    const threshold = getThresholdMs(complexity);
    expect(classifyVerdict(threshold - 1, complexity)).toBe('surrendered');
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

  it('returns 0 for all auto-approved decisions', () => {
    const decisions: Decision[] = [{
      id: 1, session_id: 's1', timestamp_ms: Date.now(),
      tool_name: 'Bash', tool_input_summary: 'ls', input_length: 2,
      decision_time_ms: null, complexity: 0.7, threshold_ms: 4500,
      verdict: 'auto_approved', user: 'test', cwd: null,
    }];
    expect(calculateCSI(decisions)).toBe(0);
  });

  it('returns 100 for all surrendered decisions', () => {
    const decisions: Decision[] = Array.from({ length: 5 }, (_, i) => ({
      id: i, session_id: 's1', timestamp_ms: Date.now() - i * 1000,
      tool_name: 'Bash', tool_input_summary: 'rm -rf', input_length: 6,
      decision_time_ms: 500, complexity: 0.7, threshold_ms: 4500,
      verdict: 'surrendered' as const, user: 'test', cwd: null,
    }));
    expect(calculateCSI(decisions)).toBe(100);
  });

  it('returns 0 for all reviewed decisions', () => {
    const decisions: Decision[] = Array.from({ length: 5 }, (_, i) => ({
      id: i, session_id: 's1', timestamp_ms: Date.now() - i * 1000,
      tool_name: 'Edit', tool_input_summary: 'change x', input_length: 8,
      decision_time_ms: 8000, complexity: 0.5, threshold_ms: 3500,
      verdict: 'reviewed' as const, user: 'test', cwd: null,
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
