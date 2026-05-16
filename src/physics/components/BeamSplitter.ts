import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay, reflectJones } from '../types';
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
        diameter: number = 25.4,
        thickness: number = 2,
        splitRatio: number = 0.5,
        name: string = "Beam Splitter"
    ) {
        super(name);
        this.diameter = diameter;
        this.thickness = thickness;
        this.splitRatio = splitRatio;
        const r = diameter / 2;
        this.bounds.set(
            new Vector3(-r, -r, -thickness / 2),
            new Vector3(r, r, thickness / 2),
        );
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Thin plate: splitting plane at w=0 (optical axis along z → w)
        // Transverse plane: u=x, v=y
        const radius = this.diameter / 2;

        const dw = rayLocal.direction.z;
        if (Math.abs(dw) < 1e-6) return null; // Parallel

        const t = -rayLocal.origin.z / dw;
        if (t < 0.001) return null;

        const hitPoint = rayLocal.origin.clone().add(
            rayLocal.direction.clone().multiplyScalar(t)
        );

        // Circular aperture check in uv transverse plane
        const hu = hitPoint.x;
        const hv = hitPoint.y;
        if (hu * hu + hv * hv > radius * radius) {
            return null;
        }

        // Normal faces toward the incoming ray along ±w
        const normal = new Vector3(0, 0, dw < 0 ? 1 : -1);
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
            return {
                rays: [childRay(ray, {
                    origin: hit.point,
                    intensity: ray.intensity,
                    opticalPathLength: ray.opticalPathLength + hit.t,
                })]
            };
        }

        const opl = ray.opticalPathLength + hit.t;

        // Reflected ray — proper incidence-plane reflection physics.
        const reflectedDir = reflectVector(ray.direction, hit.normal);
        const reflectedPolarization = reflectJones(
            ray.polarization, ray.direction, hit.normal, reflectedDir,
        );
        const reflectedRay = childRay(ray, {
            origin: hit.point,
            direction: reflectedDir,
            intensity: ray.intensity * this.splitRatio,
            opticalPathLength: opl,
            polarization: reflectedPolarization,
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

    getApertureRadius(): number {
        return this.diameter / 2;
    }
}
