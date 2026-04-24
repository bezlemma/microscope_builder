import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { Vector3, Box3 } from 'three';

/**
 * AOD (Acousto-Optic Deflector) — deflects a beam by an angle proportional
 * to the applied RF frequency.
 *
 * Splits the input beam into:
 *   - 0th order (undeflected): continues straight, intensity * (1 - efficiency)
 *   - 1st order (deflected): rotated by deflectionAngle around local Y axis,
 *     intensity * efficiency
 *
 * The deflection angle is the primary controllable/animatable parameter.
 */
export class AOD extends OpticalComponent {
    /** Current deflection angle in radians. */
    deflectionAngle: number = 0;
    /** Diffraction efficiency: fraction of power going into 1st order (0-1). */
    efficiency: number = 0.85;
    /** Maximum deflection angle in radians (~50 mrad typical). */
    maxAngle: number = 0.05;
    /** Crystal aperture radius in mm. */
    apertureRadius: number = 5;

    private static readonly WIDTH = 12;
    private static readonly HEIGHT = 12;
    private static readonly DEPTH = 30;

    constructor(name: string = 'AOD') {
        super(name);
        const w = AOD.WIDTH / 2;
        const h = AOD.HEIGHT / 2;
        const d = AOD.DEPTH / 2;
        this.bounds = new Box3(
            new Vector3(-w, -h, -d),
            new Vector3(w, h, d)
        );
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const dw = rayLocal.direction.z;
        if (Math.abs(dw) < 1e-6) return null;

        const t = -rayLocal.origin.z / dw;
        if (t < 0.01) return null;

        const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));

        if (point.x * point.x + point.y * point.y > this.apertureRadius * this.apertureRadius) {
            return null;
        }

        const normal = new Vector3(0, 0, dw > 0 ? -1 : 1);
        return { t, point, normal, localPoint: point.clone() };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        const raysOut: Ray[] = [];
        const opl = ray.opticalPathLength + hit.t;

        // 0th order: straight through
        if (this.efficiency < 1.0) {
            const zerothFraction = 1 - this.efficiency;
            raysOut.push(childRay(ray, {
                origin: hit.point,
                direction: ray.direction.clone(),
                intensity: ray.intensity * zerothFraction,
                opticalPathLength: opl,
            }));
        }

        // 1st order: deflected. The deflection axis is the AOD's LOCAL Y
        // (perpendicular to the optical axis and to the acoustic propagation
        // direction). We rotate in local space and transform back to world so
        // the deflection respects the AOD's orientation.
        if (this.efficiency > 0 && Math.abs(this.deflectionAngle) > 1e-9) {
            const localDir = ray.direction.clone().transformDirection(this.worldToLocal).normalize();
            const angle = this.deflectionAngle;
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);
            // Rotate around local +Y by `angle`.
            const deflectedLocal = new Vector3(
                cosA * localDir.x + sinA * localDir.z,
                localDir.y,
                -sinA * localDir.x + cosA * localDir.z
            ).normalize();
            const deflectedWorld = deflectedLocal.transformDirection(this.localToWorld).normalize();

            raysOut.push(childRay(ray, {
                origin: hit.point,
                direction: deflectedWorld,
                intensity: ray.intensity * this.efficiency,
                opticalPathLength: opl,
            }));
        } else if (this.efficiency > 0) {
            // Deflection angle ~0, 1st order goes straight
            raysOut.push(childRay(ray, {
                origin: hit.point,
                direction: ray.direction.clone(),
                intensity: ray.intensity * this.efficiency,
                opticalPathLength: opl,
            }));
        }

        return { rays: raysOut };
    }
}
