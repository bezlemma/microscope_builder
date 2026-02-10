import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { uvw, transverseRadius } from '../lightSpace';

/**
 * SphericalLens - A robust implementation of a thick spherical lens.
 * 
 * Defined by:
 * - Two spherical surfaces (radii R1, R2).
 * - A central thickness (distance between vertices along optical axis).
 * - A circular aperture (cylindrical bound).
 * 
 * Geometry:
 * - Local Origin (0,0,0) is the center of the lens (midpoint of thickness).
 * - Front vertex at z = -thickness/2.
 * - Back vertex at z = +thickness/2.
 * - Optical Axis is +Z (Local W).
 */
export class SphericalLens extends OpticalComponent {
    curvature: number; // Optical power (legacy/symmetric)
    apertureRadius: number; 
    thickness: number; 
    ior: number = 1.5;
    
    r1?: number; // Radius of curvature front (default derived from curvature)
    r2?: number; // Radius of curvature back (default -r1 for symmetric)

    constructor(curvature: number, aperture: number, thickness: number, name: string = "Lens", r1?: number, r2?: number, ior: number = 1.5) {
        super(name);
        this.curvature = curvature;
        this.apertureRadius = aperture;
        this.thickness = thickness;
        this.r1 = r1;
        this.r2 = r2;
        this.ior = ior;
    }

    /**
     * Common lens type presets. Sets R1/R2 to produce the given focal length
     * with the current ior and thickness.
     */
    static readonly LENS_TYPES = [
        'biconvex',       // R1 > 0, R2 < 0 (symmetric)
        'plano-convex',   // R1 = Infinity, R2 < 0
        'convex-plano',   // R1 > 0, R2 = Infinity 
        'meniscus-pos',   // R1 > 0, R2 > 0 (positive meniscus)
        'plano-concave',  // R1 = Infinity, R2 > 0
        'concave-plano',  // R1 < 0, R2 = Infinity
        'biconcave',      // R1 < 0, R2 > 0 (symmetric)
        'meniscus-neg',   // R1 < 0, R2 < 0 (negative meniscus)
    ] as const;

    setFromLensType(type: string): void {
        const f = Math.abs(this.curvature) > 1e-9 ? 1 / this.curvature : 100;
        const n = this.ior;
        
        // Use lensmaker's equation: 1/f = (n-1)[1/R1 - 1/R2 + (n-1)*t/(n*R1*R2)]
        // Simplified (thin lens approx for preset purposes): 1/f ≈ (n-1)(1/R1 - 1/R2)
        const phi = 1 / f; // optical power
        
        switch (type) {
            case 'biconvex': {
                // Symmetric: R1 = R, R2 = -R
                const R = 2 * (n - 1) / phi;
                this.r1 = R;
                this.r2 = -R;
                break;
            }
            case 'plano-convex': {
                // R1 flat, all power in R2
                const R2 = -(n - 1) / phi;
                this.r1 = 1e9; // flat
                this.r2 = R2;
                break;
            }
            case 'convex-plano': {
                // R2 flat, all power in R1  
                const R1 = (n - 1) / phi;
                this.r1 = R1;
                this.r2 = -1e9; // flat
                break;
            }
            case 'meniscus-pos': {
                // Both surfaces curve same way, net positive
                const R = 2 * (n - 1) / phi;
                this.r1 = R * 0.6;
                this.r2 = R * 1.5;
                break;
            }
            case 'plano-concave': {
                this.r1 = 1e9;
                this.r2 = (n - 1) / phi; // positive R2 = concave back
                break;
            }
            case 'concave-plano': {
                this.r1 = -(n - 1) / phi; // negative R1 = concave front
                this.r2 = -1e9;
                break;
            }
            case 'biconcave': {
                const R = 2 * (n - 1) / phi; // negative for diverging
                this.r1 = R;
                this.r2 = -R;
                break;
            }
            case 'meniscus-neg': {
                const R = 2 * (n - 1) / phi;
                this.r1 = R * 1.5; // negative
                this.r2 = R * 0.6; // negative
                break;
            }
        }
    }

    /** Get the lens type name that best matches current R1/R2 */
    getLensType(): string {
        const { R1, R2 } = this.getRadii();
        const isFlat = (r: number) => Math.abs(r) > 1e6;
        
        if (isFlat(R1) && R2 < 0) return 'plano-convex';
        if (R1 > 0 && isFlat(R2)) return 'convex-plano';
        if (isFlat(R1) && R2 > 0) return 'plano-concave';
        if (R1 < 0 && isFlat(R2)) return 'concave-plano';
        if (R1 > 0 && R2 < 0) return 'biconvex';
        if (R1 < 0 && R2 > 0) return 'biconcave';
        if (R1 > 0 && R2 > 0) return 'meniscus-pos';
        if (R1 < 0 && R2 < 0) return 'meniscus-neg';
        return 'biconvex';
    }

    /** Sag of front surface at full aperture */
    get sagFront(): number {
        const { R1 } = this.getRadii();
        if (Math.abs(R1) > 1e6) return 0;
        return Math.abs(R1) - Math.sqrt(Math.max(0, R1*R1 - this.apertureRadius*this.apertureRadius));
    }

    /** Sag of back surface at full aperture */
    get sagBack(): number {
        const { R2 } = this.getRadii();
        if (Math.abs(R2) > 1e6) return 0;
        return Math.abs(R2) - Math.sqrt(Math.max(0, R2*R2 - this.apertureRadius*this.apertureRadius));
    }

    /**
     * The effective aperture radius where the lens physically has glass.
     * For strongly curved lenses (e.g. biconvex with short focal length),
     * the front and back sphere surfaces may cross BEFORE reaching the
     * nominal apertureRadius. Beyond that crossing radius, there's no glass.
     * This method returns min(apertureRadius, crossingRadius).
     */
    get effectiveApertureRadius(): number {
        const { R1, R2 } = this.getRadii();
        const frontApex = -this.thickness / 2;
        const backApex = this.thickness / 2;
        
        // Compute the Z (optical axis) position of each surface at a given radial distance
        const frontZ = (r: number): number => {
            if (Math.abs(R1) > 1e6) return frontApex;
            const val = R1 * R1 - r * r;
            if (val < 0) return frontApex;
            const sign = R1 > 0 ? 1 : -1;
            return (frontApex + R1) - sign * Math.sqrt(val);
        };
        const backZ = (r: number): number => {
            if (Math.abs(R2) > 1e6) return backApex;
            const val = R2 * R2 - r * r;
            if (val < 0) return backApex;
            const sign = R2 > 0 ? 1 : -1;
            return (backApex + R2) - sign * Math.sqrt(val);
        };
        
        // Check if surfaces cross at full aperture
        if (frontZ(this.apertureRadius) < backZ(this.apertureRadius)) {
            return this.apertureRadius; // No crossing, full aperture is valid
        }
        
        // Binary search for the crossing radius
        let lo = 0, hi = this.apertureRadius;
        for (let i = 0; i < 30; i++) {
            const mid = (lo + hi) / 2;
            if (frontZ(mid) < backZ(mid)) {
                lo = mid; // Still has glass at this radius
            } else {
                hi = mid; // Surfaces have crossed
            }
        }
        return lo;
    }


    /**
     * Intersect a ray with a sphere.
     * Returns the smallest positive t > epsilon, or null.
     */
    private intersectSphere(rayOrigin: Vector3, rayDir: Vector3, center: Vector3, radius: number): number | null {
        const oc = rayOrigin.clone().sub(center);
        const b = oc.dot(rayDir);
        const c = oc.dot(oc) - radius * radius;
        const h = b * b - c;
        
        if (h < 0) return null; 
        
        const sqrtH = Math.sqrt(h);
        const t1 = -b - sqrtH;
        const t2 = -b + sqrtH;
        
        const epsilon = 1e-4; // Slightly larger epsilon for robustness
        
        if (t1 > epsilon) return t1;
        if (t2 > epsilon) return t2;
        return null;
    }

    /**
     * Intersect ray with the bounding cylinder of the lens (Aperture).
     * Cylinder along Z axis, radius = apertureRadius.
     * Returns smallest positive t > epsilon.
     */
    private intersectCylinder(rayOrigin: Vector3, rayDir: Vector3): number | null {
        // x^2 + y^2 = R^2
        // (Ox + tDx)^2 + (Oy + tDy)^2 = R^2
        // t^2(Dx^2 + Dy^2) + t(2OxDx + 2OyDy) + (Ox^2 + Oy^2 - R^2) = 0
        
        const dx = rayDir.x;
        const dy = rayDir.y;
        const ox = rayOrigin.x;
        const oy = rayOrigin.y;
        const r = this.apertureRadius;
        
        const A = dx*dx + dy*dy;
        const B = 2 * (ox*dx + oy*dy);
        const C = ox*ox + oy*oy - r*r;
        
        if (Math.abs(A) < 1e-9) return null; // Parallel to Z axis, no intersection with cylinder walls
        
        const h = B*B - 4*A*C;
        if (h < 0) return null;
        
        const sqrtH = Math.sqrt(h);
        const t1 = (-B - sqrtH) / (2*A);
        const t2 = (-B + sqrtH) / (2*A);
        
        const epsilon = 1e-4;
        if (t1 > epsilon) return t1;
        if (t2 > epsilon) return t2;
        return null;
    }

    /**
     * Check if a hit point on a sphere is on the correct hemisphere (near the vertex,
     * not the far "ghost" pole). This replaces fragile sag-distance heuristics.
     * 
     * For a sphere of signed radius R with center C:
     *   - The vertex (lens face) is at z = faceZ
     *   - The center is at z = faceZ + R
     *   - The far pole is at z = faceZ + 2R
     * 
     * A valid cap hit should be near the vertex, meaning:
     *   (hitZ - centerZ) and R should have opposite signs (hit is vertex-side of center)
     *   OR the hit is AT the center (degenerate, accept it)
     */
    private isOnCorrectHemisphere(hitZ: number, centerZ: number, R: number): boolean {
        if (Math.abs(R) > 1e6) return true; // Near-flat surface, no ghost pole risk
        const delta = hitZ - centerZ;
        // Valid cap: delta and R have OPPOSITE signs
        // (For R>0, vertex is at center-R, so valid hits have hitZ < centerZ → delta < 0)
        // (For R<0, vertex is at center-|R|=center+R, so valid hits have hitZ > centerZ → delta > 0)
        // Allow a small tolerance for hits exactly at the equator
        return (delta * R) <= Math.abs(R) * 0.01; // hit must be on vertex side (or very close to equator)
    }

    private refract(incident: Vector3, normal: Vector3, n1: number, n2: number): Vector3 | null {
        // Enforce normal opposes incident (cosI > 0)
        let n = normal.clone();
        if (n.dot(incident) > 0) n.negate();

        const r = n1 / n2;
        const cosI = -n.dot(incident); // Now positive
        const sinT2 = r * r * (1 - cosI * cosI);
        
        if (sinT2 > 1.0) return null; // Total Internal Reflection
        
        const cosT = Math.sqrt(1 - sinT2);
        return incident.clone().multiplyScalar(r).add(n.multiplyScalar(r * cosI - cosT)).normalize();
    }

    getRadii(): { R1: number, R2: number } {
        if (this.r1 !== undefined && this.r2 !== undefined) {
            return { R1: this.r1, R2: this.r2 };
        }
        // Fallback: symmetric lens from optical power
        // P = (n-1)(1/R1 - 1/R2) + ...
        // Simplest: 1/R = P / (2(n-1))
        // If curvature (Power) is 0 -> Infinite Radius
        if (Math.abs(this.curvature) < 1e-9) {
            return { R1: 1e9, R2: 1e9 }; // Plane window
        }
        const R = (2 * (this.ior - 1)) / this.curvature;
        return { R1: R, R2: -R }; // Symmetric: Convex-Convex (R, -R) or Concave-Concave (-R, R)
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // 1. Ray enters from World -> Local. We are looking for entry point.
        // Candidate surfaces: Front Sphere, Back Sphere. 
        // (Usually we enter from front or back).
        
        const { R1, R2 } = this.getRadii();
        
        // Define Spheres centers
        // Front Vertex is at z = -thickness/2. Center is at z = -thickness/2 + R1.
        const center1 = uvw(0, 0, -this.thickness/2 + R1);
        
        // Back Vertex is at z = thickness/2. Center is at z = thickness/2 + R2.
        const center2 = uvw(0, 0, this.thickness/2 + R2);
        
        // Potential hits
        const hits: {t: number, surf: 'front'|'back', center: Vector3, R: number}[] = [];
        
        // Front
        const t1 = this.intersectSphere(rayLocal.origin, rayLocal.direction, center1, Math.abs(R1));
        if (t1 !== null) hits.push({ t: t1, surf: 'front', center: center1, R: R1 });
        
        // Back (for rays coming from right)
        const t2 = this.intersectSphere(rayLocal.origin, rayLocal.direction, center2, Math.abs(R2));
        if (t2 !== null) hits.push({ t: t2, surf: 'back', center: center2, R: R2 });
        
        // Sort by distance
        hits.sort((a, b) => a.t - b.t);
        
        // Filter for validity: Hit must be within Aperture Radius AND within Sag (valid cap)
        for (const hit of hits) {
            const p = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(hit.t));
            
            // Check aperture bounds (Cylinder check)
            // Use effectiveApertureRadius which accounts for surface crossing
            if (transverseRadius(p) <= this.effectiveApertureRadius) {
                // Hemisphere check: reject hits on the far "ghost" pole of the sphere.
                // This is more robust than sag-distance heuristics.
                if (this.isOnCorrectHemisphere(p.z, hit.center.z, hit.R)) {
                    
                    const normal = p.clone().sub(hit.center).normalize();
                    
                    // Determine Outward Normal (pointing into Air)
                    let outNormal = normal.clone();
                    
                    if (hit.surf === 'front') {
                         if (hit.R < 0) outNormal.negate();
                    } else {
                         if (hit.R > 0) outNormal.negate();
                    }
    
                    // Check direction: Ray should be entering material
                    if (rayLocal.direction.dot(outNormal) < 0) {
                         return { t: hit.t, point: p, normal: outNormal, localPoint: p };
                    }
                }
            }
        }
        
        return null;
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        const nAir = 1.0;
        const nGlass = this.ior;
        
        const { R1, R2 } = this.getRadii();
        
        // Sphere centers in local space
        const center1 = uvw(0, 0, -this.thickness/2 + R1);
        const center2 = uvw(0, 0, this.thickness/2 + R2);
        
        // --- 1. Refract at Entry Surface (Air -> Glass) ---
        // Transform world-space ray direction to local space
        const dirIn = ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        
        // CRITICAL FIX: Recompute entry normal from geometry in local space.
        // Do NOT use hit.normal (which is world-space from chkIntersection).
        // Determine which surface was hit by proximity to each sphere center.
        const entryLocal = hit.localPoint!.clone();
        const distToCenter1 = entryLocal.distanceTo(center1);
        const distToCenter2 = entryLocal.distanceTo(center2);
        const isEntryFront = Math.abs(distToCenter1 - Math.abs(R1)) < Math.abs(distToCenter2 - Math.abs(R2));
        
        let entryNormal: Vector3;
        if (isEntryFront) {
            entryNormal = entryLocal.clone().sub(center1).normalize();
            // Outward normal (into air): depends on sign of R1
            if (R1 < 0) entryNormal.negate();
        } else {
            entryNormal = entryLocal.clone().sub(center2).normalize();
            // Outward normal (into air): depends on sign of R2
            if (R2 > 0) entryNormal.negate();
        }
        
        const dirInside = this.refract(dirIn, entryNormal, nAir, nGlass);
        if (!dirInside) return { rays: [] }; // TIR at entry (rare)
        
        // --- 2. Propagate to Exit Surface (Glass -> Air) ---
        // Start from hit.localPoint in local space, trace to exit boundary.
        
        let tExit = Infinity;
        let exitNormal: Vector3 | null = null;
        let exitPoint: Vector3 | null = null;
        
        // Check Back Sphere (most likely exit if moving +z)
        const tBack = this.intersectSphere(entryLocal, dirInside, center2, Math.abs(R2));
        if (tBack !== null && tBack < tExit) {
             const p = entryLocal.clone().add(dirInside.clone().multiplyScalar(tBack));
             if (transverseRadius(p) <= this.effectiveApertureRadius + 0.01) {
                 if (this.isOnCorrectHemisphere(p.z, center2.z, R2)) {
                     tExit = tBack;
                     exitPoint = p;
                     const n = p.clone().sub(center2).normalize();
                     exitNormal = n;
                     // Inside -> Out: normal pointing OUT into Air
                     if (R2 > 0) exitNormal.negate();
                 }
             }
        }
        
        // Check Front Sphere (for rays entering from back, or internal reflection)
        const tFront = this.intersectSphere(entryLocal, dirInside, center1, Math.abs(R1));
        if (tFront !== null && tFront < tExit) {
             const p = entryLocal.clone().add(dirInside.clone().multiplyScalar(tFront));
             if (transverseRadius(p) <= this.effectiveApertureRadius + 0.01) {
                 if (this.isOnCorrectHemisphere(p.z, center1.z, R1)) {
                     tExit = tFront;
                     exitPoint = p;
                     const n = p.clone().sub(center1).normalize();
                     exitNormal = n;
                     if (R1 < 0) exitNormal.negate();
                 }
             }
        }
        
        // Check Cylinder (Edge) — ray absorbed at rim
        const tCyl = this.intersectCylinder(entryLocal, dirInside);
        if (tCyl !== null && tCyl < tExit) {
            return { rays: [] };
        }
        
        if (tExit === Infinity || !exitPoint || !exitNormal) {
            return { rays: [] }; // Ray trapped or geometry error
        }

        // --- 3. Refract at Exit (Glass -> Air) ---
        const dirOutLocal = this.refract(dirInside, exitNormal, nGlass, nAir);
        
        if (!dirOutLocal) {
            // TIR at exit — absorb (prevents ghost rays)
            return { rays: [] };
        }

        // Transform results back to world space
        const dirOutWorld = dirOutLocal.transformDirection(this.localToWorld).normalize();
        const hitWorldBack = exitPoint.clone().applyMatrix4(this.localToWorld);

        return {
            rays: [{
                ...ray,
                origin: hitWorldBack,
                direction: dirOutWorld,
                opticalPathLength: ray.opticalPathLength + (tExit * nGlass),
                entryPoint: hit.point  // World-space entry point for visualization
            }]
        };
    }
}
