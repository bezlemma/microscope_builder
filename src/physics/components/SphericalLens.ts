import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { getW, uvw, transverseRadius } from '../lightSpace';

/**
 * SphericalLens - A biconvex or biconcave symmetric lens.
 * 
 * Light Space Coordinates (u, v, w) per PhysicsPlan.md:
 * - W-axis: Optical axis (direction light travels through lens)
 * - UV-plane: Transverse plane (the lens aperture cross-section)
 * - Surface equation: w = sag(u, v) where sag = R - sqrt(R² - u² - v²)
 * 
 * Note: THREE.js Vector3 uses .x/.y/.z properties, which map to (u, v, w).
 */
export class SphericalLens extends OpticalComponent {
    curvature: number; // Optical power (legacy/symmetric)
    apertureRadius: number; 
    thickness: number; 
    ior: number = 1.5;
    
    // Asymmetric Radii (Optional)
    // Positive R = Center to Right (+Z). 
    // Negative R = Center to Left (-Z).
    // Front Surface: Convex (bulge Left) means Center Right (R > 0). Concave (bulge Right) means Center Left (R < 0).
    // Back Surface: Convex (bulge Right) means Center Left (R < 0). Concave (bulge Left) means Center Right (R > 0).
    r1?: number;
    r2?: number;

    constructor(curvature: number, aperture: number, thickness: number, name: string = "Lens", r1?: number, r2?: number, ior: number = 1.5) {
        super(name);
        this.curvature = curvature;
        this.apertureRadius = aperture;
        this.thickness = thickness;
        this.r1 = r1;
        this.r2 = r2;
        this.ior = ior;
    }

    // Helper for sphere intersection
    private intersectSphere(rayOrigin: Vector3, rayDir: Vector3, center: Vector3, radius: number): number | null {
        const oc = rayOrigin.clone().sub(center);
        const b = oc.dot(rayDir);
        const c = oc.dot(oc) - radius * radius;
        const h = b * b - c;
        if (h < 0) return null; // No intersection
        const sqrtH = Math.sqrt(h);
        const t1 = -b - sqrtH;
        const t2 = -b + sqrtH;
        
        // Return smallest positive t
        if (t1 > 0.001) return t1;
        if (t2 > 0.001) return t2;
        return null;
    }

    private refract(incident: Vector3, normal: Vector3, n1: number, n2: number): Vector3 | null {
        const r = n1 / n2;
        const cosI = -normal.dot(incident);
        const sinT2 = r * r * (1 - cosI * cosI);
        if (sinT2 > 1) return null; 
        const cosT = Math.sqrt(1 - sinT2);
        return incident.clone().multiplyScalar(r).add(normal.clone().multiplyScalar(r * cosI - cosT)).normalize();
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Determine Radii
        let R1, R2;
        if (this.r1 !== undefined && this.r2 !== undefined) {
            R1 = this.r1;
            R2 = this.r2;
        } else {
            // Legacy Symmetric Mode
            if (Math.abs(this.curvature) < 1e-6) return this.intersectFlat(rayLocal);
            const R = (2 * (this.ior - 1)) / this.curvature;
            R1 = R;  // Front Convex (if pos curvature)
            R2 = -R; // Back Convex (if pos curvature)
        }

        // --- Front Surface Intersection ---
        // Surface at -t/2. Center at -t/2 + R1.
        const center1 = uvw(0, 0, -this.thickness/2 + R1);
        const absR1 = Math.abs(R1);
        
        // Check intersection with Front Sphere
        const t = this.intersectSphere(rayLocal.origin, rayLocal.direction, center1, absR1);

        if (t !== null) {
            const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
            
            // Aperture Check (XY distance from optical axis)
            if (transverseRadius(hitPoint) <= this.apertureRadius) {
                // W-Bounds Check: Ensure hit is on the PHYSICAL lens surface, not the extended sphere.
                // Front surface is near W = -thickness/2. Back surface is near W = +thickness/2.
                // Sag of a spherical surface can extend the W-range slightly, but it should be within thickness.
                const hitW = getW(hitPoint);
                const frontBound = -this.thickness / 2 - Math.abs(R1) * 0.1; // Allow some sag tolerance
                const backBound = this.thickness / 2 + Math.abs(R1) * 0.1;
                
                // Reject hits that are outside the lens body (on the invisible extended sphere)
                if (hitW < frontBound || hitW > backBound) {
                    return null; // Hit is on the invisible part of the sphere
                }
                
                const normal = hitPoint.clone().sub(center1).normalize();
                if (normal.dot(rayLocal.direction) > 0) normal.multiplyScalar(-1); 
                
                return { t, point: hitPoint, normal, localPoint: hitPoint };
            }
        }
        return null;
    }

    private intersectFlat(rayLocal: Ray): HitRecord | null {
        if (Math.abs(rayLocal.direction.z) < 1e-10) return null;
        const t = (-this.thickness/2 - rayLocal.origin.z) / rayLocal.direction.z;
        if (t < 0.001) return null;
        const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
        if (Math.abs(hitPoint.x) > this.apertureRadius || Math.abs(hitPoint.y) > this.apertureRadius) return null;
        return { t, point: hitPoint, normal: new Vector3(0,0,-1), localPoint: hitPoint };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        const nAir = 1.0;
        const nGlass = this.ior;
        
        // Determine Radii
        let R1, R2;
        if (this.r1 !== undefined && this.r2 !== undefined) {
            R1 = this.r1;
            R2 = this.r2;
        } else {
            const R = (2 * (this.ior - 1)) / this.curvature;
            R1 = R;
            R2 = -R;
        }

        // 1. Refract at Front
        const dirIn = ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        const normal1 = hit.normal.clone().transformDirection(this.worldToLocal).normalize();
        
        const dirInside = this.refract(dirIn, normal1, nAir, nGlass);
        if (!dirInside) return { rays: [] }; 

        // 2. Propagate to Back Surface
        // Surface at t/2. Center at t/2 + R2.
        const center2 = uvw(0, 0, this.thickness/2 + R2);
        const absR2 = Math.abs(R2);

        // Intersect Back Sphere (Internal)
        // Ray starts at hit.localPoint. inside lens.
        const t2 = this.intersectSphere(hit.localPoint!, dirInside, center2, absR2);
        
        if (t2 === null) return { rays: [] }; 

        const hit2 = hit.localPoint!.clone().add(dirInside.clone().multiplyScalar(t2));
        const normal2 = hit2.clone().sub(center2).normalize();
        if (normal2.dot(dirInside) > 0) normal2.multiplyScalar(-1); // Internal normal check

        // 3. Refract at Back
        const dirOutLocal = this.refract(dirInside, normal2, nGlass, nAir);
        if (!dirOutLocal) return { rays: [] }; 

        const dirOutWorld = dirOutLocal.transformDirection(this.localToWorld).normalize();
        const hitWorldBack = hit2.applyMatrix4(this.localToWorld);

        return {
            rays: [{
                ...ray,
                origin: hitWorldBack,
                direction: dirOutWorld,
                opticalPathLength: ray.opticalPathLength + (t2 * nGlass)
            }]
        };
    }
}
