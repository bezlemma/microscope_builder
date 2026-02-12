import { 
    Vector3, Raycaster, Mesh, BufferGeometry, MeshBasicMaterial, 
    DoubleSide, BufferAttribute, Triangle
} from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

// Patch Three.js Mesh prototype with BVH-accelerated raycast
Mesh.prototype.raycast = acceleratedRaycast;

/**
 * OpticMesh.ts
 * 
 * Universal ray-mesh intersection engine for all optical components.
 * 
 * KEY DESIGN:
 *   1. The Three.js mesh IS the physics boundary — watertight, no leaks.
 *   2. Each vertex stores an ANALYTICAL normal from the exact surface math
 *      (gradient of sag function, sphere center, flat face normal, etc.)
 *   3. At intersection, barycentric interpolation of these analytical vertex
 *      normals gives the exact continuous normal — no face-averaging artifacts.
 *   4. Inside/outside is determined by dot(ray, normal) — no surface tags.
 *   5. BVH acceleration via three-mesh-bvh for instant raycasting.
 */

export interface MeshHit {
    t: number;
    point: Vector3;
    normal: Vector3; // Analytical, barycentrically interpolated
}

/**
 * A callback that computes the exact mathematical normal for a vertex
 * at the given position. Each optic type provides its own implementation:
 *   - Spherical lens: normalize(V - sphereCenter)
 *   - Cylindrical lens: normalize(V.x, 0, V.z - cylinderAxisZ)
 *   - Prism: flat face normal
 *   - Rim: radial outward normalize(V.x, V.y, 0)
 */
export type NormalFn = (vertex: Vector3, vertexIndex?: number) => Vector3;

export class OpticMesh {
    private mesh: Mesh | null = null;
    private geometry: BufferGeometry | null = null;
    private raycaster: Raycaster = new Raycaster();

    /**
     * Build the physics mesh from a BufferGeometry.
     * 
     * Instead of calling geometry.computeVertexNormals() (which averages
     * flat face normals and produces garbage at surface discontinuities),
     * we inject the exact mathematical normal for every vertex using normalFn.
     */
    build(geometry: BufferGeometry, normalFn: NormalFn): void {
        this.geometry = geometry;

        // Inject analytical normals
        const posAttr = geometry.getAttribute('position') as BufferAttribute;
        const count = posAttr.count;
        const normals = new Float32Array(count * 3);
        const v = new Vector3();

        for (let i = 0; i < count; i++) {
            v.fromBufferAttribute(posAttr, i);
            const n = normalFn(v, i);
            normals[i * 3]     = n.x;
            normals[i * 3 + 1] = n.y;
            normals[i * 3 + 2] = n.z;
        }

        geometry.setAttribute('normal', new BufferAttribute(normals, 3));

        // Build BVH for accelerated raycasting
        (geometry as any).boundsTree = new MeshBVH(geometry);

        // Create mesh with DoubleSide so raycaster hits from both directions
        const material = new MeshBasicMaterial({ side: DoubleSide });
        this.mesh = new Mesh(geometry, material);
    }

    /**
     * Compute smooth interpolated normal at an intersection point
     * using barycentric interpolation of analytical vertex normals.
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

        // Get analytical vertex normals
        const n0 = new Vector3().fromBufferAttribute(normAttr, a);
        const n1 = new Vector3().fromBufferAttribute(normAttr, b);
        const n2 = new Vector3().fromBufferAttribute(normAttr, c);

        // Compute barycentric coordinates
        const bary = new Vector3();
        const tri = new Triangle(p0, p1, p2);
        tri.getBarycoord(hitPoint, bary);

        // Interpolate normal using barycentric weights
        const smoothNormal = new Vector3()
            .addScaledVector(n0, bary.x)
            .addScaledVector(n1, bary.y)
            .addScaledVector(n2, bary.z)
            .normalize();

        return smoothNormal;
    }

    /**
     * Find ALL ray-mesh intersections, sorted by distance.
     * Returns the full list so the caller can pick entry (index 0)
     * and exit (index 1) without needing separate methods.
     */
    intersectRayAll(origin: Vector3, direction: Vector3): MeshHit[] {
        if (!this.mesh) return [];

        this.raycaster.set(origin, direction.clone().normalize());
        this.raycaster.near = 0.001;
        this.raycaster.far = Infinity;

        const intersections = this.raycaster.intersectObject(this.mesh, false);

        return intersections.map(hit => ({
            t: hit.distance,
            point: hit.point.clone(),
            normal: this.computeSmoothNormal(hit.faceIndex!, hit.point)
        }));
    }

    /**
     * Find the nearest ray-mesh intersection.
     */
    intersectRay(origin: Vector3, direction: Vector3): MeshHit | null {
        const hits = this.intersectRayAll(origin, direction);
        return hits.length > 0 ? hits[0] : null;
    }

    // ========================================================================
    // SHARED OPTICS: Refraction + Interaction
    // These are component-agnostic — any watertight refractive optic can use them.
    // ========================================================================

    /**
     * Vector Snell's Law.
     * Returns the refracted direction, or null if TIR occurs.
     */
    static refract(incident: Vector3, normal: Vector3, n1: number, n2: number): Vector3 | null {
        const r = n1 / n2;
        const cosI = -normal.dot(incident);
        const sinT2 = r * r * (1 - cosI * cosI);
        if (sinT2 > 1) return null; // TIR
        const cosT = Math.sqrt(1 - sinT2);
        return incident.clone().multiplyScalar(r)
            .add(normal.clone().multiplyScalar(r * cosI - cosT))
            .normalize();
    }

    /**
     * Unified interact() for any refractive optic.
     *
     * Uses the dot-product test to determine entry vs. exit:
     *   ray · normal < 0  →  entering glass (air → glass)
     *   ray · normal > 0  →  exiting glass (glass → air)
     *
     * No surface tags needed. Works for spherical, cylindrical, prism, etc.
     *
     * @param entryNormal - The interpolated analytical normal at the entry point (outward-facing)
     * @param localDir    - Ray direction in local space
     * @param entryPoint  - Entry point in local space
     * @param ior         - Index of refraction of the glass
     * @param localToWorld - Transform matrix
     * @param worldEntryPoint - Entry point in world space (for visualization)
     * @param ray         - The original ray
     * @param allowInternalReflection - If true, TIR produces internal reflection bounces (prisms).
     *                                  If false, TIR uses grazing-exit clamp (lenses).
     */
    interact(
        entryNormal: Vector3,
        localDir: Vector3,
        entryPoint: Vector3,
        ior: number,
        localToWorld: import('three').Matrix4,
        worldEntryPoint: Vector3,
        ray: import('./types').Ray,
        allowInternalReflection: boolean = false
    ): import('./types').InteractionResult {
        const nAir = 1.0;
        const nGlass = ior;

        // Clean near-zero floating-point artifacts from geometry normals and
        // transformed directions. LatheGeometry vertices can have x ≈ 1e-20
        // instead of exactly 0, which propagates through refraction and
        // causes the exit raycaster to miss triangle edges.
        const EPS = 1e-12;
        const clean = (v: Vector3) => {
            if (Math.abs(v.x) < EPS) v.x = 0;
            if (Math.abs(v.y) < EPS) v.y = 0;
            if (Math.abs(v.z) < EPS) v.z = 0;
            return v;
        };
        clean(entryNormal);
        clean(localDir);
        clean(entryPoint);

        // Ensure entry normal faces against the incoming ray
        if (entryNormal.dot(localDir) > 0) entryNormal.negate();

        // 1. Refract at Entry (Air → Glass)
        const dirInside = OpticMesh.refract(localDir, entryNormal, nAir, nGlass);
        if (!dirInside) {
            return { rays: [] };
        }
        clean(dirInside);

        // 2. Trace through interior with internal reflection support
        const MAX_BOUNCES = 8;
        let currentDir = dirInside.clone();
        let currentOrigin = entryPoint.clone().add(currentDir.clone().multiplyScalar(0.01));
        let totalPath = 0;
        const internalBouncePoints: import('three').Vector3[] = []; // World-space TIR bounce points

        for (let bounce = 0; bounce < MAX_BOUNCES; bounce++) {
            const hits = this.intersectRayAll(currentOrigin, currentDir);
            if (hits.length === 0) {
                // Ray escaped through a vertex/edge gap (e.g. TIR at apex corner).
                // Return an absorbed ray with the full internal path for visualization.
                const terminationWorld = currentOrigin.clone().applyMatrix4(localToWorld);
                return {
                    rays: [{
                        ...ray,
                        origin: terminationWorld,
                        direction: currentDir.clone().transformDirection(localToWorld).normalize(),
                        intensity: 0,
                        opticalPathLength: ray.opticalPathLength + (totalPath * nGlass),
                        entryPoint: worldEntryPoint,
                        internalPath: internalBouncePoints.length > 0 ? internalBouncePoints : undefined,
                        terminationPoint: terminationWorld
                    }]
                };
            }

            const hit = hits[0];
            totalPath += hit.t;
            const exitNormal = hit.normal.clone();

            // Ensure normal faces against the ray for Snell's law
            if (exitNormal.dot(currentDir) > 0) exitNormal.negate();

            // Try to refract out (Glass → Air)
            const dirOut = OpticMesh.refract(currentDir, exitNormal, nGlass, nAir);

            if (dirOut) {

                // Transform to world space and return
                const dirOutWorld = dirOut.transformDirection(localToWorld).normalize();
                const exitPointWorld = hit.point.clone().applyMatrix4(localToWorld);

                return {
                    rays: [{
                        ...ray,
                        origin: exitPointWorld,
                        direction: dirOutWorld,
                        opticalPathLength: ray.opticalPathLength + (totalPath * nGlass),
                        entryPoint: worldEntryPoint,
                        internalPath: internalBouncePoints.length > 0 ? internalBouncePoints : undefined
                    }]
                };
            }

            // TIR occurred — handle based on component type
            if (!allowInternalReflection) {
                // Lens: check if this is a rim hit (rim normals are radial, low Z)
                const axialComponent = Math.abs(exitNormal.z);
                if (axialComponent < 0.3) {
                    return { rays: [] };
                }

                // Grazing exit fallback for lenses: clamp to tangent direction
                const cosTheta = currentDir.dot(exitNormal);
                const tangent = currentDir.clone()
                    .sub(exitNormal.clone().multiplyScalar(cosTheta))
                    .normalize();
                const dirOutLocal = tangent.clone()
                    .add(exitNormal.clone().negate().multiplyScalar(0.05))
                    .normalize();

                const dirOutWorld = dirOutLocal.transformDirection(localToWorld).normalize();
                const exitPointWorld = hit.point.clone().applyMatrix4(localToWorld);

                return {
                    rays: [{
                        ...ray,
                        origin: exitPointWorld,
                        direction: dirOutWorld,
                        opticalPathLength: ray.opticalPathLength + (totalPath * nGlass),
                        entryPoint: worldEntryPoint
                    }]
                };
            }
            // Prism: TIR on any face → reflect internally
            // Record the bounce point in world space for visualization
            internalBouncePoints.push(hit.point.clone().applyMatrix4(localToWorld));

            // Internal reflection: reflect the ray and continue tracing
            const outwardNormal = exitNormal.clone().negate();
            const dotDN = currentDir.dot(outwardNormal);
            currentDir = currentDir.clone()
                .sub(outwardNormal.clone().multiplyScalar(2 * dotDN))
                .normalize();
            currentOrigin = hit.point.clone().add(currentDir.clone().multiplyScalar(0.01));
        }

        // Exceeded max bounces — ray is trapped. Return absorbed ray with full internal path.
        console.warn('[OpticMesh] BLOCKED: Max bounces exceeded (' + MAX_BOUNCES + ')');
        const lastPtWorld = currentOrigin.clone().applyMatrix4(localToWorld);
        return {
            rays: [{
                ...ray,
                origin: lastPtWorld,
                direction: currentDir.clone().transformDirection(localToWorld).normalize(),
                intensity: 0,
                opticalPathLength: ray.opticalPathLength + (totalPath * nGlass),
                entryPoint: worldEntryPoint,
                internalPath: internalBouncePoints.length > 0 ? internalBouncePoints : undefined,
                terminationPoint: lastPtWorld
            }]
        };
    }
}
