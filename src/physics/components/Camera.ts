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
    detectorLaunchModel: 'stochastic' | 'packet' = 'stochastic';
    fieldPixelPitchOverrideX: number = 0;  // Override for field pixel pitch (0 = auto)
    fieldPixelPitchOverrideY: number = 0;

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
        this.samplesPerPixel = 4;   // 4 rays per pixel default
        // Housing (from CameraVisualizer): 84×84×122 box centered at z = -depth/2
        this.bounds.set(
            new Vector3(-42, -42, -122),
            new Vector3(42, 42, 0.5),
        );
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

        // Slab-based ray-AABB intersection.
        // Track which face is responsible for both the entry (tMin) and exit (tMax)
        // so we return the correct normal regardless of whether the ray starts
        // outside or inside the body.
        let tMin = -Infinity, tMax = Infinity;
        let minAxis = 0, minSign = 1;   // face hit when entering (tMin)
        let maxAxis = 0, maxSign = 1;   // face hit when exiting (tMax)

        const slab = (o: number, d: number, lo: number, hi: number, axis: number): boolean => {
            if (Math.abs(d) < 1e-12) {
                return o >= lo && o <= hi;
            }
            let t1 = (lo - o) / d;
            let t2 = (hi - o) / d;
            // t1 corresponds to the 'lo' plane (outward normal = -axis),
            // t2 corresponds to the 'hi' plane (outward normal = +axis).
            let s1 = -1, s2 = 1;
            if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; const ss = s1; s1 = s2; s2 = ss; }
            if (t1 > tMin) { tMin = t1; minAxis = axis; minSign = s1; }
            if (t2 < tMax) { tMax = t2; maxAxis = axis; maxSign = s2; }
            return tMin <= tMax;
        };

        if (!slab(ox, dx, -hw, hw, 0)) return null;
        if (!slab(oy, dy, -hh, hh, 1)) return null;
        if (!slab(oz, dz, minZ, 0, 2)) return null;

        let t: number;
        let normalAxis: number, normalSign: number;
        if (tMin > 0.001) {
            t = tMin; normalAxis = minAxis; normalSign = minSign;
        } else if (tMax > 0.001) {
            // Ray origin was inside the body — use the exit face normal.
            t = tMax; normalAxis = maxAxis; normalSign = maxSign;
        } else {
            return null;
        }

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
