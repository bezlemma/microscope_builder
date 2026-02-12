import { Vector3, Box3 } from 'three';

/**
 * Calculates the reflection vector using R = I - 2(N.I)N
 */
export function reflectVector(incident: Vector3, normal: Vector3): Vector3 {
    return incident.clone().sub(
        normal.clone().multiplyScalar(2 * incident.dot(normal))
    ).normalize();
}

/**
 * Clamp near-zero floating-point artifacts to exactly zero.
 * e.g. cos(π/2) ≈ 6.12e-17 → 0, preventing phantom components
 * from corrupting refraction directions and raycaster hits.
 */
export function cleanVec(v: Vector3, eps: number = 1e-12): Vector3 {
    if (Math.abs(v.x) < eps) v.x = 0;
    if (Math.abs(v.y) < eps) v.y = 0;
    if (Math.abs(v.z) < eps) v.z = 0;
    return v;
}

/**
 * Slab method for AABB Intersection (Broadphase)
 * Returns entry and exit distances (tmin, tmax).
 * If tmin > tmax or tmax < 0, no intersection.
 */
export function intersectAABB(origin: Vector3, direction: Vector3, box: Box3): { hit: boolean, tMin: number, tMax: number } {
    const invDirX = 1.0 / direction.x;
    const invDirY = 1.0 / direction.y;
    const invDirZ = 1.0 / direction.z;

    let tmin = (box.min.x - origin.x) * invDirX;
    let tmax = (box.max.x - origin.x) * invDirX;

    if (tmin > tmax) [tmin, tmax] = [tmax, tmin];

    let tymin = (box.min.y - origin.y) * invDirY;
    let tymax = (box.max.y - origin.y) * invDirY;

    if (tymin > tymax) [tymin, tymax] = [tymax, tymin];

    if ((tmin > tymax) || (tymin > tmax))
        return { hit: false, tMin: 0, tMax: 0 };

    if (tymin > tmin) tmin = tymin;
    if (tymax < tmax) tmax = tymax;

    let tzmin = (box.min.z - origin.z) * invDirZ;
    let tzmax = (box.max.z - origin.z) * invDirZ;

    if (tzmin > tzmax) [tzmin, tzmax] = [tzmax, tzmin];

    if ((tmin > tzmax) || (tzmin > tmax))
        return { hit: false, tMin: 0, tMax: 0 };

    if (tzmin > tmin) tmin = tzmin;
    if (tzmax < tmax) tmax = tzmax;

    return { hit: tmax > 0, tMin: tmin, tMax: tmax };
}


/**
 * Solves Quadratic Equation At^2 + Bt + C = 0
 * Returns sorted real roots.
 */
export function solveQuadratic(A: number, B: number, C: number): number[] {
    const disc = B * B - 4 * A * C;
    if (disc < 0) return [];
    
    if (disc === 0) return [-B / (2 * A)];
    
    const sqrtDisc = Math.sqrt(disc);
    const t0 = (-B - sqrtDisc) / (2 * A);
    const t1 = (-B + sqrtDisc) / (2 * A);
    
    return [Math.min(t0, t1), Math.max(t0, t1)];
}
