/**
 * useHaptic — single source of truth for `navigator.vibrate` patterns.
 *
 * Each named pattern encodes intent, not duration: callers should reach for
 * `tap()` when something landed, `snap()` when a magnet engaged, `done()` when
 * a long-running job finished, etc.  That keeps the vibration "voice" of the
 * app consistent across components and lets us tune all instances of a given
 * intent in one place.
 *
 * The hook silently no-ops on:
 *   - servers (no `window`)
 *   - browsers without the Vibration API (most desktops, all iOS Safari today)
 *   - users who've disabled haptics via the LS_KEY preference
 *
 * No React state is touched, so the returned object is stable across renders.
 */

const LS_KEY = 'mb4.hapticsEnabled';

function vibrationAvailable(): boolean {
    return typeof window !== 'undefined'
        && typeof window.navigator !== 'undefined'
        && typeof window.navigator.vibrate === 'function';
}

function hapticsEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        // Default ON; user must explicitly opt out.
        const v = window.localStorage.getItem(LS_KEY);
        return v === null || v === 'true';
    } catch {
        return true;
    }
}

function fire(pattern: number | number[]): void {
    if (!vibrationAvailable() || !hapticsEnabled()) return;
    try { window.navigator.vibrate(pattern); } catch { /* noop */ }
}

/**
 * Patterns:
 *   tap     — selection landed, button pressed (15 ms)
 *   snap    — drag locked onto grid / axis / port (10 ms)
 *   release — drag broke free of a snap (5 ms)
 *   confirm — toggle flipped, mode changed (20 ms)
 *   error   — invalid operation / hard limit hit (40 ms)
 *   done    — long-running job finished (e.g. PMT scan) (15 / 40 / 15 ms burst)
 *   delete  — destructive action (50 / 50 / 50 ms triple)
 */
export interface Haptic {
    tap: () => void;
    snap: () => void;
    release: () => void;
    confirm: () => void;
    error: () => void;
    done: () => void;
    delete: () => void;
    /** Escape hatch for one-off custom patterns. Prefer the named helpers. */
    custom: (pattern: number | number[]) => void;
}

const haptic: Haptic = {
    tap: () => fire(15),
    snap: () => fire(10),
    release: () => fire(5),
    confirm: () => fire(20),
    error: () => fire(40),
    done: () => fire([15, 40, 15]),
    delete: () => fire([50, 50, 50]),
    custom: (pattern) => fire(pattern),
};

/**
 * Returns the shared haptic singleton.  Hook form (vs. bare export) so that
 * future per-component preferences (e.g. per-route disable) can plug in
 * without touching call sites.
 */
export function useHaptic(): Haptic {
    return haptic;
}

/**
 * User preference toggle, useful for a Settings panel switch.  No-op on
 * servers; persists via localStorage so the choice survives reloads.
 */
export function setHapticsEnabled(enabled: boolean): void {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(LS_KEY, String(enabled)); } catch { /* noop */ }
}

export function getHapticsEnabled(): boolean {
    return hapticsEnabled();
}
