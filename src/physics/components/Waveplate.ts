import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, Complex, childRay } from '../types';
import { Vector3, Box3 } from 'three';

export type WaveplateMode = 'half' | 'quarter' | 'polarizer';

/**
 * Waveplate / Polarizer component.
 * 
 * Modes:
 * - 'half'      : λ/2 plate — rotates linear polarization by 2×(fastAxisAngle - inputAngle)
 * - 'quarter'   : λ/4 plate — converts linear ↔ circular polarization
 * - 'polarizer' : Linear polarizer — projects onto transmission axis, attenuates intensity
 * 
 * Physics (Jones calculus):
 *   Half-wave plate:     J = R(-θ) · diag(1, -1) · R(θ)
 *   Quarter-wave plate:  J = R(-θ) · diag(1, -i) · R(θ)
 *   Linear polarizer:    J = R(-θ) · diag(1,  0) · R(θ)
 * 
 * where θ = fastAxisAngle, R(θ) is rotation matrix.
 * 
 * The fast axis angle is measured from the local u-axis (transverse plane).
 */
export class Waveplate extends OpticalComponent {
    waveplateMode: WaveplateMode;
    fastAxisAngle: number;  // radians (0 = horizontal, π/4 = 45°, etc.)
    apertureRadius: number; // mm

    // Thin slab geometry for intersection
    private static readonly THICKNESS = 2; // mm visual thickness

    constructor(
        mode: WaveplateMode = 'half',
        apertureRadius: number = 12.5,
        fastAxisAngle: number = 0,
        name?: string
    ) {
        const defaultNames: Record<WaveplateMode, string> = {
            'half': 'λ/2 Plate',
            'quarter': 'λ/4 Plate',
            'polarizer': 'Linear Polarizer'
        };
        super(name ?? defaultNames[mode]);
        this.waveplateMode = mode;
        this.apertureRadius = apertureRadius;
        this.fastAxisAngle = fastAxisAngle;

        const t = Waveplate.THICKNESS / 2;
        const r = this.apertureRadius;
        this.bounds = new Box3(
            new Vector3(-t, -r, -r),
            new Vector3(t, r, r)
        );
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Thin-plane intersection at w=0 (optical axis along x → w)
        // Transverse plane: u=y, v=z
        const dw = rayLocal.direction.x;
        if (Math.abs(dw) < 1e-6) return null; // Parallel to face

        const t = -rayLocal.origin.x / dw;
        if (t < 0.01) return null;

        const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));

        // Circular aperture check in uv transverse plane
        const hu = point.y;
        const hv = point.z;
        if (hu * hu + hv * hv > this.apertureRadius * this.apertureRadius) {
            return null;
        }

        const normal = new Vector3(dw > 0 ? -1 : 1, 0, 0);  // ±w normal facing incoming ray

        return {
            t,
            point,
            normal,
            localPoint: point.clone()
        };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        const theta = this.fastAxisAngle;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);

        // Input Jones vector
        const jx = ray.polarization.x;
        const jy = ray.polarization.y;

        let outX: Complex, outY: Complex;

        if (this.waveplateMode === 'half') {
            // J = R(-θ) · diag(1, -1) · R(θ) · J_in
            // Step 1: Rotate into fast-axis frame
            const rx: Complex = { re: cos * jx.re + sin * jy.re, im: cos * jx.im + sin * jy.im };
            const ry: Complex = { re: -sin * jx.re + cos * jy.re, im: -sin * jx.im + cos * jy.im };
            // Step 2: Apply diag(1, -1) — slow axis gets π phase
            const mx: Complex = rx;
            const my: Complex = { re: -ry.re, im: -ry.im };
            // Step 3: Rotate back
            outX = { re: cos * mx.re - sin * my.re, im: cos * mx.im - sin * my.im };
            outY = { re: sin * mx.re + cos * my.re, im: sin * mx.im + cos * my.im };

        } else if (this.waveplateMode === 'quarter') {
            // J = R(-θ) · diag(1, -i) · R(θ) · J_in
            const rx: Complex = { re: cos * jx.re + sin * jy.re, im: cos * jx.im + sin * jy.im };
            const ry: Complex = { re: -sin * jx.re + cos * jy.re, im: -sin * jx.im + cos * jy.im };
            // Apply diag(1, e^{-iπ/2}) = diag(1, -i)
            // -i × (a + bi) = -ia - i²b = b - ia
            const mx: Complex = rx;
            const my: Complex = { re: ry.im, im: -ry.re };
            outX = { re: cos * mx.re - sin * my.re, im: cos * mx.im - sin * my.im };
            outY = { re: sin * mx.re + cos * my.re, im: sin * mx.im + cos * my.im };

        } else {
            // Polarizer: project onto transmission axis (fast axis direction)
            // Component along fast axis
            const projRe = cos * jx.re + sin * jy.re;
            const projIm = cos * jx.im + sin * jy.im;
            outX = { re: cos * projRe, im: cos * projIm };
            outY = { re: sin * projRe, im: sin * projIm };

            // Intensity loss: |proj|² / |J_in|²
            const inPow = jx.re * jx.re + jx.im * jx.im + jy.re * jy.re + jy.im * jy.im;
            const outPow = projRe * projRe + projIm * projIm;
            const throughput = inPow > 0 ? outPow / inPow : 0;

            // Create transmitted ray with reduced intensity
            const outRay = childRay(ray, {
                origin: hit.point.clone().add(ray.direction.clone().multiplyScalar(0.1)),
                direction: ray.direction.clone(),
                polarization: { x: outX, y: outY },
                intensity: ray.intensity * throughput
            });
            return { rays: [outRay] };
        }

        // Waveplates don't change intensity, only phase/polarization
        const outRay = childRay(ray, {
            origin: hit.point.clone().add(ray.direction.clone().multiplyScalar(0.1)),
            direction: ray.direction.clone(),
            polarization: { x: outX, y: outY },
            intensity: ray.intensity
        });
        return { rays: [outRay] };
    }

    /**
     * ABCD matrix: identity (waveplates don't affect beam width).
     */
    getABCD(): { tangential: number[][]; sagittal: number[][] } {
        const I = [[1, 0], [0, 1]];
        return { tangential: I, sagittal: I };
    }

    getApertureRadius(): number {
        return this.apertureRadius;
    }
}
