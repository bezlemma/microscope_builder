import { Box3, Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { HitRecord, InteractionResult, Ray, childRay, refractJones } from '../types';
import { OpticMesh } from '../OpticMesh';

/**
 * OpticalWindow — a parallel transparent plate/window.
 *
 * Models the ray geometry and scalar phase of a real flat glass plate:
 * refraction into glass, propagation through the slab, refraction back out,
 * aperture clipping, surface transmission, and optical path length through
 * the substrate. Reflected ghost branches and coating-dependent Fresnel
 * amplitudes are intentionally left for the coating system.
 */
export class OpticalWindow extends OpticalComponent {
    diameter: number;
    thickness: number;
    refractiveIndex: number;
    exteriorRefractiveIndex: number;
    surfaceTransmission: number;
    opticalPathOffsetMm: number;

    constructor(
        diameter: number = 25.4,
        thickness: number = 5,
        refractiveIndex: number = 1.458,
        name: string = 'Optical Window',
        surfaceTransmission: number = 0.995,
    ) {
        super(name);
        this.diameter = diameter;
        this.thickness = thickness;
        this.refractiveIndex = refractiveIndex;
        this.exteriorRefractiveIndex = 1;
        this.surfaceTransmission = surfaceTransmission;
        this.opticalPathOffsetMm = 0;
        this.updateBounds();
    }

    updateBounds(): void {
        const r = Math.max(this.diameter / 2, 0.001);
        const halfT = Math.max(this.thickness / 2, 0.001);
        this.bounds = new Box3(new Vector3(-r, -r, -halfT), new Vector3(r, r, halfT));
        this.version++;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const dz = rayLocal.direction.z;
        if (Math.abs(dz) < 1e-6) return null;

        const halfT = Math.max(this.thickness / 2, 0.001);
        const radius = Math.max(this.diameter / 2, 0.001);
        const radiusSq = radius * radius;
        let bestT = Infinity;
        let bestHit: HitRecord | null = null;

        for (const faceZ of [-halfT, halfT]) {
            const t = (faceZ - rayLocal.origin.z) / dz;
            if (t < 0.001 || t >= bestT) continue;
            const point = rayLocal.origin.clone().addScaledVector(rayLocal.direction, t);
            if (point.x * point.x + point.y * point.y > radiusSq) continue;

            bestT = t;
            bestHit = {
                t,
                point,
                normal: new Vector3(0, 0, faceZ > 0 ? 1 : -1),
                localPoint: point.clone(),
            };
        }

        return bestHit;
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        const dirInLocal = (hit.localDirection?.clone()
            ?? ray.direction.clone().transformDirection(this.worldToLocal))
            .normalize();
        const entryPoint = hit.localPoint!.clone();
        const entryFaceNormal = (hit.localNormal?.clone()
            ?? new Vector3(0, 0, entryPoint.z >= 0 ? 1 : -1))
            .normalize();
        const entryNormalAgainst = dirInLocal.dot(entryFaceNormal) > 0
            ? entryFaceNormal.clone().negate()
            : entryFaceNormal.clone();

        const nOutside = Math.max(this.exteriorRefractiveIndex, 1e-6);
        const nGlass = Math.max(this.refractiveIndex, 1e-6);
        const dirInsideLocal = OpticMesh.refract(dirInLocal, entryNormalAgainst, nOutside, nGlass);
        if (!dirInsideLocal) return { rays: [] };

        const halfT = Math.max(this.thickness / 2, 0.001);
        const exitFaceZ = entryPoint.z >= 0 ? -halfT : halfT;
        if (Math.abs(dirInsideLocal.z) < 1e-9) return { rays: [] };

        const tInside = (exitFaceZ - entryPoint.z) / dirInsideLocal.z;
        if (tInside <= 0) return { rays: [] };
        const exitPoint = entryPoint.clone().addScaledVector(dirInsideLocal, tInside);

        const radius = Math.max(this.diameter / 2, 0.001);
        if (exitPoint.x * exitPoint.x + exitPoint.y * exitPoint.y > radius * radius) {
            return { rays: [] };
        }

        const exitFaceNormal = new Vector3(0, 0, exitFaceZ > 0 ? 1 : -1);
        const exitNormalAgainst = dirInsideLocal.dot(exitFaceNormal) > 0
            ? exitFaceNormal.clone().negate()
            : exitFaceNormal.clone();
        const dirOutLocal = OpticMesh.refract(dirInsideLocal, exitNormalAgainst, nGlass, nOutside);
        if (!dirOutLocal) return { rays: [] };

        this.updateMatrices();
        const entryNormalWorld = entryNormalAgainst.clone().transformDirection(this.localToWorld).normalize();
        const exitNormalWorld = exitNormalAgainst.clone().transformDirection(this.localToWorld).normalize();
        const dirInsideWorld = dirInsideLocal.clone().transformDirection(this.localToWorld).normalize();
        const dirOutWorld = dirOutLocal.clone().transformDirection(this.localToWorld).normalize();
        const polarizationInside = refractJones(ray.polarization, ray.direction, entryNormalWorld, dirInsideWorld);
        const polarizationOut = refractJones(polarizationInside, dirInsideWorld, exitNormalWorld, dirOutWorld);
        const exitPointWorld = exitPoint.clone().applyMatrix4(this.localToWorld);
        const perSurfaceT = Math.max(0, Math.min(1, this.surfaceTransmission));
        const throughput = perSurfaceT * perSurfaceT;

        return {
            rays: [childRay(ray, {
                origin: exitPointWorld,
                direction: dirOutWorld,
                polarization: polarizationOut,
                intensity: ray.intensity * throughput,
                opticalPathLength: ray.opticalPathLength
                    + hit.t * (ray.currentMediumIndex ?? nOutside)
                    + tInside * nGlass
                    + this.opticalPathOffsetMm,
                entryPoint: hit.point.clone(),
            })],
            passthrough: true,
        };
    }

    getApertureRadius(): number {
        return this.diameter / 2;
    }
}
