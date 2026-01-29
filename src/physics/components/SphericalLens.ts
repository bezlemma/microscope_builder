import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';

export class SphericalLens extends OpticalComponent {
    curvature: number; // For UI compatibility, maps to 1/f
    apertureRadius: number;
    thickness: number;
    ior: number = 1.5; // Index of refraction (BK7 default)

    constructor(curvature: number, aperture: number, thickness: number, name: string = "Lens") {
        super(name);
        this.curvature = curvature;
        this.apertureRadius = aperture;
        this.thickness = thickness;
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
        
        // We want the intersection point closest to the ray origin but positive
        // For a lens, we might be inside or outside. 
        if (t1 > 0.001) return t1;
        if (t2 > 0.001) return t2;
        return null;
    }

    // Refraction helper (Snell's Law in vector form)
    private refract(incident: Vector3, normal: Vector3, n1: number, n2: number): Vector3 | null {
        const r = n1 / n2;
        const cosI = -normal.dot(incident);
        const sinT2 = r * r * (1 - cosI * cosI);
        if (sinT2 > 1) return null; // Total Internal Reflection
        const cosT = Math.sqrt(1 - sinT2);
        return incident.clone().multiplyScalar(r).add(normal.clone().multiplyScalar(r * cosI - cosT)).normalize();
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Thick Lens: Two spherical surfaces
        // Assume symmetric lens for now based on focal length (curvature)
        // Lensmaker's Eq: 1/f = (n-1)(1/R1 - 1/R2) -> for symmetric R1=-R2=R: 1/f = (n-1)(2/R)
        // R = 2(n-1)f = 2(n-1)/curvature
        const power = this.curvature;
        if (Math.abs(power) < 1e-6) {
            // Flat glass sheet intersection at z = -thickness/2
            if (Math.abs(rayLocal.direction.z) < 1e-10) return null;
            const t = (-this.thickness/2 - rayLocal.origin.z) / rayLocal.direction.z;
            if (t < 0.001) return null;
            const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
            if (Math.abs(hitPoint.x) > this.apertureRadius || Math.abs(hitPoint.y) > this.apertureRadius) return null;
            return { t, point: hitPoint, normal: new Vector3(0,0,-1), localPoint: hitPoint };
        }

        const R = (2 * (this.ior - 1)) / power;
        const absR = Math.abs(R);
        
        // Sphere centers:
        // Front surface center is at z = R (if R is positive, surface peaks at 0 and curves away)
        // Actually, let's peak the lens surfaces at z = -thickness/2 and +thickness/2
        // Front peak at -t/2, curves towards +z (converging) or -z (diverging)
        // Center of front sphere: [0, 0, -this.thickness/2 + R]
        const center1 = new Vector3(0, 0, -this.thickness/2 + R);
        
        // Calculate the sag (height of the spherical cap at the aperture edge)
        // sag = R - sqrt(R² - aperture²) for the cap region
        const sagSquared = absR * absR - this.apertureRadius * this.apertureRadius;
        const sag = sagSquared > 0 ? absR - Math.sqrt(sagSquared) : absR;
        
        // Front surface z-range: from apex at -thickness/2 to apex + sag
        const frontApex = -this.thickness / 2;
        const frontMaxZ = frontApex + sag;
        
        const t = this.intersectSphere(rayLocal.origin, rayLocal.direction, center1, absR);

        if (t !== null) {
            const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
            
            // Check aperture (transverse bounds)
            const inAperture = hitPoint.x * hitPoint.x + hitPoint.y * hitPoint.y <= this.apertureRadius * this.apertureRadius;
            
            // Check z-range (only accept hits on the actual lens cap, not the rest of the sphere)
            const inZRange = hitPoint.z >= frontApex - 0.1 && hitPoint.z <= frontMaxZ + 0.1;
            
            if (inAperture && inZRange) {
                const normal = hitPoint.clone().sub(center1).normalize();
                
                // Normal must point towards the incoming ray for Snell's Law
                // If the dot product is positive, normal is facing same direction as ray - flip it
                if (normal.dot(rayLocal.direction) > 0) normal.multiplyScalar(-1);

                return { t, point: hitPoint, normal, localPoint: hitPoint };
            }
        }
        return null;
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Thick Lens Refraction Pipeline
        const nAir = 1.0;
        const nGlass = this.ior;
        
        // 1. Refract at front surface
        // Transform ray direction to local space
        const dirIn = ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        
        // Transform normal from world space to local space (hit.normal is in world space from chkIntersection)
        const normal1 = hit.normal.clone().transformDirection(this.worldToLocal).normalize();
        
        const dirInside = this.refract(dirIn, normal1, nAir, nGlass);
        if (!dirInside) return { rays: [] }; // TIR
        
        // 2. Propagate to back surface
        const power = this.curvature;
        const R = (2 * (this.ior - 1)) / power;
        const absR = Math.abs(R);
        const center2 = new Vector3(0, 0, this.thickness/2 - R); // Back surface center
        
        const t2 = this.intersectSphere(hit.localPoint!, dirInside, center2, absR);
        
        if (t2 === null) return { rays: [] }; // Missed back surface (edge case)
        
        const hit2 = hit.localPoint!.clone().add(dirInside.clone().multiplyScalar(t2));
        const normal2 = hit2.clone().sub(center2).normalize();
        // Normal must point towards the incoming ray (dirInside) for Snell's Law
        if (normal2.dot(dirInside) > 0) normal2.multiplyScalar(-1);

        // 3. Refract at back surface
        const dirOutLocal = this.refract(dirInside, normal2, nGlass, nAir);
        if (!dirOutLocal) return { rays: [] }; // TIR
        
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
