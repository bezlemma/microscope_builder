import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { reflectVector } from '../math_solvers';

/**
 * PolygonScanner — Spinning Polygon Scan Mirror
 *
 * A regular N-sided polygon with reflective facets, used for
 * laser beam scanning. The polygon rotates around its center axis
 * (local Z), sweeping the reflected beam across the output field.
 *
 * Local coordinate system:
 *   - XY plane: polygon face plane (beams travel here)
 *   - Z axis:   spin axis (perpendicular to table)
 *
 * Parameters:
 *   - numFaces:        Number of reflective facets (3–12)
 *   - inscribedRadius: Distance from center to face midpoint (apothem, mm)
 *   - faceHeight:      Height of each reflective facet (mm)
 *   - scanAngle:       Current rotation angle of the polygon (radians)
 *
 * Derived:
 *   - circumRadius = inscribedRadius / cos(π / numFaces)
 *
 * Physics: Each facet is a perfect flat mirror. The reflected
 * beam direction depends on which face the ray hits, which in
 * turn depends on scanAngle. As scanAngle changes, the beam sweeps.
 *
 * The scan angle per full facet is 2π / numFaces. Because the
 * reflection doubles the angular change, the total output scan
 * angle per facet = 2 × (2π / numFaces) = 4π / numFaces.
 */
export class PolygonScanner extends OpticalComponent {
    numFaces: number;
    inscribedRadius: number;
    faceHeight: number;
    scanAngle: number;          // Current rotation (radians)

    constructor({
        numFaces = 6,
        inscribedRadius = 10,
        faceHeight = 10,
        scanAngle = 0,
        name = 'Polygon Scanner',
    }: {
        numFaces?: number;
        inscribedRadius?: number;
        faceHeight?: number;
        scanAngle?: number;
        name?: string;
    } = {}) {
        super(name);
        this.numFaces = Math.max(3, Math.round(numFaces));
        this.inscribedRadius = inscribedRadius;
        this.faceHeight = faceHeight;
        this.scanAngle = scanAngle;
        this._updateBounds();
    }

    /** Circumscribed radius (center to vertex). */
    get circumRadius(): number {
        return this.inscribedRadius / Math.cos(Math.PI / this.numFaces);
    }

    /** Half-width of a single facet. */
    get faceHalfWidth(): number {
        return this.circumRadius * Math.sin(Math.PI / this.numFaces);
    }

    recalculate(): void {
        this._updateBounds();
    }

    private _updateBounds(): void {
        const R = this.circumRadius;
        const hh = this.faceHeight / 2;
        this.bounds.set(
            new Vector3(-R, -R, -hh),
            new Vector3(R, R, hh)
        );
    }

    // ── Geometry helpers (local XY plane) ──────────────────

    /** Vertex k position in local space (XY plane, z=0). */
    private _vertex(k: number): [number, number] {
        const angle = this.scanAngle + k * (2 * Math.PI / this.numFaces);
        const R = this.circumRadius;
        return [R * Math.cos(angle), R * Math.sin(angle)];
    }

    /** Outward-pointing normal for face k (local XY, unit vector). */
    private _faceNormal(k: number): [number, number] {
        const midAngle = this.scanAngle + (k + 0.5) * (2 * Math.PI / this.numFaces);
        return [Math.cos(midAngle), Math.sin(midAngle)];
    }

    // ── Ray intersection ───────────────────────────────────

    intersect(rayLocal: Ray): HitRecord | null {
        const N = this.numFaces;
        const halfH = this.faceHeight / 2;

        let bestT = Infinity;
        let bestHit: HitRecord | null = null;

        for (let k = 0; k < N; k++) {
            const [nx, ny] = this._faceNormal(k);

            // Only consider rays approaching from outside (dot < 0)
            const nDotD = nx * rayLocal.direction.x + ny * rayLocal.direction.y;
            if (nDotD >= 0) continue;

            // Ray-plane intersection: t = n · (v0 - O) / (n · D)
            const [v0x, v0y] = this._vertex(k);
            const dx = v0x - rayLocal.origin.x;
            const dy = v0y - rayLocal.origin.y;
            const t = (nx * dx + ny * dy) / nDotD;
            if (t < 1e-6 || t >= bestT) continue;

            // Hit point
            const hitX = rayLocal.origin.x + t * rayLocal.direction.x;
            const hitY = rayLocal.origin.y + t * rayLocal.direction.y;
            const hitZ = rayLocal.origin.z + t * rayLocal.direction.z;

            // Z bounds (face height)
            if (Math.abs(hitZ) > halfH) continue;

            // Face bounds: project onto tangent (v0 → v1)
            const [v1x, v1y] = this._vertex((k + 1) % N);
            const tx = v1x - v0x;
            const ty = v1y - v0y;
            const faceLen = Math.sqrt(tx * tx + ty * ty);
            const proj = ((hitX - v0x) * tx + (hitY - v0y) * ty) / faceLen;
            if (proj < 0 || proj > faceLen) continue;

            bestT = t;
            const hitPoint = new Vector3(hitX, hitY, hitZ);
            bestHit = {
                t,
                point: hitPoint,
                normal: new Vector3(nx, ny, 0),
                localPoint: hitPoint.clone()
            };
        }

        return bestHit;
    }

    // ── Interaction: mirror reflection ─────────────────────

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        const reflectedDir = reflectVector(ray.direction, hit.normal);

        // Mirror reflection: π phase shift (E → -E)
        const polX = ray.polarization.x;
        const polY = ray.polarization.y;

        return {
            rays: [childRay(ray, {
                origin: hit.point,
                direction: reflectedDir,
                polarization: {
                    x: { re: -polX.re, im: -polX.im },
                    y: { re: -polY.re, im: -polY.im }
                },
                opticalPathLength: ray.opticalPathLength + hit.t
            })]
        };
    }

    // ── Solver 2 support ──────────────────────────────────

    /** ABCD matrix: flat mirror = identity. */
    getABCD(): [number, number, number, number] {
        return [1, 0, 0, 1];
    }

    getApertureRadius(): number {
        return this.circumRadius;
    }

    get label(): string {
        return `${this.numFaces}-face polygon`;
    }
}
