import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { reflectVector } from '../math_solvers';

/**
 * BeamSplitter — 50/50 non-polarizing beam splitter (thin plate model).
 *
 * On hit, splits the incoming ray into two child rays:
 *   - Reflected (splitRatio of intensity): reflected off the surface
 *   - Transmitted (1 - splitRatio of intensity): passes straight through
 *
 * Both children inherit polarization from the parent ray.
 * Geometry: thin flat plate like Mirror — two flat faces at x = ±thickness/2.
 */
export class BeamSplitter extends OpticalComponent {
    diameter: number;     // mm — circular aperture diameter
    thickness: number;    // mm — plate thickness
    splitRatio: number;   // fraction reflected (0–1), default 0.5

    constructor(
        diameter: number = 25,
        thickness: number = 2,
        splitRatio: number = 0.5,
        name: string = "Beam Splitter"
    ) {
        super(name);
        this.diameter = diameter;
        this.thickness = thickness;
        this.splitRatio = splitRatio;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Thin plate model: single splitting plane at x = 0 (component center)
        // This makes the splitting point coincide with the component's position,
        // which is critical for proper interferometer alignment.
        const radius = this.diameter / 2;

        const denom = rayLocal.direction.x;
        if (Math.abs(denom) < 1e-6) return null; // Parallel

        const t = (0 - rayLocal.origin.x) / denom;
        if (t < 0.001) return null;

        const hitPoint = rayLocal.origin.clone().add(
            rayLocal.direction.clone().multiplyScalar(t)
        );

        // Circular aperture check (in YZ plane)
        if (hitPoint.y * hitPoint.y + hitPoint.z * hitPoint.z > radius * radius) {
            return null;
        }

        // Normal faces toward the incoming ray
        const normal = new Vector3(denom < 0 ? 1 : -1, 0, 0);
        return {
            t,
            point: hitPoint,
            normal,
            localPoint: hitPoint.clone()
        };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Determine if ray is approaching from outside (normal faces against ray)
        const approaching = ray.direction.dot(hit.normal) < 0;

        if (!approaching) {
            // Hitting from inside — just pass through (shouldn't normally happen
            // for thin plate, but handle gracefully)
            return {
                rays: [childRay(ray, {
                    origin: hit.point,
                    intensity: ray.intensity
                })]
            };
        }

        const opl = ray.opticalPathLength + hit.t;

        // Reflected ray
        const reflectedDir = reflectVector(ray.direction, hit.normal);
        const reflectedRay = childRay(ray, {
            origin: hit.point,
            direction: reflectedDir,
            intensity: ray.intensity * this.splitRatio,
            opticalPathLength: opl
        });

        // Transmitted ray — passes straight through
        const transmittedRay = childRay(ray, {
            origin: hit.point,
            direction: ray.direction.clone(),
            intensity: ray.intensity * (1 - this.splitRatio),
            opticalPathLength: opl
        });

        return {
            rays: [reflectedRay, transmittedRay]
        };
    }

    /**
     * ABCD matrix for Solver 2 — thin flat plate = identity.
     */
    getABCD(): [number, number, number, number] {
        return [1, 0, 0, 1];
    }

    getApertureRadius(): number {
        return this.diameter / 2;
    }
}
