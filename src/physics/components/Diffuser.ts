import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { deterministicRandom } from '../deterministicRandom';

/**
 * Diffuser — frosted glass / ground-glass screen.
 *
 * A thin circular plane that scatters each incoming ray into a random
 * direction within a cone around the original propagation direction.
 * Energy is conserved (no absorption). Wavelength, phase, and
 * polarization are preserved.
 *
 * Used to turn a parallel beam (e.g. from a laser or SLM) into
 * diverging light, simulating an illuminated diffuse object.
 */
export class Diffuser extends OpticalComponent {
    diameter: number;
    thickness: number;

    /** Half-angle of the scattering cone (radians).
     *  1deg is typical for engineered diffusers.
     *  5deg is a strong scatter. */
    coneHalfAngle: number;

    constructor(
        diameter: number = 25.4,
        thickness: number = 2,
        coneHalfAngle: number = 1 * Math.PI / 180,
        name: string = 'Diffuser',
    ) {
        super(name);
        this.diameter = diameter;
        this.thickness = thickness;
        this.coneHalfAngle = coneHalfAngle;
        const r = diameter / 2;
        this.bounds.set(
            new Vector3(-r, -r, -thickness / 2),
            new Vector3(r, r, thickness / 2),
        );
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const radius = this.diameter / 2;
        const dw = rayLocal.direction.z;
        if (Math.abs(dw) < 1e-6) return null;

        const t = -rayLocal.origin.z / dw;
        if (t < 0.001) return null;

        const hitPoint = rayLocal.origin.clone().add(
            rayLocal.direction.clone().multiplyScalar(t),
        );

        const hu = hitPoint.x;
        const hv = hitPoint.y;
        if (hu * hu + hv * hv > radius * radius) return null;

        const normal = new Vector3(0, 0, dw < 0 ? 1 : -1);
        return { t, point: hitPoint, normal, localPoint: hitPoint.clone() };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Build a local basis around the incoming ray direction.
        const forward = ray.direction.clone().normalize();
        let upHint = new Vector3(0, 1, 0);
        if (Math.abs(forward.dot(upHint)) > 0.99) upHint = new Vector3(1, 0, 0);
        const right = new Vector3().crossVectors(forward, upHint).normalize();
        const up = new Vector3().crossVectors(right, forward).normalize();

        // Deterministic random from hit position (seeded by ray properties)
        const seed1 = deterministicRandom(
            hit.point.x, hit.point.y, hit.point.z,
            ray.origin.x, ray.origin.y, ray.origin.z,
            ray.direction.x, ray.direction.y, ray.direction.z,
            ray.wavelength, 0,
        );
        const seed2 = deterministicRandom(
            hit.point.x, hit.point.y, hit.point.z,
            ray.origin.x, ray.origin.y, ray.origin.z,
            ray.direction.x, ray.direction.y, ray.direction.z,
            ray.wavelength, 1,
        );

        // Uniform random direction within the scattering cone.
        const cosMin = Math.cos(this.coneHalfAngle);
        const cosTheta = cosMin + seed1 * (1 - cosMin);
        const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
        const phi = seed2 * 2 * Math.PI;

        const scatteredDir = new Vector3()
            .addScaledVector(right, sinTheta * Math.cos(phi))
            .addScaledVector(up, sinTheta * Math.sin(phi))
            .addScaledVector(forward, cosTheta)
            .normalize();

        return {
            rays: [childRay(ray, {
                origin: hit.point,
                direction: scatteredDir,
                opticalPathLength: ray.opticalPathLength + hit.t,
            })],
        };
    }
}
