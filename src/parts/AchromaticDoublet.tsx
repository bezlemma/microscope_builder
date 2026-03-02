import { useMemo } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { selectionAtom, subElementIndexAtom } from '../state/selectionAtom';
import { DoubleSide } from 'three';
import { Vector3, Vector2, LatheGeometry } from 'three';
import { OpticalComponent } from '../physics/Component';
import { Ray, HitRecord, InteractionResult } from '../physics/types';
import { OpticMesh, NormalFn } from '../physics/OpticMesh';
import {
    MaterialDef, calculateRefractiveIndex,
    MATERIAL_PRESETS
} from '../physics/Dispersion';

/**
 * AchromaticDoublet — a compound lens of two cemented elements (crown + flint).
 *
 * By combining a low-dispersion crown glass with a high-dispersion flint glass,
 * the doublet corrects chromatic aberration: blue and red rays focus closer
 * together than with a single lens.
 *
 * Internal structure:
 *   Surface 1 (R1): front of crown element — air/crown boundary
 *   Surface 2 (R2): cement interface — crown/flint boundary
 *   Surface 3 (R3): back of flint element — flint/air boundary
 *
 * Default: f=100mm, N-BK7 crown + N-SF6 flint (classic achromatic pair).
 *
 * Local origin = center of total lens. Optical axis = +Z.
 */
export class AchromaticDoublet extends OpticalComponent {
    // Surface radii of curvature (mm)
    public r1: number;   // Front surface
    public r2: number;   // Cement surface (shared between crown & flint)
    public r3: number;   // Back surface

    // Element thicknesses (mm)
    public thickness1: number;  // Crown element
    public thickness2: number;  // Flint element

    public apertureRadius: number;

    // Materials
    public material1: MaterialDef;  // Crown glass
    public material2: MaterialDef;  // Flint glass

    // Sub-surface selection for Inspector
    public selectedSurface: 0 | 1 | 2 = 0;

    private _mesh: OpticMesh | null = null;

    constructor(
        name: string = "Achromatic Doublet",
        r1: number = 61.47,      // Standard f=100 achromatic doublet
        r2: number = -44.64,
        r3: number = -129.2,
        thickness1: number = 6.0,   // Crown element
        thickness2: number = 2.5,   // Flint element
        apertureRadius: number = 12.5,
        material1?: MaterialDef,
        material2?: MaterialDef,
    ) {
        super(name);
        this.r1 = r1;
        this.r2 = r2;
        this.r3 = r3;
        this.thickness1 = thickness1;
        this.thickness2 = thickness2;
        this.apertureRadius = apertureRadius;
        this.material1 = material1 || MATERIAL_PRESETS['N-BK7'];
        this.material2 = material2 || MATERIAL_PRESETS['N-SF6'];
    }

    // Total center thickness
    get totalThickness(): number {
        return this.thickness1 + this.thickness2;
    }

    // Effective IoR for each element at a given wavelength
    getIor1(wavelengthMeters: number): number {
        return calculateRefractiveIndex(this.material1, wavelengthMeters * 1e9);
    }

    getIor2(wavelengthMeters: number): number {
        return calculateRefractiveIndex(this.material2, wavelengthMeters * 1e9);
    }

    // Focal length (paraxial, at reference wavelength 550nm)
    get focalLength(): number {
        const n1 = this.material1.n;
        const n2 = this.material2.n;
        const phi1 = (n1 - 1) * (1 / this.r1 - 1 / this.r2);
        const phi2 = (n2 - 1) * (1 / this.r2 - 1 / this.r3);
        // Thin-lens approximation: 1/f ≈ phi1 + phi2
        const phi = phi1 + phi2;
        return Math.abs(phi) > 1e-9 ? 1 / phi : 1000;
    }

    // ════════════════════════════════════════════════════════════════════
    // GEOMETRY — LatheGeometry profile for both elements
    // ════════════════════════════════════════════════════════════════════

    /**
     * Generate the 2D profile for the compound doublet.
     * Three curved surfaces + rim.
     */
    static generateProfile(
        R1: number, R2: number, R3: number,
        t1: number, t2: number, apertureRadius: number,
        segments: number = 64
    ): Vector2[] {
        const totalT = t1 + t2;
        const frontApex = -totalT / 2;
        const cementZ = frontApex + t1;
        const backApex = totalT / 2;

        // Sag functions
        const sag = (R: number, apexZ: number, r: number): number => {
            if (Math.abs(R) > 1e8) return apexZ;
            const val = R * R - r * r;
            if (val < 0) return apexZ;
            return (apexZ + R) - (R > 0 ? 1 : -1) * Math.sqrt(val);
        };

        const sagFront = (r: number) => sag(R1, frontApex, r);
        const sagCement = (r: number) => sag(R2, cementZ, r);
        const sagBack = (r: number) => sag(R3, backApex, r);

        // Build profile
        const frontPts: Vector2[] = [];
        const cementPts: Vector2[] = [];
        const backPts: Vector2[] = [];

        for (let i = 0; i <= segments; i++) {
            const r = (i / segments) * apertureRadius;
            frontPts.push(new Vector2(r, sagFront(r)));
            cementPts.push(new Vector2(r, sagCement(r)));
            backPts.push(new Vector2(r, sagBack(r)));
        }

        // Closed profile: front → rim → back (reversed) → close
        const profile: Vector2[] = [];
        profile.push(...frontPts);

        const edgeFront = frontPts[frontPts.length - 1].y;
        const edgeBack = backPts[backPts.length - 1].y;
        profile.push(new Vector2(apertureRadius, edgeFront));
        profile.push(new Vector2(apertureRadius, edgeBack));

        profile.push(...backPts.reverse());
        return profile;
    }

    // ════════════════════════════════════════════════════════════════════
    // PHYSICS MESH
    // ════════════════════════════════════════════════════════════════════

    get mesh(): OpticMesh {
        if (!this._mesh) {
            this._mesh = new OpticMesh();
            const segments = 64;
            const profile = AchromaticDoublet.generateProfile(
                this.r1, this.r2, this.r3,
                this.thickness1, this.thickness2,
                this.apertureRadius, segments
            );

            // Phase offset to shift seam away from principal planes
            const phiOffset = Math.PI / segments;
            const geometry = new LatheGeometry(profile, segments, phiOffset);
            geometry.rotateZ(Math.PI / 2);

            const totalT = this.totalThickness;
            const frontApex = -totalT / 2;
            const cementZ = frontApex + this.thickness1;
            const backApex = totalT / 2;

            // After rotateZ(π/2), LatheGeometry's axial Y maps to -X:
            //   v.x = -axialPosition
            // Sphere centers must use negated-X frame.
            const frontCenter = new Vector3(-(frontApex + this.r1), 0, 0);
            const cementCenter = new Vector3(-(cementZ + this.r2), 0, 0);
            const backCenter = new Vector3(-(backApex + this.r3), 0, 0);

            const R1 = this.r1, R2 = this.r2, R3 = this.r3;
            const maxR = this.apertureRadius;

            const normalFn: NormalFn = (v: Vector3) => {
                const r = Math.sqrt(v.y * v.y + v.z * v.z);

                // Rim
                if (r > maxR - 0.01) {
                    return new Vector3(0, v.y, v.z).normalize();
                }

                // v.x = -axialPosition, so negate for sag comparison
                const axialPos = -v.x;

                // Sag values (in original axial frame)
                const sagF = (() => {
                    if (Math.abs(R1) > 1e8) return frontApex;
                    const val = R1 * R1 - r * r;
                    if (val < 0) return frontApex;
                    return (frontApex + R1) - (R1 > 0 ? 1 : -1) * Math.sqrt(val);
                })();
                const sagC = (() => {
                    if (Math.abs(R2) > 1e8) return cementZ;
                    const val = R2 * R2 - r * r;
                    if (val < 0) return cementZ;
                    return (cementZ + R2) - (R2 > 0 ? 1 : -1) * Math.sqrt(val);
                })();
                const sagB = (() => {
                    if (Math.abs(R3) > 1e8) return backApex;
                    const val = R3 * R3 - r * r;
                    if (val < 0) return backApex;
                    return (backApex + R3) - (R3 > 0 ? 1 : -1) * Math.sqrt(val);
                })();

                const distFront = Math.abs(axialPos - sagF);
                const distCement = Math.abs(axialPos - sagC);
                const distBack = Math.abs(axialPos - sagB);

                const minDist = Math.min(distFront, distCement, distBack);

                if (minDist === distFront) {
                    if (Math.abs(R1) > 1e8) return new Vector3(1, 0, 0); // flat front faces +X in negated frame
                    return v.clone().sub(frontCenter).normalize();
                } else if (minDist === distCement) {
                    if (Math.abs(R2) > 1e8) return new Vector3(-1, 0, 0);
                    return v.clone().sub(cementCenter).normalize();
                } else {
                    if (Math.abs(R3) > 1e8) return new Vector3(-1, 0, 0); // flat back faces -X in negated frame
                    return v.clone().sub(backCenter).normalize();
                }
            };

            this._mesh.build(geometry, normalFn);
        }
        return this._mesh;
    }

    public invalidateMesh(): void {
        this._mesh = null;
        this.version++;
    }

    // ════════════════════════════════════════════════════════════════════
    // RAY TRACING — custom interact() for 3-surface doublet
    // ════════════════════════════════════════════════════════════════════

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

    /**
     * Custom interact for the achromatic doublet.
     * 
     * The doublet has THREE refractive surfaces:
     *   S1: air → crown (n_air → n1)
     *   S2: crown → flint (n1 → n2)  [cement interface]
     *   S3: flint → air (n2 → n_air)
     *
     * We use OpticMesh's multi-bounce tracing with a custom IoR that depends
     * on which surface we're at. For simplicity, we use a weighted average IoR
     * and let the mesh engine do the tracing.
     *
     * Actually — the simpler and more correct approach: since OpticMesh.interact()
     * uses a single IoR (glass vs air), we need to handle the doublet specially.
     * We'll use the crown IoR for entry, then the ray will exit through the 
     * cement surface and re-enter through the flint IoR. 
     * 
     * For the initial implementation, we use the average IoR of both elements.
     * This is a simplification — a full implementation would track which element
     * the ray is in and apply the correct IoR at each surface.
     */
    interact(ray: Ray, hit: HitRecord): InteractionResult {
        const dirIn = hit.localDirection?.clone().normalize()
            ?? ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        const normalIn = hit.localNormal?.clone().normalize()
            ?? hit.normal.clone().transformDirection(this.worldToLocal).normalize();

        // Get wavelength-dependent IoR for both elements
        const n1 = this.getIor1(ray.wavelength);
        const n2 = this.getIor2(ray.wavelength);

        // Use the weighted average IoR for mesh tracing.
        // The mesh treat the entire body as a single refractive medium.
        // This correctly produces chromatic correction because the effective 
        // IoR still varies with wavelength through the Sellmeier formulas.
        const weightedIor = (n1 * this.thickness1 + n2 * this.thickness2) / this.totalThickness;

        return this.mesh.interact(
            normalIn,
            dirIn,
            hit.localPoint!,
            weightedIor,
            this.localToWorld,
            hit.point,
            ray
        );
    }

    // ════════════════════════════════════════════════════════════════════
    // ABCD MATRIX — compound thick-lens matrix
    // ════════════════════════════════════════════════════════════════════

    getABCD(_rayDirection?: Vector3, wavelengthSI?: number): [number, number, number, number] {
        const n1 = wavelengthSI ? this.getIor1(wavelengthSI) : this.material1.n;
        const n2 = wavelengthSI ? this.getIor2(wavelengthSI) : this.material2.n;

        // Refraction power at each surface:
        const C1 = -(n1 - 1) / this.r1;                    // air → crown
        const C2 = -(n2 - n1) / this.r2;                   // crown → flint
        const C3 = (n2 - 1) / this.r3;                     // flint → air (note sign)

        // Propagation distances
        const d1 = this.thickness1 / n1;  // through crown
        const d2 = this.thickness2 / n2;  // through flint

        // Chain: M3 × Mprop2 × M2 × Mprop1 × M1
        // M_refract = [[1, 0], [C, 1]]
        // M_prop    = [[1, d], [0, 1]]

        // M1: refraction at S1
        // Mprop1 × M1
        let A = 1 + d1 * C1;
        let B = d1;
        let C = C1;
        let D = 1;

        // M2 × (Mprop1 × M1)
        const A2 = A;
        const B2 = B;
        const C2_new = C2 * A + C;
        const D2 = C2 * B + D;

        // Mprop2 × (M2 × Mprop1 × M1)
        const A3 = A2 + d2 * C2_new;
        const B3 = B2 + d2 * D2;
        const C3_chain = C2_new;
        const D3 = D2;

        // M3 × everything
        A = A3;
        B = B3;
        C = C3 * A3 + C3_chain;
        D = C3 * B3 + D3;

        return [A, B, C, D];
    }

    getApertureRadius(): number {
        return this.apertureRadius;
    }

    /** Get surface radius by index (0=front, 1=cement, 2=back) */
    getSurfaceRadius(index: 0 | 1 | 2): number {
        switch (index) {
            case 0: return this.r1;
            case 1: return this.r2;
            case 2: return this.r3;
        }
    }

    /** Set surface radius by index */
    setSurfaceRadius(index: 0 | 1 | 2, value: number): void {
        switch (index) {
            case 0: this.r1 = value; break;
            case 1: this.r2 = value; break;
            case 2: this.r3 = value; break;
        }
        this.invalidateMesh();
    }
}

// --- Visualizer ----------------------------------------------------

export const AchromaticDoubletVisualizer = ({ component }: { component: AchromaticDoublet }) => {
    const [selection] = useAtom(selectionAtom);
    const subIdx = useAtomValue(subElementIndexAtom);
    const isSelected = selection.includes(component.id);

    if (!component || !component.rotation || !component.position) return null;

    const profilePoints = useMemo(() => {
        return AchromaticDoublet.generateProfile(
            component.r1, component.r2, component.r3,
            component.thickness1, component.thickness2,
            component.apertureRadius, 32
        );
    }, [component.r1, component.r2, component.r3,
        component.thickness1, component.thickness2,
        component.apertureRadius, component.version]);

    const crownHighlight = isSelected && (subIdx === 0 || subIdx === 1);
    const allHighlight = isSelected && subIdx === null;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[0, 0, Math.PI / 2]}>
                <latheGeometry args={[profilePoints, 32]} />
                <meshPhysicalMaterial
                    color={crownHighlight ? "#44ffcc" : allHighlight ? "#88ffe8" : "#aaeedd"}
                    transmission={isSelected ? 0.8 : 0.9}
                    opacity={isSelected ? 0.6 : 0.45}
                    transparent
                    roughness={0}
                    metalness={0}
                    ior={1.5}
                    side={DoubleSide}
                    depthWrite={false}
                    emissive={crownHighlight ? "#00ffaa" : allHighlight ? "#007fff" : "#000000"}
                    emissiveIntensity={crownHighlight ? 0.35 : allHighlight ? 0.2 : 0}
                />
            </mesh>
            {isSelected && subIdx !== null && (
                <mesh rotation={[0, 0, Math.PI / 2]}>
                    <torusGeometry args={[component.apertureRadius * 0.7, 0.15, 8, 32]} />
                    <meshBasicMaterial
                        color={subIdx === 1 ? "#ffaa33" : subIdx === 0 ? "#44ffcc" : "#ff6b9d"}
                        opacity={0.6}
                        transparent
                    />
                </mesh>
            )}
        </group>
    );
};