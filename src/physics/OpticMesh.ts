import { 
    Vector3, Raycaster, Mesh, BufferGeometry, MeshBasicMaterial, 
    DoubleSide, BufferAttribute, Triangle
} from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { childRay } from './types';
import { cleanVec } from './math_solvers';

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
    faceIndex?: number; // Triangle index from raycaster (for surface identification)
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
    private posAttr: BufferAttribute | null = null;
    private normAttr: BufferAttribute | null = null;
    private indexAttr: BufferAttribute | null = null;
    private scratchDirection: Vector3 = new Vector3();
    private scratchP0: Vector3 = new Vector3();
    private scratchP1: Vector3 = new Vector3();
    private scratchP2: Vector3 = new Vector3();
    private scratchN0: Vector3 = new Vector3();
    private scratchN1: Vector3 = new Vector3();
    private scratchN2: Vector3 = new Vector3();
    private scratchBary: Vector3 = new Vector3();
    private scratchTriangle: Triangle = new Triangle();

    private static _warnedKeys: Set<string> = new Set();
    /**
     * Emit a warning once per session for a given key, so noisy fallbacks
     * don't flood the console on every ray but are still visible.
     */
    static warnOnce(key: string, message: string): void {
        if (OpticMesh._warnedKeys.has(key)) return;
        OpticMesh._warnedKeys.add(key);
        console.warn(message);
    }

    get builtGeometry(): BufferGeometry | null {
        return this.geometry;
    }

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
        this.posAttr = posAttr;
        this.normAttr = geometry.getAttribute('normal') as BufferAttribute;
        this.indexAttr = geometry.index;

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
    private computeSmoothNormal(faceIndex: number, hitPoint: Vector3, target: Vector3): Vector3 {
        const index = this.indexAttr;
        const posAttr = this.posAttr;
        const normAttr = this.normAttr;

        if (!index || !posAttr || !normAttr) {
            return target.set(0, 0, 1);
        }

        // Get vertex indices for this face
        const a = index.getX(faceIndex * 3);
        const b = index.getX(faceIndex * 3 + 1);
        const c = index.getX(faceIndex * 3 + 2);

        // Get vertex positions
        const p0 = this.scratchP0.fromBufferAttribute(posAttr, a);
        const p1 = this.scratchP1.fromBufferAttribute(posAttr, b);
        const p2 = this.scratchP2.fromBufferAttribute(posAttr, c);

        // Get analytical vertex normals
        const n0 = this.scratchN0.fromBufferAttribute(normAttr, a);
        const n1 = this.scratchN1.fromBufferAttribute(normAttr, b);
        const n2 = this.scratchN2.fromBufferAttribute(normAttr, c);

        // Compute barycentric coordinates
        const bary = this.scratchBary;
        this.scratchTriangle.set(p0, p1, p2).getBarycoord(hitPoint, bary);

        // Interpolate normal using barycentric weights
        return target.set(0, 0, 0)
            .addScaledVector(n0, bary.x)
            .addScaledVector(n1, bary.y)
            .addScaledVector(n2, bary.z)
            .normalize();
    }

    /**
     * Find ALL ray-mesh intersections, sorted by distance.
     * Returns the full list so the caller can pick entry (index 0)
     * and exit (index 1) without needing separate methods.
     */
    intersectRayAll(origin: Vector3, direction: Vector3): MeshHit[] {
        if (!this.mesh) return [];

        (this.raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = false;
        this.raycaster.set(origin, this.scratchDirection.copy(direction).normalize());
        this.raycaster.near = 0.001;
        this.raycaster.far = Infinity;

        const intersections = this.raycaster.intersectObject(this.mesh, false);

        return intersections.map(hit => ({
            t: hit.distance,
            point: hit.point.clone(),
            normal: this.computeSmoothNormal(hit.faceIndex!, hit.point, new Vector3()),
            faceIndex: hit.faceIndex ?? undefined
        }));
    }

    /**
     * Find the nearest ray-mesh intersection.
     */
    intersectRay(origin: Vector3, direction: Vector3): MeshHit | null {
        if (!this.mesh) return null;

        const raycaster = this.raycaster as Raycaster & { firstHitOnly?: boolean };
        raycaster.firstHitOnly = true;
        try {
            this.raycaster.set(origin, this.scratchDirection.copy(direction).normalize());
            this.raycaster.near = 0.001;
            this.raycaster.far = Infinity;

            const hit = this.raycaster.intersectObject(this.mesh, false)[0];
            if (!hit) return null;

            return {
                t: hit.distance,
                point: hit.point.clone(),
                normal: this.computeSmoothNormal(hit.faceIndex!, hit.point, new Vector3()),
                faceIndex: hit.faceIndex ?? undefined
            };
        } finally {
            raycaster.firstHitOnly = false;
        }
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
     * @param exitSurfaceLabel - Optional callback to label exit faces for split detection.
     *                           Maps a triangle faceIndex to a semantic string (e.g. "front", "back").
     *                           When provided, child rays get exitSurfaceId stamped.
     */
    interact(
        entryNormal: Vector3,
        localDir: Vector3,
        entryPoint: Vector3,
        ior: number,
        localToWorld: import('three').Matrix4,
        worldEntryPoint: Vector3,
        ray: import('./types').Ray,
        allowInternalReflection: boolean = false,
        exitSurfaceLabel?: (faceIndex: number) => string,
        exteriorIorCallback?: (hitPointLocal: Vector3) => number
    ): import('./types').InteractionResult {
        const nAirEntry = exteriorIorCallback ? exteriorIorCallback(entryPoint) : 1.0;
        const nGlass = ior;

        // Clean near-zero floating-point artifacts from geometry normals and
        // transformed directions. LatheGeometry vertices can have x ≈ 1e-20
        // instead of exactly 0, which propagates through refraction and
        // causes the exit raycaster to miss triangle edges.
        cleanVec(entryNormal);
        cleanVec(localDir);
        cleanVec(entryPoint);

        // Ensure entry normal faces against the incoming ray
        if (entryNormal.dot(localDir) > 0) entryNormal.negate();

        // 1. Refract at Entry (Exterior → Glass)
        const dirInside = OpticMesh.refract(localDir, entryNormal, nAirEntry, nGlass);
        if (!dirInside) {
            // TIR at entry (extreme grazing angle) — reflect off the front surface
            const dotDN = localDir.dot(entryNormal);
            const reflected = localDir.clone()
                .sub(entryNormal.clone().multiplyScalar(2 * dotDN))
                .normalize();
            const dirReflWorld = reflected.transformDirection(localToWorld).normalize();
            return {
                rays: [childRay(ray, {
                    origin: worldEntryPoint,
                    direction: dirReflWorld,
                    entryPoint: worldEntryPoint
                })]
            };
        }
        cleanVec(dirInside);

        // 2. Trace through interior with internal reflection support
        const MAX_BOUNCES = 8;
        let currentDir = dirInside.clone();
        let currentOrigin = entryPoint.clone().add(currentDir.clone().multiplyScalar(0.01));
        let totalPath = 0;
        const internalBouncePoints: import('three').Vector3[] = []; // World-space TIR bounce points

        let lastHitNormal: Vector3 | null = null; // Track last known surface normal for fallback
        const traceInterior = (origin: Vector3, direction: Vector3): MeshHit[] => {
            if (allowInternalReflection) return this.intersectRayAll(origin, direction);
            const hit = this.intersectRay(origin, direction);
            return hit ? [hit] : [];
        };

        for (let bounce = 0; bounce < MAX_BOUNCES; bounce++) {
            let hits = traceInterior(currentOrigin, currentDir);

            // Mesh gap recovery: if no hits, try small origin perturbation
            if (hits.length === 0) {
                // Try nudging the origin backward (closer to the surface we just bounced from)
                const retryOrigin = currentOrigin.clone().add(currentDir.clone().multiplyScalar(-0.02));
                hits = traceInterior(retryOrigin, currentDir);
                if (hits.length > 0) {
                    // Only accept hits that are ahead of our original position
                    hits = hits.filter(h => h.t > 0.03);
                }
            }

            if (hits.length === 0) {
                // The fallbacks below are geometric rescues, not physical models:
                // they emit a "grazing escape" ray to keep the trace alive when the
                // mesh-raycaster fails (LatheGeometry axis singularities, sub-voxel
                // edge gaps). Downstream components receive a ray that doesn't
                // represent the true physical path. We warn once per fallback so
                // degenerate setups are visible rather than silently producing
                // bogus ray geometry.
                if (!allowInternalReflection && bounce > 0 && lastHitNormal) {
                    OpticMesh.warnOnce('lens-post-bounce-fallback',
                        '[OpticMesh] Lens TIR/gap fallback: emitting grazing exit ray (non-physical).');
                    const outwardNormal = lastHitNormal.clone();
                    // outwardNormal should point outward (away from glass interior)
                    if (outwardNormal.dot(currentDir) < 0) outwardNormal.negate();

                    const cosTheta = currentDir.dot(outwardNormal.clone().negate());
                    const tangent = currentDir.clone()
                        .sub(outwardNormal.clone().negate().multiplyScalar(cosTheta))
                        .normalize();
                    const dirOutLocal = tangent.clone()
                        .add(outwardNormal.clone().multiplyScalar(0.05))
                        .normalize();

                    const dirOutWorld = dirOutLocal.clone().transformDirection(localToWorld).normalize();
                    const exitPointWorld = currentOrigin.clone().applyMatrix4(localToWorld);

                    return {
                        rays: [childRay(ray, {
                            origin: exitPointWorld,
                            direction: dirOutWorld,
                            opticalPathLength: ray.opticalPathLength + (totalPath * nGlass),
                            entryPoint: worldEntryPoint,
                            internalPath: internalBouncePoints.length > 0 ? internalBouncePoints : undefined
                        })]
                    };
                }

                // Prism fallback: after TIR bounce, the reflected ray may escape
                // through a mesh edge gap or hit a degenerate vertex (for example
                // the sharp apex of a triangular prism). Emit a grazing escape ray
                // instead of silently absorbing the beam.
                if (allowInternalReflection && bounce > 0 && lastHitNormal) {
                    OpticMesh.warnOnce('prism-post-bounce-fallback',
                        '[OpticMesh] Prism TIR/gap fallback: emitting grazing exit ray (non-physical).');
                    const outwardNormal = lastHitNormal.clone();
                    if (outwardNormal.dot(currentDir) < 0) outwardNormal.negate();

                    const cosTheta = currentDir.dot(outwardNormal.clone().negate());
                    const tangent = currentDir.clone()
                        .sub(outwardNormal.clone().negate().multiplyScalar(cosTheta))
                        .normalize();
                    const dirOutLocal = tangent.clone()
                        .add(outwardNormal.clone().multiplyScalar(0.05))
                        .normalize();

                    const dirOutWorld = dirOutLocal.clone().transformDirection(localToWorld).normalize();
                    const exitPointWorld = currentOrigin.clone().applyMatrix4(localToWorld);

                    return {
                        rays: [childRay(ray, {
                            origin: exitPointWorld,
                            direction: dirOutWorld,
                            opticalPathLength: ray.opticalPathLength + (totalPath * nGlass),
                            entryPoint: worldEntryPoint,
                            internalPath: internalBouncePoints.length > 0 ? internalBouncePoints : undefined
                        })]
                    };
                }

                // Lens on first bounce (bounce === 0): the on-axis ray can miss exit
                // triangles at the LatheGeometry revolution axis (degenerate center).
                // Retry with a tiny off-axis perturbation before giving up.
                if (!allowInternalReflection && bounce === 0) {
                    // Try small perpendicular nudge to escape axis singularity
                    const perturbed = currentOrigin.clone();
                    perturbed.x += 0.005;  // Nudge in local u (radial for LatheGeometry)
                    hits = traceInterior(perturbed, currentDir);
                    if (hits.length > 0) {
                        // Found it — use this hit as the exit surface
                        const hit = hits[0];
                        totalPath += hit.t;
                        const exitNormal = hit.normal.clone();
                        if (exitNormal.dot(currentDir) > 0) exitNormal.negate();
                        const nAirExit = exteriorIorCallback ? exteriorIorCallback(hit.point) : 1.0;
                        const dirOut = OpticMesh.refract(currentDir, exitNormal, nGlass, nAirExit);
                        if (dirOut) {
                            const dirOutWorld = dirOut.transformDirection(localToWorld).normalize();
                            const exitPointWorld = hit.point.clone().applyMatrix4(localToWorld);
                            return {
                                rays: [childRay(ray, {
                                    origin: exitPointWorld,
                                    direction: dirOutWorld,
                                    opticalPathLength: ray.opticalPathLength + (totalPath * nGlass),
                                    entryPoint: worldEntryPoint,
                                    internalPath: internalBouncePoints.length > 0 ? internalBouncePoints : undefined
                                })]
                            };
                        }
                    }
                    // Nudge didn't help — pass through undeviated as fallback for lenses
                    // (on-axis ray through flat surface should continue straight)
                    OpticMesh.warnOnce('lens-axis-passthrough-fallback',
                        '[OpticMesh] On-axis lens fallback: passing ray through undeviated (no exit surface found).');
                    const exitPointWorld = currentOrigin.clone().applyMatrix4(localToWorld);
                    const dirOutWorld = currentDir.clone().transformDirection(localToWorld).normalize();
                    return {
                        rays: [childRay(ray, {
                            origin: exitPointWorld,
                            direction: dirOutWorld,
                            opticalPathLength: ray.opticalPathLength + (totalPath * nGlass),
                            entryPoint: worldEntryPoint,
                            internalPath: internalBouncePoints.length > 0 ? internalBouncePoints : undefined
                        })]
                    };
                }

                // Prism / first bounce: no recovery possible — absorb
                const terminationWorld = currentOrigin.clone().applyMatrix4(localToWorld);
                return {
                    rays: [childRay(ray, {
                        origin: terminationWorld,
                        direction: currentDir.clone().transformDirection(localToWorld).normalize(),
                        intensity: 0,
                        opticalPathLength: ray.opticalPathLength + (totalPath * nGlass),
                        entryPoint: worldEntryPoint,
                        internalPath: internalBouncePoints.length > 0 ? internalBouncePoints : undefined,
                        terminationPoint: terminationWorld
                    })]
                };
            }


            const hit = hits[0];
            totalPath += hit.t;
            const exitNormal = hit.normal.clone();
            lastHitNormal = exitNormal.clone(); // Track for mesh gap fallback

            // Ensure normal faces against the ray for Snell's law
            if (exitNormal.dot(currentDir) > 0) exitNormal.negate();

            // Try to refract out (Glass → Exterior)
            const nAirExit = exteriorIorCallback ? exteriorIorCallback(hit.point) : 1.0;
            const dirOut = OpticMesh.refract(currentDir, exitNormal, nGlass, nAirExit);

            if (dirOut) {

                // Transform to world space and return
                const dirOutWorld = dirOut.transformDirection(localToWorld).normalize();
                const exitPointWorld = hit.point.clone().applyMatrix4(localToWorld);

                return {
                    rays: [childRay(ray, {
                        origin: exitPointWorld,
                        direction: dirOutWorld,
                        opticalPathLength: ray.opticalPathLength + (totalPath * nGlass),
                        entryPoint: worldEntryPoint,
                        internalPath: internalBouncePoints.length > 0 ? internalBouncePoints : undefined,
                        exitSurfaceId: (exitSurfaceLabel && hit.faceIndex !== undefined)
                            ? exitSurfaceLabel(hit.faceIndex) : undefined
                    })]
                };
            }

            // TIR occurred — handle based on component type
            if (!allowInternalReflection) {
                // Lens TIR: always use grazing exit fallback.
                // Even rays that hit the rim should scatter out rather than vanish.

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
                    rays: [childRay(ray, {
                        origin: exitPointWorld,
                        direction: dirOutWorld,
                        opticalPathLength: ray.opticalPathLength + (totalPath * nGlass),
                        entryPoint: worldEntryPoint
                    })]
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
            rays: [childRay(ray, {
                origin: lastPtWorld,
                direction: currentDir.clone().transformDirection(localToWorld).normalize(),
                intensity: 0,
                opticalPathLength: ray.opticalPathLength + (totalPath * nGlass),
                entryPoint: worldEntryPoint,
                internalPath: internalBouncePoints.length > 0 ? internalBouncePoints : undefined,
                terminationPoint: lastPtWorld
            })]
        };
    }
}
