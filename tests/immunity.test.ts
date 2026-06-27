import { describe, it, expect } from 'vitest';
import { isImmune, normalizeRole, explainImmunity, formatImmunityPolicy, type ImmunityConfig } from '../examples/immunity';

const CFG: ImmunityConfig = { roles: ['Core Mods', 'Moderator', 'SuperTeam BR'], botMasters: ['999'] };

describe('immunity — MEE6 defaults', () => {
  it('server owner is immune by default', () =>
    expect(isImmune({ isOwner: true }, CFG)).toMatchObject({ immune: true, reason: 'server-owner' }));
  it('Administrator permission is immune by default', () =>
    expect(isImmune({ hasAdminPermission: true }, CFG)).toMatchObject({ immune: true, reason: 'admin-permission' }));
  it('bots are immune by default', () =>
    expect(isImmune({ isBot: true }, CFG)).toMatchObject({ immune: true, reason: 'bot' }));
  it('bot masters are immune by id', () =>
    expect(isImmune({ id: '999' }, CFG)).toMatchObject({ immune: true, reason: 'bot-master' }));
  it('defaults can be turned off', () => {
    expect(isImmune({ isOwner: true }, { ...CFG, immuneServerOwner: false }).immune).toBe(false);
    expect(isImmune({ hasAdminPermission: true }, { ...CFG, immuneAdminPermission: false }).immune).toBe(false);
    expect(isImmune({ isBot: true }, { ...CFG, immuneBots: false }).immune).toBe(false);
  });
});

describe('immunity — roles', () => {
  it('matches an immune role', () =>
    expect(isImmune({ roles: ['Member', 'Core Mods'] }, CFG)).toMatchObject({ immune: true, reason: 'immune-role', matchedRole: 'Core Mods' }));
  it('matches case-insensitively and ignores a leading @', () =>
    expect(isImmune({ roles: ['@moderator'] }, CFG).immune).toBe(true));
  it('matches by id too', () =>
    expect(isImmune({ roles: ['123456'] }, { roles: ['123456'] }).immune).toBe(true));
  it('a normal member with no immune role is not immune', () =>
    expect(isImmune({ id: '1', roles: ['Member', 'Verified'] }, CFG).immune).toBe(false));
  it('an empty subject is not immune', () => expect(isImmune({}, CFG).immune).toBe(false));
});

describe('immunity — precedence & helpers', () => {
  it('owner short-circuits before role checks', () =>
    expect(isImmune({ isOwner: true, roles: ['Core Mods'] }, CFG).reason).toBe('server-owner'));
  it('normalizeRole strips @, trims, lowercases', () => {
    expect(normalizeRole('@Core Mods')).toBe('core mods');
    expect(normalizeRole('  Moderator ')).toBe('moderator');
  });
  it('no config = nobody is immune except built-in bot/owner/admin defaults', () => {
    expect(isImmune({ roles: ['anything'] }).immune).toBe(false);
    expect(isImmune({ isOwner: true }).immune).toBe(true);
  });
});

describe('immunity — command renderers', () => {
  it('explainImmunity gives a reason for an immune subject', () => {
    expect(explainImmunity({ isOwner: true }, CFG)).toContain('server owner');
    expect(explainImmunity({ roles: ['Core Mods'] }, CFG)).toContain('@Core Mods');
  });
  it('explainImmunity marks a normal member as not immune', () =>
    expect(explainImmunity({ roles: ['Member'] }, CFG)).toContain('not immune'));
  it('formatImmunityPolicy lists defaults and roles', () => {
    const out = formatImmunityPolicy(CFG);
    expect(out).toContain('server owner');
    expect(out).toContain('immune roles (3)');
    expect(out).toContain('@Core Mods');
  });
  it('formatImmunityPolicy reflects disabled defaults', () =>
    expect(formatImmunityPolicy({ ...CFG, immuneBots: false, immuneServerOwner: false })).not.toContain('server owner'));
});
