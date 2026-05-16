import { Ray, childRay } from './types';

/**
 * Mark a ray as having entered (or left) a refractive medium. The only state
 * that changes is `currentMediumIndex`, which downstream OPL accumulation
 * (e.g. `cardFieldSynthesis`) reads to convert geometric distance into
 * optical path.
 */
export function applyPacketMediumIndex(ray: Ray, mediumIndex: number): Ray {
    const targetIndex = Math.max(mediumIndex, 1e-9);
    const currentIndex = ray.currentMediumIndex ?? 1;
    if (Math.abs(targetIndex - currentIndex) < 1e-12) return ray;
    return childRay(ray, { currentMediumIndex: targetIndex });
}
