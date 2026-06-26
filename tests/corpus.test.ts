import { describe, it, expect } from 'vitest';
import { moderateMessage } from '../examples/moderate-message';
import { classifyMessage } from '../examples/classify-and-route';
import { EVAL_CASES } from '../examples/eval-cases';

describe('regression corpus (EN/PT/ES)', () => {
  it.each(EVAL_CASES)('$name (scam=$expectScam)', (c) => {
    const d = moderateMessage({
      text: c.text,
      memberTrust: c.trust ?? 'MEMBER',
      accountAgeDays: c.ageDays ?? 30,
      officialDomains: c.officialDomains,
    });
    expect(d.escalate).toBe(c.expectScam);
    if (c.expectTag) expect(classifyMessage(c.text).tag).toBe(c.expectTag);
  });
});
