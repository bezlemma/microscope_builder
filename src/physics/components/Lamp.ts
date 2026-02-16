import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { intersectAABB } from '../math_solvers';
import { Vector3, Box3 } from 'three';

/**
 * Convert wavelength (nm) to linear RGB using the same algorithm as RayVisualizer.
 * Used here purely for computing white-balance weights.
 */
function wavelengthToRGBLinear(wlNm: number): { r: number; g: number; b: number } {
    let r = 0, g = 0, b = 0;
    if (wlNm >= 380 && wlNm < 440) { r = -(wlNm - 440) / (440 - 380); b = 1; }
    else if (wlNm >= 440 && wlNm < 490) { g = (wlNm - 440) / (490 - 440); b = 1; }
    else if (wlNm >= 490 && wlNm < 510) { g = 1; b = -(wlNm - 510) / (510 - 490); }
    else if (wlNm >= 510 && wlNm < 580) { r = (wlNm - 510) / (580 - 510); g = 1; }
    else if (wlNm >= 580 && wlNm < 645) { r = 1; g = -(wlNm - 645) / (645 - 580); }
    else if (wlNm >= 645 && wlNm <= 780) { r = 1; }
    let f = 1;
    if (wlNm >= 380 && wlNm < 420) f = 0.3 + 0.7 * (wlNm - 380) / (420 - 380);
    else if (wlNm >= 645 && wlNm <= 780) f = 0.3 + 0.7 * (780 - wlNm) / (780 - 645);
    else if (wlNm < 380 || wlNm > 780) return { r: 0, g: 0, b: 0 };
    r = Math.pow(r * f, 0.8);
    g = Math.pow(g * f, 0.8);
    b = Math.pow(b * f, 0.8);
    return { r, g, b };
}

/**
 * Compute the optimal per-ray opacity for additive blending.
 * When all visible rays overlap with this opacity, their additive RGB sums
 * should each reach ~1.0, producing white. Formula: opacity = 1 / min(sumR, sumG, sumB).
 * The weakest channel barely saturates; stronger channels clamp.
 */
function computeAdditiveOpacity(wavelengthsNm: number[]): number {
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
 * Lamp — broadband white-light source for brightfield microscopy.
 *
 * Emits rays at multiple discrete wavelengths spanning the visible spectrum.
 * Each wavelength traces independently through the optical system, enabling
 * chromatic aberration, filter spectral effects, and true white-light imaging.
 *
 * Default: 7 visible wavelengths (ROYGBIV) at 40nm spacing.
 * Can include UV (<380nm) and IR (>780nm) bands for prism demonstrations.
 * Unpolarized (modeled as fixed horizontal polarization — irrelevant for
 * non-polarization-sensitive setups).
 * Incoherent — no interference between wavelengths.
 */
export class Lamp extends OpticalComponent {
    beamRadius: number = 3;       // mm (half-width of collimated beam)
    beamWaist: number = 3;        // mm (1/e² waist radius for Solver 2)
    power: number = 1.0;          // Watts (total optical output power)

    // Discrete wavelengths to emit, in nm. 
    spectralWavelengths: number[] = [340, 380, 420, 460, 500, 540, 580, 620, 660, 700, 740, 780, 820];

    /**
     * Optimal per-ray opacity for additive blending.
     * Auto-computed so overlapping visible rays produce balanced white.
     */
    get additiveOpacity(): number {
        return computeAdditiveOpacity(this.spectralWavelengths);
    }

    private static readonly HOUSING = new Box3(
        new Vector3(-20, -11, -15),
        new Vector3(3, 11, 15)
    );

    constructor(name: string = "Lamp Source") {
        super(name);
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const { hit, tMin, tMax } = intersectAABB(rayLocal.origin, rayLocal.direction, Lamp.HOUSING);
        if (!hit) return null;

        const t = tMin > 0 ? tMin : tMax;
        if (t < 0) return null;

        return {
            t,
            point: rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t)),
            normal: new Vector3(1, 0, 0),
            localPoint: rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t))
        };
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        // Absorb external rays hitting the housing
        return { rays: [] };
    }
}

