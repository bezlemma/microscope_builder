import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import {
    Ray, HitRecord, InteractionResult,
    childRay, jonesFromBasis, jonesProject,
} from '../types';
import { reflectVector } from '../math_solvers';

/**
 * PolarizingBeamSplitter — Reflects S-polarization, Transmits P-polarization.
 *
 * Thin circular polarizing beam-splitter plate. The physics surface is the
 * plate mid-plane (same convention as BeamSplitter and DichroicMirror); the
 * visible thickness is the holder/substrate envelope.
 *
 * S and P are defined by the actual incidence plane on that surface:
 *
 *   s = normalize(d x n)
 *   p = normalize(s x d)
 *
 * where d is the incoming ray direction and n is the surface normal facing the
 * incoming side. Ideal coating rule: S reflects, P transmits. At normal
 * incidence the incidence plane is undefined, so this ideal S/P plate has no
 * physically defined split and passes the ray through.
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

    private incidenceBasis(direction: Vector3, normal: Vector3): { sVec: Vector3; pVec: Vector3 } | null {
        const d = direction.clone().normalize();
        const n = normal.clone().normalize();
        const sVec = new Vector3().crossVectors(d, n);
        const sLen = sVec.length();
        if (sLen < 1e-9) return null;
        sVec.divideScalar(sLen);
        return {
            sVec,
            pVec: new Vector3().crossVectors(sVec, d).normalize(),
        };
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
        const d = ray.direction.clone().normalize();
        const n = hit.normal.clone().normalize();

        const basis = this.incidenceBasis(d, n);
        if (!basis) {
            return {
                rays: [childRay(ray, {
                    origin: hit.point,
                    intensity: ray.intensity,
                    opticalPathLength: opl,
                })]
            };
        }
        const { sVec, pVec } = basis;

        // Project the world-frame Jones vector onto the S and P basis vectors.
        const Es = jonesProject(ray.polarization, sVec);
        const Ep = jonesProject(ray.polarization, pVec);

        const powerS = Es.re * Es.re + Es.im * Es.im;
        const powerP = Ep.re * Ep.re + Ep.im * Ep.im;
        const total = powerS + powerP;
        if (total < 1e-12) {
            // Unpolarized / zero-amplitude — no physically meaningful split.
            // Send everything through to avoid disappearing the ray.
            return {
                rays: [childRay(ray, {
                    origin: hit.point,
                    intensity: ray.intensity,
                    opticalPathLength: opl,
                })]
            };
        }
        const fR = powerS / total;
        const fT = powerP / total;

        const raysOut: Ray[] = [];

        // Reflected: S-polarization preserved, π phase flip on reflection.
        // Output Jones is unit-magnitude; intensity carries the split fraction.
        if (fR > 1e-6) {
            const reflectedDir = reflectVector(d, n);
            const sMag = Math.sqrt(powerS);
            const phase = { re: -Es.re / sMag, im: -Es.im / sMag };
            const newPolarization = jonesFromBasis(phase, sVec);
            raysOut.push(childRay(ray, {
                origin: hit.point,
                direction: reflectedDir,
                intensity: ray.intensity * fR,
                opticalPathLength: opl,
                polarization: newPolarization,
            }));
        }

        // Transmitted: P-polarization preserved, direction unchanged.
        if (fT > 1e-6) {
            const pMag = Math.sqrt(powerP);
            const phase = { re: Ep.re / pMag, im: Ep.im / pMag };
            const newPolarization = jonesFromBasis(phase, pVec);
            raysOut.push(childRay(ray, {
                origin: hit.point,
                direction: d.clone(),
                intensity: ray.intensity * fT,
                opticalPathLength: opl,
                polarization: newPolarization,
            }));
        }

        return { rays: raysOut };
    }

    getApertureRadius(): number {
        return this.diameter / 2;
    }
}
