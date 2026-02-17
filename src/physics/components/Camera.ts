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

    intersect(rayLocal: Ray): HitRecord | null {
        // Sensor plane at w=0, facing +w direction
        const ow = rayLocal.origin.z;
        const dw = rayLocal.direction.z;

        if (Math.abs(dw) < 1e-6) return null;

        const t = -ow / dw;
        if (t < 0.001) return null;

        const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));

        // Check bounds in uv transverse plane
        const hu = hitPoint.x;  // u coordinate
        const hv = hitPoint.y;  // v coordinate
        if (Math.abs(hu) > this.width / 2 || Math.abs(hv) > this.height / 2) {
            return null;
        }

        return {
            t: t,
            point: hitPoint,
            normal: new Vector3(0, 0, 1),  // +w normal
            localPoint: hitPoint
        };
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        // Absorb
        return { rays: [] };
    }
}
