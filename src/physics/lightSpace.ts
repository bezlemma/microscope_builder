/**
 * Light Space Coordinates (u, v, w) per PhysicsPlan.md
 * 
 * W-axis: Optical axis (direction light travels through component)
 * UV-plane: Transverse plane (cross-section of component)
 * 
 * This module provides type-safe access to Light Space coordinates
 * using THREE.js Vector3 internally.
 */

import { Vector3 } from 'three';

/**
 * Accessors for Light Space coordinates on a Vector3.
 * 
 * In Light Space:
 * - u = Vector3.x (transverse 1)
 * - v = Vector3.y (transverse 2) 
 * - w = Vector3.z (optical axis)
 */
export function getU(v: Vector3): number { return v.x; }
export function getV(v: Vector3): number { return v.y; }
export function getW(v: Vector3): number { return v.z; }

export function setU(v: Vector3, u: number): void { v.x = u; }
export function setV(v: Vector3, val: number): void { v.y = val; }
export function setW(v: Vector3, w: number): void { v.z = w; }

/**
 * Create a Light Space vector from uvw coordinates.
 */
export function uvw(u: number, v: number, w: number): Vector3 {
    return new Vector3(u, v, w);
}

/**
 * Get transverse distance (radial distance in UV plane)
 */
export function transverseRadius(v: Vector3): number {
    return Math.sqrt(v.x * v.x + v.y * v.y);
}
