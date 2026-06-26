/**
 * Evasion-resistant, multilingual (EN + PT + ES) moderation scorer + action decision.
 * Pure, dependency-free. All keyword matching runs on the normalized skeleton
 * (see normalize.ts), so homoglyph / zero-width / leet / accent evasions are
 * already defeated. No `.*` regexes — matching is linear (ReDoS-safe).
 */
import { normalizeForMatch, scanUrls, contentHash } from './normalize';

export type TrustState = 'NEW' | 'MEMBER' | 'TRUSTED' | 'FLAGGED' | 'MUTED' | 'BANNED';
export type Action = 'allow' | 'warn' | 'delete' | 'mute' | 'kick' | 'ban';
export type Severity = 'none' | 'low' | 'medium' | 'high';

export interface MessageInput {
  text: string;
  memberTrust: TrustState;
  accountAgeDays: number;
  mentionCount?: number;
  repeatedCount?: number; // near-identical recent messages (use contentHash to count)
  officialDomains?: string[]; // allowlist for URL spoof detection
  blocklistDomains?: string[]; // known-bad domains (see scanUrls)
  externalSignals?: { tokenScam?: boolean; addressScam?: boolean; reason?: string }; // from cross-skill enrichment (see enrich-token.ts)
}

export interface Decision {
  action: Action;
  severity: Severity;
  score: number; // 0..100
  confidence: number; // 0..1
  reasons: string[];
  escalate: boolean; // notify human mods
  contentHash: string; // for cross-member spam dedupe
}

interface Pattern {
  id: string;
  weight: number;
  any?: string[]; // skeleton substrings; any match hits
  near?: [string[], string[]]; // both groups present within `window` chars
}

// Multilingual scam lexicon (EN + PT-BR). Extend from resources/scam-patterns.md.
const PATTERNS: Pattern[] = [
  {
    id: 'seed-phrase',
    weight: 75,
    any: [
      'seed phrase', 'recovery phrase', 'secret phrase', '12 word', '24 word',
      'validate your wallet', 'sync your wallet', 'migrate your wallet', 'restore your wallet',
      'frase de recuperacao', 'frase semente', 'chave secreta', 'palavras de recuperacao',
      'validar carteira', 'sincronizar carteira', 'verificar carteira', 'conectar carteira para verificar',
      'frase de recuperacion', 'frase semilla', 'clave secreta', 'validar billetera', 'sincronizar billetera', 'verificar billetera',
    ],
  },
  {
    id: 'drainer-claim',
    weight: 45,
    near: [
      ['claim', 'mint', 'airdrop', 'reclame', 'resgate', 'reivindique', 'conecte', 'reclama', 'reclamar', 'consigue'],
      ['now', 'here', 'live', 'today', 'agora', 'aqui', 'ja', 'aproveite', 'ahora'],
    ],
  },
  {
    id: 'doubling',
    weight: 60,
    near: [
      ['send', 'envie', 'mande', 'deposite', 'envia', 'manda'],
      ['double', '2x', 'back', 'receba', 'dobro', 'retorno', 'devolvo', 'recibe', 'doble'],
    ],
  },
  {
    id: 'dm-bait',
    weight: 35,
    near: [
      ['dm me', 'message me', 'contact support', 'me chama no pv', 'chama no privado', 'suporte oficial', 'escribeme', 'soporte oficial'],
      ['help', 'issue', 'unlock', 'fix', 'ajuda', 'problema', 'desbloquear', 'resolver', 'ayuda'],
    ],
  },
  {
    // Prompt-injection attempts are themselves a red flag (see resources/security.md).
    id: 'agent-injection',
    weight: 40,
    any: [
      'ignore previous instructions', 'ignore all previous', 'disregard the rules',
      'you are now admin', 'you are an admin', 'act as admin',
      'reveal your prompt', 'system prompt', 'unban everyone', 'approve all',
      'ignora las instrucciones anteriores', 'ignora las instrucciones', 'eres administrador', 'revela tu prompt',
    ],
  },
];

function nearMatch(s: string, a: string[], b: string[], window = 40): boolean {
  for (const x of a) {
    const i = s.indexOf(x);
    if (i < 0) continue;
    for (const y of b) {
      const j = s.indexOf(y);
      if (j >= 0 && Math.abs(j - i) <= window) return true;
    }
  }
  return false;
}

export function moderateMessage(input: MessageInput): Decision {
  const reasons: string[] = [];
  let score = 0;

  const skeleton = normalizeForMatch(input.text);
  // Mentions/links read from RAW text (before confusable folding).
  const mentions = input.mentionCount ?? (input.text.match(/@\w+/g) || []).length;
  const urls = scanUrls(input.text, input.officialDomains ?? [], input.blocklistDomains ?? []);
  const hasLink = urls.length > 0;
  const suspiciousUrl = urls.some((u) => u.suspicious);
  const repeated = input.repeatedCount ?? 0;
  const untrusted = input.memberTrust === 'NEW' || input.memberTrust === 'FLAGGED';

  let scamHit = false;
  for (const p of PATTERNS) {
    let hit = false;
    if (p.any) hit = p.any.some((t) => skeleton.includes(t));
    if (!hit && p.near) hit = nearMatch(skeleton, p.near[0], p.near[1]);
    if (hit) {
      score += p.weight;
      reasons.push(`scam:${p.id}`);
      scamHit = true;
    }
  }

  if (suspiciousUrl) { score += 40; reasons.push('suspicious-url'); }
  if (hasLink && untrusted) { score += 30; reasons.push('link-from-untrusted'); }
  if (input.accountAgeDays < 1 && hasLink) { score += 15; reasons.push('fresh-account-link'); }
  if (mentions >= 5) { score += 20; reasons.push('mass-mentions'); }
  if (repeated >= 3) { score += 20; reasons.push('flood'); }

  const external = Boolean(input.externalSignals?.tokenScam || input.externalSignals?.addressScam);
  if (input.externalSignals?.tokenScam) { score += 50; reasons.push('external:token-scam'); }
  if (input.externalSignals?.addressScam) { score += 50; reasons.push('external:address-scam'); }

  score = Math.min(100, score);

  let severity: Severity = 'none';
  let action: Action = 'allow';
  let confidence = 0.8;
  const strong = scamHit || suspiciousUrl || external;

  if (score >= 70) {
    severity = 'high';
    action = strong ? 'mute' : 'delete'; // ban is human-gated; never automatic here
    confidence = strong ? 0.9 : 0.7;
  } else if (score >= 40) {
    severity = 'medium';
    action = 'delete';
    confidence = 0.7;
  } else if (score >= 20) {
    severity = 'low';
    action = 'warn';
    confidence = 0.6;
  }

  return {
    action,
    severity,
    score,
    confidence,
    reasons,
    escalate: severity === 'high' || strong,
    contentHash: contentHash(input.text),
  };
}
