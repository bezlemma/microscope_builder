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
 * Generalized Snell refraction for a zero-thickness phase surface.
 *
 * `phaseGradient` is the tangent-space gradient of the imposed optical-path
 * discontinuity ΔOPL, expressed in world or local coordinates matching the
 * incident ray and normal. For a thin lens phase sheet, for example:
 *   ΔOPL(x, y) = -(x^2 + y^2) / (2f)
 *   ∇ΔOPL      = (-x / f, -y / f, 0)
 *
 * The helper applies the tangential momentum jump and reconstructs the
 * outgoing unit direction from the remaining normal component.
 */
export function refractPhaseSurface(
    incident: Vector3,
    normal: Vector3,
    phaseGradient: Vector3,
    nIn: number = 1,
    nOut: number = 1
): Vector3 | null {
    const facingNormal = normal.clone().normalize();
    if (incident.dot(facingNormal) > 0) facingNormal.negate();

    const tangentGradient = phaseGradient.clone()
        .sub(facingNormal.clone().multiplyScalar(phaseGradient.dot(facingNormal)));

    const tangentialIn = incident.clone()
        .sub(facingNormal.clone().multiplyScalar(incident.dot(facingNormal)));

    const tangentialOut = tangentialIn.clone()
        .multiplyScalar(nIn / nOut)
        .add(tangentGradient.clone().multiplyScalar(1 / nOut));

    const normalSq = 1 - tangentialOut.lengthSq();
    if (normalSq < 0) return null;

    return tangentialOut
        .sub(facingNormal.multiplyScalar(Math.sqrt(normalSq)))
        .normalize();
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
 * Slab method for AABB Intersection (Broadphase).
 * Returns entry and exit distances (tmin, tmax).
 * If tmin > tmax or tmax < 0, no intersection.
 *
 * Robust against zero / near-zero direction components: for a slab where the
 * ray is parallel, we return a miss iff the origin is outside that slab.
 */
export function intersectAABB(origin: Vector3, direction: Vector3, box: Box3): { hit: boolean, tMin: number, tMax: number } {
    const EPS = 1e-20;

    const slab = (o: number, d: number, lo: number, hi: number): { min: number; max: number } | null => {
        if (Math.abs(d) < EPS) {
            // Ray is parallel to this slab: miss unless origin is between the planes.
            if (o < lo || o > hi) return null;
            return { min: -Infinity, max: Infinity };
        }
        const inv = 1 / d;
        let t1 = (lo - o) * inv;
        let t2 = (hi - o) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        return { min: t1, max: t2 };
    };

    const sx = slab(origin.x, direction.x, box.min.x, box.max.x);
    if (!sx) return { hit: false, tMin: 0, tMax: 0 };
    const sy = slab(origin.y, direction.y, box.min.y, box.max.y);
    if (!sy) return { hit: false, tMin: 0, tMax: 0 };
    const sz = slab(origin.z, direction.z, box.min.z, box.max.z);
    if (!sz) return { hit: false, tMin: 0, tMax: 0 };

    const tmin = Math.max(sx.min, sy.min, sz.min);
    const tmax = Math.min(sx.max, sy.max, sz.max);

    if (tmin > tmax) return { hit: false, tMin: 0, tMax: 0 };
    return { hit: tmax > 0, tMin: tmin, tMax: tmax };
}


/**
 * Numerical approximation of the Error Function (erf)
 * Maximum error 1.5e-7 (Abramowitz and Stegun 7.1.26)
 */
export function erf(x: number): number {
    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);
    
    const p = 0.3275911;
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    
    return sign * y;
}
