import { useMemo } from 'react';
import { useAtom } from 'jotai';
import { selectionAtom } from '../state/selectionAtom';
import { DoubleSide, LatheGeometry } from 'three';
/**
 * AsphericLens — An aspheric singlet lens using Newton-Raphson iteration
 * for intersection and analytical gradient normals.
 *
 * The sag function for each surface is:
 *   z(r) = c·r² / (1 + √(1 - (1+k)·c²·r²)) + A4·r⁴ + A6·r⁶ + A8·r⁸ + A10·r¹⁰
 *
 * where c = 1/R (curvature), k = conic constant, and A4–A10 are polynomial coefficients.
 *
 * Local Origin (0,0,0) is center of lens. Optical axis = +Z.
 * Front vertex at z = -thickness/2, back vertex at z = +thickness/2.
 */
import { Vector3, Vector2 } from 'three';
import { OpticalComponent } from '../physics/Component';
import { Ray, HitRecord, InteractionResult } from '../physics/types';
import { OpticMesh } from '../physics/OpticMesh';
import { calculateRefractiveIndex, MaterialDef } from '../physics/Dispersion';

// ─── Aspheric surface parameters ────────────────────────────────────

export interface AsphericSurface {
    R: number;      // Radius of curvature (mm). Infinity = flat.
    k: number;      // Conic constant: 0 = sphere, -1 = parabola, <-1 = hyperbola, >0 = oblate
    A4: number;     // 4th-order deformation coefficient
    A6: number;     // 6th-order
    A8: number;     // 8th-order
    A10: number;    // 10th-order
}

// ─── Helper: sag + derivative ───────────────────────────────────────

function asphericSag(surf: AsphericSurface, r: number): number {
    const c = Math.abs(surf.R) > 1e8 ? 0 : 1 / surf.R;
    const r2 = r * r;
    const c2r2 = c * c * r2;
    const denom = 1 + (1 + surf.k) * c2r2;

    let z: number;
    if (Math.abs(c) < 1e-12) {
        z = 0; // flat
    } else if (denom <= 0) {
        // Outside the valid domain — just use polynomial terms
        z = c * r2 / 2;
    } else {
        z = c * r2 / (1 + Math.sqrt(1 - (1 + surf.k) * c2r2));
    }

    // Polynomial terms
    const r4 = r2 * r2;
    z += surf.A4 * r4 + surf.A6 * r4 * r2 + surf.A8 * r4 * r4 + surf.A10 * r4 * r4 * r2;
    return z;
}

/** Derivative of sag with respect to r (for Newton-Raphson and normals) */
function asphericSagDr(surf: AsphericSurface, r: number): number {
    const c = Math.abs(surf.R) > 1e8 ? 0 : 1 / surf.R;
    const r2 = r * r;
    const disc = 1 - (1 + surf.k) * c * c * r2;

    let dz_dr: number;
    if (Math.abs(c) < 1e-12) {
        dz_dr = 0;
    } else if (disc <= 0) {
        dz_dr = c * r;
    } else {
        dz_dr = c * r / Math.sqrt(disc);
    }

    // Polynomial derivative
    const r3 = r2 * r;
    dz_dr += 4 * surf.A4 * r3 + 6 * surf.A6 * r3 * r2 + 8 * surf.A8 * r3 * r2 * r2 + 10 * surf.A10 * r3 * r2 * r2 * r2;
    return dz_dr;
}

// ─── Newton-Raphson ray-aspheric intersection ──────────────────────

const NR_MAX_ITER = 20;
const NR_EPS = 1e-8;

/**
 * Find intersection of a ray with an aspheric surface using Newton-Raphson.
 * X-forward convention: surface at x = apex + sag(r) where r = sqrt(y² + z²).
 * Ray: P(t) = origin + t * direction
 * We solve: x(t) - apex - sag(r(t)) = 0
 */
function intersectAsphericSurface(
    origin: Vector3, dir: Vector3,
    apex: number, surf: AsphericSurface, apertureR: number
): { t: number; point: Vector3; normal: Vector3 } | null {
    // Initial guess: approximate as sphere
    const c = Math.abs(surf.R) > 1e8 ? 0 : 1 / surf.R;
    let t: number;

    if (Math.abs(c) < 1e-12) {
        // Flat surface — direct plane intersection at x = apex
        if (Math.abs(dir.x) < 1e-10) return null;
        t = (apex - origin.x) / dir.x;
    } else {
        // Spherical initial guess: sphere center at (apex + R, 0, 0)
        const center = apex + surf.R;
        const oc = new Vector3(origin.x - center, origin.y, origin.z);
        const a = dir.dot(dir);
        const b = 2 * oc.dot(dir);
        const cc = oc.dot(oc) - surf.R * surf.R;
        const disc = b * b - 4 * a * cc;
        if (disc < 0) {
            // No spherical intersection — try plane guess
            if (Math.abs(dir.x) < 1e-10) return null;
            t = (apex - origin.x) / dir.x;
        } else {
            const sqrtDisc = Math.sqrt(disc);
            const t1 = (-b - sqrtDisc) / (2 * a);
            const t2 = (-b + sqrtDisc) / (2 * a);
            // Pick the closer positive root
            if (t1 > 0.001 && t2 > 0.001) t = Math.min(t1, t2);
            else if (t1 > 0.001) t = t1;
            else if (t2 > 0.001) t = t2;
            else {
                // Try plane
                if (Math.abs(dir.x) < 1e-10) return null;
                t = (apex - origin.x) / dir.x;
            }
        }
    }

    if (t < 0.001) t = 0.001;

    // Newton-Raphson refinement
    for (let iter = 0; iter < NR_MAX_ITER; iter++) {
        const px = origin.x + t * dir.x;
        const py = origin.y + t * dir.y;
        const pz = origin.z + t * dir.z;
        const r = Math.sqrt(py * py + pz * pz);  // transverse distance in YZ

        if (r > apertureR * 1.2) return null; // Way outside aperture

        const sagVal = asphericSag(surf, r);
        const f = px - apex - sagVal; // Residual: x - apex - sag(r)

        if (Math.abs(f) < NR_EPS) break; // Converged

        // Derivative: df/dt = dx/dt - dsag/dt
        // = dir.x - (dsag/dr)(dr/dt)
        // dr/dt = (py*dir.y + pz*dir.z) / r  (for r > 0)
        const dsag_dr = asphericSagDr(surf, r);
        let dr_dt = 0;
        if (r > 1e-12) {
            dr_dt = (py * dir.y + pz * dir.z) / r;
        }
        const df_dt = dir.x - dsag_dr * dr_dt;

        if (Math.abs(df_dt) < 1e-15) break; // Degenerate

        t -= f / df_dt;

        if (t < 0) return null;
    }

    // Final point
    const hitX = origin.x + t * dir.x;
    const hitY = origin.y + t * dir.y;
    const hitZ = origin.z + t * dir.z;
    const hitR = Math.sqrt(hitY * hitY + hitZ * hitZ);  // transverse in YZ

    // Aperture check
    if (hitR > apertureR) return null;

    // Compute normal from surface gradient
    // Surface: F(x,y,z) = x - apex - sag(r) = 0, r = sqrt(y²+z²)
    // ∇F = (1, -∂sag/∂y, -∂sag/∂z)
    // ∂sag/∂y = (dsag/dr)(y/r), ∂sag/∂z = (dsag/dr)(z/r)
    const dsag = hitR > 1e-12 ? asphericSagDr(surf, hitR) : 0;
    const nx = 1;
    const ny = hitR > 1e-12 ? -dsag * hitY / hitR : 0;
    const nz = hitR > 1e-12 ? -dsag * hitZ / hitR : 0;
    const normal = new Vector3(nx, ny, nz).normalize();

    return { t, point: new Vector3(hitX, hitY, hitZ), normal };
}

// ─── AsphericLens Component ─────────────────────────────────────────

export class AsphericLens extends OpticalComponent {
    readonly componentType = 'asphericLens';

    apertureRadius: number;
    thickness: number;
    ior: number;

    front: AsphericSurface;
    back: AsphericSurface;

    // Material/dispersion (same pattern as SphericalLens)
    materialName: string = 'Custom';
    material: MaterialDef | null = null;

    private _mesh: OpticMesh | null = null;
    private _meshVersion = -1;

    constructor(
        apertureRadius: number = 12.5,
        thickness: number = 6,
        name: string = 'Aspheric Lens',
        ior: number = 1.5168
    ) {
        super(name);
        this.apertureRadius = apertureRadius;
        this.thickness = thickness;
        this.ior = ior;

        // Default: biconvex parabolic (k = -1 eliminates spherical aberration for one surface)
        this.front = { R: 50, k: -1, A4: 0, A6: 0, A8: 0, A10: 0 };
        this.back = { R: -50, k: 0, A4: 0, A6: 0, A8: 0, A10: 0 };
    }

    // ─── Mesh (for visualization only — intersection uses NR) ────────

    get mesh(): OpticMesh {
        if (this._mesh && this._meshVersion === this.version) return this._mesh;

        const profile = AsphericLens.generateProfile(
            this.front, this.back,
            this.apertureRadius, this.thickness, 48
        );

        const geo = new LatheGeometry(profile, 32);
        const normalFn = (v: Vector3): Vector3 => {
            const r = Math.sqrt(v.y * v.y + v.z * v.z);
            const frontZ = -this.thickness / 2 + asphericSag(this.front, r);
            const backZ = this.thickness / 2 + asphericSag(this.back, r);

            const isFront = Math.abs(v.z - frontZ) < Math.abs(v.z - backZ);
            const surf = isFront ? this.front : this.back;
            const dsag = r > 1e-12 ? asphericSagDr(surf, r) : 0;
            const nx = r > 1e-12 ? -dsag * v.x / r : 0;
            const ny = r > 1e-12 ? -dsag * v.y / r : 0;
            const normal = new Vector3(nx, ny, 1).normalize();
            if (!isFront) normal.negate();
            return normal;
        };

        const mesh = new OpticMesh();
        mesh.build(geo, normalFn);
        this._mesh = mesh;
        this._meshVersion = this.version;
        return this._mesh;
    }

    invalidateMesh(): void {
        this._mesh = null;
        this.version++;
    }

    // ─── Profile generation ─────────────────────────────────────────

    static generateProfile(
        front: AsphericSurface, back: AsphericSurface,
        apertureRadius: number, thickness: number,
        segments: number = 48
    ): Vector2[] {
        const frontApex = -thickness / 2;
        const backApex = thickness / 2;
        const points: Vector2[] = [];

        // Back surface (bottom to axis)
        for (let i = segments; i >= 0; i--) {
            const r = (i / segments) * apertureRadius;
            const z = backApex + asphericSag(back, r);
            points.push(new Vector2(r, z));
        }

        // Front surface (axis to top)
        for (let i = 0; i <= segments; i++) {
            const r = (i / segments) * apertureRadius;
            const z = frontApex + asphericSag(front, r);
            points.push(new Vector2(r, z));
        }

        // Close the rim
        const rimBackZ = backApex + asphericSag(back, apertureRadius);
        points.push(new Vector2(apertureRadius, rimBackZ));

        return points;
    }

    // ─── Intersection (Newton-Raphson, not mesh BVH) ────────────────

    intersect(rayLocal: Ray): HitRecord | null {
        const origin = rayLocal.origin;
        const dir = rayLocal.direction;
        const frontApex = -this.thickness / 2;
        const backApex = this.thickness / 2;

        // Try front surface first
        const hitFront = intersectAsphericSurface(origin, dir, frontApex, this.front, this.apertureRadius);
        // Try back surface
        const hitBack = intersectAsphericSurface(origin, dir, backApex, this.back, this.apertureRadius);

        // Pick the closer valid hit
        let best: { t: number; point: Vector3; normal: Vector3 } | null = null;

        if (hitFront && hitFront.t > 0.001) {
            best = hitFront;
        }
        if (hitBack && hitBack.t > 0.001) {
            if (!best || hitBack.t < best.t) {
                best = hitBack;
            }
        }

        if (!best) return null;

        return {
            t: best.t,
            point: best.point,
            normal: best.normal,
            localPoint: best.point.clone(),
        };
    }

    // ─── Effective IoR ──────────────────────────────────────────────

    getEffectiveIor(wavelengthMeters: number): number {
        if (this.material) {
            return calculateRefractiveIndex(
                this.material,
                wavelengthMeters * 1e9
            );
        }
        return this.ior;
    }

    setMaterial(material: MaterialDef): void {
        this.material = material;
        this.materialName = material.name;
        this.ior = calculateRefractiveIndex(material, 550);
        this.version++;
    }

    clearMaterial(): void {
        this.material = null;
        this.materialName = 'Custom';
    }

    // ─── Interaction ────────────────────────────────────────────────

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        const dirIn = hit.localDirection?.clone().normalize()
            ?? ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        const normalIn = hit.localNormal?.clone().normalize()
            ?? hit.normal.clone().transformDirection(this.worldToLocal).normalize();

        const effectiveIor = this.getEffectiveIor(ray.wavelength);

        return this.mesh.interact(
            normalIn, dirIn, hit.localPoint!,
            effectiveIor, this.localToWorld, hit.point, ray
        );
    }

    // ─── ABCD (paraxial approximation — same as spherical) ──────────

    getABCD(_rayDirection?: Vector3, wavelengthSI?: number): [number, number, number, number] {
        const R1 = this.front.R;
        const R2 = this.back.R;
        const n = wavelengthSI ? this.getEffectiveIor(wavelengthSI) : this.ior;
        const t = this.thickness;

        const C1 = -(n - 1) / R1;
        const C2 = (n - 1) / R2;
        const B_prop = t / n;

        const a1 = 1 + B_prop * C1;
        const b1 = B_prop;
        const c1 = C1;

        const A = a1;
        const B = b1;
        const C = C2 * a1 + c1;
        const D = C2 * b1 + 1;

        return [A, B, C, D];
    }

    get focalLength(): number {
        const [, , C] = this.getABCD();
        return Math.abs(C) > 1e-12 ? -1 / C : Infinity;
    }

    getApertureRadius(): number {
        return this.apertureRadius;
    }

    toJSON(): Record<string, any> {
        return {
            componentType: this.componentType,
            name: this.name,
            id: this.id,
            apertureRadius: this.apertureRadius,
            thickness: this.thickness,
            ior: this.ior,
            front: { ...this.front },
            back: { ...this.back },
            materialName: this.materialName,
        };
    }
}

// --- Visualizer ----------------------------------------------------

export const AsphericLensVisualizer = ({ component }: { component: AsphericLens }) => {
    const [selection] = useAtom(selectionAtom);
    const isSelected = selection.includes(component.id);

    if (!component || !component.rotation || !component.position) return null;

    const profilePoints = useMemo(() => {
        return AsphericLens.generateProfile(
            component.front, component.back,
            component.apertureRadius, component.thickness, 48
        );
    }, [component.front, component.back,
        component.apertureRadius, component.thickness, component.version]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[0, 0, Math.PI / 2]}>
                <latheGeometry args={[profilePoints, 32]} />
                <meshPhysicalMaterial
                    color={isSelected ? "#cc99ff" : "#bb88ee"}
                    transmission={isSelected ? 0.8 : 0.92}
                    opacity={isSelected ? 0.6 : 0.4}
                    transparent
                    roughness={0}
                    metalness={0}
                    ior={component.ior || 1.5}
                    side={DoubleSide}
                    depthWrite={false}
                    emissive={isSelected ? "#bb88ff" : "#000000"}
                    emissiveIntensity={isSelected ? 0.15 : 0}
                />
            </mesh>
        </group>
    );
};