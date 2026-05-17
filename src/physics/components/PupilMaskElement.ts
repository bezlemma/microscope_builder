import { Vector3, Box3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay, Complex } from '../types';
import { PupilMask, samplePupilMask, createUniformPupilMask, createPhaseRingPupilMask } from '../PupilFunction';

/**
 * PupilMaskElement — a pupil plane mask with phase and amplitude modulation.
 *
 * Three modes:
 *   - 'uniform': full transmission, no phase shift
 *   - 'annulus': ring aperture (blocks outside inner/outer radii)
 *   - 'phaseRing': ring with configurable phase shift and transmission
 *
 * Simplified for ray system: applies amplitude/phase mask at thin plane.
 * No edge interaction or diffraction.
 */
export class PupilMaskElement extends OpticalComponent {
    mode: 'uniform' | 'annulus' | 'phaseRing' = 'phaseRing';
    radius: number = 4;
    thickness: number = 1;
    innerRadius: number = 0.55;
    outerRadius: number = 0.8;
    ringTransmission: number = 1;
    ringPhaseShift: number = Math.PI / 2;
    backgroundTransmission: number = 1;
    backgroundPhaseShift: number = 0;
    resolution: number = 64;

    private _mask: PupilMask | null = null;

    constructor(name: string = 'Pupil Mask') {
        super(name);
        this.updateBounds();
        this.rebuildMask();
    }

    /** Recompute bounds from the current radius/thickness. Call after edits. */
    updateBounds(): void {
        const r = this.radius;
        this.bounds = new Box3(
            new Vector3(-r, -r, -this.thickness / 2),
            new Vector3(r, r, this.thickness / 2),
        );
        this.version++;
    }

    rebuildMask(): void {
        switch (this.mode) {
            case 'uniform':
                this._mask = createUniformPupilMask(this.resolution);
                break;
            case 'annulus':
                this._mask = createPhaseRingPupilMask(this.innerRadius, this.outerRadius, {
                    ringTransmission: 1,
                    ringPhase: 0,
                    backgroundTransmission: 0,
                    backgroundPhase: 0,
                    res: this.resolution,
                });
                break;
            case 'phaseRing':
                this._mask = createPhaseRingPupilMask(this.innerRadius, this.outerRadius, {
                    ringTransmission: this.ringTransmission,
                    ringPhase: this.ringPhaseShift,
                    backgroundTransmission: this.backgroundTransmission,
                    backgroundPhase: this.backgroundPhaseShift,
                    res: this.resolution,
                });
                break;
        }
        this.version++;
    }

    get mask(): PupilMask | null { return this._mask; }

    intersect(rayLocal: Ray): HitRecord | null {
        const dw = rayLocal.direction.z;
        if (Math.abs(dw) < 1e-6) return null;

        const t = -rayLocal.origin.z / dw;
        if (t < 0.001) return null;

        const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
        const hu = point.x;
        const hv = point.y;
        if (hu * hu + hv * hv > this.radius * this.radius) return null;

        const normal = new Vector3(0, 0, dw < 0 ? 1 : -1);
        return { t, point, normal, localPoint: point.clone() };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        const lp = hit.localPoint!;
        const xNorm = lp.x / this.radius;
        const yNorm = lp.y / this.radius;

        const sample = samplePupilMask(this._mask, xNorm, yNorm);

        if (sample.transmission < 1e-6) {
            return { rays: [] }; // Blocked
        }

        const opl = ray.opticalPathLength + hit.t;
        const amplitude = sample.transmission;
        const phase = sample.phase;
        const wavelengthMm = ray.wavelength * 1e3;
        const phaseOplOffset = Number.isFinite(wavelengthMm) && Math.abs(wavelengthMm) > 1e-12
            ? (phase / (2 * Math.PI)) * wavelengthMm
            : 0;

        // Apply phase shift and amplitude. A scalar pupil phase is an optical
        // path phase, not a polarization change, so store it as equivalent OPL.
        // Jones masks can still carry polarization-specific phase directly.
        let polarization = ray.polarization;
        let opticalPathLength = opl + phaseOplOffset;
        if (sample.jones) {
            // Apply Jones matrix: E_out = J * E_in
            const [m00, m01, m10, m11] = sample.jones;
            const ex = ray.polarization.x;
            const ey = ray.polarization.y;
            const outX: Complex = {
                re: (m00.re * ex.re - m00.im * ex.im + m01.re * ey.re - m01.im * ey.im),
                im: (m00.re * ex.im + m00.im * ex.re + m01.re * ey.im + m01.im * ey.re),
            };
            const outY: Complex = {
                re: (m10.re * ex.re - m10.im * ex.im + m11.re * ey.re - m11.im * ey.im),
                im: (m10.re * ex.im + m10.im * ex.re + m11.re * ey.im + m11.im * ey.re),
            };
            polarization = { x: outX, y: outY, z: { re: ray.polarization.z.re, im: ray.polarization.z.im } };
            opticalPathLength = opl;
        } else {
            // Keep the scalar phase in opticalPathLength; rotating the Jones
            // vector as well would double-count coherent interference phase.
            const ex = ray.polarization.x;
            const ey = ray.polarization.y;
            const ez = ray.polarization.z;
            polarization = {
                x: { re: ex.re, im: ex.im },
                y: { re: ey.re, im: ey.im },
                z: { re: ez.re, im: ez.im },
            };
        }

        return {
            rays: [childRay(ray, {
                origin: hit.point,
                intensity: ray.intensity * amplitude * amplitude,
                opticalPathLength,
                polarization,
            })],
            passthrough: true,
        };
    }
}
