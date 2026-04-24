import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { reflectVector } from '../math_solvers';

export class Mirror extends OpticalComponent {
    diameter: number;   // mm — circular aperture diameter
    thickness: number;  // mm — mirror body thickness

    /** Table hole spacing in mm. */
    static readonly TABLE_HOLE_SPACING_MM = 25;

    constructor(diameter: number = 25.4, thickness: number = 6, name: string = "Mirror") {
        super(name);
        this.diameter = diameter;
        this.thickness = thickness;
        const r = diameter / 2;
        this.bounds.set(
            new Vector3(-r, -r, -thickness / 2),
            new Vector3(r, r, thickness / 2),
        );
    }

    /**
     * Position and orient this mirror so that a beam arriving from
     * `incomingDirection` reflects into `outgoingDirection` at the given
     * world-space coordinates. The reflecting surface lands precisely on
     * (hitX, hitY, hitZ).
     */
    reflectAt(
        hitX: number,
        hitY: number,
        hitZ: number,
        incomingDirection: Vector3,
        outgoingDirection: Vector3,
    ): void {
        const incoming = incomingDirection.clone().normalize();
        const outgoing = outgoingDirection.clone().normalize();
        const normal = incoming.clone().sub(outgoing);
        if (normal.lengthSq() < 1e-12) {
            throw new Error('Mirror.reflectAt requires distinct incoming/outgoing directions.');
        }
        normal.normalize();
        this.pointAlong(normal.x, normal.y, normal.z);
        const offsetSign = Math.sign(incoming.dot(normal)) || 1;
        const halfThickness = this.thickness / 2;
        this.setPosition(
            hitX + offsetSign * halfThickness * normal.x,
            hitY + offsetSign * halfThickness * normal.y,
            hitZ + offsetSign * halfThickness * normal.z,
        );
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Two flat faces at w=±halfThickness (optical axis along z → w)
        // Transverse plane: u=x, v=y
        const radius = this.diameter / 2;
        const halfThickness = this.thickness / 2;

        const dw = rayLocal.direction.z;
        if (Math.abs(dw) < 1e-6) return null; // Parallel to both planes

        let bestT = Infinity;
        let bestHit: HitRecord | null = null;

        for (const planeW of [-halfThickness, halfThickness]) {
            const t = (planeW - rayLocal.origin.z) / dw;
            if (t > 0.001 && t < bestT) {
                const hitPoint = rayLocal.origin.clone().add(
                    rayLocal.direction.clone().multiplyScalar(t)
                );
                // Circular aperture check in uv transverse plane
                const hu = hitPoint.x;
                const hv = hitPoint.y;
                if (hu * hu + hv * hv <= radius * radius) {
                    bestT = t;
                    // Normal points outward from the face along ±w
                    const normal = new Vector3(0, 0, planeW > 0 ? 1 : -1);
                    bestHit = {
                        t: t,
                        point: hitPoint,
                        normal: normal,
                        localPoint: hitPoint
                    };
                }
            }
        }

        return bestHit;
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // If the ray approaches from the same side as the outward normal,
        // it's hitting from inside the mirror body → absorb (opaque metal).
        if (ray.direction.dot(hit.normal) >= 0) {
            return { rays: [] };
        }

        // Ray approaching from outside → reflect
        const reflectedDir = reflectVector(ray.direction, hit.normal);

        // Mirror reflection introduces a π phase shift (E → -E)
        // This negates both Jones vector components
        const polX = ray.polarization.x;
        const polY = ray.polarization.y;

        return {
            rays: [childRay(ray, {
                origin: hit.point,
                direction: reflectedDir,
                polarization: {
                    x: { re: -polX.re, im: -polX.im },
                    y: { re: -polY.re, im: -polY.im }
                },
                opticalPathLength: ray.opticalPathLength + hit.t
            })]
        };
    }

    /** Solver 2 transfer matrix. Flat mirrors leave q unchanged. */
    getParaxialTransform(): [number, number, number, number] {
        return [1, 0, 0, 1];
    }

    getApertureRadius(): number {
        return this.diameter / 2;
    }
}
