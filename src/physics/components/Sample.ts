import { Vector3, Box3, Euler, Quaternion, BoxGeometry } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { SpectralProfile } from '../SpectralProfile';
import { OpticMesh, NormalFn } from '../OpticMesh';

export type SampleSpecimenKind = 'mickey' | 'colloids';

export interface ColloidSpecimen {
    center: Vector3;
    radius: number;
    glowColor?: string;
}

export interface ColloidTrapZone {
    center: Vector3;
    lateralRadius: number;
    axialRange: number;
    stiffnessPerSecond?: number;
}

export const COLLOID_DISPLAY_COLORS = [
    '#5ac8ff',
    '#ff6b8a',
    '#ffd166',
    '#7ee081',
    '#b084f5',
    '#ff9f43',
    '#4dd4ac',
    '#f78bd8',
    '#9ad0ff',
    '#f6e27f',
    '#78e6f2',
    '#c3f584',
];

export function defaultColloidColor(index: number): string {
    return COLLOID_DISPLAY_COLORS[index % COLLOID_DISPLAY_COLORS.length]!;
}

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

    /** Which specimen is mounted inside the ordinary 2D holder. */
    specimenKind: SampleSpecimenKind = 'mickey';
    /** Colloid centers/radii in local holder coordinates, for flow-cell samples. */
    colloidSpheres: ColloidSpecimen[] = [];
    /** Width/height of the water-filled flow-cell region, in local holder coordinates. */
    flowCellWidth: number = 8;
    flowCellHeight: number = 5;
    /** Inner water thickness along local W/Z. */
    flowCellDepth: number = 0.08;
    /** Coverslip/end-glass thickness at +/- W/Z. */
    flowCellGlassThickness: number = 0.17;
    /** Medium inside the holder. This is metadata for viewers/presets for now. */
    fillMediumIndex: number = 1.33;
    /** Color used for visible colloid glow halos. */
    colloidGlowColor: string = '#007fff';
    /** Brownian medium settings for colloid flow-cell specimens. */
    colloidTemperatureK: number = 295;
    colloidViscosity: number = 1e-3;
    /** Demo time-scale multiplier for passive beads. The physical bead radius
     *  and trap geometry stay micron-scale; this controls how fast the viewer
     *  advances diffusion so users can see it during a short interaction. */
    colloidDiffusionScale: number = 1;
    private _lastColloidStepTimeMs: number | null = null;

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

    static makeDefaultColloids(
        count: number = 10,
        radius: number = 0.0025,
        width: number = 4,
        height: number = 3,
        depth: number = 0.08,
    ): ColloidSpecimen[] {
        const seed = [
            [-2.6, -1.4, -0.018],
            [-1.7, 0.9, 0.013],
            [-0.9, -0.3, -0.006],
            [-0.2, 1.35, 0.021],
            [0.45, -1.15, -0.015],
            [1.1, 0.15, 0.003],
            [1.9, 1.05, -0.024],
            [2.45, -0.65, 0.018],
            [-2.25, 1.55, 0.0],
            [2.75, 0.55, -0.008],
        ];
        if (count <= seed.length && width <= 4 && height <= 3 && depth >= 0.04) {
            return seed.slice(0, count).map(([x, y, z], index) => ({
                center: new Vector3(x, y, z),
                radius,
                glowColor: defaultColloidColor(index),
            }));
        }

        const usableW = Math.max(radius * 2, width - radius * 2);
        const usableH = Math.max(radius * 2, height - radius * 2);
        const usableD = Math.max(0, depth - radius * 2);
        return Array.from({ length: count }, (_, i) => {
            const nearTrap = i < Math.min(12, count);
            const fx = fract((i + 1) * 0.61803398875);
            const fy = fract((i + 1) * 0.41421356237);
            const fz = fract((i + 1) * 0.73205080757);
            const spread = nearTrap ? 0.07 : 1;
            const x = (fx - 0.5) * usableW * spread;
            const y = (fy - 0.5) * usableH * spread;
            const z = usableD > 0 ? (fz - 0.5) * usableD : 0;
            return {
                center: new Vector3(x, y, z),
                radius,
                glowColor: defaultColloidColor(i),
            };
        });
    }

    stepColloidDiffusion(nowMs: number, trapZones: ColloidTrapZone[] = []): boolean {
        if (this.specimenKind !== 'colloids' || this.colloidSpheres.length === 0) return false;
        const lastMs = this._lastColloidStepTimeMs;
        this._lastColloidStepTimeMs = nowMs;
        if (lastMs === null) return false;

        const dt = Math.max(1e-4, Math.min(0.1, (nowMs - lastMs) / 1000));
        const meanRadiusMm = this.colloidSpheres.reduce((sum, s) => sum + s.radius, 0) / this.colloidSpheres.length;
        const radiusMeters = Math.max(meanRadiusMm * 1e-3, 1e-12);
        const gammaSI = 6 * Math.PI * Math.max(this.colloidViscosity, 1e-8) * radiusMeters;
        const kBTsi = 1.380649e-23 * this.colloidTemperatureK;
        const sigmaMm = Math.sqrt(Math.max(0, 2 * kBTsi * dt / gammaSI)) * 1e3 * this.colloidDiffusionScale;

        let movedSq = 0;
        for (const sphere of this.colloidSpheres) {
            const oldX = sphere.center.x;
            const oldY = sphere.center.y;
            const oldZ = sphere.center.z;
            sphere.center.x = reflectIntoRange(
                sphere.center.x + sigmaMm * gaussianRandom(),
                -this.flowCellWidth / 2 + sphere.radius,
                this.flowCellWidth / 2 - sphere.radius,
            );
            sphere.center.y = reflectIntoRange(
                sphere.center.y + sigmaMm * gaussianRandom(),
                -this.flowCellHeight / 2 + sphere.radius,
                this.flowCellHeight / 2 - sphere.radius,
            );
            sphere.center.z = reflectIntoRange(
                sphere.center.z + sigmaMm * gaussianRandom(),
                -this.flowCellDepth / 2 + sphere.radius,
                this.flowCellDepth / 2 - sphere.radius,
            );
            for (const zone of trapZones) {
                const movedByTrap = applyColloidTrapZone(sphere, zone, dt);
                if (movedByTrap) {
                    sphere.center.z = reflectIntoRange(
                        sphere.center.z,
                        -this.flowCellDepth / 2 + sphere.radius,
                        this.flowCellDepth / 2 - sphere.radius,
                    );
                }
            }
            movedSq +=
                (sphere.center.x - oldX) * (sphere.center.x - oldX) +
                (sphere.center.y - oldY) * (sphere.center.y - oldY) +
                (sphere.center.z - oldZ) * (sphere.center.z - oldZ);
        }

        movedSq += resolveColloidOverlaps(
            this.colloidSpheres,
            this.flowCellWidth,
            this.flowCellHeight,
            this.flowCellDepth,
        );

        return movedSq > 1e-12;
    }

    pauseColloidDiffusion(): void {
        this._lastColloidStepTimeMs = null;
    }

    configureColloidFlowCell(options: {
        count?: number;
        radius?: number;
        width?: number;
        height?: number;
        depth?: number;
        glassThickness?: number;
        fillMediumIndex?: number;
        temperatureK?: number;
        viscosity?: number;
        diffusionScale?: number;
    } = {}): this {
        this.specimenKind = 'colloids';
        this.flowCellWidth = options.width ?? this.flowCellWidth;
        this.flowCellHeight = options.height ?? this.flowCellHeight;
        this.flowCellDepth = options.depth ?? this.flowCellDepth;
        this.flowCellGlassThickness = options.glassThickness ?? this.flowCellGlassThickness;
        this.fillMediumIndex = options.fillMediumIndex ?? this.fillMediumIndex;
        this.colloidTemperatureK = options.temperatureK ?? this.colloidTemperatureK;
        this.colloidViscosity = options.viscosity ?? this.colloidViscosity;
        this.colloidDiffusionScale = options.diffusionScale ?? this.colloidDiffusionScale;
        const radius = options.radius ?? 0.0025;
        this.colloidSpheres = Sample.makeDefaultColloids(
            options.count ?? 10,
            radius,
            this.flowCellWidth,
            this.flowCellHeight,
            this.flowCellDepth,
        );
        return this;
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


    private getBaseSpecimenSpheres(): { center: Vector3; radius: number }[] {
        if (this.specimenKind === 'colloids') {
            return this.colloidSpheres.map(sphere => ({
                center: sphere.center.clone(),
                radius: sphere.radius,
            }));
        }
        return Sample.getSpecimenSpheresCanonical();
    }

    getSpecimenSpheresLocal(): { center: Vector3; radius: number }[] {
        const rotation = new Quaternion().setFromEuler(this.specimenRotation);
        return this.getBaseSpecimenSpheres().map(sphere => ({
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
        if (bounds.isEmpty()) {
            bounds.set(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));
        }
        return bounds;
    }

    getVolumeBoundsLocal(): Box3 {
        if (this.specimenKind === 'colloids') {
            return new Box3(
                new Vector3(-this.flowCellWidth / 2, -this.flowCellHeight / 2, -this.flowCellDepth / 2),
                new Vector3(this.flowCellWidth / 2, this.flowCellHeight / 2, this.flowCellDepth / 2),
            );
        }
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

    private intersectLocalBox(worldRay: Ray, box: Box3): { tNear: number, tFar: number } | null {
        this.updateMatrices();
        const localOrigin = this._volumeLocalOrigin.copy(worldRay.origin).applyMatrix4(this.worldToLocal);
        const localDir = this._volumeLocalDir.copy(worldRay.direction).transformDirection(this.worldToLocal).normalize();

        // Analytical AABB slab intersection — no triangle mesh, no edge artifacts.
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
     * Get the near and far planes of the sample volume for a world ray.
     * Used by Solver 3 strictly to evaluate the internal E&M field integral.
     */
    getVolumeIntersection(worldRay: Ray): { tNear: number, tFar: number } | null {
        return this.intersectLocalBox(worldRay, this.getVolumeBoundsLocal());
    }

    /**
     * Get the broader proxy that Sample.intersect uses for tracing. This is
     * intentionally separate from getVolumeIntersection(), which may be much
     * tighter than the clickable/traceable holder shell.
     */
    getInteractionIntersection(worldRay: Ray): { tNear: number, tFar: number } | null {
        return this.intersectLocalBox(worldRay, Sample.BOUNDS);
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

        for (const sphere of this.getBaseSpecimenSpheres()) {
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

function fract(value: number): number {
    return value - Math.floor(value);
}

function reflectIntoRange(value: number, min: number, max: number): number {
    if (max <= min) return (min + max) / 2;
    let out = value;
    for (let i = 0; i < 4 && (out < min || out > max); i++) {
        if (out < min) out = min + (min - out);
        if (out > max) out = max - (out - max);
    }
    return Math.max(min, Math.min(max, out));
}

function applyColloidTrapZone(sphere: ColloidSpecimen, zone: ColloidTrapZone, dt: number): boolean {
    const lateralRadius = Math.max(zone.lateralRadius, sphere.radius);
    const axialRange = Math.max(zone.axialRange, sphere.radius);
    const dx = sphere.center.x - zone.center.x;
    const dy = sphere.center.y - zone.center.y;
    const dz = sphere.center.z - zone.center.z;
    const lateral = Math.hypot(dx, dy) / lateralRadius;
    const axial = Math.abs(dz) / axialRange;
    const normalized = Math.max(lateral, axial);
    if (normalized >= 1) return false;

    const coreWeight = normalized <= 0.65
        ? 1
        : (() => {
            const t = (1 - normalized) / 0.35;
            return t * t * (3 - 2 * t);
        })();
    const rate = Math.max(0, zone.stiffnessPerSecond ?? 14) * coreWeight;
    if (rate <= 0) return false;
    const relaxation = 1 - Math.exp(-rate * dt);
    const before = sphere.center.clone();
    sphere.center.lerp(zone.center, relaxation);
    return sphere.center.distanceToSquared(before) > 1e-18;
}

function resolveColloidOverlaps(
    spheres: ColloidSpecimen[],
    width: number,
    height: number,
    depth: number,
): number {
    if (spheres.length < 2) return 0;
    let movedSq = 0;
    for (let i = 0; i < spheres.length; i++) {
        for (let j = i + 1; j < spheres.length; j++) {
            const a = spheres[i];
            const b = spheres[j];
            const minDistance = a.radius + b.radius;
            const dx = b.center.x - a.center.x;
            const dy = b.center.y - a.center.y;
            const dz = b.center.z - a.center.z;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq >= minDistance * minDistance) continue;

            const dist = Math.sqrt(Math.max(distSq, 1e-18));
            const push = 0.5 * (minDistance - dist);
            const nx = dx / dist;
            const ny = dy / dist;
            const nz = dz / dist;
            a.center.x -= nx * push;
            a.center.y -= ny * push;
            a.center.z -= nz * push;
            b.center.x += nx * push;
            b.center.y += ny * push;
            b.center.z += nz * push;
            a.center.x = reflectIntoRange(a.center.x, -width / 2 + a.radius, width / 2 - a.radius);
            a.center.y = reflectIntoRange(a.center.y, -height / 2 + a.radius, height / 2 - a.radius);
            a.center.z = reflectIntoRange(a.center.z, -depth / 2 + a.radius, depth / 2 - a.radius);
            b.center.x = reflectIntoRange(b.center.x, -width / 2 + b.radius, width / 2 - b.radius);
            b.center.y = reflectIntoRange(b.center.y, -height / 2 + b.radius, height / 2 - b.radius);
            b.center.z = reflectIntoRange(b.center.z, -depth / 2 + b.radius, depth / 2 - b.radius);
            movedSq += push * push * 2;
        }
    }
    return movedSq;
}

function gaussianRandom(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
