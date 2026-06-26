/**
 * Member contact store: the integration seam between the moderation/support logic
 * and your database. Define `MemberStore` against your DB; `InMemoryMemberStore` is a
 * dependency-free reference impl. Includes the contact lifecycle (onboarding,
 * vouching, reputation, segmentation) as pure, testable helpers.
 * See resources/contact-management.md and resources/data-schemas.md.
 */
import { TrustState } from './moderate-message';

export interface Warning {
  at: string; // ISO
  reason: string;
  signal: string;
  actor: 'agent' | 'human';
}

export interface MemberRecord {
  id: string; // stable platform id (NOT the handle)
  handle: string;
  platform: 'telegram' | 'discord';
  joinedAt: string; // ISO — first seen
  lastSeenAt: string; // ISO — last activity
  trustState: TrustState;
  roles: string[]; // e.g. ['mod', 'contributor']
  tags: string[]; // relationship/segments: 'vip', 'partner', 'press', ...
  reputation: number; // signed; rises with help, falls with violations
  messageCount: number;
  interactions: number; // support/mod touchpoints
  warnings: Warning[];
  ticketIds: string[]; // linked SupportTicket ids
  language?: string; // detected/declared, e.g. 'pt'
  links?: Record<string, string>; // e.g. { x: '@handle' }
  vouchedBy?: string; // handle of a TRUSTED voucher
  mutedUntil?: string;
  notes?: string;
}

export interface ContactPolicy {
  promoteAfterMessages: number;
  promoteAfterDays: number;
  flagDecayDays: number;
}

export const DEFAULT_CONTACT_POLICY: ContactPolicy = {
  promoteAfterMessages: 5,
  promoteAfterDays: 2,
  flagDecayDays: 14,
};

export function newMember(id: string, handle: string, platform: 'telegram' | 'discord'): MemberRecord {
  const now = new Date().toISOString();
  return {
    id,
    handle,
    platform,
    joinedAt: now,
    lastSeenAt: now,
    trustState: 'NEW',
    roles: [],
    tags: [],
    reputation: 0,
    messageCount: 0,
    interactions: 0,
    warnings: [],
    ticketIds: [],
  };
}

// ---- pure contact-lifecycle helpers (framework-agnostic, testable) ----

/** Adjust reputation: positive for helpfulness, negative for violations. */
export function adjustReputation(rec: MemberRecord, delta: number): MemberRecord {
  rec.reputation += delta;
  return rec;
}

/** A TRUSTED member vouches a newcomer -> promote NEW to MEMBER. */
export function vouch(rec: MemberRecord, byHandle: string): MemberRecord {
  rec.vouchedBy = byHandle;
  if (rec.trustState === 'NEW') rec.trustState = 'MEMBER';
  return rec;
}

/**
 * Apply trust transitions from policy: NEW -> MEMBER once active + aged with no
 * warnings; FLAGGED -> MEMBER after a clean decay window.
 */
export function maybePromote(
  rec: MemberRecord,
  now: number = Date.now(),
  policy: ContactPolicy = DEFAULT_CONTACT_POLICY,
): MemberRecord {
  const ageDays = (now - Date.parse(rec.joinedAt)) / 86_400_000;
  if (
    rec.trustState === 'NEW' &&
    rec.messageCount >= policy.promoteAfterMessages &&
    ageDays >= policy.promoteAfterDays &&
    rec.warnings.length === 0
  ) {
    rec.trustState = 'MEMBER';
  } else if (rec.trustState === 'FLAGGED') {
    const last = rec.warnings.length ? Date.parse(rec.warnings[rec.warnings.length - 1].at) : Date.parse(rec.joinedAt);
    if ((now - last) / 86_400_000 >= policy.flagDecayDays) rec.trustState = 'MEMBER';
  }
  return rec;
}

export interface MemberStore {
  get(id: string): Promise<MemberRecord | undefined>;
  upsert(rec: MemberRecord): Promise<void>;
  recordWarning(id: string, w: Omit<Warning, 'at'>): Promise<void>;
  recordInteraction(id: string, at?: string): Promise<void>;
  addTag(id: string, tag: string): Promise<void>;
  setTrust(id: string, state: TrustState): Promise<void>;
  note(id: string, text: string): Promise<void>;
  findByTag(tag: string): Promise<MemberRecord[]>;
  findByRole(role: string): Promise<MemberRecord[]>;
}

export class InMemoryMemberStore implements MemberStore {
  private map = new Map<string, MemberRecord>();

  async get(id: string): Promise<MemberRecord | undefined> {
    return this.map.get(id);
  }

  async upsert(rec: MemberRecord): Promise<void> {
    this.map.set(rec.id, rec);
  }

  async recordWarning(id: string, w: Omit<Warning, 'at'>): Promise<void> {
    const rec = this.map.get(id);
    if (!rec) return;
    rec.warnings.push({ at: new Date().toISOString(), ...w });
    adjustReputation(rec, -2); // violations cost reputation
    // First soft violation flags an otherwise-good member.
    if (rec.trustState === 'NEW' || rec.trustState === 'MEMBER') rec.trustState = 'FLAGGED';
  }

  async recordInteraction(id: string, at: string = new Date().toISOString()): Promise<void> {
    const rec = this.map.get(id);
    if (!rec) return;
    rec.interactions += 1;
    rec.lastSeenAt = at;
  }

  async addTag(id: string, tag: string): Promise<void> {
    const rec = this.map.get(id);
    if (rec && !rec.tags.includes(tag)) rec.tags.push(tag);
  }

  async setTrust(id: string, state: TrustState): Promise<void> {
    const rec = this.map.get(id);
    if (rec) rec.trustState = state;
  }

  async note(id: string, text: string): Promise<void> {
    const rec = this.map.get(id);
    if (rec) rec.notes = rec.notes ? `${rec.notes}\n${text}` : text;
  }

  async findByTag(tag: string): Promise<MemberRecord[]> {
    return [...this.map.values()].filter((r) => r.tags.includes(tag));
  }

  async findByRole(role: string): Promise<MemberRecord[]> {
    return [...this.map.values()].filter((r) => r.roles.includes(role));
  }
}
