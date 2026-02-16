import { Vector3, BufferGeometry, Float32BufferAttribute } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { OpticMesh, NormalFn } from '../OpticMesh';

/**
 * CylindricalLens - A lens curved in one axis (Y), flat in the other (X).
 * 
 * Creates a rectangular cross-section with one or two cylindrical surfaces.
 * Uses ExtrudeGeometry-like custom BufferGeometry since the shape is NOT
 * rotationally symmetric (LatheGeometry won't work).
 * 
 * Local Origin (0,0,0) is center of lens. Optical axis = +Z.
 * Width (X extent) = width parameter, Height (Y extent) = apertureRadius * 2.
 * Front vertex at z = -thickness/2, back vertex at z = +thickness/2.
 * 
 * The cylindrical curvature is in the Y-Z plane:
 *   Front surface: cylinder with radius R1, axis along X
 *   Back surface:  cylinder with radius R2, axis along X
 */
export class CylindricalLens extends OpticalComponent {
    public r1: number;          // Front radius of curvature (positive = center behind surface)
    public r2: number;          // Back radius of curvature
    public apertureRadius: number; // Half-height (Y extent / 2)
    public width: number;       // X extent
    public thickness: number;   // Center thickness
    public ior: number;

    private _mesh: OpticMesh | null = null;

    constructor(
        r1: number, r2: number,
        apertureRadius: number, width: number, thickness: number,
        name: string = "Cylindrical Lens", ior: number = 1.5168
    ) {
        super(name);
        this.r1 = r1;
        this.r2 = r2;
        this.apertureRadius = apertureRadius;
        this.width = width;
        this.thickness = thickness;
        this.ior = ior;
    }

    /** Sag function for the front surface at height y */
    private sagFront(y: number): number {
        const R = this.r1;
        const frontApex = -this.thickness / 2;
        if (Math.abs(R) > 1e8) return frontApex;
        const val = R * R - y * y;
        if (val < 0) return frontApex;
        return (frontApex + R) - (R > 0 ? 1 : -1) * Math.sqrt(val);
    }

    /** Sag function for the back surface at height y */
    private sagBack(y: number): number {
        const R = this.r2;
        const backApex = this.thickness / 2;
        if (Math.abs(R) > 1e8) return backApex;
        const val = R * R - y * y;
        if (val < 0) return backApex;
        return (backApex + R) - (R > 0 ? 1 : -1) * Math.sqrt(val);
    }

    get mesh(): OpticMesh {
        if (!this._mesh) {
            this._mesh = new OpticMesh();
            const geometry = this.buildGeometry();

            const frontApex = -this.thickness / 2;
            const backApex = this.thickness / 2;
            const R1 = this.r1;
            const R2 = this.r2;
            const halfW = this.width / 2;

            // Cylindrical surface centers (on the Z axis, axis along X)
            const frontCenterZ = frontApex + R1;
            const backCenterZ = backApex + R2;

            const normalFn: NormalFn = (v: Vector3) => {
                const y = v.y;
                const z = v.z;

                // Rim vertices: check if vertex is on the top/bottom/left/right edges
                const isTopBottom = Math.abs(Math.abs(y) - this.apertureRadius) < 0.01;
                const isLeftRight = Math.abs(Math.abs(v.x) - halfW) < 0.01;

                if (isTopBottom) return new Vector3(0, Math.sign(y), 0);
                if (isLeftRight) return new Vector3(Math.sign(v.x), 0, 0);

                // Compute sag Z values at this Y position
                const sagFZ = this.sagFront(y);
                const sagBZ = this.sagBack(y);

                const distToFront = Math.abs(z - sagFZ);
                const distToBack = Math.abs(z - sagBZ);

                if (distToFront < distToBack) {
                    // Front surface — cylinder with axis along X
                    if (Math.abs(R1) > 1e8) return new Vector3(0, 0, -1);
                    // Normal in Y-Z plane: (0, y - 0, z - frontCenterZ) normalized
                    return new Vector3(0, y, z - frontCenterZ).normalize();
                } else {
                    // Back surface — cylinder with axis along X
                    if (Math.abs(R2) > 1e8) return new Vector3(0, 0, 1);
                    return new Vector3(0, y, z - backCenterZ).normalize();
                }
            };

            this._mesh.build(geometry, normalFn);
        }
        return this._mesh;
    }

    /**
     * Build a custom BufferGeometry for the cylindrical lens body.
     * The cross-section in Y-Z is a lens profile, extruded along X.
     */
    private buildGeometry(): BufferGeometry {
        const segsY = 32;  // Segments along the curved Y dimension
        const segsX = 4;   // Segments along the flat X dimension (just needs a few)
        const halfW = this.width / 2;

        // Find effective max Y (where surfaces might cross)
        let maxY = this.apertureRadius;
        for (let i = 0; i <= segsY; i++) {
            const y = (i / segsY) * this.apertureRadius;
            if (this.sagBack(y) - this.sagFront(y) < 0) {
                let lo = ((i - 1) / segsY) * this.apertureRadius;
                let hi = y;
                for (let j = 0; j < 20; j++) {
                    const mid = (lo + hi) / 2;
                    if (this.sagBack(mid) - this.sagFront(mid) > 0) lo = mid; else hi = mid;
                }
                maxY = lo;
                break;
            }
        }

        // Build 2D profile (Y, Z pairs) — front then back
        const frontProfile: { y: number; z: number }[] = [];
        const backProfile: { y: number; z: number }[] = [];
        for (let i = 0; i <= segsY; i++) {
            const y = -maxY + (2 * maxY * i) / segsY;
            frontProfile.push({ y, z: this.sagFront(Math.abs(y)) });
            backProfile.push({ y, z: this.sagBack(Math.abs(y)) });
        }

        // Create vertices and faces by extruding the profile along X
        const positions: number[] = [];
        const indices: number[] = [];

        // Front face vertices (for each X slice, all Y profile points)
        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (this.width * xi) / segsX;
            for (const p of frontProfile) {
                positions.push(x, p.y, p.z);
            }
        }

        // Back face vertices
        const backOffset = (segsX + 1) * (segsY + 1);
        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (this.width * xi) / segsX;
            for (const p of backProfile) {
                positions.push(x, p.y, p.z);
            }
        }

        const yCount = segsY + 1;

        // Front face triangles
        for (let xi = 0; xi < segsX; xi++) {
            for (let yi = 0; yi < segsY; yi++) {
                const a = xi * yCount + yi;
                const b = (xi + 1) * yCount + yi;
                const c = (xi + 1) * yCount + (yi + 1);
                const d = xi * yCount + (yi + 1);
                indices.push(a, b, c);
                indices.push(a, c, d);
            }
        }

        // Back face triangles (reversed winding)
        for (let xi = 0; xi < segsX; xi++) {
            for (let yi = 0; yi < segsY; yi++) {
                const a = backOffset + xi * yCount + yi;
                const b = backOffset + (xi + 1) * yCount + yi;
                const c = backOffset + (xi + 1) * yCount + (yi + 1);
                const d = backOffset + xi * yCount + (yi + 1);
                indices.push(a, c, b);
                indices.push(a, d, c);
            }
        }

        // Side walls (top, bottom, left, right)
        // Top wall (y = maxY): connect front and back profiles at yi=segsY
        const topAndBottomOffset = positions.length / 3;
        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (this.width * xi) / segsX;
            // Top front edge
            positions.push(x, maxY, this.sagFront(maxY));
            // Top back edge
            positions.push(x, maxY, this.sagBack(maxY));
        }
        for (let xi = 0; xi < segsX; xi++) {
            const a = topAndBottomOffset + xi * 2;
            const b = topAndBottomOffset + (xi + 1) * 2;
            const c = topAndBottomOffset + (xi + 1) * 2 + 1;
            const d = topAndBottomOffset + xi * 2 + 1;
            indices.push(a, b, c);
            indices.push(a, c, d);
        }

        // Bottom wall (y = -maxY)
        const bottomOffset = positions.length / 3;
        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (this.width * xi) / segsX;
            positions.push(x, -maxY, this.sagFront(maxY));
            positions.push(x, -maxY, this.sagBack(maxY));
        }
        for (let xi = 0; xi < segsX; xi++) {
            const a = bottomOffset + xi * 2;
            const b = bottomOffset + (xi + 1) * 2;
            const c = bottomOffset + (xi + 1) * 2 + 1;
            const d = bottomOffset + xi * 2 + 1;
            indices.push(a, c, b);
            indices.push(a, d, c);
        }

        // Left wall (x = -halfW): connect front[0] to back[0] for all Y
        const leftOffset = positions.length / 3;
        for (let yi = 0; yi <= segsY; yi++) {
            const fp = frontProfile[yi];
            const bp = backProfile[yi];
            positions.push(-halfW, fp.y, fp.z);
            positions.push(-halfW, bp.y, bp.z);
        }
        for (let yi = 0; yi < segsY; yi++) {
            const a = leftOffset + yi * 2;
            const b = leftOffset + (yi + 1) * 2;
            const c = leftOffset + (yi + 1) * 2 + 1;
            const d = leftOffset + yi * 2 + 1;
            indices.push(a, c, b);
            indices.push(a, d, c);
        }

        // Right wall (x = +halfW)
        const rightOffset = positions.length / 3;
        for (let yi = 0; yi <= segsY; yi++) {
            const fp = frontProfile[yi];
            const bp = backProfile[yi];
            positions.push(halfW, fp.y, fp.z);
            positions.push(halfW, bp.y, bp.z);
        }
        for (let yi = 0; yi < segsY; yi++) {
            const a = rightOffset + yi * 2;
            const b = rightOffset + (yi + 1) * 2;
            const c = rightOffset + (yi + 1) * 2 + 1;
            const d = rightOffset + yi * 2 + 1;
            indices.push(a, b, c);
            indices.push(a, c, d);
        }

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

    interact(ray: Ray, hit: HitRecord): InteractionResult {
    // Use raw local-space values stored during chkIntersection to avoid
    // floating-point errors from world↔local rotation matrix round-trips.
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
     * ABCD matrix for the tangential plane (Y-Z, where cylindrical curvature acts).
     * Same thick-lens compound matrix as SphericalLens.
     * Returns [A, B, C, D].
     */
    getABCD_tangential(): [number, number, number, number] {
        const R1 = this.r1;
        const R2 = this.r2;
        const n = this.ior;
        const t = this.thickness;

        const C1 = -(n - 1) / (n * R1);
        const D1 = 1 / n;
        const B_prop = t / n;
        const C2 = (n - 1) / R2;
        const D2 = n;

        // Chain: M2 × M_prop × M1
        const a1 = 1;
        const b1 = B_prop * D1;
        const c1 = C1;
        const d1 = B_prop * C1 + D1;

        const A = a1;
        const B = b1;
        const C = C2 * a1 + D2 * c1;
        const D = C2 * b1 + D2 * d1;

        return [A, B, C, D];
    }

    /**
     * ABCD matrix for the sagittal plane (X-Z, no curvature — flat window).
     * Just propagation through glass: [[1, t/n], [0, 1]]
     * Returns [A, B, C, D].
     */
    getABCD_sagittal(): [number, number, number, number] {
        return [1, this.thickness / this.ior, 0, 1];
    }

    getApertureRadius(): number {
        return this.apertureRadius;
    }
}
