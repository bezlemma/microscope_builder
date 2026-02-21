import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';

/**
 * PMT (Photo-Multiplier Tube) — a point detector that records total incident
 * light intensity. Unlike a Camera (which has a 2D sensor), the PMT sums all
 * light hitting it into a single scalar. To build 2D images, it raster-scans
 * through two animation axes (e.g., two galvo mirrors for X and Y).
 */
export class PMT extends OpticalComponent {
    width: number;
    height: number;

    // Axis binding — which components/properties form the X and Y scan axes
    xAxisComponentId: string | null = null;
    xAxisProperty: string | null = null;
    yAxisComponentId: string | null = null;
    yAxisProperty: string | null = null;

    // Solver 3 backward trace parameters (PMT acts as a 1-pixel camera)
    sensorNA: number = 0.01;        // Acceptance cone half-angle (matches Camera default)
    samplesPerPixel: number = 100;   // Monte Carlo samples per galvo position

    // Raster scan result
    scanResX: number = 64;
    scanResY: number = 64;
    scanImage: Float32Array | null = null;    // Raster-scanned image (resX × resY)
    scanStale: boolean = true;
    /** PMT sample rate in Hz — combined with galvo Hz values to derive scan resolution */
    pmtSampleHz: number = 4096;
    /** Component version snapshot at scan completion (used to detect non-animation edits) */
    scanVersionSnapshot: Map<string, number> | null = null;

    constructor(width: number = 10, height: number = 10, name: string = "PMT Detector") {
        super(name);
        this.width = width;
        this.height = height;
    }

    /** Mark the scan result as stale. Keeps the image if it exists. */
    markScanStale(): void {
        this.scanStale = true;
    }

    /** Clear scan data entirely (called at the start of a new scan). */
    clearScan(): void {
        this.scanImage = null;
        this.scanStale = true;
        this.scanVersionSnapshot = null;
    }

    /** Check if the PMT has valid axis bindings for raster scanning. */
    hasValidAxes(): boolean {
        return !!(this.xAxisComponentId && this.xAxisProperty && this.yAxisComponentId && this.yAxisProperty);
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Sensor plane at z=0, facing +z direction
        const ow = rayLocal.origin.z;
        const dw = rayLocal.direction.z;

        if (Math.abs(dw) < 1e-6) return null;

        const t = -ow / dw;
        if (t < 0.001) return null;

        const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));

        // Check bounds
        const hu = hitPoint.x;
        const hv = hitPoint.y;
        if (Math.abs(hu) > this.width / 2 || Math.abs(hv) > this.height / 2) {
            return null;
        }

        return {
            t: t,
            point: hitPoint,
            normal: new Vector3(0, 0, 1),
            localPoint: hitPoint
        };
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        // Absorb — point detector
        return { rays: [] };
    }
}
