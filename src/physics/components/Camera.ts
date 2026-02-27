import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';

export class Camera extends OpticalComponent {
    width: number;
    height: number;
    sensorResX: number;
    sensorResY: number;
    sensorNA: number;           // Pixel acceptance cone NA (determines angular sampling spread)
    samplesPerPixel: number;    // Monte Carlo samples per pixel for Solver 3

    // Solver 3 render results (stored on the camera that produced them)
    solver3Image: Float32Array | null = null;
    forwardImage: Float32Array | null = null;  // Forward excitation signal (Solver 2 beam at sensor)
    solver3Paths: Ray[][] | null = null;
    solver3Stale: boolean = true;

    // Scan accumulation results — per-frame images for scrubbing
    scanFrames: Float32Array[] | null = null;       // Each frame's emission image
    scanExFrames: Float32Array[] | null = null;      // Each frame's excitation image
    scanFrameCount: number = 0;
    /** Component version snapshot at scan completion (used to detect non-animation edits) */
    scanVersionSnapshot: Map<string, number> | null = null;

    constructor(width: number = 13, height: number = 13, name: string = "Camera Sensor") {
        super(name);
        this.width = width;
        this.height = height;
        this.sensorResX = 64;
        this.sensorResY = 64;
        this.sensorNA = 0;          // Angular sampling disabled (0 = deterministic single ray)
        this.samplesPerPixel = 1;   // Single ray per pixel
    }

    /** Clear single-shot Solver 3 results (called when scene changes).
     *  Scan frame data is preserved — only cleared when a new scan starts. */
    markSolver3Stale(): void {
        this.solver3Stale = true;
        // If we have scan frames, keep the averaged image visible
        if (!this.scanFrames) {
            this.solver3Image = null;
            this.forwardImage = null;
            this.solver3Paths = null;
        }
    }

    /** Clear scan frame data (called at the start of a new scan). */
    clearScanFrames(): void {
        this.scanFrames = null;
        this.scanExFrames = null;
        this.scanFrameCount = 0;
        this.scanVersionSnapshot = null;
    }

    // Camera body dimensions (must match CameraVisualizer in ComponentVisualizers.tsx)
    static readonly BODY_WIDTH  = 84;
    static readonly BODY_HEIGHT = 84;
    static readonly BODY_DEPTH  = 122;

    intersect(rayLocal: Ray): HitRecord | null {
        // The camera body is a solid box:
        //   x: [-BODY_WIDTH/2,  +BODY_WIDTH/2]
        //   y: [-BODY_HEIGHT/2, +BODY_HEIGHT/2]
        //   z: [-BODY_DEPTH,    0]              (sensor face at z=0, body extends behind)
        const hw = Camera.BODY_WIDTH / 2;
        const hh = Camera.BODY_HEIGHT / 2;
        const minZ = -Camera.BODY_DEPTH;

        const ox = rayLocal.origin.x, oy = rayLocal.origin.y, oz = rayLocal.origin.z;
        const dx = rayLocal.direction.x, dy = rayLocal.direction.y, dz = rayLocal.direction.z;

        // Slab-based ray-AABB intersection
        let tMin = -Infinity, tMax = Infinity;
        let normalAxis = 0; // 0=x, 1=y, 2=z
        let normalSign = 1;

        // X slab
        if (Math.abs(dx) < 1e-12) {
            if (ox < -hw || ox > hw) return null;
        } else {
            let t1 = (-hw - ox) / dx;
            let t2 = ( hw - ox) / dx;
            let sign = -1;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
            if (t1 > tMin) { tMin = t1; normalAxis = 0; normalSign = sign; }
            if (t2 < tMax) tMax = t2;
            if (tMin > tMax) return null;
        }

        // Y slab
        if (Math.abs(dy) < 1e-12) {
            if (oy < -hh || oy > hh) return null;
        } else {
            let t1 = (-hh - oy) / dy;
            let t2 = ( hh - oy) / dy;
            let sign = -1;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
            if (t1 > tMin) { tMin = t1; normalAxis = 1; normalSign = sign; }
            if (t2 < tMax) tMax = t2;
            if (tMin > tMax) return null;
        }

        // Z slab
        if (Math.abs(dz) < 1e-12) {
            if (oz < minZ || oz > 0) return null;
        } else {
            let t1 = (minZ - oz) / dz;
            let t2 = (0    - oz) / dz;
            let sign = -1;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
            if (t1 > tMin) { tMin = t1; normalAxis = 2; normalSign = sign; }
            if (t2 < tMax) tMax = t2;
            if (tMin > tMax) return null;
        }

        const t = tMin > 0.001 ? tMin : (tMax > 0.001 ? tMax : -1);
        if (t < 0.001) return null;

        const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
        const normal = new Vector3(0, 0, 0);
        if (normalAxis === 0) normal.x = normalSign;
        else if (normalAxis === 1) normal.y = normalSign;
        else normal.z = normalSign;

        return {
            t,
            point: hitPoint,
            normal,
            localPoint: hitPoint,
        };
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        // Absorb
        return { rays: [] };
    }
}
