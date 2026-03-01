import { Vector3, Box3, Euler, Quaternion, BoxGeometry } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
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

    // Internal specimen rotation: Allows rotating the Mickey Mouse independent of the outer boundary box (e.g. for SPIM SampleChamber cups to remain unspilled)
    specimenRotation: Euler = new Euler(0, 0, 0);

    // Internal specimen offset: translates the Mickey within the holder, ±5mm.
    // Designed to later integrate with animation channels for scanning.
    specimenOffset: Vector3 = new Vector3(0, 0, 0);

    // Mickey Mouse geometry definition (local space)
    // Frame is in XY plane (standing upright at default rotation),
    // holder normal is along Z, ears point +Y (up), spread in ±X.
    private static readonly SPHERES = [
        { center: new Vector3(0, 0, 0), radius: 0.5 },        // Head
        { center: new Vector3(-0.5, 0.5, 0), radius: 0.25 },  // Left ear (+Y up, -X left)
        { center: new Vector3(0.5, 0.5, 0), radius: 0.25 },   // Right ear (+Y up, +X right)
    ];

    private static readonly BOUNDS = new Box3(
        new Vector3(-15, -15, -10),
        new Vector3(15, 15, 10)
    );

    private _mesh: OpticMesh | null = null;

    constructor(name: string = "Sample (Mickey)") {
        super(name);
        // GFP-like
        this.excitationSpectrum = new SpectralProfile('bandpass', 500, [{ center: 488, width: 30 }]);
        this.emissionSpectrum = new SpectralProfile('bandpass', 500, [{ center: 520, width: 40 }]);
        this.fluorescenceEfficiency = 0.5; // Fluorescence quantum yield (0–1)
        this.absorption = 0.1;              // Reduced Beer-Lambert coeff
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
        const meshHit = this.mesh.intersectRay(rayLocal.origin, rayLocal.direction);
        if (!meshHit) return null;

        return {
            t: meshHit.t,
            point: meshHit.point,
            normal: meshHit.normal,
            localPoint: meshHit.point.clone()
        };
    }

    /**
     * Get the near and far planes of the sample volume for a world ray.
     * Used by Solver 3 strictly to evaluate the internal E&M field integral.
     */
    getVolumeIntersection(worldRay: Ray): { tNear: number, tFar: number } | null {
        this.updateMatrices();
        const localOrigin = worldRay.origin.clone().applyMatrix4(this.worldToLocal);
        const localDir = worldRay.direction.clone().transformDirection(this.worldToLocal).normalize();

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
        const localOrigin = worldRay.origin.clone().applyMatrix4(this.worldToLocal);
        const localDir = worldRay.direction.clone().transformDirection(this.worldToLocal).normalize();

        // Apply specimen internal offset
        const offsetOrigin = localOrigin.clone().sub(this.specimenOffset);

        // Apply specimen internal rotation
        const invQ = new Quaternion().setFromEuler(this.specimenRotation).invert();
        const specOrigin = offsetOrigin.applyQuaternion(invQ);
        const specDir = localDir.clone().applyQuaternion(invQ);

        const segments: { tStart: number; tEnd: number }[] = [];

        for (const sphere of Sample.SPHERES) {
            const oc = specOrigin.clone().sub(sphere.center);
            const b = oc.dot(specDir);
            const c = oc.dot(oc) - sphere.radius * sphere.radius;
            const h = b * b - c;

            if (h >= 0) {
                const sqrtH = Math.sqrt(h);
                const t1 = -b - sqrtH;
                const t2 = -b + sqrtH;

                // Only count positive intersections
                const tEntry = Math.max(t1, 0);
                const tExit = Math.max(t2, 0);

                if (tExit > tEntry) {
                    // Convert local sphere intersection 't' back to world 't'.
                    // Since scale is 1, world 't' delta matches local 't' delta.
                    // We need to project the local hit point back to world space
                    // to find the exact world-ray 't'.
                    const pEntrySpec = specOrigin.clone().add(specDir.clone().multiplyScalar(tEntry));
                    const pExitSpec = specOrigin.clone().add(specDir.clone().multiplyScalar(tExit));
                    
                    const q = new Quaternion().setFromEuler(this.specimenRotation);
                    
                    const specToWorld = (p: Vector3) => {
                        const p2 = p.clone().applyQuaternion(q).add(this.specimenOffset);
                        p2.applyMatrix4(this.localToWorld);
                        return p2.sub(worldRay.origin).dot(worldRay.direction);
                    };

                    segments.push({
                        tStart: specToWorld(pEntrySpec),
                        tEnd: specToWorld(pExitSpec)
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
        // Brightfield pass-through: ray continues unchanged.
        // But since we use OpticMesh, it will generate tags for Solver 2
        // to handle absorption through the volume.
        return this.mesh.interact(
            hit.normal,
            ray.direction.clone().transformDirection(this.worldToLocal).normalize(),
            hit.localPoint!,
            1.0, // Index 1.0 (sample is basically air + fluorophores)
            this.localToWorld,
            hit.point,
            ray
        );
    }
}
