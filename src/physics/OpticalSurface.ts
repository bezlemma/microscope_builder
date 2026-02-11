import { Vector3 } from 'three';
import { Ray, HitRecord } from './types';

/**
 * Base class for any optical surface (lens face, mirror, prism face, etc.).
 * Each surface is responsible for its own intersection logic including bounds checks.
 */
export abstract class OpticalSurface {
    public id: string;

    constructor(id: string) {
        this.id = id;
    }

    /**
     * Intersects the ray with this surface.
     * @param rayLocal Ray in the component's local space.
     * @returns HitRecord with surface metadata if hit, null otherwise.
     */
    abstract intersect(rayLocal: Ray): HitRecord | null;
}

/**
 * A spherical cap surface, used for lens faces.
 * Defined by a sphere center, radius, aperture radius (for circular clipping),
 * and a hemisphere direction (+1 or -1 along Z) to select the correct cap.
 */
export class SphericalCap extends OpticalSurface {
    center: Vector3;
    radius: number;
    radiusSq: number;
    apertureRadiusSq: number;
    hemisphereDir: number; // +1 for Z > center.z, -1 for Z < center.z

    constructor(id: string, center: Vector3, radius: number, apertureRadius: number, hemisphereDir: number) {
        super(id);
        this.center = center;
        this.radius = radius;
        this.radiusSq = radius * radius;
        this.apertureRadiusSq = apertureRadius * apertureRadius;
        this.hemisphereDir = hemisphereDir;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // 1. Ray-Sphere Intersection (Geometric)
        const oc = this.center.clone().sub(rayLocal.origin);
        const tProj = oc.dot(rayLocal.direction);
        const perpDistSq = oc.dot(oc) - tProj * tProj;

        if (perpDistSq > this.radiusSq) return null; // Misses sphere

        const halfChord = Math.sqrt(this.radiusSq - perpDistSq);
        
        // Check both roots: tProj - halfChord (near), tProj + halfChord (far)
        // We iterate both because the valid cap might be on the far side 
        // (though usually we hit the near side first, but geometry is geometry).
        
        let bestT = Infinity;
        let bestHit: Vector3 | null = null;
        let bestNormal: Vector3 | null = null;

        for (const t of [tProj - halfChord, tProj + halfChord]) {
            if (t < 1e-6) continue; // Behind ray or self-intersection
            if (t >= bestT) continue; // Already have a closer hit

            const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
            
            // 2. Aperture Clip (Cylindrical Limit)
            // Check radial distance from optic axis (assumed 0,0 locally)
            // Note: If the lens is centered at 0,0 locally.
            // If the cap is part of a lens, the aperture check is usually relative to the lens axis (0,0).
            const r2 = hitPoint.x * hitPoint.x + hitPoint.y * hitPoint.y;
            if (r2 > this.apertureRadiusSq) continue;

            // 3. Hemisphere Check
            // Ensure the hit is on the correct side of the sphere center.
            // (e.g. Front convex face: Center is at -Z, Cap is at +Z relative to center)
            const dz = hitPoint.z - this.center.z;
            if (dz * this.hemisphereDir <= 0) continue; 

            // Valid hit!
            bestT = t;
            bestHit = hitPoint;
            
            // Normal is outward from center
            bestNormal = hitPoint.clone().sub(this.center).normalize();
            // Or maybe inward? For a glass lens, normals usually point out of the glass.
            // But here we are just geometry. Let's return the geometric normal.
            // Caller (SphericalLens) might need to flip it if hitting from inside.
            // But wait, OpticalSurface usually implies an interface.
            // Let's standardise: Normal points OUT of the sphere center.
        }

        if (bestHit && bestNormal) {
             return {
                t: bestT,
                point: bestHit, // Local point for now, caller converts to world?
                // Wait, HitRecord expects World Point/Normal usually.
                // But intersect() is called with rayLocal.
                // Let's return local data, and caller transforms.
                // But types.ts says HitRecord has point/normal/localPoint.
                // We should return a partial or define behavior.
                // Let's return local points in this recursive structure and let Component wrapper handle transforms.
                // Actually, let's keep HitRecord structure but put local points in it.
                // The caller (SphericalLens.intersect) will transform to world.
                normal: bestNormal,
                localPoint: bestHit
            } as HitRecord;
        }

        return null;
    }
}

/**
 * A planar face, used for flat lens sides or prisms.
 * Defined by a point on the plane, a normal, and a radial aperture limit.
 */
export class PlanarFace extends OpticalSurface {
    origin: Vector3;
    normal: Vector3;
    apertureRadiusSq: number;

    constructor(id: string, origin: Vector3, normal: Vector3, apertureRadius: number) {
        super(id);
        this.origin = origin;
        this.normal = normal.normalize();
        this.apertureRadiusSq = apertureRadius * apertureRadius;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const denom = this.normal.dot(rayLocal.direction);
        if (Math.abs(denom) < 1e-10) return null; // Parallel

        const t = this.normal.dot(this.origin.clone().sub(rayLocal.origin)) / denom;
        if (t < 1e-6) return null; // Behind or self

        const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
        
        // Aperture Check (Circular)
        // Assumes aperture is centered at 0,0 locally!
        // If the plane is shifted, we might need 2D check.
        // For standard lenses, flat face is centered at 0,0.
        const r2 = hitPoint.x * hitPoint.x + hitPoint.y * hitPoint.y;
        if (r2 > this.apertureRadiusSq) return null;

        return {
            t: t,
            point: hitPoint, // Local
            normal: this.normal.clone(), // Local normal
            localPoint: hitPoint
        } as HitRecord;
    }
}

/**
 * A cylindrical face, used for the outer rim of a lens.
 * Defined by radius and min/max Z extent.
 */
export class CylindricalFace extends OpticalSurface {
    radius: number;
    radiusSq: number;
    zMin: number;
    zMax: number;

    constructor(id: string, radius: number, zMin: number, zMax: number) {
        super(id);
        this.radius = radius;
        this.radiusSq = radius * radius;
        this.zMin = zMin;
        this.zMax = zMax;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Ray-Cylinder Intersection (Infinite cylinder along Z)
        // x^2 + y^2 = r^2
        // Ray: O + tD
        // (Ox + tDx)^2 + (Oy + tDy)^2 = r^2
        // t^2(Dx^2 + Dy^2) + 2t(OxDx + OyDy) + (Ox^2 + Oy^2 - r^2) = 0
        
        const dx = rayLocal.direction.x;
        const dy = rayLocal.direction.y;
        const ox = rayLocal.origin.x;
        const oy = rayLocal.origin.y;

        const A = dx * dx + dy * dy;
        const B = 2 * (ox * dx + oy * dy);
        const C = ox * ox + oy * oy - this.radiusSq;

        if (Math.abs(A) < 1e-10) return null; // Ray parallel to Z axis (and usually missed)

        const disc = B * B - 4 * A * C;
        if (disc < 0) return null;

        const sqrtDisc = Math.sqrt(disc);
        const t1 = (-B - sqrtDisc) / (2 * A);
        const t2 = (-B + sqrtDisc) / (2 * A);

        let bestT = Infinity;
        let bestHit: Vector3 | null = null;
        let bestNormal: Vector3 | null = null;

        for (const t of [t1, t2]) {
            if (t < 1e-6) continue;
            if (t >= bestT) continue;

            const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
            
            // Z-Extent Check
            if (hitPoint.z < this.zMin || hitPoint.z > this.zMax) continue;

            bestT = t;
            bestHit = hitPoint;
            bestNormal = new Vector3(hitPoint.x, hitPoint.y, 0).normalize();
        }

        if (bestHit && bestNormal) {
            return {
                t: bestT,
                point: bestHit,
                normal: bestNormal,
                localPoint: bestHit
            } as HitRecord;
        }

        return null;
    }
}
