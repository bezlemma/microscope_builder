/**
 * Common utility functions shared across the codebase.
 */

/** Round to 2 decimal places. Replaces ~30 occurrences of Math.round(x * 100) / 100. */
export function round2(n: number): number {
    return Math.round(n * 100) / 100;
}
