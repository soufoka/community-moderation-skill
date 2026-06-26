# Gray-zone LLM Adjudication

The heuristic scorer (`examples/moderate-message.ts`) is fast, deterministic, and ReDoS-safe — but a fixed lexicon has a gray zone. For ambiguous scores (default **30–60**), get a second opinion from an LLM **without** opening a prompt-injection hole. Implemented in `examples/llm-adjudicator.ts`.

## When to call the LLM

| Heuristic score | Action |
|-----------------|--------|
| `< grayZoneLow` (30) | Trust heuristic → allow / low |
| `[low, high]` (30–60) | Ask the LLM judge |
| `> grayZoneHigh` (60) | Trust heuristic → act + escalate |

## Injection-safe contract

- The message is passed as **DATA**, wrapped in `<message>…</message>`, with any nested `</message>` stripped.
- The system instruction (`ADJUDICATOR_SYSTEM`) forbids following instructions found in the message and treats instruction-like content as a `suspect`/`scam` signal.
- Output is constrained to compact JSON `{label, confidence, rationale}`; nothing else is honored.
- The judge has **no tools and no authority** — it returns a label only. Humans still gate irreversible actions.

## Output contract

```json
{ "label": "allow" | "suspect" | "scam", "confidence": 0.0, "rationale": "short reason" }
```

## Cost & reliability

- Only gray-zone messages reach the LLM (a small fraction of traffic).
- Cache verdicts by `contentHash` to avoid re-judging duplicates / coordinated spam.
- On timeout or error, **fall back to the heuristic label** — never block the pipeline.
- Use a current Claude model: `claude-haiku-4-5` for cheap, fast classification; escalate to a larger model for genuinely hard cases.
