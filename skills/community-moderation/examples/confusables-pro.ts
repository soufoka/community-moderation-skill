/**
 * OPTIONAL — full Unicode (TR39) homoglyph coverage via the `confusables` lib.
 *
 * The detection core stays dependency-free; call `enableProConfusables()` once at
 * startup to swap the curated fold for the library's complete confusables table.
 * The mixed-script gating is preserved, so genuine Russian/CJK text is NOT mangled
 * (the library alone folds all Cyrillic -> Latin; we only apply it inside tokens
 * that mix Latin with a non-Latin look-alike — the signature of evasion).
 *
 * Install: npm i confusables
 */
import { remove } from 'confusables';
import { setScriptFold, defaultScriptFold } from './normalize';

/** Enable full TR39 confusables coverage (call once at startup). */
export function enableProConfusables(): void {
  setScriptFold((ch) => {
    if (ch.charCodeAt(0) < 128) return defaultScriptFold(ch); // never touch ASCII
    const p = remove(ch).toLowerCase();
    // Only single ASCII letters/digits slot cleanly into the match skeleton;
    // otherwise fall back to the curated map.
    return /^[a-z0-9]$/.test(p) ? p : defaultScriptFold(ch);
  });
}
