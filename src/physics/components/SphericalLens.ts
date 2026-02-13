import { Vector3, Vector2, LatheGeometry } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { OpticMesh, NormalFn } from '../OpticMesh';

/**
 * SphericalLens - A robust analytical thick spherical lens.
 * 
 * Uses OpticMesh (Three.js mesh + BVH raycaster) with analytical vertex
 * normals for exact ray-surface interaction. The mesh is built from
 * generateProfile() — the same geometry used for visual rendering.
 * 
 * Local Origin (0,0,0) is center of lens. Optical axis = +Z.
 * Front vertex at z = -thickness/2, back vertex at z = +thickness/2.
 */
export class SphericalLens extends OpticalComponent {
    public curvature: number = 0.02; // Default f=50
    public apertureRadius: number = 10.0; 
    public thickness: number = 5.0; 
    public ior: number = 1.5168;
    
    // Explicit radii overrides (optional)
    public r1?: number; 
    public r2?: number;

    // Computed property for internal engine
    public get focalLength(): number {
        return Math.abs(this.curvature) > 1e-9 ? 1 / this.curvature : 1000;
    }

    // Cached physics mesh (built once, reused for all ray intersections)
    private _mesh: OpticMesh | null = null;

    constructor(curvature: number, aperture: number, thickness: number, name: string = "Lens", r1?: number, r2?: number, ior: number = 1.5168) {
        super(name);
        this.curvature = curvature;
        this.apertureRadius = aperture;
        this.thickness = thickness;
        this.r1 = r1;
        this.r2 = r2;
        this.ior = ior;
    }

    /** Get or build the physics mesh. Cached until parameters change. */
    get mesh(): OpticMesh {
        if (!this._mesh) {
            this._mesh = new OpticMesh();
            const { R1, R2 } = this.getRadii();
            const segments = 64;
            const profilePoints = SphericalLens.generateProfile(R1, R2, this.apertureRadius, this.thickness, segments);

            // Build LatheGeometry from profile, rotate to align Z = optical axis
            const geometry = new LatheGeometry(profilePoints, segments);
            geometry.rotateX(Math.PI / 2);

            const frontApex = -this.thickness / 2;
            const backApex = this.thickness / 2;
            const frontCenter = new Vector3(0, 0, frontApex + R1);
            const backCenter = new Vector3(0, 0, backApex + R2);

            const normalFn: NormalFn = (v: Vector3) => {
                const r = Math.sqrt(v.x * v.x + v.y * v.y);
                const maxR = this.effectiveApertureRadius;

                // Rim: radial outward
                if (r > maxR - 0.01) {
                    return new Vector3(v.x, v.y, 0).normalize();
                }

                // Classify by proximity to actual sag values
                const sagFrontZ = (() => {
                    if (Math.abs(R1) > 1e8) return frontApex;
                    const val = R1 * R1 - r * r;
                    if (val < 0) return frontApex;
                    return (frontApex + R1) - (R1 > 0 ? 1 : -1) * Math.sqrt(val);
                })();
                const sagBackZ = (() => {
                    if (Math.abs(R2) > 1e8) return backApex;
                    const val = R2 * R2 - r * r;
                    if (val < 0) return backApex;
                    return (backApex + R2) - (R2 > 0 ? 1 : -1) * Math.sqrt(val);
                })();

                const distToFront = Math.abs(v.z - sagFrontZ);
                const distToBack = Math.abs(v.z - sagBackZ);

                if (distToFront < distToBack) {
                    // Front surface
                    if (Math.abs(R1) > 1e8) return new Vector3(0, 0, -1);
                    return v.clone().sub(frontCenter).normalize();
                } else {
                    // Back surface
                    if (Math.abs(R2) > 1e8) return new Vector3(0, 0, 1);
                    return v.clone().sub(backCenter).normalize();
                }
            };

            this._mesh.build(geometry, normalFn);
        }
        return this._mesh;
    }

    /** Invalidate mesh cache when parameters change */
    public invalidateMesh(): void {
        this._mesh = null;
    }

    // ========================================================================
    // LENS TYPE PRESETS
    // ========================================================================

    // (Kept for compatibility with existing Presets API)
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
        const f = this.focalLength;
        const n = this.ior;
        
        // 1/f = (n-1) * (1/R1 - 1/R2)
        // Symmetric: R1 = -R2. 1/f = (n-1)(2/R1) -> R1 = 2(n-1)f
        
        switch (type) {
            case 'biconvex': {
                const R = 2 * (n - 1) * f;
                this.r1 = R;
                this.r2 = -R;
                break;
            }
            case 'plano-convex': {
                // R1=Inf, R2 = -(n-1)f
                const R = (n - 1) * f;
                this.r1 = undefined; // Infinity
                this.r2 = -R;
                break;
            }
            case 'convex-plano': {
                // R1=(n-1)f, R2=Inf
                const R = (n - 1) * f;
                this.r1 = R;
                this.r2 = undefined;
                break;
            }
            case 'meniscus-pos': {
                // Positive Meniscus: R1, R2 > 0. R1 < R2 (more curved front)
                this.r1 = f;
                this.r2 = f * 3; 
                break;
            }
            case 'plano-concave': {
                // f < 0. R2 = -(n-1)f. Since f<0, R2>0.
                const R = -(n - 1) * f;
                this.r1 = undefined;
                this.r2 = R;
                break;
            }
            case 'concave-plano': {
                // f < 0. R1 = f/(n-1). Since f<0, R1<0.
                const R = f / (n - 1);
                this.r1 = R;
                this.r2 = undefined;
                break;
            }
            case 'biconcave': {
                // f < 0. R1 = 2(n-1)f. R1 < 0.
                const R = 2 * (n - 1) * f;
                this.r1 = R;
                this.r2 = -R;
                break;
            }
            case 'meniscus-neg': {
                 // Negative Meniscus. R1, R2 > 0 (bent right). R1 > R2 (weaker front).
                this.r1 = Math.abs(f) * 3;
                this.r2 = Math.abs(f); 
                break;
            }
        }
    }

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

    // ========================================================================
    // GEOMETRY HELPERS
    // ========================================================================

    get sagFront(): number {
        const { R1 } = this.getRadii();
        if (Math.abs(R1) > 1e6) return 0;
        return Math.abs(R1) - Math.sqrt(Math.max(0, R1*R1 - this.apertureRadius*this.apertureRadius));
    }

    get sagBack(): number {
        const { R2 } = this.getRadii();
        if (Math.abs(R2) > 1e6) return 0;
        return Math.abs(R2) - Math.sqrt(Math.max(0, R2*R2 - this.apertureRadius*this.apertureRadius));
    }

    get effectiveApertureRadius(): number {
        const { R1, R2 } = this.getRadii();
        const frontApex = -this.thickness / 2;
        const backApex = this.thickness / 2;
        
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
        
        if (frontZ(this.apertureRadius) < backZ(this.apertureRadius)) {
            return this.apertureRadius;
        }
        
        let lo = 0, hi = this.apertureRadius;
        for (let i = 0; i < 30; i++) {
            const mid = (lo + hi) / 2;
            if (frontZ(mid) < backZ(mid)) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        return lo;
    }

    getRadii(): { R1: number, R2: number } {
        if (this.r1 !== undefined && this.r2 !== undefined) {
            return { R1: this.r1, R2: this.r2 };
        }
        if (Math.abs(this.curvature) < 1e-9) {
            return { R1: 1e9, R2: 1e9 };
        }
        const R = (2 * (this.ior - 1)) / this.curvature;
        return { R1: R, R2: -R };
    }

    /**
     * Generate the 2D profile for a lens cross-section (used by LensVisualizer).
     * Profile format: Vector2(radial, axial) for LatheGeometry.
     */
    static generateProfile(R1: number, R2: number, apertureRadius: number, thickness: number, segments: number = 64): Vector2[] {
        const frontPoints: Vector2[] = [];
        const backPoints: Vector2[] = [];
        const frontApex = -thickness / 2;
        const backApex = thickness / 2;

        // Compute sag functions for front and back surfaces
        const sagFront = (r: number): number => {
            if (Math.abs(R1) > 1e8) return frontApex;
            const val = R1 * R1 - r * r;
            if (val < 0) return frontApex;
            return (frontApex + R1) - (R1 > 0 ? 1 : -1) * Math.sqrt(val);
        };
        const sagBack = (r: number): number => {
            if (Math.abs(R2) > 1e8) return backApex;
            const val = R2 * R2 - r * r;
            if (val < 0) return backApex;
            return (backApex + R2) - (R2 > 0 ? 1 : -1) * Math.sqrt(val);
        };

        // Find where surfaces cross (if they do) — this is the max physical radius
        let maxR = apertureRadius;
        for (let i = 0; i <= segments; i++) {
            const r = (i / segments) * apertureRadius;
            if (sagBack(r) - sagFront(r) < 0) {
                // Surfaces crossed — binary search for exact crossing point
                let lo = ((i - 1) / segments) * apertureRadius;
                let hi = r;
                for (let j = 0; j < 20; j++) {
                    const mid = (lo + hi) / 2;
                    if (sagBack(mid) - sagFront(mid) > 0) lo = mid; else hi = mid;
                }
                maxR = lo;
                break;
            }
        }

        // Build profile up to maxR with curved surfaces
        for (let i = 0; i <= segments; i++) {
            const r = (i / segments) * maxR;
            frontPoints.push(new Vector2(r, sagFront(r)));
            backPoints.push(new Vector2(r, sagBack(r)));
        }

        // Build closed profile: front surface → rim → back surface (reversed)
        const profile: Vector2[] = [];
        profile.push(...frontPoints);
        
        const edgeFrontW = frontPoints[frontPoints.length - 1].y;
        const edgeBackW = backPoints[backPoints.length - 1].y;

        // Rim at the edge of the physical glass body
        profile.push(new Vector2(maxR, edgeFrontW));
        profile.push(new Vector2(maxR, edgeBackW));
        
        profile.push(...backPoints.reverse());
        
        return profile;
    }

    // ========================================================================
    // INTERSECT & INTERACT (via OpticMesh)
    // ========================================================================
    
    intersect(rayLocal: Ray): HitRecord | null {
        const meshHit = this.mesh.intersectRay(rayLocal.origin, rayLocal.direction);
        
        if (!meshHit) return null;
        
        return {
            t: meshHit.t,
            point: meshHit.point,
            normal: meshHit.normal,
            localPoint: meshHit.point.clone()
        };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Use raw local-space values stored during chkIntersection to avoid
        // floating-point errors from world↔local rotation matrix round-trips.
        // The rotation matrix for e.g. rotateY(π/2) has cos(π/2) ≈ 6.12e-17
        // instead of exactly 0, which corrupts the refracted direction enough
        // to make the raycaster miss the exit surface.
        const dirIn = hit.localDirection?.clone().normalize()
            ?? ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        const normalIn = hit.localNormal?.clone().normalize()
            ?? hit.normal.clone().transformDirection(this.worldToLocal).normalize();

        return this.mesh.interact(
            normalIn,
            dirIn,
            hit.localPoint!,
            this.ior,
            this.localToWorld,
            hit.point,
            ray
        );
    }

    /**
     * ABCD matrix for Solver 2 (Gaussian Beam Propagation).
     * Thick-lens compound matrix:
     *   M = M_refract(R2) × M_propagate(t/n) × M_refract(R1)
     *
     * Convention: R > 0 means center of curvature is to the right of the surface.
     * Returns [A, B, C, D].
     */
    getABCD(): [number, number, number, number] {
        const { R1, R2 } = this.getRadii();
        const n = this.ior;
        const t = this.thickness;

        // M_refract at surface 1 (air→glass): [[1, 0], [-(n-1)/R1, 1]]
        // Using the general form: [[1, 0], [-(n2-n1)/(n2*R), n1/n2]]
        // Surface 1: n1=1 (air), n2=n (glass)
        const C1 = -(n - 1) / (n * R1);
        const D1 = 1 / n;

        // M_propagate through glass: [[1, t/n], [0, 1]]
        // Actually d = t (physical thickness), already in glass
        const B_prop = t / n;

        // M_refract at surface 2 (glass→air): [[1, 0], [-(1-n)/(1*R2), n/1]]
        // n1=n (glass), n2=1 (air)
        const C2 = -(1 - n) / R2; // = (n - 1) / R2
        const D2 = n;

        // Chain: M = M2 × M_prop × M1
        // M1 = [[1, 0], [C1, D1]]
        // M_prop = [[1, B_prop], [0, 1]]
        // M2 = [[1, 0], [C2, D2]]
        
        // Step 1: M_prop × M1
        const a1 = 1;
        const b1 = B_prop * D1;
        const c1 = C1;
        const d1 = B_prop * C1 + D1;

        // Step 2: M2 × (M_prop × M1)
        const A = a1;
        const B = b1;
        const C = C2 * a1 + D2 * c1;
        const D = C2 * b1 + D2 * d1;

        return [A, B, C, D];
    }

    getApertureRadius(): number {
        return this.apertureRadius;
    }
}
