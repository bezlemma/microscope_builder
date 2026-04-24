import { Vector3, Vector2, LatheGeometry } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { OpticMesh, NormalFn } from '../OpticMesh';
import { SphericalLens } from './SphericalLens';
import { cleanVec } from '../math_solvers';
import { cauchyIorFromReference } from '../dispersion';

/**
 * AchromatDoublet — a cemented achromatic doublet lens.
 *
 * Models two glass elements (crown + flint) cemented together as a single
 * draggable component. Three spherical surfaces define the shape:
 *   Surface 1 (front) — R1
 *   Surface 2 (cement) — R2 (shared interface)
 *   Surface 3 (back)   — R3
 *
 * Physics: Two independent OpticMesh sub-meshes, each traced with its own IOR.
 *
 * Default: Thorlabs AC254-200-A equivalent (f=200 mm achromatic doublet).
 *
 * Local Origin (0,0,0) is center of the combined lens. Optical axis = +Z.
 */
export class AchromatDoublet extends OpticalComponent {
    /** Front surface radius */
    public r1: number;
    /** Cemented interface radius (shared between elements) */
    public r2: number;
    /** Back surface radius */
    public r3: number;
    /** Element 1 center thickness (crown glass) */
    public t1: number;
    /** Element 2 center thickness (flint glass) */
    public t2: number;
    /** Element 1 refractive index (crown glass) */
    public ior1: number;
    /** Element 2 refractive index (flint glass) */
    public ior2: number;
    /** Shared aperture radius */
    public apertureRadius: number;

    /** Tiny cement gap to avoid coplanar surface tracing issues */
    private static readonly CEMENT_GAP = 0.01;

    // Cached physics sub-meshes
    private _mesh1: OpticMesh | null = null;
    private _mesh2: OpticMesh | null = null;

    constructor(
        r1 = 77.4,
        r2 = -87.6,
        r3 = 291.1,
        t1 = 4.0,
        t2 = 2.5,
        apertureRadius = 25.4,
        ior1 = 1.658,
        ior2 = 1.750,
        name = 'Achromatic Doublet',
    ) {
        super(name);
        this.r1 = r1;
        this.r2 = r2;
        this.r3 = r3;
        this.t1 = t1;
        this.t2 = t2;
        this.apertureRadius = apertureRadius;
        this.ior1 = ior1;
        this.ior2 = ior2;
        const tTotal = t1 + t2 + AchromatDoublet.CEMENT_GAP;
        this.bounds.set(
            new Vector3(-apertureRadius, -apertureRadius, -tTotal / 2),
            new Vector3(apertureRadius, apertureRadius, tTotal / 2),
        );
    }

    get totalThickness(): number {
        return this.t1 + this.t2 + AchromatDoublet.CEMENT_GAP;
    }

    get cementZ(): number {
        return -this.totalThickness / 2 + this.t1;
    }

    getElement1Ior(wavelengthMeters: number): number {
        return cauchyIorFromReference(this.ior1, wavelengthMeters, { family: 'glass' });
    }

    getElement2Ior(wavelengthMeters: number): number {
        return cauchyIorFromReference(this.ior2, wavelengthMeters, { family: 'glass' });
    }

    public invalidateMesh(): void {
        this._mesh1 = null;
        this._mesh2 = null;
        this.version++;
    }

    private buildSubMesh(
        R_front: number,
        R_back: number,
        thickness: number,
        zOffset: number,
    ): OpticMesh {
        const mesh = new OpticMesh();
        const segments = 64;

        const profilePoints = SphericalLens.generateProfile(
            R_front, R_back, this.apertureRadius, thickness, segments,
        );
        for (const p of profilePoints) {
            p.y += zOffset;
        }

        const geometry = new LatheGeometry(profilePoints, segments);
        geometry.rotateX(Math.PI / 2);

        const frontApex = -thickness / 2 + zOffset;
        const backApex = thickness / 2 + zOffset;
        const frontCenter = new Vector3(0, 0, frontApex + R_front);
        const backCenter = new Vector3(0, 0, backApex + R_back);

        const normalFn: NormalFn = (v: Vector3) => {
            const r = Math.sqrt(v.x * v.x + v.y * v.y);
            const maxR = this.apertureRadius;

            if (r > maxR - 0.01) {
                return new Vector3(v.x, v.y, 0).normalize();
            }

            const sagFrontZ = (() => {
                if (Math.abs(R_front) > 1e8) return frontApex;
                const val = R_front * R_front - r * r;
                if (val < 0) return frontApex;
                return (frontApex + R_front) - (R_front > 0 ? 1 : -1) * Math.sqrt(val);
            })();
            const sagBackZ = (() => {
                if (Math.abs(R_back) > 1e8) return backApex;
                const val = R_back * R_back - r * r;
                if (val < 0) return backApex;
                return (backApex + R_back) - (R_back > 0 ? 1 : -1) * Math.sqrt(val);
            })();

            const distToFront = Math.abs(v.z - sagFrontZ);
            const distToBack = Math.abs(v.z - sagBackZ);

            if (distToFront < distToBack) {
                if (Math.abs(R_front) > 1e8) return new Vector3(0, 0, -1);
                return v.clone().sub(frontCenter).normalize();
            } else {
                if (Math.abs(R_back) > 1e8) return new Vector3(0, 0, 1);
                return v.clone().sub(backCenter).normalize();
            }
        };

        mesh.build(geometry, normalFn);
        return mesh;
    }

    get mesh1(): OpticMesh {
        if (!this._mesh1) {
            const totalT = this.totalThickness;
            const zCenter1 = -totalT / 2 + this.t1 / 2;
            this._mesh1 = this.buildSubMesh(this.r1, this.r2, this.t1, zCenter1);
        }
        return this._mesh1;
    }

    get mesh2(): OpticMesh {
        if (!this._mesh2) {
            const totalT = this.totalThickness;
            const zCenter2 = -totalT / 2 + this.t1 + AchromatDoublet.CEMENT_GAP + this.t2 / 2;
            this._mesh2 = this.buildSubMesh(this.r2, this.r3, this.t2, zCenter2);
        }
        return this._mesh2;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const hit1 = this.mesh1.intersectRay(rayLocal.origin, rayLocal.direction);
        const hit2 = this.mesh2.intersectRay(rayLocal.origin, rayLocal.direction);

        if (!hit1 && !hit2) return null;

        const best = (!hit1) ? hit2!
            : (!hit2) ? hit1
            : (hit1.t < hit2.t) ? hit1 : hit2;

        return {
            t: best.t,
            point: best.point,
            normal: best.normal,
            localPoint: best.point.clone(),
            localNormal: best.normal.clone(),
        };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        const dirIn = hit.localDirection?.clone().normalize()
            ?? ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        const normalIn = hit.localNormal?.clone().normalize()
            ?? hit.normal.clone().transformDirection(this.worldToLocal).normalize();

        // Determine which element was hit based on Z position relative to cement
        const zHit = hit.localPoint!.z;
        const isElement1First = zHit <= this.cementZ + AchromatDoublet.CEMENT_GAP / 2;
        const element1Ior = this.getElement1Ior(ray.wavelength);
        const element2Ior = this.getElement2Ior(ray.wavelength);
        const firstMesh = isElement1First ? this.mesh1 : this.mesh2;
        const firstIor = isElement1First ? element1Ior : element2Ior;
        const secondMesh = isElement1First ? this.mesh2 : this.mesh1;
        const secondIor = isElement1First ? element2Ior : element1Ior;

        const R_ap = this.apertureRadius;
        const R2 = this.r2;
        const cZ = this.cementZ;

        const cementExteriorCallback = (pLocal: Vector3) => {
            const rSq = pLocal.x * pLocal.x + pLocal.y * pLocal.y;
            if (rSq > R_ap * R_ap - 0.01) return 1.0;

            const sagCementZ = (() => {
                if (Math.abs(R2) > 1e8) return cZ;
                const val = R2 * R2 - rSq;
                if (val < 0) return cZ;
                return (cZ + R2) - (R2 > 0 ? 1 : -1) * Math.sqrt(val);
            })();

            if (Math.abs(pLocal.z - sagCementZ) < 0.1 || Math.abs(pLocal.z - (sagCementZ + AchromatDoublet.CEMENT_GAP)) < 0.1) {
                return secondIor;
            }
            return 1.0;
        };

        // Refract through first element
        const result1 = firstMesh.interact(
            normalIn, dirIn, hit.localPoint!, firstIor,
            this.localToWorld, hit.point, ray,
            false, undefined, cementExteriorCallback
        );

        if (result1.rays.length === 0) return result1;

        // Take the main output ray
        const exitRay = result1.rays[0];
        if (exitRay.intensity <= 0) return result1;

        // Transform exit ray to local space for intersection with second element
        const exitDirLocal = cleanVec(
            exitRay.direction.clone().transformDirection(this.worldToLocal),
        ).normalize();
        const exitOriginLocal = cleanVec(
            exitRay.origin.clone().applyMatrix4(this.worldToLocal),
        );

        // Find intersection with second element
        const hit2 = secondMesh.intersectRay(exitOriginLocal, exitDirLocal);
        if (!hit2) {
            return result1;
        }

        // Trace through second element
        const normal2 = hit2.normal.clone();
        const result2 = secondMesh.interact(
            normal2, exitDirLocal, hit2.point, secondIor,
            this.localToWorld,
            hit2.point.clone().applyMatrix4(this.localToWorld),
            exitRay,
            false, undefined, cementExteriorCallback
        );

        // Combine: element 2's output rays + element 1's Fresnel reflections
        const reflections1 = result1.rays.slice(1);
        return {
            rays: [...result2.rays, ...reflections1],
        };
    }

    // ========================================================================
    // Profile generation for visualization
    // ========================================================================

    generateSplitProfiles(segments = 32): [Vector2[], Vector2[]] {
        const totalT = this.totalThickness;
        const frontApex = -totalT / 2;
        const backApex = totalT / 2;
        const cZ = this.cementZ;
        const R1 = this.r1;
        const R2 = this.r2;
        const R3 = this.r3;

        const sag = (R: number, apex: number, r: number): number => {
            if (Math.abs(R) > 1e8) return apex;
            const val = R * R - r * r;
            if (val < 0) return apex;
            return (apex + R) - (R > 0 ? 1 : -1) * Math.sqrt(val);
        };

        let maxR = this.apertureRadius;
        for (let i = 0; i <= segments; i++) {
            const r = (i / segments) * this.apertureRadius;
            if (sag(R3, backApex, r) - sag(R1, frontApex, r) < 0) {
                let lo = ((i - 1) / segments) * this.apertureRadius;
                let hi = r;
                for (let j = 0; j < 20; j++) {
                    const mid = (lo + hi) / 2;
                    if (sag(R3, backApex, mid) - sag(R1, frontApex, mid) > 0) lo = mid; else hi = mid;
                }
                maxR = lo;
                break;
            }
        }

        const frontPts: Vector2[] = [];
        const cementPts: Vector2[] = [];
        const backPts: Vector2[] = [];
        for (let i = 0; i <= segments; i++) {
            const r = (i / segments) * maxR;
            const fz = sag(R1, frontApex, r);
            const bz = sag(R3, backApex, r);
            const rawCement = sag(R2, cZ, r);
            const clamped = Math.max(fz, Math.min(bz, rawCement));
            frontPts.push(new Vector2(r, fz));
            cementPts.push(new Vector2(r, clamped));
            backPts.push(new Vector2(r, bz));
        }

        const edgeFrontZ = frontPts[frontPts.length - 1].y;
        const edgeCementZ = cementPts[cementPts.length - 1].y;
        const edgeBackZ = backPts[backPts.length - 1].y;

        const front: Vector2[] = [...frontPts];
        front.push(new Vector2(maxR, edgeFrontZ));
        front.push(new Vector2(maxR, edgeCementZ));
        front.push(...[...cementPts].reverse());

        const back: Vector2[] = [...cementPts];
        back.push(new Vector2(maxR, edgeCementZ));
        back.push(new Vector2(maxR, edgeBackZ));
        back.push(...[...backPts].reverse());

        return [front, back];
    }

    generateCombinedProfile(segments = 32): Vector2[] {
        const totalT = this.totalThickness;
        const frontApex = -totalT / 2;
        const backApex = totalT / 2;
        const R1 = this.r1;
        const R3 = this.r3;

        const sagFront = (r: number): number => {
            if (Math.abs(R1) > 1e8) return frontApex;
            const val = R1 * R1 - r * r;
            if (val < 0) return frontApex;
            return (frontApex + R1) - (R1 > 0 ? 1 : -1) * Math.sqrt(val);
        };
        const sagBack = (r: number): number => {
            if (Math.abs(R3) > 1e8) return backApex;
            const val = R3 * R3 - r * r;
            if (val < 0) return backApex;
            return (backApex + R3) - (R3 > 0 ? 1 : -1) * Math.sqrt(val);
        };

        let maxR = this.apertureRadius;
        for (let i = 0; i <= segments; i++) {
            const r = (i / segments) * this.apertureRadius;
            if (sagBack(r) - sagFront(r) < 0) {
                let lo = ((i - 1) / segments) * this.apertureRadius;
                let hi = r;
                for (let j = 0; j < 20; j++) {
                    const mid = (lo + hi) / 2;
                    if (sagBack(mid) - sagFront(mid) > 0) lo = mid; else hi = mid;
                }
                maxR = lo;
                break;
            }
        }

        const frontPoints: Vector2[] = [];
        const backPoints: Vector2[] = [];
        for (let i = 0; i <= segments; i++) {
            const r = (i / segments) * maxR;
            frontPoints.push(new Vector2(r, sagFront(r)));
            backPoints.push(new Vector2(r, sagBack(r)));
        }

        const profile: Vector2[] = [...frontPoints];
        const edgeFrontZ = frontPoints[frontPoints.length - 1].y;
        const edgeBackZ = backPoints[backPoints.length - 1].y;
        profile.push(new Vector2(maxR, edgeFrontZ));
        profile.push(new Vector2(maxR, edgeBackZ));
        profile.push(...backPoints.reverse());

        return profile;
    }

    generateCementProfile(segments = 32): Vector2[] {
        const cZ = this.cementZ;
        const R2 = this.r2;

        const sagCement = (r: number): number => {
            if (Math.abs(R2) > 1e8) return cZ;
            const val = R2 * R2 - r * r;
            if (val < 0) return cZ;
            return (cZ + R2) - (R2 > 0 ? 1 : -1) * Math.sqrt(val);
        };

        const points: Vector2[] = [];
        for (let i = 0; i <= segments; i++) {
            const r = (i / segments) * this.apertureRadius;
            points.push(new Vector2(r, sagCement(r)));
        }
        return points;
    }

    getParaxialTransform(): [number, number, number, number] {
        const n1 = this.ior1;
        const n2 = this.ior2;
        const R1 = this.r1;
        const R2 = this.r2;
        const R3 = this.r3;
        const t1 = this.t1;
        const t2 = this.t2;

        // 3 refraction surfaces + 2 propagation steps
        // S1: air->crown, S2: crown->flint, S3: flint->air
        const C1 = -(n1 - 1) / R1;
        const C2 = -(n2 - n1) / R2;
        const C3 = (n2 - 1) / R3;
        const B1 = t1 / n1;
        const B2 = t2 / n2;

        // Chain: M3 * Mprop2 * M2 * Mprop1 * M1
        // Each refraction: [[1,0],[C,1]], propagation: [[1,B],[0,1]]
        let a = 1, b = 0, c = 0, d = 1;

        // M1
        const a1 = a + b * C1, b1 = b, c1 = c + d * C1, d1 = d;
        // Mprop1
        const a2 = a1 + b1 * 0, b2 = a1 * B1 + b1, c2 = c1 + d1 * 0, d2 = c1 * B1 + d1;
        // M2
        const a3 = a2 + b2 * C2, b3 = b2, c3 = c2 + d2 * C2, d3 = d2;
        // Mprop2
        const a4 = a3 + b3 * 0, b4 = a3 * B2 + b3, c4 = c3 + d3 * 0, d4 = c3 * B2 + d3;
        // M3
        const A = a4 + b4 * C3, B = b4, C = c4 + d4 * C3, D = d4;

        return [A, B, C, D];
    }

    getApertureRadius(): number {
        return this.apertureRadius;
    }
}
