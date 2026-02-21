import { Vector3, Box3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { SpectralProfile } from '../SpectralProfile';
import { intersectAABB } from '../math_solvers';

/**
 * Sample — Mickey Mouse, roughly 1mm in diameter similar to my normal samples.
 *
 * Physics:
 *   - Brightfield: Beer-Lambert absorption based on ray path length through material.
 *     T = exp(-α·d) where α = absorption coefficient, d = chord length.
 *   - Fluorescence metadata (excitation/emission spectra) is stored here
 *     for Solver 3 to query when backward rays hit the sample.
 *     The Sample does NOT generate emission rays itself.
 */
export class Sample extends OpticalComponent {
    excitationSpectrum: SpectralProfile;   // What wavelengths excite this fluorophore
    emissionSpectrum: SpectralProfile;     // What wavelengths are emitted
    fluorescenceEfficiency: number;        // Quantum yield × absorption (dimensionless)
    absorption: number;                    // Beer-Lambert coeff (mm⁻¹). Higher = more opaque.

    // Mickey Mouse geometry definition (local space)
    // Frame is in YZ plane (standing upright at default rotation),
    // holder normal is along X, ears point +Z (up), spread in ±Y.
    private static readonly SPHERES = [
        { center: new Vector3(0, 0, 0), radius: 0.5 },        // Head
        { center: new Vector3(0, -0.5, 0.5), radius: 0.25 },  // Left ear (+Z up, -Y left)
        { center: new Vector3(0, 0.5, 0.5), radius: 0.25 },   // Right ear (+Z up, +Y right)
    ];

    private static readonly BOUNDS = new Box3(
        new Vector3(-0.5, -10, -10),
        new Vector3(0.5, 10, 10)
    );

    constructor(name: string = "Sample (Mickey)") {
        super(name);
        // GFP-like
        this.excitationSpectrum = new SpectralProfile('bandpass', 500, [{ center: 488, width: 30 }]);
        this.emissionSpectrum = new SpectralProfile('bandpass', 500, [{ center: 520, width: 40 }]);
        this.fluorescenceEfficiency = 0.5; // Fluorescence quantum yield (0–1)
        this.absorption = 3.0;              // Beer-Lambert coeff: exp(-3·1) ≈ 5% at thickest
    }

    /**
     * Query excitation efficiency at a given wavelength (0–1).
     * Used by Solver 3 to weight fluorescence by spectral overlap.
     */
    getExcitationEfficiency(wavelengthNm: number): number {
        return this.excitationSpectrum.getTransmission(wavelengthNm);
    }

    /**
     * Get the dominant emission wavelength (nm) for backward ray tracing.
     * Returns the peak of the emission spectrum, or 520nm fallback.
     */
    getEmissionWavelength(): number {
        return this.emissionSpectrum.getDominantPassWavelength() ?? 520;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const { hit, tMin, tMax } = intersectAABB(rayLocal.origin, rayLocal.direction, Sample.BOUNDS);
        if (!hit || tMax < 0.001) return null;

        const t = tMin > 0.001 ? tMin : tMax;
        const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));

        return {
            t: t,
            point: point,
            normal: new Vector3(1, 0, 0), // Generic normal for bounding box
            localPoint: point
        };
    }

    /**
     * Get the near and far planes of the sample volume for a world ray.
     * Used by Solver 3 strictly to evaluate the internal E&M field integral.
     */
    getVolumeIntersection(worldRay: Ray): { tNear: number, tFar: number } | null {
        this.updateMatrices();
        const localOrigin = worldRay.origin.clone().applyMatrix4(this.worldToLocal);
        const localDir = worldRay.direction.clone().transformDirection(this.worldToLocal).normalize();
        
        const { hit, tMin, tMax } = intersectAABB(localOrigin, localDir, Sample.BOUNDS);
        if (!hit || tMax <= 0) return null;

        // Return distances along the WORLD ray, which match LOCAL distances because the
        // transform is purely rotational/translational (scale = 1).
        return { tNear: Math.max(0, tMin), tFar: tMax };
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
