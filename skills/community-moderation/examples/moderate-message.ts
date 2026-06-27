/**
 * Evasion-resistant, multilingual (EN/PT/ES/ID/VI/TR/RU/ZH) moderation scorer + action decision.
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
  massPingTokens?: string[]; // channel-wide @ping tokens to block from non-admins (default DEFAULT_MASS_PING_TOKENS; [] disables)
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
      'frasa pemulihan', 'validasi dompet', 'sinkronkan dompet',
      'cum tu khoi phuc', 'xac minh vi', 'khoi phuc vi',
      'kurtarma ifadesi', 'cuzdanini dogrula', 'gizli anahtar',
      'фраза восстановления', 'сид фраза', 'подтвердите кошелек', 'секретный ключ', 'закрытый ключ',
      '助记词', '验证钱包', '私钥', '同步钱包',
      '시드 문구', '복구 문구', '지갑 인증', '니모닉', '개인 키',
      'シードフレーズ', 'リカバリーフレーズ', 'ウォレット認証', '秘密鍵', 'ニーモニック',
    ],
  },
  {
    id: 'drainer-claim',
    weight: 45,
    near: [
      ['claim', 'mint', 'airdrop', 'reclame', 'resgate', 'reivindique', 'conecte', 'reclama', 'reclamar', 'consigue', 'klaim', 'получите', 'заберите', '领取', '认领', '에어드랍', '클레임', 'エアドロップ', '請求'],
      ['now', 'here', 'live', 'today', 'agora', 'aqui', 'ja', 'aproveite', 'ahora', 'sekarang', 'ngay', 'simdi', 'сеичас', '现在', '立即', '지금', '즉시', '今すぐ'],
    ],
  },
  {
    id: 'doubling',
    weight: 60,
    near: [
      ['send', 'envie', 'mande', 'deposite', 'envia', 'manda', 'kirim', 'gui', 'gonder'],
      ['double', '2x', 'back', 'receba', 'dobro', 'retorno', 'devolvo', 'recibe', 'doble', 'kembali', 'gap doi', 'iki kati'],
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
      'игнорируи предыдущие инструкции', 'ты администратор', '忽略之前的指令', '忽略以上指令',
    ],
  },
];

// Channel-wide ping tokens (@everyone/@here/@all/…) that notify a whole server/group.
// Only admins should use these — a non-admin who does is spamming. Override per community
// via foka-config.json -> moderation.massPingTokens (passed as input.massPingTokens).
export const DEFAULT_MASS_PING_TOKENS = [
  'everyone', 'here', 'all', 'channel', 'room', 'online', 'group', 'todos', 'all_members',
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build (and memoize) the matcher from a token list. Tokens are ESCAPED literals joined
// into one alternation — never user-supplied regex — so it stays ReDoS-safe. Matched on
// RAW text (the platform only pings on the literal ASCII token; a homoglyph @everyоne
// can't ping). The `@` must sit at a mention position (start or after a non-word char) so
// `name@everyone.com` isn't flagged. An empty token list disables the check (returns null).
const massPingCache = new Map<string, RegExp | null>();
function massPingMatcher(tokens?: string[]): RegExp | null {
  const list = (tokens ?? DEFAULT_MASS_PING_TOKENS)
    .map((t) => t.toLowerCase().replace(/^@+/, '').trim())
    .filter(Boolean);
  const key = list.join('|');
  if (massPingCache.has(key)) return massPingCache.get(key)!;
  const re = list.length ? new RegExp('(?:^|[^\\w@])@(' + list.map(escapeRe).join('|') + ')\\b', 'i') : null;
  massPingCache.set(key, re);
  return re;
}

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

  const text = (input.text ?? '').slice(0, 10000); // bound ALL processing (scanUrls + mentions too), not just normalize
  const skeleton = normalizeForMatch(text);
  // Mentions/links read from RAW text (before confusable folding).
  const mentions = input.mentionCount ?? (text.match(/@\w+/g) || []).length;
  const urls = scanUrls(text, input.officialDomains ?? [], input.blocklistDomains ?? []);
  const links = urls.filter((u) => !u.allowlisted); // whitelisted (official) domains are exempt — never filtered
  const hasLink = links.length > 0;
  const suspiciousUrl = links.some((u) => u.suspicious);
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
  // Channel-wide @everyone/@here/@all from a non-admin → remove it. Tokens are configurable
  // (input.massPingTokens); admins are exempt at the bot layer (immune / TRUSTED are escalated,
  // not auto-actioned). A lone token scores to `delete`; with links/scam it climbs to mute + escalate.
  const massPingRe = massPingMatcher(input.massPingTokens);
  if (massPingRe && massPingRe.test(text)) { score += 45; reasons.push('mass-ping'); }
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
    contentHash: contentHash(text),
  };
}
