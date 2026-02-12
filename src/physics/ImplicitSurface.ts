import { Vector3 } from 'three';
import { Ray } from './types';

/**
 * ImplicitSurface.ts
 * 
 * Implements a lightweight SDF (Signed Distance Function) engine for raymarching.
 * This allows defining optical components as mathematical volumes (CSG).
 * 
 * SDF Convention:
 *  - dist < 0 : Inside the object
 *  - dist > 0 : Outside the object
 *  - dist = 0 : On the surface
 */

export type SDF = (p: Vector3) => number;

// ============================================================================
// PRIMITIVES
// ============================================================================

export const sdSphere = (p: Vector3, center: Vector3, radius: number): number => {
    return p.distanceTo(center) - radius;
};

export const sdCylinder = (p: Vector3, center: Vector3, radius: number, height: number, axis: 'x'|'y'|'z' = 'z'): number => {
    const rel = p.clone().sub(center);
    let rDist = 0;
    if (axis === 'z') rDist = Math.sqrt(rel.x*rel.x + rel.y*rel.y);
    else if (axis === 'y') rDist = Math.sqrt(rel.x*rel.x + rel.z*rel.z);
    else rDist = Math.sqrt(rel.y*rel.y + rel.z*rel.z);

    // Infinite cylinder SDF
    const dCyl = rDist - radius;

    // Capped cylinder Logic (Intersection of Cylinder and 2 Planes)
    // Actually, CSG intersection is easier to manage at the component level.
    // But for a primitive "Capped Cylinder", we can use max.
    // height is full height (thickness).
    let dPlane = 0;
    if (axis === 'z') dPlane = Math.abs(rel.z) - height / 2;
    else if (axis === 'y') dPlane = Math.abs(rel.y) - height / 2;
    else dPlane = Math.abs(rel.x) - height / 2;

    return Math.max(dCyl, dPlane);
};

export const sdPlane = (p: Vector3, normal: Vector3, offset: number): number => {
    // Plane defined by dot(p,n) + offset = 0
    return p.dot(normal) + offset;
};

// ============================================================================
// OPERATIONS
// ============================================================================

export const opUnion = (d1: number, d2: number): number => Math.min(d1, d2);

export const opSubtract = (d1: number, d2: number): number => Math.max(d1, -d2);

export const opIntersect = (d1: number, d2: number): number => Math.max(d1, d2);

// ============================================================================
// ENGINE
// ============================================================================

const MAX_STEPS = 100;
const EPSILON = 1e-4; // 0.1 micron precision
const MAX_DIST = 1000.0;

/**
 * Raymarches the SDF to find the intersection.
 * @param ray Ray in local space
 * @param sdf The distance function
 * @returns t value of intersection, or Infinity if miss
 */
export const raymarch = (ray: Ray, sdf: SDF): number => {
    let t = 1e-3; // Small offset to prevent self-intersection at ray origin
    for (let i = 0; i < MAX_STEPS; i++) {
        const p = ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
        const d = sdf(p);
        
        if (d < EPSILON) {
            return t;
        }
        
        t += d;
        if (t > MAX_DIST) break;
    }
    return Infinity;
};

/**
 * Computes the normal vector at point p using finite differences.
 * Normal points OUT of the SDF (towards positive distance).
 */
export const calcNormal = (p: Vector3, sdf: SDF): Vector3 => {
    const e = 1e-4;
    const dx = sdf(new Vector3(p.x + e, p.y, p.z)) - sdf(new Vector3(p.x - e, p.y, p.z));
    const dy = sdf(new Vector3(p.x, p.y + e, p.z)) - sdf(new Vector3(p.x, p.y - e, p.z));
    const dz = sdf(new Vector3(p.x, p.y, p.z + e)) - sdf(new Vector3(p.x, p.y, p.z - e));
    return new Vector3(dx, dy, dz).normalize();
};

/**
 * Helper to get bounds for raymarching optimization?
 * For now, straight raymarching is fast enough for <100 rays.
 */
