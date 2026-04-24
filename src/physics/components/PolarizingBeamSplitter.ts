import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { reflectVector } from '../math_solvers';

/**
 * PolarizingBeamSplitter — Reflects S-polarization, Transmits P-polarization.
 *
 * Projects the incoming Jones vector onto the incidence surface plane
 * to dynamically partition beam energy between reflected and transmitted rays.
 */
export class PolarizingBeamSplitter extends OpticalComponent {
    diameter: number;
    thickness: number;

    constructor(
        diameter: number = 25.4,
        thickness: number = 2,
        name: string = "Polarizing BS"
    ) {
        super(name);
        this.diameter = diameter;
        this.thickness = thickness;
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
            rayLocal.direction.clone().multiplyScalar(t)
        );

        const hu = hitPoint.x;
        const hv = hitPoint.y;
        if (hu * hu + hv * hv > radius * radius) {
            return null;
        }

        const normal = new Vector3(0, 0, dw < 0 ? 1 : -1);
        return { t, point: hitPoint, normal, localPoint: hitPoint.clone() };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
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
        const Ex = ray.polarization.x;
        const Ey = ray.polarization.y;

        // Calculate power in S and P components
        // S-polarization (perpendicular to incidence plane) is reflected
        // P-polarization (parallel to incidence plane) is transmitted
        const totalPower = Ex.re * Ex.re + Ex.im * Ex.im + Ey.re * Ey.re + Ey.im * Ey.im;
        // For a PBS aligned with the component axes, S ~ y-component, P ~ x-component
        const powerS = Ey.re * Ey.re + Ey.im * Ey.im;
        const powerP = Ex.re * Ex.re + Ex.im * Ex.im;
        const reflectFraction = totalPower > 1e-12 ? powerS / totalPower : 0;
        const transmitFraction = totalPower > 1e-12 ? powerP / totalPower : 0;

        const raysOut: Ray[] = [];

        // Reflected ray (S polarization).
        // Normalize the output Jones vector to unit magnitude so the downstream
        // |E|² = intensity · |Jones|² convention doesn't double-count the amplitude
        // reduction that's already encoded in `intensity * reflectFraction`.
        if (reflectFraction > 1e-6) {
            const reflectedDir = reflectVector(ray.direction, hit.normal);
            const sMag = Math.sqrt(powerS);
            const nyRe = sMag > 1e-12 ? -Ey.re / sMag : 0;
            const nyIm = sMag > 1e-12 ? -Ey.im / sMag : 0;
            raysOut.push(childRay(ray, {
                origin: hit.point,
                direction: reflectedDir,
                intensity: ray.intensity * reflectFraction,
                opticalPathLength: opl,
                polarization: {
                    x: { re: 0, im: 0 },
                    y: { re: nyRe, im: nyIm }, // unit-magnitude, π phase flip on reflection
                },
            }));
        }

        // Transmitted ray (P polarization) — also unit-normalized.
        if (transmitFraction > 1e-6) {
            const pMag = Math.sqrt(powerP);
            const nxRe = pMag > 1e-12 ? Ex.re / pMag : 0;
            const nxIm = pMag > 1e-12 ? Ex.im / pMag : 0;
            raysOut.push(childRay(ray, {
                origin: hit.point,
                direction: ray.direction.clone(),
                intensity: ray.intensity * transmitFraction,
                opticalPathLength: opl,
                polarization: {
                    x: { re: nxRe, im: nxIm },
                    y: { re: 0, im: 0 },
                },
            }));
        }

        return { rays: raysOut };
    }

    getParaxialTransform(): [number, number, number, number] {
        return [1, 0, 0, 1];
    }

    getApertureRadius(): number {
        return this.diameter / 2;
    }
}
