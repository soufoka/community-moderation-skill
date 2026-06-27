import { describe, it, expect } from 'vitest';
import { normalizeForMatch } from '../examples/normalize';
import { enableProConfusables } from '../examples/confusables-pro';

// vitest isolates module state per file, so enabling pro here does NOT affect the
// other suites (which keep using the curated, dependency-free default).
enableProConfusables();

describe('confusables-pro (full TR39 coverage)', () => {
  it('folds exotic homoglyphs the curated map lacks (Armenian ց -> g)', () =>
    expect(normalizeForMatch('ցm')).toBe('gm'));
  it('still folds Cyrillic homoglyphs', () => expect(normalizeForMatch('сlаiм')).toBe('claim'));
  it('preserves genuine Russian (mixed-script gating still holds)', () =>
    expect(normalizeForMatch('кошелек')).toBe('кошелек'));
});
