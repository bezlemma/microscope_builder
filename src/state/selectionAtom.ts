/**
 * UI atoms used by component visualizers — extracted to their own module
 * to avoid circular dependency.
 * 
 * Component files (e.g. SphericalLens.tsx) import these for their visualizers,
 * which would otherwise create a cycle through store.ts → presets → components → store.ts.
 */
import { atom } from 'jotai';

export const selectionAtom = atom<string[]>([]);

// Index into a compound component's surfaces. null = whole component selected.
export const subElementIndexAtom = atom<number | null>(null);
