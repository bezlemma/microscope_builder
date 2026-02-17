import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';

/**
 * Sample — specimen on the optical table.
 *
 * Geometry: Mickey Mouse (3 spheres) in local space.
 *
 * Physics:
 *   - Brightfield: Beer-Lambert absorption based on ray path length through material.
 *     T = exp(-α·d) where α = absorption coefficient, d = chord length.
 *   - Fluorescence metadata (excitation/emission wavelengths) is stored here
 *     for Solver 3 to query when backward rays hit the sample.
 *     The Sample does NOT generate emission rays itself.
 */
export class Sample extends OpticalComponent {
    excitationNm: number;           // Excitation center wavelength (nm)
    emissionNm: number;             // Emission center wavelength (nm)
    excitationBandwidth: number;    // Excitation band FWHM (nm)
    fluorescenceEfficiency: number; // Quantum yield × absorption (dimensionless)
    absorption: number;             // Beer-Lambert coeff (mm⁻¹). Higher = more opaque.

    // Mickey Mouse geometry definition (local space)
    private static readonly SPHERES = [
        { center: new Vector3(0, 0, 0), radius: 0.5 },       // Head
        { center: new Vector3(-0.5, 0.5, 0), radius: 0.25 }, // Left ear
        { center: new Vector3(0.5, 0.5, 0), radius: 0.25 },  // Right ear
    ];

    constructor(name: string = "Sample (Mickey)") {
        super(name);
        this.excitationNm = 488;       // Default: GFP excitation
        this.emissionNm = 520;         // Default: GFP emission
        this.excitationBandwidth = 30; // ±15 nm acceptance
        this.fluorescenceEfficiency = 1e-4; // Fluorescence ~10,000× weaker than excitation
        this.absorption = 3.0;         // Beer-Lambert coeff: exp(-3·1) ≈ 5% at thickest
    }

    intersect(rayLocal: Ray): HitRecord | null {
        let closestT = Infinity;
        let bestHit: HitRecord | null = null;

        for (const sphere of Sample.SPHERES) {
            const oc = rayLocal.origin.clone().sub(sphere.center);
            const b = oc.dot(rayLocal.direction);
            const c = oc.dot(oc) - sphere.radius * sphere.radius;
            const h = b * b - c;

            if (h >= 0) {
                const sqrtH = Math.sqrt(h);
                const t1 = -b - sqrtH;
                const t2 = -b + sqrtH;

                // Check t1
                if (t1 > 0.001 && t1 < closestT) {
                    closestT = t1;
                    const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t1));
                    bestHit = {
                        t: t1,
                        point: point,
                        normal: point.clone().sub(sphere.center).normalize(),
                        localPoint: point
                    };
                }
                 // Check t2 (only if inside)
                 else if (t2 > 0.001 && t2 < closestT) {
                    closestT = t2;
                    const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t2));
                    bestHit = {
                        t: t2,
                        point: point,
                        normal: point.clone().sub(sphere.center).normalize(),
                        localPoint: point
                    };
                }
            }
        }

        return bestHit;
    }

    /**
     * Compute total path length (chord length) through the Mickey geometry
     * for a given WORLD-space ray. This is used by Solver 3 for Beer-Lambert
     * absorption: T = exp(-α·d).
     *
     * Sums chord lengths across all spheres the ray passes through.
     * Returns 0 if the ray misses all spheres.
     */
    computeChordLength(worldRay: Ray): number {
        // Transform ray to local space
        this.updateMatrices();
        const localOrigin = worldRay.origin.clone().applyMatrix4(this.worldToLocal);
        const localDir = worldRay.direction.clone().transformDirection(this.worldToLocal).normalize();

        let totalChord = 0;

        for (const sphere of Sample.SPHERES) {
            const oc = localOrigin.clone().sub(sphere.center);
            const b = oc.dot(localDir);
            const c = oc.dot(oc) - sphere.radius * sphere.radius;
            const h = b * b - c;

            if (h >= 0) {
                const sqrtH = Math.sqrt(h);
                const t1 = -b - sqrtH;
                const t2 = -b + sqrtH;

                // Only count positive intersections (forward along ray)
                const tEntry = Math.max(t1, 0);
                const tExit = Math.max(t2, 0);

                if (tExit > tEntry) {
                    totalChord += tExit - tEntry;
                }
            }
        }

        return totalChord;
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Brightfield pass-through: ray continues unchanged.
        // Fluorescence emission is handled by Solver 3 (backward tracing).
        return {
            rays: [childRay(ray, {
                origin: hit.point,
                direction: ray.direction.clone()
            })]
        };
    }
}
