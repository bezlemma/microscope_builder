import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { intersectAABB } from '../math_solvers';
import { Vector3, Box3 } from 'three';
import { wavelengthToRGB } from '../spectral';

/**
 * Convert wavelength (nm) to linear RGB for white-balance computation.
 * Delegates to the centralized spectral.ts implementation.
 */
function wavelengthToRGBLinear(wlNm: number): { r: number; g: number; b: number } {
    const { r, g, b } = wavelengthToRGB(wlNm);
    return { r, g, b };
}

/**
 * Compute the optimal per-ray opacity for additive blending.
 * When all visible rays overlap with this opacity, their additive RGB sums
 * should each reach ~1.0, producing white. Formula: opacity = 1 / min(sumR, sumG, sumB).
 * The weakest channel barely saturates; stronger channels clamp.
 */
export function computeAdditiveOpacity(wavelengthsNm: number[]): number {
    let sumR = 0, sumG = 0, sumB = 0;
    for (const wl of wavelengthsNm) {
        const c = wavelengthToRGBLinear(wl);
        sumR += c.r; sumG += c.g; sumB += c.b;
    }
    // If any channel has no contribution, fall back to 0.5
    if (sumR < 0.01 || sumG < 0.01 || sumB < 0.01) return 0.5;
    // Opacity that makes the weakest channel reach 1.0
    const minSum = Math.min(sumR, sumG, sumB);
    return Math.min(1.0, 1.0 / minSum);
}

/**
 * Generate `N` visible wavelengths for a broadband lamp. Odd N keeps a
 * wavelength near the 540 nm photopic peak, while the full default spread covers
 * violet through red so dispersive optics can show an actual rainbow instead of
 * only cyan/yellow endpoints.
 *   N = 1 → [540]
 *   N = 3 → [460, 540, 650]   (display-friendly B/G/R primaries)
 *   N = 7 → [415, 455.8, 496.7, 537.5, 578.3, 619.2, 660]
 */
export function generateLampSpectrum(N: number): number[] {
    const count = Math.max(1, Math.round(N));
    if (count === 1) return [540];
    if (count === 3) return [460, 540, 650];
    const minWl = 415;
    const maxWl = 660;
    const step = (maxWl - minWl) / (count - 1);
    return Array.from({ length: count }, (_, i) => minWl + i * step);
}

/**
 * Lamp — broadband white-light source for brightfield microscopy.
 *
 * Emits rays at multiple discrete wavelengths spanning the visible spectrum.
 * Each wavelength traces independently through the optical system, enabling
 * chromatic aberration, filter spectral effects, and true white-light imaging.
 *
 * Wavelength count is set with `spectralCount` (snaps to odd; default 7).
 * `spectralWavelengths` is also directly assignable for callers that need to
 * pin specific wavelengths (e.g. fluorescence presets, .ubz round-trip).
 */
export class Lamp extends OpticalComponent {
    beamRadius: number = 3;       // mm (1/e² beam half-width)
    power: number = 1.0;          // Watts (total optical output power)
    sourcePointCount: number = 3; // Number of source points (for extended sources)
    emitterRadius: number = 0.9;  // Physical emitter radius (mm)

    // Discrete wavelengths to emit, in nm. Initialised by the constructor from
    // the default `spectralCount`; can be reassigned directly to override.
    spectralWavelengths: number[] = generateLampSpectrum(7);

    /**
     * Number of discrete spectral lines the lamp is split into. Snaps to odd
     * on assignment so the bundle stays white-balanced around 540 nm, and
     * regenerates `spectralWavelengths` to a fresh evenly-spaced set.
     */
    get spectralCount(): number {
        return this.spectralWavelengths.length;
    }
    set spectralCount(n: number) {
        let value = Math.max(1, Math.round(n));
        if (value % 2 === 0) value += 1;
        this.spectralWavelengths = generateLampSpectrum(value);
        this.version++;
    }

    /**
     * Optimal per-ray opacity for additive blending.
     * Auto-computed so overlapping visible rays produce balanced white.
     */
    get additiveOpacity(): number {
        return computeAdditiveOpacity(this.spectralWavelengths);
    }

    private static readonly HOUSING = new Box3(
        new Vector3(-15, -11, -20),
        new Vector3(15, 11, 3)
    );

    constructor(name: string = "Lamp Source") {
        super(name);
        this.bounds = Lamp.HOUSING.clone();
        // Default: beam fires along +X (in the optical table XY plane)
        this.pointAlong(1, 0, 0);
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const { hit, tMin, tMax } = intersectAABB(rayLocal.origin, rayLocal.direction, Lamp.HOUSING);
        if (!hit) return null;

        // Use the first positive t to avoid self-intersection when a ray starts
        // exactly on the housing boundary.
        const t = tMin > 0.001 ? tMin : tMax;
        if (t < 0.001) return null;

        const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
        return {
            t,
            point,
            normal: new Vector3(0, 0, 1),
            localPoint: point.clone()
        };
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        // Absorb external rays hitting the housing
        return { rays: [] };
    }
}
