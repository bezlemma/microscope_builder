import { useMemo } from 'react';
import { Vector3, BufferGeometry, Float32BufferAttribute } from 'three';
import { OpticalComponent } from '../physics/Component';
import { Ray, HitRecord, InteractionResult } from '../physics/types';
import { OpticMesh, NormalFn } from '../physics/OpticMesh';
import { MaterialDef, DispersionFormula, calculateRefractiveIndex } from '../physics/Dispersion';

/**
 * 
 * X-forward convention:
 *   - Triangle cross-section in XY plane (visible from top-down Z view)
 *   - Apex at +X, base at -X
 *   - Extrudes along Z (prism "width" / height on table)
 *   - Beam enters along +X through the angled faces
 *
 * Local Origin (0,0,0) is center of prism (centroid).
 */
export class PrismLens extends OpticalComponent {
    public apexAngle: number;    // Full apex angle in radians (default: 60° = π/3)
    public height: number;       // Height from base to apex (X extent in local space)
    public width: number;        // Extrusion depth (Z extent — glass thickness on table)
    public ior: number;          // Base IOR at sodium D-line (589nm)

    // ─── Dispersion / Material ────────────────────────────────────────
    public material: MaterialDef | null = null;

    private _mesh: OpticMesh | null = null;

    constructor(
        apexAngle: number = Math.PI / 3,
        height: number = 20,
        width: number = 20,
        name: string = "Prism",
        ior: number = 1.5168
    ) {
        super(name);
        this.apexAngle = apexAngle;
        this.height = height;
        this.width = width;
        this.ior = ior;
    }

    /**
     * Compute the three cross-section vertices of the triangular prism in X-Y plane.
     * Origin-centered: centroid at (0, 0).
     * 
     * For an equilateral prism (60°):
     *   apex at +X, base at -X
     *   front face: apex → baseLeft (upper angled face)
     *   back face:  apex → baseRight (lower angled face)
     *   base face:  flat at -X
     *
     * Returns [X, Y] pairs.
     */
    private getTriangleVertices(): { apex: [number, number]; baseLeft: [number, number]; baseRight: [number, number] } {
        const halfAngle = this.apexAngle / 2;
        // Base half-width from apex angle and height
        const baseHalfWidth = this.height * Math.tan(halfAngle);

        // Triangle vertices (X, Y):
        //   apex:      (height * 2/3 from centroid, 0) — pointing along +X
        //   baseLeft:  (-height * 1/3, -baseHalfWidth)
        //   baseRight: (-height * 1/3, +baseHalfWidth)
        const centroidXOffset = this.height / 3;  // Centroid is 1/3 from base

        const apex: [number, number] = [this.height - centroidXOffset, 0];
        const baseLeft: [number, number] = [-centroidXOffset, -baseHalfWidth];
        const baseRight: [number, number] = [-centroidXOffset, baseHalfWidth];

        return { apex, baseLeft, baseRight };
    }

    get mesh(): OpticMesh {
        if (!this._mesh) {
            this._mesh = new OpticMesh();
            const geometry = this.buildGeometry();

            const { apex, baseLeft, baseRight } = this.getTriangleVertices();
            const halfW = this.width / 2;

            // Compute face normals for the three rectangular faces
            // Front face: apex → baseLeft edge (in XY plane)
            const frontEdge = new Vector3(baseLeft[0] - apex[0], baseLeft[1] - apex[1], 0);
            const frontNormal = new Vector3(-frontEdge.y, frontEdge.x, 0).normalize();

            // Back face: apex → baseRight edge (in XY plane)
            const backEdge = new Vector3(baseRight[0] - apex[0], baseRight[1] - apex[1], 0);
            const backNormal = new Vector3(backEdge.y, -backEdge.x, 0).normalize();

            // Base face: flat left side (-X direction)
            const baseNormal = new Vector3(-1, 0, 0);

            // Vertex layout (see buildGeometry):
            //   0..2:   bottom end cap (3 verts, z = -halfW)
            //   3..5:   top end cap (3 verts, z = +halfW)
            //   6..9:   front face (4 verts)
            //  10..13:  back face (4 verts)
            //  14..17:  base face (4 verts)
            const normalFn: NormalFn = (v: Vector3, vertexIndex?: number) => {
                if (vertexIndex !== undefined) {
                    if (vertexIndex < 3) return new Vector3(0, 0, -1);       // Bottom cap
                    if (vertexIndex < 6) return new Vector3(0, 0, 1);        // Top cap
                    if (vertexIndex < 10) return frontNormal.clone();         // Front face
                    if (vertexIndex < 14) return backNormal.clone();          // Back face
                    return baseNormal.clone();                                // Base face
                }

                // Fallback: classify by signed distance (for runtime intersection normals)
                const frontDist = this.signedDistToLine(v.x, v.y, apex, baseLeft);
                const backDist = this.signedDistToLine(v.x, v.y, apex, baseRight);
                const baseDist = Math.abs(v.x - baseLeft[0]);

                // Check end caps (z = ±halfW)
                if (Math.abs(Math.abs(v.z) - halfW) < 0.01 &&
                    Math.abs(frontDist) > 0.1 && Math.abs(backDist) > 0.1 && baseDist > 0.1) {
                    return new Vector3(0, 0, Math.sign(v.z));
                }

                const minDist = Math.min(Math.abs(frontDist), Math.abs(backDist), baseDist);
                if (Math.abs(frontDist) === minDist) return frontNormal.clone();
                if (Math.abs(backDist) === minDist) return backNormal.clone();
                return baseNormal.clone();
            };

            this._mesh.build(geometry, normalFn);
        }
        return this._mesh;
    }

    /**
     * Signed distance from point (px, py) to line through (x1, y1) and (x2, y2).
     * Positive = right side of the line (when looking from p1 to p2).
     */
    private signedDistToLine(px: number, py: number, p1: [number, number], p2: [number, number]): number {
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-10) return 0;
        // Cross product gives signed distance * len
        return ((px - p1[0]) * dy - (py - p1[1]) * dx) / len;
    }

    /**
     * Build a triangular prism BufferGeometry.
     * Triangle in XY plane, extruded along Z.
     * Two triangular end caps + three rectangular side faces.
     */
    private buildGeometry(): BufferGeometry {
        const { apex, baseLeft, baseRight } = this.getTriangleVertices();
        const halfW = this.width / 2;

        const positions: number[] = [];
        const indices: number[] = [];

        // We need separate vertices per face for correct normals

        // --- Bottom end cap (z = -halfW) ---
        const lcApex = positions.length / 3;
        positions.push(apex[0], apex[1], -halfW);
        positions.push(baseLeft[0], baseLeft[1], -halfW);
        positions.push(baseRight[0], baseRight[1], -halfW);
        indices.push(lcApex, lcApex + 2, lcApex + 1); // CCW from -Z side

        // --- Top end cap (z = +halfW) ---
        const rcApex = positions.length / 3;
        positions.push(apex[0], apex[1], halfW);
        positions.push(baseLeft[0], baseLeft[1], halfW);
        positions.push(baseRight[0], baseRight[1], halfW);
        indices.push(rcApex, rcApex + 1, rcApex + 2); // CCW from +Z side

        // --- Front face (apex → baseLeft, extruded along Z) ---
        const ffOffset = positions.length / 3;
        positions.push(apex[0], apex[1], -halfW);         // 0
        positions.push(apex[0], apex[1], halfW);            // 1
        positions.push(baseLeft[0], baseLeft[1], -halfW);   // 2
        positions.push(baseLeft[0], baseLeft[1], halfW);    // 3
        indices.push(ffOffset, ffOffset + 2, ffOffset + 1);
        indices.push(ffOffset + 1, ffOffset + 2, ffOffset + 3);

        // --- Back face (apex → baseRight, extruded along Z) ---
        const bfOffset = positions.length / 3;
        positions.push(apex[0], apex[1], -halfW);           // 0
        positions.push(apex[0], apex[1], halfW);             // 1
        positions.push(baseRight[0], baseRight[1], -halfW);  // 2
        positions.push(baseRight[0], baseRight[1], halfW);   // 3
        indices.push(bfOffset, bfOffset + 1, bfOffset + 2);
        indices.push(bfOffset + 1, bfOffset + 3, bfOffset + 2);

        // --- Base face (baseLeft → baseRight, extruded along Z) ---
        const basOffset = positions.length / 3;
        positions.push(baseLeft[0], baseLeft[1], -halfW);    // 0
        positions.push(baseLeft[0], baseLeft[1], halfW);     // 1
        positions.push(baseRight[0], baseRight[1], -halfW);  // 2
        positions.push(baseRight[0], baseRight[1], halfW);   // 3
        indices.push(basOffset, basOffset + 1, basOffset + 2);
        indices.push(basOffset + 1, basOffset + 3, basOffset + 2);

        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        return geometry;
    }

    public invalidateMesh(): void {
        this._mesh = null;
        this.version++;
    }

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
     * Classify a triangle face index into a semantic surface name.
     * The geometry has 8 triangles total:
     *   face 0:   bottom end cap
     *   face 1:   top end cap
     *   face 2-3: front face (apex → baseLeft)
     *   face 4-5: back face (apex → baseRight)
     *   face 6-7: base face (baseLeft → baseRight)
     */
    classifyFace(faceIndex: number): string {
        const name = this.name || 'Prism';
        if (faceIndex <= 1) return `${name}:endcap`;
        if (faceIndex <= 3) return `${name}:front`;
        if (faceIndex <= 5) return `${name}:back`;
        return `${name}:base`;
    }

    // Dispersion: uses Sellmeier material when set, falls back to Cauchy.
    getIOR(wavelengthMeters: number): number {
        if (this.material && this.material.formula !== DispersionFormula.NONE) {
            return calculateRefractiveIndex(this.material, wavelengthMeters * 1e9);
        }
        // Cauchy fallback: n(λ) = A + B/λ²
        const wlNm = wavelengthMeters * 1e9;
        const B = 12000;
        const A = this.ior - B / (589 * 589);
        return A + B / (wlNm * wlNm);
    }

    setMaterial(material: MaterialDef): void {
        this.material = material;
        this.ior = material.n;
        this.invalidateMesh();
    }

    clearMaterial(): void {
        this.material = null;
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Use raw local-space values stored during chkIntersection to avoid
        // floating-point errors from world↔local rotation matrix round-trips.
        const dirIn = hit.localDirection?.clone().normalize()
            ?? ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        const normalIn = hit.localNormal?.clone().normalize()
            ?? hit.normal.clone().transformDirection(this.worldToLocal).normalize();

        const effectiveIOR = this.getIOR(ray.wavelength);

        return this.mesh.interact(
            normalIn,
            dirIn,
            hit.localPoint!,
            effectiveIOR,
            this.localToWorld,
            hit.point,
            ray,
            true, // allowInternalReflection — prisms can TIR
            (faceIndex) => this.classifyFace(faceIndex)
        );
    }

    /**
     * Compute anamorphic ABCD matrices for a ray passing through the prism.
     *
     * @param worldDir Incoming ray direction (world space)
     * @returns Tangential and sagittal ABCD tuples [A,B,C,D]
     *
     * Physics:
     *  - Entry surface: tangential magnification cos(θ₂)/cos(θ₁)
     *  - Exit surface:  tangential magnification cos(θ₄)/cos(θ₃)
     *  - Internal propagation distance d between the two faces
     *  - Sagittal plane: no angular magnification, just propagation d/n
     */
    getABCD_for_ray(worldDir: Vector3, wavelengthSI?: number): {
        abcdTangential: [number, number, number, number];
        abcdSagittal: [number, number, number, number];
    } {
        const identity: [number, number, number, number] = [1, 0, 0, 1];

        // Transform world direction into prism local frame
        const localDir = worldDir.clone().transformDirection(this.worldToLocal).normalize();

        // Get prism face normals in local space (X-Y plane, outward-pointing)
        const { apex, baseLeft, baseRight } = this.getTriangleVertices();

        // Front face normal (same computation as in mesh getter)
        const frontEdge = new Vector3(baseLeft[0] - apex[0], baseLeft[1] - apex[1], 0);
        const frontNormal = new Vector3(-frontEdge.y, frontEdge.x, 0).normalize();

        // Back face normal
        const backEdge = new Vector3(baseRight[0] - apex[0], baseRight[1] - apex[1], 0);
        const backNormal = new Vector3(backEdge.y, -backEdge.x, 0).normalize();

        // Determine which face the beam enters (the one it hits first)
        // Entry face is the one whose outward normal opposes the beam direction
        const frontDot = localDir.dot(frontNormal);
        const backDot = localDir.dot(backNormal);

        let entryNormal: Vector3, exitNormal: Vector3;
        if (frontDot < backDot) {
            entryNormal = frontNormal;
            exitNormal = backNormal;
        } else {
            entryNormal = backNormal;
            exitNormal = frontNormal;
        }

        // Entry surface: Snell's law
        const cosTheta1 = Math.abs(localDir.dot(entryNormal));
        if (cosTheta1 < 0.01) return { abcdTangential: identity, abcdSagittal: identity };

        const sinTheta1 = Math.sqrt(1 - cosTheta1 * cosTheta1);
        const ior = wavelengthSI ? this.getIOR(wavelengthSI) : this.ior;
        const sinTheta2 = sinTheta1 / ior;
        if (sinTheta2 >= 1) return { abcdTangential: identity, abcdSagittal: identity }; // TIR
        const cosTheta2 = Math.sqrt(1 - sinTheta2 * sinTheta2);

        // Internal direction (refracted) — compute for path length estimation
        const n = entryNormal.clone().multiplyScalar(-Math.sign(localDir.dot(entryNormal)));
        const internalDir = localDir.clone().multiplyScalar(1 / ior)
            .add(n.clone().multiplyScalar(cosTheta1 / ior - cosTheta2));
        internalDir.normalize();

        // Exit surface: angle of incidence inside
        const cosTheta3 = Math.abs(internalDir.dot(exitNormal));
        if (cosTheta3 < 0.01) return { abcdTangential: identity, abcdSagittal: identity };

        const sinTheta3 = Math.sqrt(1 - cosTheta3 * cosTheta3);
        const sinTheta4 = sinTheta3 * ior;
        if (sinTheta4 >= 1) return { abcdTangential: identity, abcdSagittal: identity }; // TIR
        const cosTheta4 = Math.sqrt(1 - sinTheta4 * sinTheta4);

        // Internal path length (approximate)
        const d = this.height * 0.6;

        // Combined ABCD (exit × propagation × entry)
        const A_t = (cosTheta4 * cosTheta2) / (cosTheta3 * cosTheta1);
        const B_t = d * cosTheta4 * cosTheta1 / (ior * cosTheta3 * cosTheta2);
        const C_t = 0;
        const D_t = (cosTheta3 * cosTheta1) / (cosTheta4 * cosTheta2);

        const A_s = 1;
        const B_s = d / ior;
        const C_s = 0;
        const D_s = 1;

        return {
            abcdTangential: [A_t, B_t, C_t, D_t],
            abcdSagittal: [A_s, B_s, C_s, D_s]
        };
    }
    //TODO: IS this right? Light usually travels in both directions the same, why would this be different?
    /** Override: prism has anamorphic ABCD that depends on ray direction and wavelength */
    getComponentABCD(rayDirection?: Vector3, wavelengthSI?: number): {
        abcdX: [number, number, number, number];
        abcdY: [number, number, number, number];
        apertureRadius: number;
    } {
        if (rayDirection) {
            const { abcdTangential, abcdSagittal } = this.getABCD_for_ray(rayDirection, wavelengthSI);
            // Prism's tangential plane (plane of incidence) is X-Y → maps to qy.
            return { abcdX: abcdSagittal, abcdY: abcdTangential, apertureRadius: 0 };
        }
        return { abcdX: [1, 0, 0, 1], abcdY: [1, 0, 0, 1], apertureRadius: 0 };
    }
}

// --- Visualizer ----------------------------------------------------

export const PrismVisualizer = ({ component }: { component: PrismLens }) => {
    if (!component || !component.rotation || !component.position) return null;

    const halfAngle = component.apexAngle / 2;
    const baseHalfWidth = component.height * Math.tan(halfAngle);
    const centroidX = component.height / 3;
    const halfW = component.width / 2;

    const geometry = useMemo(() => {
        // Triangle in XY plane, extruded along Z
        const ax = component.height - centroidX, ay = 0;        // apex
        const blx = -centroidX, bly = -baseHalfWidth;            // base left
        const brx = -centroidX, bry = baseHalfWidth;              // base right

        const positions = [
            // Bottom cap (z = -halfW)
            ax, ay, -halfW,  blx, bly, -halfW,  brx, bry, -halfW,
            // Top cap (z = +halfW)
            ax, ay, halfW,   blx, bly, halfW,   brx, bry, halfW,
            // Front face (apex → baseLeft, extruded along Z)
            ax, ay, -halfW,  ax, ay, halfW,  blx, bly, -halfW,  blx, bly, halfW,
            // Back face (apex → baseRight, extruded along Z)
            ax, ay, -halfW,  ax, ay, halfW,  brx, bry, -halfW,  brx, bry, halfW,
            // Base face (baseLeft → baseRight, extruded along Z)
            blx, bly, -halfW,  blx, bly, halfW,  brx, bry, -halfW,  brx, bry, halfW,
        ];
        const indices = [0, 2, 1, 3, 4, 5, 6, 8, 7, 7, 8, 9, 10, 11, 12, 11, 13, 12, 14, 15, 16, 15, 17, 16];

        // Front face normal (perpendicular to apex→baseLeft edge in XY)
        const frontDx = blx - ax, frontDy = bly - ay;
        const frontLen = Math.sqrt(frontDx * frontDx + frontDy * frontDy);
        const fnX = -frontDy / frontLen, fnY = frontDx / frontLen;

        // Back face normal
        const backDx = brx - ax, backDy = bry - ay;
        const backLen = Math.sqrt(backDx * backDx + backDy * backDy);
        const bnX = backDy / backLen, bnY = -backDx / backLen;

        const normals = [
            0, 0, -1,  0, 0, -1,  0, 0, -1,      // Bottom cap
            0, 0, 1,   0, 0, 1,   0, 0, 1,        // Top cap
            fnX, fnY, 0,  fnX, fnY, 0,  fnX, fnY, 0,  fnX, fnY, 0,  // Front
            bnX, bnY, 0,  bnX, bnY, 0,  bnX, bnY, 0,  bnX, bnY, 0,  // Back
            -1, 0, 0,  -1, 0, 0,  -1, 0, 0,  -1, 0, 0,              // Base
        ];

        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
        geo.setIndex(indices);
        return geo;
    }, [component.apexAngle, component.height, component.width]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh geometry={geometry}>
                <meshPhysicalMaterial
                    color="#ccffff"
                    transmission={0.99}
                    opacity={0.6}
                    transparent
                    roughness={0}
                    side={2}
                    depthWrite={false}
                />
            </mesh>
        </group>
    );
};