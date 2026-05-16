import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay, Complex } from '../types';
import { Vector3, Box3 } from 'three';

/**
 * Faraday Optical Isolator — allows light in one direction only.
 *
 * Forward-propagating light passes with a small insertion loss.
 * Backward-propagating light is attenuated by the extinction ratio.
 *
 * Applies 45deg non-reciprocal Faraday rotation to forward Jones vector.
 */
export class FaradayIsolator extends OpticalComponent {
    /** Insertion loss for forward-propagating light (0-1, e.g., 0.95 = 5% loss). */
    insertionLoss: number = 0.95;
    /** Extinction ratio in dB for backward-propagating light. */
    extinctionDB: number = 35;
    /** Aperture radius in mm. */
    apertureRadius: number = 12.5;

    private static readonly THICKNESS = 25;

    constructor(name: string = 'Faraday Isolator') {
        super(name);
        const t = FaradayIsolator.THICKNESS / 2;
        const r = this.apertureRadius;
        this.bounds = new Box3(
            new Vector3(-r, -r, -t),
            new Vector3(r, r, t)
        );
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const dw = rayLocal.direction.z;
        if (Math.abs(dw) < 1e-6) return null;

        const t = -rayLocal.origin.z / dw;
        if (t < 0.01) return null;

        const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));

        const hu = point.x;
        const hv = point.y;
        if (hu * hu + hv * hv > this.apertureRadius * this.apertureRadius) {
            return null;
        }

        const normal = new Vector3(0, 0, dw > 0 ? -1 : 1);
        return { t, point, normal, localPoint: point.clone() };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Forward = ray traveling in same direction as component's optical axis (+Z local)
        const localDir = ray.direction.clone().transformDirection(this.worldToLocal);
        const isForward = localDir.z > 0;

        let throughput: number;
        let polarization = ray.polarization;

        // Faraday rotation is NON-RECIPROCAL: the rotation sense is set by the
        // magnetic field in the medium, not by the direction of propagation.
        // In the lab frame, both forward and backward rays rotate by +45°.
        // This is the key physical signature that makes an isolator an isolator —
        // reflected light gets rotated ANOTHER 45° (not un-rotated), landing on
        // the orthogonal polarization axis so it's blocked by the input polarizer.
        const cos45 = Math.SQRT1_2;
        const sin45 = Math.SQRT1_2;
        const jx = ray.polarization.x;
        const jy = ray.polarization.y;
        const outX: Complex = {
            re: cos45 * jx.re - sin45 * jy.re,
            im: cos45 * jx.im - sin45 * jy.im,
        };
        const outY: Complex = {
            re: sin45 * jx.re + cos45 * jy.re,
            im: sin45 * jx.im + cos45 * jy.im,
        };
        polarization = { x: outX, y: outY, z: { re: 0, im: 0 } };

        if (isForward) {
            throughput = this.insertionLoss;
        } else {
            // Backward: the rotation is applied (above) AND the bulk extinction
            // accounts for the downstream polarizer rejecting the now-crossed
            // polarization. Keep using the dB extinction as a lumped attenuation.
            throughput = Math.pow(10, -this.extinctionDB / 10);
        }

        return {
            rays: [childRay(ray, {
                origin: hit.point,
                direction: ray.direction.clone(),
                polarization,
                intensity: ray.intensity * throughput,
                opticalPathLength: ray.opticalPathLength + hit.t,
            })],
            passthrough: true,
        };
    }
}
