import { Vector3, Box3, Euler, Quaternion, BoxGeometry } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { SpectralProfile } from '../SpectralProfile';
import { OpticMesh, NormalFn } from '../OpticMesh';

/**
 * Sample — Mickey Mouse, roughly 1mm in diameter similar to my normal samples.
 *
 * Physics:
 *   - Brightfield: Beer-Lambert absorption based on ray path length through material.
 *     T = exp(-α·d) where α = absorption coefficient, d = chord length.
 *   - Fluorescence metadata (excitation/emission spectra) is stored here
 *     for Solver 3 to query when backward rays hit the sample.
 *     The Sample does NOT generate emission rays itself.
 */
export class Sample extends OpticalComponent {
    excitationSpectrum: SpectralProfile;   // What wavelengths excite this fluorophore
    emissionSpectrum: SpectralProfile;     // What wavelengths are emitted
    fluorescenceEfficiency: number;        // Quantum yield × absorption (dimensionless)
    absorption: number;                    // Beer-Lambert coeff (mm⁻¹). Higher = more opaque.
    refractiveIndexDelta: number = 0;      // Refractive index difference from immersion medium

    // Internal specimen rotation: Allows rotating the Mickey Mouse independent of the outer boundary box (e.g. for SPIM SampleChamber cups to remain unspilled)
    specimenRotation: Euler = new Euler(0, 0, 0);

    // Internal specimen offset: translates the Mickey within the holder, ±5mm.
    // Designed to later integrate with animation channels for scanning.
    specimenOffset: Vector3 = new Vector3(0, 0, 0);

    // Mickey Mouse geometry definition (local space)
    // Scaled by 2/3 and centered for better specimen proportions.
    private static readonly MICKEY_SCALE = 2 / 3;
    private static readonly MICKEY_CENTER = new Vector3(0, 0.125, 0);

    private static readonly SPHERES = [
        { center: new Vector3(0, 0, 0).sub(Sample.MICKEY_CENTER).multiplyScalar(Sample.MICKEY_SCALE), radius: 0.5 * Sample.MICKEY_SCALE },
        { center: new Vector3(-0.5, 0.5, 0).sub(Sample.MICKEY_CENTER).multiplyScalar(Sample.MICKEY_SCALE), radius: 0.25 * Sample.MICKEY_SCALE },
        { center: new Vector3(0.5, 0.5, 0).sub(Sample.MICKEY_CENTER).multiplyScalar(Sample.MICKEY_SCALE), radius: 0.25 * Sample.MICKEY_SCALE },
    ];

    private static readonly BOUNDS = (() => {
        const bounds = new Box3();
        for (const sphere of Sample.SPHERES) {
            bounds.expandByPoint(sphere.center.clone().addScalar(sphere.radius));
            bounds.expandByPoint(sphere.center.clone().addScalar(-sphere.radius));
        }
        // Add margin for the interaction region around the specimen
        bounds.min.addScalar(-5);
        bounds.max.addScalar(5);
        return bounds;
    })();

    private _mesh: OpticMesh | null = null;
    private _volumeLocalOrigin: Vector3 = new Vector3();
    private _volumeLocalDir: Vector3 = new Vector3();
    private _chordLocalOrigin: Vector3 = new Vector3();
    private _chordLocalDir: Vector3 = new Vector3();
    private _chordSpecOrigin: Vector3 = new Vector3();
    private _chordSpecDir: Vector3 = new Vector3();
    private _chordInvQ: Quaternion = new Quaternion();

    static getSpecimenSpheresCanonical(): { center: Vector3; radius: number }[] {
        return Sample.SPHERES.map(sphere => ({
            center: sphere.center.clone(),
            radius: sphere.radius,
        }));
    }

    constructor(name: string = "Sample (Mickey)") {
        super(name);
        // GFP-like
        this.excitationSpectrum = new SpectralProfile('bandpass', 500, [{ center: 488, width: 30 }]);
        this.emissionSpectrum = new SpectralProfile('bandpass', 500, [{ center: 520, width: 40 }]);
        this.fluorescenceEfficiency = 0.5; // Fluorescence quantum yield (0–1)
        this.absorption = 0.1;              // Reduced Beer-Lambert coeff
        // Holder frame (from SampleVisualizer): 40×40×2 outer
        this.bounds.set(new Vector3(-20, -20, -1), new Vector3(20, 20, 1));
    }

    getSpecimenSpheresLocal(): { center: Vector3; radius: number }[] {
        const rotation = new Quaternion().setFromEuler(this.specimenRotation);
        return Sample.getSpecimenSpheresCanonical().map(sphere => ({
            center: sphere.center.clone().applyQuaternion(rotation).add(this.specimenOffset),
            radius: sphere.radius,
        }));
    }

    getSpecimenBoundsLocal(): Box3 {
        const bounds = new Box3();
        for (const sphere of this.getSpecimenSpheresLocal()) {
            const center = sphere.center;
            bounds.expandByPoint(center.clone().addScalar(sphere.radius));
            bounds.expandByPoint(center.clone().addScalar(-sphere.radius));
        }
        return bounds;
    }

    getVolumeBoundsLocal(): Box3 {
        return this.getSpecimenBoundsLocal();
    }

    getFieldBoundsLocal(): Box3 {
        return this.getSpecimenBoundsLocal();
    }

    get mesh(): OpticMesh {
        if (!this._mesh) {
            this._mesh = new OpticMesh();
            const box = Sample.BOUNDS;
            const size = box.getSize(new Vector3());
            const geometry = new BoxGeometry(size.x, size.y, size.z);
            const normalFn: NormalFn = (v: Vector3) => {
                const n = new Vector3();
                if (Math.abs(v.x - box.max.x) < 0.01) n.x = 1;
                else if (Math.abs(v.x - box.min.x) < 0.01) n.x = -1;
                else if (Math.abs(v.y - box.max.y) < 0.01) n.y = 1;
                else if (Math.abs(v.y - box.min.y) < 0.01) n.y = -1;
                else if (Math.abs(v.z - box.max.z) < 0.01) n.z = 1;
                else if (Math.abs(v.z - box.min.z) < 0.01) n.z = -1;
                return n.normalize();
            };
            this._mesh.build(geometry, normalFn);
        }
        return this._mesh;
    }

    /**
     * Query excitation efficiency at a given wavelength (0–1).
     * Used by Solver 3 to weight fluorescence by spectral overlap.
     */
    getExcitationEfficiency(wavelengthNm: number): number {
        return this.excitationSpectrum.getTransmission(wavelengthNm);
    }

    /**
     * Get the dominant emission wavelength (nm) for backward ray tracing.
     * Returns the peak of the emission spectrum, or 520nm fallback.
     */
    getEmissionWavelength(): number {
        return this.emissionSpectrum.getDominantPassWavelength() ?? 520;
    }

    /**
     * Get the dominant excitation wavelength (nm).
     * Returns the peak of the excitation spectrum, or 488nm fallback.
     */
    getExcitationWavelength(): number {
        return this.excitationSpectrum.getDominantPassWavelength() ?? 488;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Compute analytical intersection with the AABB
        const box = Sample.BOUNDS;
        let tMin = -Infinity, tMax = Infinity;
        let normal = new Vector3();

        const checkAxis = (originCoord: number, dirCoord: number, minBound: number, maxBound: number, axisNormal: Vector3) => {
            if (Math.abs(dirCoord) < 1e-12) {
                if (originCoord < minBound || originCoord > maxBound) return false;
            } else {
                let t1 = (minBound - originCoord) / dirCoord;
                let t2 = (maxBound - originCoord) / dirCoord;
                let n1 = axisNormal.clone().multiplyScalar(-1);
                let n2 = axisNormal.clone();
                if (t1 > t2) {
                    const temp = t1; t1 = t2; t2 = temp;
                    const tempN = n1; n1 = n2; n2 = tempN;
                }
                if (t1 > tMin) { tMin = t1; normal = n1; }
                if (t2 < tMax) tMax = t2;
                if (tMin > tMax) return false;
                if (tMax < 0) return false;
            }
            return true;
        };

        if (!checkAxis(rayLocal.origin.x, rayLocal.direction.x, box.min.x, box.max.x, new Vector3(1, 0, 0))) return null;
        if (!checkAxis(rayLocal.origin.y, rayLocal.direction.y, box.min.y, box.max.y, new Vector3(0, 1, 0))) return null;
        if (!checkAxis(rayLocal.origin.z, rayLocal.direction.z, box.min.z, box.max.z, new Vector3(0, 0, 1))) return null;

        const t = tMin > 0 ? tMin : tMax;
        if (t < 0) return null;

        const localPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
        return {
            t,
            point: localPoint, // gets mapped to world by chkIntersection
            normal,
            localPoint
        };
    }

    /**
     * Get the near and far planes of the sample volume for a world ray.
     * Used by Solver 3 strictly to evaluate the internal E&M field integral.
     */
    getVolumeIntersection(worldRay: Ray): { tNear: number, tFar: number } | null {
        this.updateMatrices();
        const localOrigin = this._volumeLocalOrigin.copy(worldRay.origin).applyMatrix4(this.worldToLocal);
        const localDir = this._volumeLocalDir.copy(worldRay.direction).transformDirection(this.worldToLocal).normalize();

        // Analytical AABB slab intersection — no triangle mesh, no edge artifacts.
        const box = Sample.BOUNDS;
        let tMin = -Infinity, tMax = Infinity;

        // X slab
        if (Math.abs(localDir.x) < 1e-12) {
            if (localOrigin.x < box.min.x || localOrigin.x > box.max.x) return null;
        } else {
            let t1 = (box.min.x - localOrigin.x) / localDir.x;
            let t2 = (box.max.x - localOrigin.x) / localDir.x;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            tMin = Math.max(tMin, t1);
            tMax = Math.min(tMax, t2);
            if (tMin > tMax) return null;
        }

        // Y slab
        if (Math.abs(localDir.y) < 1e-12) {
            if (localOrigin.y < box.min.y || localOrigin.y > box.max.y) return null;
        } else {
            let t1 = (box.min.y - localOrigin.y) / localDir.y;
            let t2 = (box.max.y - localOrigin.y) / localDir.y;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            tMin = Math.max(tMin, t1);
            tMax = Math.min(tMax, t2);
            if (tMin > tMax) return null;
        }

        // Z slab
        if (Math.abs(localDir.z) < 1e-12) {
            if (localOrigin.z < box.min.z || localOrigin.z > box.max.z) return null;
        } else {
            let t1 = (box.min.z - localOrigin.z) / localDir.z;
            let t2 = (box.max.z - localOrigin.z) / localDir.z;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            tMin = Math.max(tMin, t1);
            tMax = Math.min(tMax, t2);
            if (tMin > tMax) return null;
        }

        return { tNear: Math.max(0, tMin), tFar: Math.max(0, tMax) };
    }

    /**
     * Compute segments of the ray that pass through the Mickey geometry.
     * Returns an array of { tStart, tEnd } in world-space distances along the ray.
     */
    computeChordSegments(worldRay: Ray): { tStart: number; tEnd: number }[] {
        // Transform ray to local space
        this.updateMatrices();
        const localOrigin = this._chordLocalOrigin.copy(worldRay.origin).applyMatrix4(this.worldToLocal);
        const localDir = this._chordLocalDir.copy(worldRay.direction).transformDirection(this.worldToLocal).normalize();

        // Apply specimen offset/rotation. These are rigid transforms with unit
        // scale, so the sphere-intersection t values remain world-ray distances.
        const invQ = this._chordInvQ.setFromEuler(this.specimenRotation).invert();
        const specOrigin = this._chordSpecOrigin.copy(localOrigin).sub(this.specimenOffset).applyQuaternion(invQ);
        const specDir = this._chordSpecDir.copy(localDir).applyQuaternion(invQ);

        const segments: { tStart: number; tEnd: number }[] = [];

        for (const sphere of Sample.SPHERES) {
            const ocX = specOrigin.x - sphere.center.x;
            const ocY = specOrigin.y - sphere.center.y;
            const ocZ = specOrigin.z - sphere.center.z;
            const b = ocX * specDir.x + ocY * specDir.y + ocZ * specDir.z;
            const c = ocX * ocX + ocY * ocY + ocZ * ocZ - sphere.radius * sphere.radius;
            const h = b * b - c;

            if (h >= 0) {
                const sqrtH = Math.sqrt(h);
                const t1 = -b - sqrtH;
                const t2 = -b + sqrtH;

                // Only count positive intersections
                const tEntry = Math.max(t1, 0);
                const tExit = Math.max(t2, 0);

                if (tExit > tEntry) {
                    segments.push({
                        tStart: tEntry,
                        tEnd: tExit
                    });
                }
            }
        }

        // Merge overlapping segments if necessary (simple version: just return all)
        return segments;
    }

    /** Legacy helper for absorption (sum of segments) */
    computeChordLength(worldRay: Ray): { chordLength: number; midT: number } {
        const segs = this.computeChordSegments(worldRay);
        let total = 0;
        let weightedT = 0;
        for (const s of segs) {
            const d = s.tEnd - s.tStart;
            total += d;
            weightedT += ((s.tStart + s.tEnd) / 2) * d;
        }
        if (total === 0) return { chordLength: 0, midT: 0 };
        return { chordLength: total, midT: weightedT / total };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Brightfield pass-through. Ignore this.mesh refraction so the excitation
        // beam doesn't get trapped by TIR in the bounding box.
        // We just return a ray that continues straight.
        return {
            rays: [childRay(ray, {
                origin: hit.point.clone(),
                direction: ray.direction.clone(),
                opticalPathLength: ray.opticalPathLength + hit.t
            })]
        };
    }
}
