import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';

/**
 * QPD (Quadrant Photodiode) — a four-quadrant position-sensitive detector.
 *
 * Splits its active area into four quadrants (A, B, C, D):
 *   A = top-left    (+y, -x)
 *   B = top-right   (+y, +x)
 *   C = bottom-left (-y, -x)
 *   D = bottom-right(-y, +x)
 *
 * Computes differential signals:
 *   X = ((B+D) - (A+C)) / Sum  -> horizontal beam position
 *   Y = ((A+B) - (C+D)) / Sum  -> vertical beam position
 *   Sum = A + B + C + D         -> total power
 *
 * Terminal detector: all rays are absorbed.
 */
export class QPD extends OpticalComponent {
    /** Active area diameter in mm. */
    activeDiameter: number;
    /** Gap between quadrants in mm (dead zone at the cross). */
    gapWidth: number;

    /** Accumulated quadrant intensities [A, B, C, D]. */
    quadrants: [number, number, number, number] = [0, 0, 0, 0];
    /** Number of rays that hit each quadrant. */
    quadrantHits: [number, number, number, number] = [0, 0, 0, 0];
    /** Total ray count hitting the detector. */
    totalHits: number = 0;

    constructor(activeDiameter: number = 5, name: string = 'QPD') {
        super(name);
        this.activeDiameter = activeDiameter;
        this.gapWidth = 0.1;
        // Housing (from QPDVisualizer): (activeDiameter+6) × (activeDiameter+6) × 6 centered at z=-3.
        const r = (activeDiameter + 6) / 2;
        this.bounds.set(new Vector3(-r, -r, -6), new Vector3(r, r, 0.5));
    }

    /** Reset accumulated data (called before each trace). */
    resetAccumulator(): void {
        this.quadrants = [0, 0, 0, 0];
        this.quadrantHits = [0, 0, 0, 0];
        this.totalHits = 0;
    }

    /** Normalized X position signal: ((B+D)-(A+C))/Sum, range [-1, 1]. */
    get signalX(): number {
        const [a, b, c, d] = this.quadrants;
        const sum = a + b + c + d;
        if (sum < 1e-15) return 0;
        return ((b + d) - (a + c)) / sum;
    }

    /** Normalized Y position signal: ((A+B)-(C+D))/Sum, range [-1, 1]. */
    get signalY(): number {
        const [a, b, c, d] = this.quadrants;
        const sum = a + b + c + d;
        if (sum < 1e-15) return 0;
        return ((a + b) - (c + d)) / sum;
    }

    /** Total power on all quadrants. */
    get signalSum(): number {
        return this.quadrants[0] + this.quadrants[1] + this.quadrants[2] + this.quadrants[3];
    }

    intersect(rayLocal: Ray): HitRecord | null {
        let tBlock = Infinity;
        let normalBlock = new Vector3();

        const ox = rayLocal.origin.x, oy = rayLocal.origin.y, oz = rayLocal.origin.z;
        const dx = rayLocal.direction.x, dy = rayLocal.direction.y, dz = rayLocal.direction.z;

        const hw = (this.activeDiameter + 6) / 2;
        const hh = (this.activeDiameter + 6) / 2;

        const slab = (o: number, d: number, minL: number, maxL: number) => {
            if (Math.abs(d) < 1e-12) return (o >= minL && o <= maxL) ? [-Infinity, Infinity] : null;
            let t1 = (minL - o) / d; let t2 = (maxL - o) / d;
            return t1 < t2 ? [t1, t2] : [t2, t1];
        };

        const tx = slab(ox, dx, -hw, hw);
        const ty = slab(oy, dy, -hh, hh);
        const tz = slab(oz, dz, -6, 0);

        if (tx && ty && tz) {
            const tMin = Math.max(tx[0], ty[0], tz[0]);
            const tMax = Math.min(tx[1], ty[1], tz[1]);
            if (tMin <= tMax) {
                if (tMin > 0.001) {
                    tBlock = tMin;
                    if (tMin === tx[0]) normalBlock.x = dx < 0 ? 1 : -1;
                    else if (tMin === ty[0]) normalBlock.y = dy < 0 ? 1 : -1;
                    else normalBlock.z = dz < 0 ? 1 : -1;
                } else if (tMax > 0.001) {
                    tBlock = tMax;
                    if (tMax === tx[1]) normalBlock.x = dx > 0 ? -1 : 1;
                    else if (tMax === ty[1]) normalBlock.y = dy > 0 ? -1 : 1;
                    else normalBlock.z = dz > 0 ? -1 : 1;
                }
            }
        }

        // Active aperture hit at z=0 plane
        let tActive = Infinity;
        if (Math.abs(dz) > 1e-6) {
            const t = -oz / dz;
            if (t > 0.001) {
                const hx = ox + t * dx;
                const hy = oy + t * dy;
                const r = this.activeDiameter / 2;
                if (hx * hx + hy * hy <= r * r) tActive = t;
            }
        }

        if (tBlock === Infinity && tActive === Infinity) return null;

        if (tBlock < tActive) {
            const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(tBlock));
            return { t: tBlock, point: hitPoint, normal: normalBlock, localPoint: hitPoint.clone(), isBlocked: true };
        } else {
            const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(tActive));
            return { t: tActive, point: hitPoint, normal: new Vector3(0, 0, 1), localPoint: hitPoint.clone() };
        }
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        if (hit.isBlocked) {
            return { rays: [] };
        }

        // Bin into quadrant based on local hit position
        const lp = hit.localPoint!;
        const halfGap = this.gapWidth / 2;

        if (Math.abs(lp.x) > halfGap && Math.abs(lp.y) > halfGap) {
            const isRight = lp.x > 0;
            const isTop = lp.y > 0;
            let idx: number;
            if (!isRight && isTop) idx = 0;       // A: top-left
            else if (isRight && isTop) idx = 1;    // B: top-right
            else if (!isRight && !isTop) idx = 2;  // C: bottom-left
            else idx = 3;                           // D: bottom-right

            this.quadrants[idx] += ray.intensity;
            this.quadrantHits[idx]++;
            this.totalHits++;
        }

        // Terminal detector: absorb everything
        return { rays: [] };
    }
}
