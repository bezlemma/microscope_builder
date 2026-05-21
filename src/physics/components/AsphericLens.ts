import { Vector3, Vector2, LatheGeometry } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { OpticMesh, NormalFn } from '../OpticMesh';

/**
 * Even-asphere thick lens. Each surface follows
 *
 *     z(r) = c·r² / (1 + √(1 − (1+k)·c²·r²))  +  Σ Aᵢ · r^(2i+4)
 *
 * with c = 1/R, k the conic constant, and Aᵢ ∈ ℝ for i = 0..N−1
 * mapping to A4·r⁴, A6·r⁶, A8·r⁸, A10·r¹⁰, A12·r¹², A14·r¹⁴.
 *
 * k = 0  → sphere
 * k = −1 → parabola
 * k < −1 → hyperbola
 * −1 < k < 0 → prolate ellipsoid
 * k > 0  → oblate ellipsoid
 *
 * Like SphericalLens this builds a LatheGeometry profile that the OpticMesh
 * BVH ray-casts; vertex normals are the analytical gradient of the sag.
 */

export interface AsphericSurfaceParams {
    /** Radius of curvature; |R| ≥ 1e6 treated as flat. */
    R: number;
    /** Conic constant. */
    k: number;
    /** Even aspheric coefficients [A4, A6, A8, A10, A12, A14]. */
    A: number[];
}

export interface AsphericLensConfig {
    name?: string;
    front?: Partial<AsphericSurfaceParams>;
    back?: Partial<AsphericSurfaceParams>;
    apertureRadius?: number;
    thickness?: number;
    ior?: number;
}

export const ASPHERE_MAX_TERMS = 6;

const FLAT_THRESHOLD = 1e6;

function isFlat(R: number): boolean {
    return Math.abs(R) >= FLAT_THRESHOLD;
}

/** Sag of one even-asphere surface, measured from the apex. */
export function asphereSagFromApex(surface: AsphericSurfaceParams, r: number): number {
    const r2 = r * r;
    let z = 0;

    if (!isFlat(surface.R)) {
        const c = 1 / surface.R;
        const disc = 1 - (1 + surface.k) * c * c * r2;
        if (disc > 0) {
            z = (c * r2) / (1 + Math.sqrt(disc));
        } else {
            // Past the conic terminator: clamp to the asymptotic sag at the
            // last valid radius so the profile stays single-valued.
            const maxValidR2 = (1 - 1e-9) / Math.max((1 + surface.k) * c * c, 1e-30);
            const r2c = Math.max(0, maxValidR2);
            const dc = 1 - (1 + surface.k) * c * c * r2c;
            z = dc > 0 ? (c * r2c) / (1 + Math.sqrt(dc)) : c * r2c;
        }
    }

    let rp = r2 * r2;
    for (let i = 0; i < surface.A.length; i++) {
        z += surface.A[i] * rp;
        rp *= r2;
    }
    return z;
}

/** dz/dr along the surface profile. */
export function asphereSagDerivative(surface: AsphericSurfaceParams, r: number): number {
    if (r === 0) return 0;
    let dz = 0;

    if (!isFlat(surface.R)) {
        const c = 1 / surface.R;
        const disc = 1 - (1 + surface.k) * c * c * r * r;
        if (disc > 0) {
            dz = (c * r) / Math.sqrt(disc);
        } else {
            // At/past the terminator the slope diverges; fake a steep wall so
            // the analytical normal still points sensibly.
            dz = Math.sign(c) * 1e3;
        }
    }

    let rp = r * r * r;
    for (let i = 0; i < surface.A.length; i++) {
        const power = 2 * i + 4;
        dz += power * surface.A[i] * rp;
        rp *= r * r;
    }
    return dz;
}

/**
 * Largest radius at which the front and back surfaces still bound a positive
 * thickness. Falls back to apertureRadius when there's no crossing.
 */
function maxValidRadius(
    front: AsphericSurfaceParams,
    back: AsphericSurfaceParams,
    apertureRadius: number,
    thickness: number,
    samples: number = 64,
): number {
    const frontApex = -thickness / 2;
    const backApex = thickness / 2;
    const frontZ = (r: number) => frontApex + asphereSagFromApex(front, r);
    const backZ = (r: number) => backApex + asphereSagFromApex(back, r);

    for (let i = 1; i <= samples; i++) {
        const r = (i / samples) * apertureRadius;
        const gap = backZ(r) - frontZ(r);
        if (gap < 0) {
            // Surfaces crossed in [(i-1)/N, i/N] · aperture; bisect.
            let lo = ((i - 1) / samples) * apertureRadius;
            let hi = r;
            for (let j = 0; j < 24; j++) {
                const mid = (lo + hi) / 2;
                if (backZ(mid) - frontZ(mid) > 0) lo = mid;
                else hi = mid;
            }
            return lo;
        }
    }
    return apertureRadius;
}

const DEFAULT_FRONT: AsphericSurfaceParams = { R: 13, k: -1, A: [] };
const DEFAULT_BACK: AsphericSurfaceParams = { R: 1e9, k: 0, A: [] };

/**
 * Named factory presets. Each function takes a target focal length (mm) and
 * the lens index of refraction, and returns front/back surface parameters.
 *
 * For paraxial focal length the conic + Aᵢ terms are irrelevant — they only
 * shape aberrations — so the curvatures come from the standard thin-lens
 * lensmaker equation 1/f = (n−1)·(1/R1 − 1/R2).
 */
export type AsphericPreset =
    | 'plano-asphere-collimator'
    | 'best-form-asphere'
    | 'biconvex-asphere'
    | 'meniscus-asphere'
    | 'schmidt-corrector';

export function asphericPresetSurfaces(
    type: AsphericPreset,
    f: number,
    n: number,
): { front: AsphericSurfaceParams; back: AsphericSurfaceParams } {
    const fMag = Math.max(Math.abs(f), 1e-6);
    switch (type) {
        case 'plano-asphere-collimator': {
            // R1 convex toward source, flat back, prolate ellipsoidal front
            // (k ≈ −0.7 cancels SA at infinite conjugate for typical glass).
            const R = (n - 1) * fMag;
            return {
                front: { R, k: -0.7, A: [] },
                back: { R: 1e9, k: 0, A: [] },
            };
        }
        case 'best-form-asphere': {
            // Mild conic split between two convex surfaces, like a "best-form
            // singlet" with aspheric residual correction.
            const R = 2 * (n - 1) * fMag * 1.1;
            return {
                front: { R, k: -0.3, A: [] },
                back: { R: -R * 0.8, k: -0.3, A: [] },
            };
        }
        case 'biconvex-asphere': {
            // Symmetric biconvex with prolate-ellipsoidal correction on both.
            const R = 2 * (n - 1) * fMag;
            return {
                front: { R, k: -0.5, A: [] },
                back: { R: -R, k: -0.5, A: [] },
            };
        }
        case 'meniscus-asphere': {
            // Positive meniscus: both R > 0 with the front more curved.
            return {
                front: { R: fMag, k: -0.2, A: [] },
                back: { R: fMag * 3, k: 0, A: [] },
            };
        }
        case 'schmidt-corrector': {
            // Approximately-flat refractor with 4th- and 6th-order terms.
            // Power is near-zero; the polynomial does the work.
            const R = 1e9;
            return {
                front: { R, k: 0, A: [1.5e-5, -3e-9] },
                back: { R: 1e9, k: 0, A: [] },
            };
        }
    }
}

export class AsphericLens extends OpticalComponent {
    public r1: number;
    public r2: number;
    public k1: number;
    public k2: number;
    public A1: number[];
    public A2: number[];
    public apertureRadius: number;
    public thickness: number;
    public ior: number;

    private _mesh: OpticMesh | null = null;

    constructor(config: AsphericLensConfig = {}) {
        super(config.name ?? 'Aspheric Lens');
        this.r1 = config.front?.R ?? DEFAULT_FRONT.R;
        this.r2 = config.back?.R ?? DEFAULT_BACK.R;
        this.k1 = config.front?.k ?? DEFAULT_FRONT.k;
        this.k2 = config.back?.k ?? DEFAULT_BACK.k;
        this.A1 = (config.front?.A ?? DEFAULT_FRONT.A).slice();
        this.A2 = (config.back?.A ?? DEFAULT_BACK.A).slice();
        this.apertureRadius = config.apertureRadius ?? 3;
        this.thickness = config.thickness ?? 4;
        this.ior = config.ior ?? 1.5168;
        this.recomputeBounds();
    }

    /** Front-surface parameters as a struct. */
    get frontSurface(): AsphericSurfaceParams {
        return { R: this.r1, k: this.k1, A: this.A1 };
    }

    /** Back-surface parameters as a struct. */
    get backSurface(): AsphericSurfaceParams {
        return { R: this.r2, k: this.k2, A: this.A2 };
    }

    /** Paraxial focal length from the thick-lens lensmaker equation. */
    get focalLength(): number {
        const invR1 = isFlat(this.r1) ? 0 : 1 / this.r1;
        const invR2 = isFlat(this.r2) ? 0 : 1 / this.r2;
        // Thick-lens correction (n−1)²·t / (n·R1·R2) only contributes when both
        // surfaces are curved; with either R infinite the term vanishes.
        const thickTerm = (isFlat(this.r1) || isFlat(this.r2))
            ? 0
            : ((this.ior - 1) ** 2 * this.thickness) / (this.ior * this.r1 * this.r2);
        const inv = (this.ior - 1) * (invR1 - invR2) + thickTerm;
        if (Math.abs(inv) < 1e-12) return 1e6;
        return 1 / inv;
    }

    setFromPreset(type: AsphericPreset, focalLength?: number): void {
        const f = focalLength ?? Math.abs(this.focalLength);
        const { front, back } = asphericPresetSurfaces(type, f, this.ior);
        this.r1 = front.R;
        this.r2 = back.R;
        this.k1 = front.k;
        this.k2 = back.k;
        this.A1 = front.A.slice();
        this.A2 = back.A.slice();
        this.invalidateMesh();
    }

    /** Re-derive AABB from current geometry (sag of asphere can exceed sphere). */
    recomputeBounds(): void {
        const a = this.apertureRadius;
        const front = this.frontSurface;
        const back = this.backSurface;
        const frontApex = -this.thickness / 2;
        const backApex = this.thickness / 2;
        let zMin = frontApex;
        let zMax = backApex;
        const samples = 24;
        for (let i = 0; i <= samples; i++) {
            const r = (i / samples) * a;
            zMin = Math.min(zMin, frontApex + asphereSagFromApex(front, r));
            zMax = Math.max(zMax, backApex + asphereSagFromApex(back, r));
        }
        this.bounds.set(
            new Vector3(-a, -a, zMin - 0.05),
            new Vector3(a, a, zMax + 0.05),
        );
    }

    invalidateMesh(): void {
        this._mesh = null;
        this.recomputeBounds();
        this.version++;
    }

    /** Largest radius where the front sag still sits ahead of the back sag. */
    get effectiveApertureRadius(): number {
        return maxValidRadius(this.frontSurface, this.backSurface, this.apertureRadius, this.thickness);
    }

    private get mesh(): OpticMesh {
        if (!this._mesh) {
            this._mesh = new OpticMesh();
            const segments = 96;
            const profile = AsphericLens.generateProfile(
                this.frontSurface,
                this.backSurface,
                this.apertureRadius,
                this.thickness,
                segments,
            );
            const geometry = new LatheGeometry(profile, segments);
            geometry.rotateX(Math.PI / 2);

            const front = this.frontSurface;
            const back = this.backSurface;
            const frontApex = -this.thickness / 2;
            const backApex = this.thickness / 2;
            const maxR = this.effectiveApertureRadius;

            const normalFn: NormalFn = (v: Vector3) => {
                const r = Math.sqrt(v.x * v.x + v.y * v.y);

                if (r > maxR - 0.01) {
                    return new Vector3(v.x, v.y, 0).normalize();
                }

                const sagFrontZ = frontApex + asphereSagFromApex(front, r);
                const sagBackZ = backApex + asphereSagFromApex(back, r);
                const onFront = Math.abs(v.z - sagFrontZ) < Math.abs(v.z - sagBackZ);
                const surface = onFront ? front : back;
                const dz = asphereSagDerivative(surface, r);

                if (r < 1e-6) {
                    return new Vector3(0, 0, onFront ? -1 : 1);
                }

                // Implicit form F = z - apex - sag(r); grad F = (-x/r*dz, -y/r*dz, 1).
                // For the front surface flip so the normal points toward −Z (out of the
                // lens). OpticMesh.interact further reorients against the ray.
                const inv_r = 1 / r;
                if (onFront) {
                    return new Vector3(v.x * inv_r * dz, v.y * inv_r * dz, -1).normalize();
                }
                return new Vector3(-v.x * inv_r * dz, -v.y * inv_r * dz, 1).normalize();
            };

            this._mesh.build(geometry, normalFn);
        }
        return this._mesh;
    }

    /** Profile points for a LatheGeometry revolution: (radius, axial). */
    static generateProfile(
        front: AsphericSurfaceParams,
        back: AsphericSurfaceParams,
        apertureRadius: number,
        thickness: number,
        segments: number = 64,
    ): Vector2[] {
        const frontApex = -thickness / 2;
        const backApex = thickness / 2;
        const maxR = maxValidRadius(front, back, apertureRadius, thickness, segments);

        const frontPoints: Vector2[] = [];
        const backPoints: Vector2[] = [];
        for (let i = 0; i <= segments; i++) {
            const r = (i / segments) * maxR;
            frontPoints.push(new Vector2(r, frontApex + asphereSagFromApex(front, r)));
            backPoints.push(new Vector2(r, backApex + asphereSagFromApex(back, r)));
        }

        const profile: Vector2[] = [];
        profile.push(...frontPoints);
        profile.push(new Vector2(maxR, frontPoints[frontPoints.length - 1].y));
        profile.push(new Vector2(maxR, backPoints[backPoints.length - 1].y));
        profile.push(...backPoints.reverse());
        return profile;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const meshHit = this.mesh.intersectRay(rayLocal.origin, rayLocal.direction);
        if (!meshHit) return null;
        return {
            t: meshHit.t,
            point: meshHit.point,
            normal: meshHit.normal,
            localPoint: meshHit.point.clone(),
        };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
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
            ray,
        );
    }

    getApertureRadius(): number {
        return this.apertureRadius;
    }
}
