import { Vector3, BufferGeometry, Float32BufferAttribute } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { OpticMesh, NormalFn } from '../OpticMesh';

/**
 * PrismLens - A triangular prism for dispersion demonstrations.
 * 
 * Equilateral (or custom angle) triangular cross-section, extruded
 * along the X axis. All faces are flat → normals are face-constant.
 * 
 * Local Origin (0,0,0) is center of prism. Optical axis = +Z.
 * The prism cross-section is in the Y-Z plane:
 *   - Front face: angled, facing -Z (toward incoming light)
 *   - Back face: angled, facing +Z (toward exiting light)
 *   - Bottom face: flat, facing -Y
 * 
 * The apex (top vertex) is at +Y, the base is at -Y.
 */
export class PrismLens extends OpticalComponent {
    public apexAngle: number;    // Full apex angle in radians (default: 60° = π/3)
    public height: number;       // Height from base to apex (Y extent)
    public width: number;        // Extrusion depth (X extent)
    public ior: number;          // Base IOR at sodium D-line (589nm)



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
     * Compute the three cross-section vertices of the triangular prism in Y-Z plane.
     * Origin-centered: centroid at (0, 0).
     * 
     * For an equilateral prism (60°):
     *   apex at top (+Y), base at bottom (-Y)
     *   front face: left side, back face: right side
     */
    private getTriangleVertices(): { apex: [number, number]; baseLeft: [number, number]; baseRight: [number, number] } {
        const halfAngle = this.apexAngle / 2;
        // Base half-width from apex angle and height
        const baseHalfWidth = this.height * Math.tan(halfAngle);

        // Triangle vertices (Y, Z):
        //   apex:      (height * 2/3 from centroid, 0)
        //   baseLeft:  (-height * 1/3, -baseHalfWidth)
        //   baseRight: (-height * 1/3, +baseHalfWidth)
        const centroidYOffset = this.height / 3;  // Centroid is 1/3 from base

        const apex: [number, number] = [this.height - centroidYOffset, 0];
        const baseLeft: [number, number] = [-centroidYOffset, -baseHalfWidth];
        const baseRight: [number, number] = [-centroidYOffset, baseHalfWidth];

        return { apex, baseLeft, baseRight };
    }

    get mesh(): OpticMesh {
        if (!this._mesh) {
            this._mesh = new OpticMesh();
            const geometry = this.buildGeometry();

            const { apex, baseLeft, baseRight } = this.getTriangleVertices();
            const halfW = this.width / 2;

            // Compute face normals for the three rectangular faces
            // Front face: apex → baseLeft edge
            const frontEdge = new Vector3(0, baseLeft[0] - apex[0], baseLeft[1] - apex[1]);
            const frontNormal = new Vector3(0, -frontEdge.z, frontEdge.y).normalize();

            // Back face: apex → baseRight edge
            const backEdge = new Vector3(0, baseRight[0] - apex[0], baseRight[1] - apex[1]);
            const backNormal = new Vector3(0, backEdge.z, -backEdge.y).normalize();

            // Base face: flat bottom
            const baseNormal = new Vector3(0, -1, 0);

            // Vertex layout (see buildGeometry):
            //   0..2:   left end cap (3 verts)
            //   3..5:   right end cap (3 verts)
            //   6..9:   front face (4 verts)
            //  10..13:  back face (4 verts)
            //  14..17:  base face (4 verts)
            const normalFn: NormalFn = (v: Vector3, vertexIndex?: number) => {
                if (vertexIndex !== undefined) {
                    if (vertexIndex < 3) return new Vector3(-1, 0, 0);       // Left cap
                    if (vertexIndex < 6) return new Vector3(1, 0, 0);        // Right cap
                    if (vertexIndex < 10) return frontNormal.clone();         // Front face
                    if (vertexIndex < 14) return backNormal.clone();          // Back face
                    return baseNormal.clone();                                // Base face
                }

                // Fallback: classify by signed distance (for runtime intersection normals)
                const frontDist = this.signedDistToLine(v.y, v.z, apex, baseLeft);
                const backDist = this.signedDistToLine(v.y, v.z, apex, baseRight);
                const baseDist = Math.abs(v.y - baseLeft[0]);

                // Check end caps
                if (Math.abs(Math.abs(v.x) - halfW) < 0.01 &&
                    Math.abs(frontDist) > 0.1 && Math.abs(backDist) > 0.1 && baseDist > 0.1) {
                    return new Vector3(Math.sign(v.x), 0, 0);
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
     * Signed distance from point (py, pz) to line through (y1, z1) and (y2, z2).
     * Positive = right side of the line (when looking from p1 to p2).
     */
    private signedDistToLine(py: number, pz: number, p1: [number, number], p2: [number, number]): number {
        const dy = p2[0] - p1[0];
        const dz = p2[1] - p1[1];
        const len = Math.sqrt(dy * dy + dz * dz);
        if (len < 1e-10) return 0;
        // Cross product gives signed distance * len
        return ((py - p1[0]) * dz - (pz - p1[1]) * dy) / len;
    }

    /**
     * Build a triangular prism BufferGeometry.
     * Two triangular end caps + three rectangular side faces.
     */
    private buildGeometry(): BufferGeometry {
        const { apex, baseLeft, baseRight } = this.getTriangleVertices();
        const halfW = this.width / 2;

        // 6 unique vertices for the prism (2 triangular ends × 3 vertices)
        // Left end (x = -halfW):  0, 1, 2
        // Right end (x = +halfW): 3, 4, 5
        const positions: number[] = [];
        const indices: number[] = [];

        // We need separate vertices per face for correct normals

        // --- Left end cap ---
        const lcApex = positions.length / 3;
        positions.push(-halfW, apex[0], apex[1]);
        positions.push(-halfW, baseLeft[0], baseLeft[1]);
        positions.push(-halfW, baseRight[0], baseRight[1]);
        indices.push(lcApex, lcApex + 2, lcApex + 1); // CCW from -X side

        // --- Right end cap ---
        const rcApex = positions.length / 3;
        positions.push(halfW, apex[0], apex[1]);
        positions.push(halfW, baseLeft[0], baseLeft[1]);
        positions.push(halfW, baseRight[0], baseRight[1]);
        indices.push(rcApex, rcApex + 1, rcApex + 2); // CCW from +X side

        // --- Front face (apex → baseLeft, extruded along X) ---
        const ffOffset = positions.length / 3;
        positions.push(-halfW, apex[0], apex[1]);       // 0
        positions.push(halfW, apex[0], apex[1]);        // 1
        positions.push(-halfW, baseLeft[0], baseLeft[1]); // 2
        positions.push(halfW, baseLeft[0], baseLeft[1]);  // 3
        indices.push(ffOffset, ffOffset + 2, ffOffset + 1);
        indices.push(ffOffset + 1, ffOffset + 2, ffOffset + 3);

        // --- Back face (apex → baseRight, extruded along X) ---
        const bfOffset = positions.length / 3;
        positions.push(-halfW, apex[0], apex[1]);         // 0
        positions.push(halfW, apex[0], apex[1]);          // 1
        positions.push(-halfW, baseRight[0], baseRight[1]); // 2
        positions.push(halfW, baseRight[0], baseRight[1]);   // 3
        indices.push(bfOffset, bfOffset + 1, bfOffset + 2);
        indices.push(bfOffset + 1, bfOffset + 3, bfOffset + 2);

        // --- Base face (baseLeft → baseRight, extruded along X) ---
        const basOffset = positions.length / 3;
        positions.push(-halfW, baseLeft[0], baseLeft[1]);   // 0
        positions.push(halfW, baseLeft[0], baseLeft[1]);    // 1
        positions.push(-halfW, baseRight[0], baseRight[1]); // 2
        positions.push(halfW, baseRight[0], baseRight[1]);  // 3
        indices.push(basOffset, basOffset + 1, basOffset + 2);
        indices.push(basOffset + 1, basOffset + 3, basOffset + 2);

        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        return geometry;
    }

    public invalidateMesh(): void {
        this._mesh = null;
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
     *   face 0:   left end cap
     *   face 1:   right end cap
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

    // Cauchy dispersion: n(λ) = A + B/λ²
    // Coefficients derived dynamically from this.ior at 589nm (sodium D-line).
    // B ≈ 12000 nm² gives heavy flint glass dispersion (strong rainbow).
    getIOR(wavelengthMeters: number): number {
        const wlNm = wavelengthMeters * 1e9;
        const B = 12000;
        const A = this.ior - B / (589 * 589);
        return A + B / (wlNm * wlNm);
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
    getABCD_for_ray(worldDir: Vector3): {
        abcdTangential: [number, number, number, number];
        abcdSagittal: [number, number, number, number];
    } {
        const identity: [number, number, number, number] = [1, 0, 0, 1];

        // Transform world direction into prism local frame
        const localDir = worldDir.clone().transformDirection(this.worldToLocal).normalize();

        // Get prism face normals in local space (Y-Z plane, outward-pointing)
        const { apex, baseLeft, baseRight } = this.getTriangleVertices();

        // Front face normal (same computation as in mesh getter)
        const frontEdge = new Vector3(0, baseLeft[0] - apex[0], baseLeft[1] - apex[1]);
        const frontNormal = new Vector3(0, -frontEdge.z, frontEdge.y).normalize();

        // Back face normal
        const backEdge = new Vector3(0, baseRight[0] - apex[0], baseRight[1] - apex[1]);
        const backNormal = new Vector3(0, backEdge.z, -backEdge.y).normalize();

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
        const ior = this.ior; // ABCD uses base IOR (beam propagation is monochromatic per-branch)
        const sinTheta2 = sinTheta1 / ior;
        if (sinTheta2 >= 1) return { abcdTangential: identity, abcdSagittal: identity }; // TIR
        const cosTheta2 = Math.sqrt(1 - sinTheta2 * sinTheta2);

        // Internal direction (refracted) — compute for path length estimation
        // Using Snell's vector form: d_t = (n1/n2)d_i + (n1/n2 · cosθ1 - cosθ2)n
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

        // Internal path length (approximate: distance between face planes along internal ray)
        // Use the distance between the two face planes along the internal direction
        const d = this.height * 0.6; // Rough estimate for typical configurations

        // Combined ABCD (exit × propagation × entry)
        // Tangential plane:
        //   M_entry = [[cos2/cos1, 0], [0, cos1/(n·cos2)]]
        //   M_prop  = [[1, d], [0, 1]]
        //   M_exit  = [[cos4/cos3, 0], [0, n·cos3/cos4]]
        const A_t = (cosTheta4 * cosTheta2) / (cosTheta3 * cosTheta1);
        const B_t = d * cosTheta4 * cosTheta1 / (ior * cosTheta3 * cosTheta2);
        const C_t = 0;
        const D_t = (cosTheta3 * cosTheta1) / (cosTheta4 * cosTheta2);

        // Sagittal plane:
        //   Combined = [[1, d/n], [0, 1]]
        const A_s = 1;
        const B_s = d / ior;
        const C_s = 0;
        const D_s = 1;

        return {
            abcdTangential: [A_t, B_t, C_t, D_t],
            abcdSagittal: [A_s, B_s, C_s, D_s]
        };
    }
}
