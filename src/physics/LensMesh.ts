import { Vector3, Raycaster, Mesh, LatheGeometry, MeshBasicMaterial, DoubleSide, BufferAttribute, Triangle } from 'three';

/**
 * LensMesh.ts
 * 
 * Three.js-based ray intersection engine for SphericalLens.
 * Uses LatheGeometry (identical to the visual renderer) + Three.js Raycaster
 * for exact intersection. The rendered mesh IS the physics mesh — single source of truth.
 * 
 * Smooth normals are computed via barycentric interpolation of vertex normals
 * from the LatheGeometry's BufferGeometry.
 */

export type SurfaceTag = 'front' | 'back' | 'rim';

export interface MeshHit {
    t: number;
    point: Vector3;
    normal: Vector3;        // Smooth interpolated normal
    surfaceTag: SurfaceTag;
}

export class LensMesh {
    private mesh: Mesh | null = null;
    private geometry: LatheGeometry | null = null;
    private raycaster: Raycaster = new Raycaster();

    // Store lens geometry params for surface classification
    private frontApex: number = 0;
    private backApex: number = 0;

    /**
     * Build the Three.js mesh from the lens profile.
     * Uses the exact same LatheGeometry that LensVisualizer renders.
     */
    buildFromProfile(
        profilePoints: import('three').Vector2[],
        segments: number,
        thickness: number
    ): void {
        this.frontApex = -thickness / 2;
        this.backApex = thickness / 2;

        // Create LatheGeometry — identical to LensVisualizer
        this.geometry = new LatheGeometry(profilePoints, segments);
        
        // LatheGeometry revolves around the Y-axis, but the physics local space
        // uses Z as the optical axis. Apply the same π/2 X-rotation that the 
        // visual renderer uses (<mesh rotation={[Math.PI/2, 0, 0]}>), then bake
        // it into the geometry so the Raycaster operates in the correct space.
        this.geometry.rotateX(Math.PI / 2);
        this.geometry.computeVertexNormals();

        // Create mesh with DoubleSide so raycaster hits from both directions
        const material = new MeshBasicMaterial({ side: DoubleSide });
        this.mesh = new Mesh(this.geometry, material);
    }

    /**
     * Classify which surface a hit point belongs to based on its Z position.
     */
    private classifySurface(point: Vector3): SurfaceTag {
        const z = point.z;

        // Classify by Z position relative to front/back apex
        if (Math.abs(z - this.frontApex) < Math.abs(z - this.backApex)) {
            return 'front';
        } else if (Math.abs(z - this.backApex) < Math.abs(z - this.frontApex)) {
            return 'back';
        }
        return 'rim';
    }

    /**
     * Compute smooth interpolated normal at an intersection point
     * using barycentric interpolation of vertex normals.
     */
    private computeSmoothNormal(faceIndex: number, hitPoint: Vector3): Vector3 {
        if (!this.geometry) return new Vector3(0, 0, 1);

        const index = this.geometry.index;
        const posAttr = this.geometry.getAttribute('position') as BufferAttribute;
        const normAttr = this.geometry.getAttribute('normal') as BufferAttribute;

        if (!index || !posAttr || !normAttr) {
            return new Vector3(0, 0, 1);
        }

        // Get vertex indices for this face
        const a = index.getX(faceIndex * 3);
        const b = index.getX(faceIndex * 3 + 1);
        const c = index.getX(faceIndex * 3 + 2);

        // Get vertex positions
        const p0 = new Vector3().fromBufferAttribute(posAttr, a);
        const p1 = new Vector3().fromBufferAttribute(posAttr, b);
        const p2 = new Vector3().fromBufferAttribute(posAttr, c);

        // Get vertex normals
        const n0 = new Vector3().fromBufferAttribute(normAttr, a);
        const n1 = new Vector3().fromBufferAttribute(normAttr, b);
        const n2 = new Vector3().fromBufferAttribute(normAttr, c);

        // Compute barycentric coordinates
        const bary = new Vector3();
        const tri = new Triangle(p0, p1, p2);
        tri.getBarycoord(hitPoint, bary);

        // Interpolate normal
        const smoothNormal = new Vector3()
            .addScaledVector(n0, bary.x)
            .addScaledVector(n1, bary.y)
            .addScaledVector(n2, bary.z)
            .normalize();

        return smoothNormal;
    }

    /**
     * Find nearest ray intersection (entry point — ray coming from outside).
     */
    intersectRay(origin: Vector3, direction: Vector3): MeshHit | null {
        if (!this.mesh) return null;

        this.raycaster.set(origin, direction.clone().normalize());
        this.raycaster.near = 0.001;
        this.raycaster.far = Infinity;

        const intersections = this.raycaster.intersectObject(this.mesh, false);

        if (intersections.length === 0) return null;

        const hit = intersections[0];
        const faceIndex = hit.faceIndex!;
        const smoothNormal = this.computeSmoothNormal(faceIndex, hit.point);
        const surfaceTag = this.classifySurface(hit.point);

        return {
            t: hit.distance,
            point: hit.point.clone(),
            normal: smoothNormal,
            surfaceTag
        };
    }

    /**
     * Find nearest ray intersection from INSIDE the lens (exit point).
     * Three.js Raycaster with DoubleSide material hits both front and back faces.
     */
    intersectRayFromInside(origin: Vector3, direction: Vector3): MeshHit | null {
        if (!this.mesh) return null;

        this.raycaster.set(origin, direction.clone().normalize());
        this.raycaster.near = 0.001;
        this.raycaster.far = Infinity;

        const intersections = this.raycaster.intersectObject(this.mesh, false);

        if (intersections.length === 0) return null;

        // The nearest intersection from inside should be the exit point
        const hit = intersections[0];
        const faceIndex = hit.faceIndex!;
        const smoothNormal = this.computeSmoothNormal(faceIndex, hit.point);
        const surfaceTag = this.classifySurface(hit.point);

        return {
            t: hit.distance,
            point: hit.point.clone(),
            normal: smoothNormal,
            surfaceTag
        };
    }
}
