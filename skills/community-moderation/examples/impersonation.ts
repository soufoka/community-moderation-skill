/**
 * Admin-impersonation defense. Scammers copy an admin's display name (and a look-alike
 * handle) to phish members. This compares each sender's name/handle against a roster of
 * protected admins — on the normalized skeleton, so homoglyph/zero-width tricks are
 * caught — and flags impersonators so the bot can mute them and escalate.
 *
 * Real admins are exempt (their handle is in the roster). Handles are unique per platform,
 * so an impersonator can only copy the *name* or use a look-alike handle.
 */
import { normalizeForMatch } from './normalize';

export interface ProtectedAdmin {
  handle?: string; // platform username, with or without '@'
  displayName?: string; // shown name, e.g. 'Kaue | Superteam BR'
}

export interface ImpersonationResult {
  impersonator: boolean;
  matchedAdmin?: string;
  reason?: 'lookalike-handle' | 'name-match' | 'name-contains';
}

function handleOf(h?: string): string {
  return (h ?? '').replace(/^@/, '').toLowerCase();
}

export function checkImpersonation(
  member: { handle?: string; displayName?: string; isAdmin?: boolean },
  admins: ProtectedAdmin[],
): ImpersonationResult {
  if (member.isAdmin) return { impersonator: false };

  const memHandle = handleOf(member.handle);
  const memHandleSkel = normalizeForMatch(memHandle);
  const memName = normalizeForMatch(member.displayName ?? '');

  // A sender whose handle exactly matches a protected admin IS that admin (handles are unique).
  for (const a of admins) {
    if (a.handle && memHandle && memHandle === handleOf(a.handle)) return { impersonator: false };
  }

  for (const a of admins) {
    const aHandle = handleOf(a.handle);
    const aName = normalizeForMatch(a.displayName ?? '');

    // Look-alike handle (homoglyph/zero-width): different raw handle, identical skeleton.
    if (aHandle && memHandle && memHandle !== aHandle && memHandleSkel === normalizeForMatch(aHandle)) {
      return { impersonator: true, matchedAdmin: a.handle ?? a.displayName, reason: 'lookalike-handle' };
    }
    // Copied display name (exact, or admin name embedded in a longer name like "Kaue | Support").
    if (aName && memName) {
      if (memName === aName) return { impersonator: true, matchedAdmin: a.displayName, reason: 'name-match' };
      if (aName.length >= 4 && memName.includes(aName)) {
        return { impersonator: true, matchedAdmin: a.displayName, reason: 'name-contains' };
      }
    }
  }
  return { impersonator: false };
}
