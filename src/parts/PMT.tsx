import { Vector3 } from 'three';
import { OpticalComponent } from '../physics/Component';
import { Ray, HitRecord, InteractionResult } from '../physics/types';

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
    samplesPerPixel: number = 4;     // Monte Carlo samples per galvo position

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
        const ow = rayLocal.origin.x;
        const dw = rayLocal.direction.x;

        if (Math.abs(dw) < 1e-6) return null;

        const t = -ow / dw;
        if (t < 0.001) return null;

        const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));

        // Check bounds
        const hu = hitPoint.y;
        const hv = hitPoint.z;
        if (Math.abs(hu) > this.width / 2 || Math.abs(hv) > this.height / 2) {
            return null;
        }

        return {
            t: t,
            point: hitPoint,
            normal: new Vector3(1, 0, 0),
            localPoint: hitPoint
        };
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        // Absorb — point detector
        return { rays: [] };
    }
}

// ─── Visualizer ────────────────────────────────────────────

export const PMTVisualizer = ({ component }: { component: PMT }) => {
    const width = 20;
    const height = 20;
    const depth = 30;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[0, 0, 0]}>
                <boxGeometry args={[depth, width, height]} />
                <meshStandardMaterial color="#555" metalness={0.5} roughness={0.5} />
            </mesh>
            <mesh position={[depth / 2 + 0.1, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
                <circleGeometry args={[width * 0.3, 32]} />
                <meshStandardMaterial color="rgba(134, 45, 175, 1)" metalness={0.8} roughness={0.15} />
            </mesh>
        </group>
    );
};

