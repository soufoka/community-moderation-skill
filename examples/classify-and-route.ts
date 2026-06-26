/**
 * Multilingual (EN/PT/ES/ID/VI/TR/RU/ZH) support classification + persona routing.
 * Self-contained. Matching runs on the normalized skeleton (normalize.ts),
 * using plain substring checks only — no regex, so it is ReDoS-safe.
 * Personas/channels come from config (see templates/foka-config.json).
 */
import { normalizeForMatch } from './normalize';

export type SupportTag =
  | 'wallet-help' | 'transaction-issue' | 'bounty-question' | 'submission-help'
  | 'payout-issue' | 'technical-dev' | 'bug-report' | 'partnership'
  | 'feedback' | 'off-topic' | 'spam';

export type Priority = 'P1' | 'P2' | 'P3' | 'P4';

export interface RouteConfig {
  routes: Record<string, { persona: string; channel: string }>; // tag -> owner
  defaultPersona: string;
  defaultChannel: string;
}

export interface Classification {
  tag: SupportTag;
  priority: Priority;
}

export interface Routing extends Classification {
  persona: string;
  channel: string;
  handoff: string;
}

// Order matters: higher-priority / more-specific rules first.
const RULES: { tag: SupportTag; priority: Priority; any: string[] }[] = [
  { tag: 'payout-issue', priority: 'P1', any: ['payout', 'not paid', 'didnt get paid', 'reward not', 'payment not', 'nao recebi', 'pagamento', 'recompensa nao', 'nao fui pago', 'no me pagaron', 'no he recibido', 'no pagaron', 'belum dibayar', 'odeme alamadim', 'chua nhan', 'не заплатили', '没有收到', '未支付'] },
  { tag: 'submission-help', priority: 'P2', any: ['submit', 'submission', 'how to enter', 'how do i apply', 'deadline', 'enviar submissao', 'como participar', 'como envio', 'prazo', 'como participo', 'como me inscribo', 'fecha limite'] },
  { tag: 'bounty-question', priority: 'P2', any: ['bounty', 'listing', 'prize', 'eligib', 'premio', 'elegiv', 'recompensa', 'elegible'] },
  { tag: 'transaction-issue', priority: 'P2', any: ['transaction', 'tx', 'failed', 'stuck', 'pending', 'signature', 'transacao', 'falhou', 'travada', 'pendente', 'assinatura', 'transaccion', 'pendiente', 'firma', 'fallo', 'transaksi', 'islem', 'giao dich', 'транзакция', '交易'] },
  { tag: 'wallet-help', priority: 'P2', any: ['wallet', 'phantom', 'solflare', 'connect', 'sign', 'carteira', 'conectar', 'assinar', 'billetera', 'firmar', 'dompet', 'cuzdan', 'ket noi vi', 'кошелек', '钱包'] },
  { tag: 'bug-report', priority: 'P3', any: ['bug', 'broken', 'error', 'crash', 'not working', 'erro', 'quebrado', 'nao funciona', 'travou', 'no funciona', 'roto'] },
  { tag: 'technical-dev', priority: 'P3', any: ['api', 'sdk', 'rpc', 'anchor', 'program', 'deploy', 'integrat', 'programa', 'integrac'] },
  { tag: 'partnership', priority: 'P3', any: ['partner', 'collab', 'sponsor', 'integration request', 'parceria', 'patrocin', 'colaborac', 'asociacion'] },
  { tag: 'feedback', priority: 'P4', any: ['feedback', 'suggest', 'feature request', 'sugest', 'ideia', 'melhoria', 'sugerencia', 'mejora'] },
];

export function classifyMessage(text: string): Classification {
  const s = normalizeForMatch(text);
  const words = s.split(' ');
  // Pure-ASCII single tokens match on word-PREFIX (kills mid-word false positives like
  // "api" in "capital" or "sign" in "design"). Phrases and non-Latin keywords
  // (CJK/Cyrillic, which carry no ASCII word boundaries) still match as substrings.
  const has = (k: string) => (/^[a-z0-9]+$/.test(k) ? words.some((w) => w.startsWith(k)) : s.includes(k));
  for (const r of RULES) {
    if (r.any.some(has)) return { tag: r.tag, priority: r.priority };
  }
  return { tag: 'off-topic', priority: 'P4' };
}

export function routeToPersona(
  c: Classification,
  cfg: RouteConfig,
  member: { handle: string; trustState: string },
  summary: string,
): Routing {
  const route = cfg.routes[c.tag] ?? { persona: cfg.defaultPersona, channel: cfg.defaultChannel };
  const handoff =
    `[${c.priority}] ${c.tag} — from @${member.handle} (${member.trustState})\n` +
    `Summary: ${summary}\n` +
    `Suggested owner: ${route.persona} in ${route.channel}`;
  return { tag: c.tag, priority: c.priority, persona: route.persona, channel: route.channel, handoff };
}
