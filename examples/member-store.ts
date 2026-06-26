/**
 * Member contact store: the integration seam between the moderation logic and
 * your database. Define `MemberStore` against your DB; `InMemoryMemberStore` is a
 * dependency-free reference impl for tests and prototypes.
 * Schema mirrors resources/data-schemas.md.
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
  joinedAt: string; // ISO
  trustState: TrustState;
  roles: string[];
  reputation: number;
  messageCount: number;
  warnings: Warning[];
  mutedUntil?: string;
  notes?: string;
}

export interface MemberStore {
  get(id: string): Promise<MemberRecord | undefined>;
  upsert(rec: MemberRecord): Promise<void>;
  recordWarning(id: string, w: Omit<Warning, 'at'>): Promise<void>;
}

export function newMember(id: string, handle: string, platform: 'telegram' | 'discord'): MemberRecord {
  return {
    id,
    handle,
    platform,
    joinedAt: new Date().toISOString(),
    trustState: 'NEW',
    roles: [],
    reputation: 0,
    messageCount: 0,
    warnings: [],
  };
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
    // First soft violation flags an otherwise-good member.
    if (rec.trustState === 'NEW' || rec.trustState === 'MEMBER') rec.trustState = 'FLAGGED';
  }
}
