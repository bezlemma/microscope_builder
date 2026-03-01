import { OpticalComponent } from '../physics/Component';
import { Ray, HitRecord, InteractionResult } from '../physics/types';
import { intersectAABB } from '../physics/math_solvers';
import { Vector3, Box3 } from 'three';
import { wavelengthToRGB } from '../physics/spectral';

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
    beamRadius: number = 3;       // mm (1/e² beam half-width)
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

    // HOUSING box: body extends behind emission point along -X
    private static readonly HOUSING = new Box3(
        new Vector3(-20, -15, -11),
        new Vector3(3, 15, 11)
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

// ─── Visualizer ────────────────────────────────────────────

export const LampVisualizer = ({ component }: { component: OpticalComponent }) => {
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[-8.5, 0, 0]}>
                <boxGeometry args={[23, 30, 22]} />
                <meshStandardMaterial color="#2a2520" metalness={0.3} roughness={0.7} />
            </mesh>
            <mesh position={[3, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[5, 5, 2, 16]} />
                <meshStandardMaterial color="#BBB" />
            </mesh>
        </group>
    );
};

