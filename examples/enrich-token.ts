/**
 * Cross-skill enrichment: turn a token mint / wallet address found in a message
 * into an external risk signal for moderateMessage({ externalSignals }).
 *
 * The actual on-chain data comes from OTHER repo skills (birdeye, helius,
 * wallet-analysis) via an INJECTED lookup — this module stays dependency-free.
 * See resources/cross-skill-composition.md.
 */

export interface TokenData {
  liquidityUsd?: number;
  ageMinutes?: number;
  mintAuthorityActive?: boolean;
  freezeAuthorityActive?: boolean;
  holders?: number;
}

export interface TokenRisk {
  scam: boolean;
  reasons: string[];
}

export type TokenLookup = (mint: string) => Promise<TokenData>;

// Solana base58 pubkey-ish (no 0 O I l). Bounded length -> ReDoS-safe.
const MINT_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

export function extractMints(text: string): string[] {
  return text.match(MINT_RE) ?? [];
}

/**
 * Honeypot/scam heuristic over data fetched from birdeye/helius-style skills.
 * Two or more red flags => treat as scam (feeds externalSignals.tokenScam).
 */
export async function assessToken(mint: string, lookup: TokenLookup): Promise<TokenRisk> {
  const d = await lookup(mint);
  const reasons: string[] = [];
  if (d.freezeAuthorityActive) reasons.push('freeze-authority-active');
  if (d.mintAuthorityActive) reasons.push('mint-authority-active');
  if ((d.liquidityUsd ?? 0) < 1000) reasons.push('very-low-liquidity');
  if ((d.ageMinutes ?? Infinity) < 60) reasons.push('brand-new-token');
  if ((d.holders ?? Infinity) < 25) reasons.push('few-holders');
  return { scam: reasons.length >= 2, reasons };
}
