/**
 * SourceRayFactory — Creates initial source rays from Lasers and Lamps.
 *
 * Replaces three duplicate inline constructions in OpticalTable.tsx.
 * Uses Vector3(0, 0, 1) as the local forward direction (optical axis),
 * matching the component coordinate convention.
 */
import { Vector3 } from 'three';
import { OpticalComponent } from './Component';
import { Laser } from './components/Laser';
import { Lamp } from './components/Lamp';
import { PMT } from './components/PMT';
import { Sample } from './components/Sample';
import { PointSource2D } from './components/PointSource2D';
import { PointSource3D } from './components/PointSource3D';
import { ConeSource3D } from './components/ConeSource3D';
import { WedgeSource2D } from './components/WedgeSource2D';
import { StructuredSource } from './components/StructuredSource';
import { Ray, Coherence, createRay } from './types';
import {
    launchRigorousLaser,
    launchRigorousLampEmitterPoint,
    launchRigorousStructured,
} from './rigorousSourceLaunchers';

/** Ray counts per ring — outer ring is 24, inner rings are 12 each. */
const FIRST_RING_COUNT = 24;
const INNER_RING_COUNT = 12;
const MAX_LAMP_SOURCE_POINTS = 32;
function estimateBeamletFootprint(beamRadius: number, totalBeamlets: number): number {
    if (totalBeamlets <= 1) return Math.max(beamRadius, 0.05);
    return Math.max(beamRadius / Math.sqrt(totalBeamlets), 0.05);
}

function finiteNonNegative(value: number, fallback: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function lampSpectralWavelengths(lamp: Lamp): number[] {
    const wavelengths = lamp.spectralWavelengths.filter(wavelength =>
        Number.isFinite(wavelength) && wavelength > 0
    );
    return wavelengths.length > 0 ? wavelengths : [550];
}

/**
 * Rasterize a single character into a square bitmap of side `size`. Pixels that
 * fall inside the rendered glyph are marked as emission points.
 *
 * Uses OffscreenCanvas (browser) when available; in Node/tests we fall back to
 * a simple "filled disk" pattern so code paths still produce rays.
 */
interface StructuredPattern { size: number; bits: Uint8Array; count: number; }
const structuredPatternCache = new Map<string, StructuredPattern>();
function rasterizeStructuredPattern(char: string, size: number): StructuredPattern {
    const key = `${size}::${char}`;
    const cached = structuredPatternCache.get(key);
    if (cached) return cached;

    const bits = new Uint8Array(size * size);
    let count = 0;

    const canMakeCanvas = typeof document !== 'undefined'
        || (typeof globalThis !== 'undefined' && 'OffscreenCanvas' in globalThis);
    if (canMakeCanvas) {
        try {
            const canvas: any = typeof document !== 'undefined'
                ? document.createElement('canvas')
                : new (globalThis as any).OffscreenCanvas(size, size);
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, size, size);
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.font = `${Math.floor(size * 0.8)}px sans-serif`;
                ctx.fillText(char || '?', size / 2, size / 2);
                const img = ctx.getImageData(0, 0, size, size);
                for (let i = 0; i < size * size; i++) {
                    if (img.data[i * 4] > 128) { bits[i] = 1; count++; }
                }
            }
        } catch {
            /* fall through to circle fallback */
        }
    }

    if (count === 0) {
        // Fallback pattern: filled disk so the source still emits rays even in
        // environments without a canvas.
        const r2 = (size * 0.45) ** 2;
        const cx = size / 2 - 0.5;
        const cy = size / 2 - 0.5;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = x - cx, dy = y - cy;
                if (dx * dx + dy * dy <= r2) { bits[y * size + x] = 1; count++; }
            }
        }
    }

    const pattern = { size, bits, count };
    structuredPatternCache.set(key, pattern);
    return pattern;
}


/**
 * Snap a ray count to the nearest ring boundary so that all
 * rings are complete (no partial circles). Rounds up.
 * Valid values: 24, 36, 48, 60, 72, 84, 96, 108, 120, ...
 */
export function snapToRingBoundary(n: number): number {
    if (n <= FIRST_RING_COUNT) return FIRST_RING_COUNT;
    // Round up to next multiple: first_ring + k * inner_ring
    const excess = n - FIRST_RING_COUNT;
    const k = Math.ceil(excess / INNER_RING_COUNT);
    return FIRST_RING_COUNT + k * INNER_RING_COUNT;
}

export function stablePreviewSourceRays(sourceRays: Ray[], maxNonMainPerSource: number): Ray[] {
    if (maxNonMainPerSource <= 0) return sourceRays.filter(ray => ray.isMainRay);

    type SourceGroup = { main: Ray[]; nonMain: Ray[] };
    const groups = new Map<string, SourceGroup>();
    const order: string[] = [];

    for (let i = 0; i < sourceRays.length; i++) {
        const ray = sourceRays[i];
        const key = ray.sourceId ?? `__anonymous_${i}`;
        let group = groups.get(key);
        if (!group) {
            group = { main: [], nonMain: [] };
            groups.set(key, group);
            order.push(key);
        }
        if (ray.isMainRay) group.main.push(ray);
        else group.nonMain.push(ray);
    }

    const preview: Ray[] = [];
    for (const key of order) {
        const group = groups.get(key);
        if (!group) continue;
        preview.push(...group.main);

        if (group.nonMain.length <= maxNonMainPerSource) {
            preview.push(...group.nonMain);
            continue;
        }

        for (let i = 0; i < maxNonMainPerSource; i++) {
            const idx = Math.min(
                group.nonMain.length - 1,
                Math.floor((i + 0.5) * group.nonMain.length / maxNonMainPerSource),
            );
            preview.push(group.nonMain[idx]);
        }
    }

    return preview;
}

/**
 * Create source rays from all Lasers and Lamps in the scene.
 *
 * @param components  All scene components
 * @param rayCount    Number of marginal/fill rays per source
 * @param mode        'full' = center + ring rays; 'center' = center ray only
 * @returns           Array of source rays ready for Solver 1
 */
export function createSourceRays(
    components: OpticalComponent[],
    rayCount: number,
    mode: 'full' | 'center' = 'full',
): Ray[] {
    const sourceRays: Ray[] = [];

    // ── Lasers ──
    const laserComps = components.filter(c => c instanceof Laser) as Laser[];
    for (const laser of laserComps) {
        if (!laser.isOn) continue;

        const origin = laser.position.clone();
        const direction = new Vector3(0, 0, 1).applyQuaternion(laser.rotation).normalize();
        origin.add(direction.clone().multiplyScalar(3));

        const wavelength = laser.wavelength * 1e-9;
        const targetRayCount = mode === 'full' ? 1 + Math.max(1, rayCount) : 1;
        sourceRays.push(...launchRigorousLaser({
            origin,
            direction,
            beamRadius: laser.beamRadius,
            wavelengthM: wavelength,
            totalPower: laser.power,
            targetRayCount,
            intensityProfile: 'gaussian',
            sourceId: laser.id,
            sourceKind: 'laser',
            coherenceMode: Coherence.Coherent,
        }).rays);
    }

    // ── Lamps ──
    const lampComps = components.filter(c => c instanceof Lamp) as Lamp[];
    for (const lamp of lampComps) {
        const baseOrigin = lamp.position.clone();
        const direction = new Vector3(0, 0, 1).applyQuaternion(lamp.rotation).normalize();
        baseOrigin.add(direction.clone().multiplyScalar(3));

        const beamRadius = finiteNonNegative(lamp.beamRadius, 0);
        const spectralWavelengths = lampSpectralWavelengths(lamp);
        const rawSourcePointCount = Number.isFinite(lamp.sourcePointCount) ? lamp.sourcePointCount : 1;
        const sourcePointCount = Math.min(
            MAX_LAMP_SOURCE_POINTS,
            Math.max(1, Math.round(rawSourcePointCount)),
        );
        const emitterRadius = finiteNonNegative(lamp.emitterRadius, 0);
        const lampPower = Number.isFinite(lamp.power) ? lamp.power : 0;
        const effectiveSourcePoints = emitterRadius > 0 ? sourcePointCount : 1;
        const right = new Vector3(1, 0, 0).applyQuaternion(lamp.rotation).normalize();
        const up = new Vector3(0, 1, 0).applyQuaternion(lamp.rotation).normalize();
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));

        const sourceOrigin = (index: number): Vector3 => {
            if (effectiveSourcePoints <= 1) return baseOrigin.clone();
            if (index === 0) return baseOrigin.clone();
            const radius = emitterRadius * Math.sqrt(index / Math.max(1, effectiveSourcePoints - 1));
            const phi = index * goldenAngle;
            return baseOrigin.clone()
                .addScaledVector(right, Math.cos(phi) * radius)
                .addScaledVector(up, Math.sin(phi) * radius);
        };

        for (const wavelengthNm of spectralWavelengths) {
            const wavelength = wavelengthNm * 1e-9;
            const defaultRays = Math.max(1, rayCount);
            const totalRays = mode === 'full'
                ? (defaultRays >= 16 ? Math.max(1, Math.floor(defaultRays / 2)) : defaultRays)
                : 0;
            const rayDirectionsPerPoint = mode === 'full' ? 1 + totalRays : 1;
            const sourcePointPower = (lampPower / spectralWavelengths.length) / effectiveSourcePoints;
            const sourceId = `${lamp.id}_${wavelengthNm}nm`;

            for (let sourcePointIndex = 0; sourcePointIndex < effectiveSourcePoints; sourcePointIndex++) {
                const origin = sourceOrigin(sourcePointIndex);
                const beamlets = launchRigorousLampEmitterPoint({
                    origin,
                    direction,
                    beamRadius,
                    wavelengthM: wavelength,
                    bandwidth: 10e-9,
                    totalPower: sourcePointPower,
                    targetRayCount: rayDirectionsPerPoint,
                    intensityProfile: 'superGaussian',
                    sourceId,
                }).rays;
                if (sourcePointIndex !== 0) {
                    for (const ray of beamlets) {
                        ray.isMainRay = false;
                    }
                }
                sourceRays.push(...beamlets);
            }
        }
    }

    // ── Point / Cone / Wedge / Structured sources ──

    // Orthonormal basis aligned with the component's forward direction (+Z local).
    const makeBasis = (rotation: { clone(): any }) => {
        const forward = new Vector3(0, 0, 1).applyQuaternion((rotation as any).clone()).normalize();
        const right = new Vector3(1, 0, 0).applyQuaternion((rotation as any).clone()).normalize();
        const up = new Vector3(0, 1, 0).applyQuaternion((rotation as any).clone()).normalize();
        return { forward, right, up };
    };

    const makeSourceRay = (
        origin: Vector3, direction: Vector3, wavelengthM: number,
        intensity: number, footprint: number, sourceId: string,
        mainRay: boolean, sourceKind: Ray['sourceKind'],
        coherenceMode: Coherence = Coherence.Incoherent,
    ): Ray => createRay({
        origin: origin.clone(),
        direction: direction.clone().normalize(),
        wavelength: wavelengthM,
        intensity,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
        opticalPathLength: 0,
        footprintRadius: footprint,
        coherenceMode,
        isMainRay: mainRay,
        sourceId,
        sourceKind,
        packetLaunchRigor: sourceKind === 'laser' || sourceKind === 'lamp' || sourceKind === 'structured'
            ? 'rigorous'
            : 'geometricFallback',
    });

    // --- PointSource3D: isotropic sphere (Fibonacci lattice) ---
    const pointSource3Ds = components.filter(c => c instanceof PointSource3D) as PointSource3D[];
    for (const src of pointSource3Ds) {
        src.updateMatrices();
        const origin = src.position.clone();
        const wavelengthM = src.wavelength * 1e-9;
        const n = mode === 'full' ? Math.max(4, rayCount) : 0;
        const totalEmittedRays = mode === 'full' ? n + 1 : 1;
        const perRayPower = src.power / totalEmittedRays;
        const footprint = estimateBeamletFootprint(src.beamRadius, totalEmittedRays);

        // Center (forward) main ray first
        const { forward } = makeBasis(src.rotation);
        sourceRays.push(makeSourceRay(origin, forward, wavelengthM, perRayPower, footprint, src.id, true, 'point3d'));
        if (mode !== 'full') continue;

        // Fibonacci sphere for the remaining rays — uniform density over 4π.
        const phiGolden = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < n; i++) {
            const y = 1 - (2 * (i + 0.5)) / n;
            const r = Math.sqrt(Math.max(0, 1 - y * y));
            const phi = i * phiGolden;
            const dir = new Vector3(r * Math.cos(phi), y, r * Math.sin(phi));
            sourceRays.push(makeSourceRay(origin, dir, wavelengthM, perRayPower, footprint, src.id, false, 'point3d'));
        }
    }

    // --- PointSource2D: isotropic in the component's X-Z plane ---
    const pointSource2Ds = components.filter(c => c instanceof PointSource2D) as PointSource2D[];
    for (const src of pointSource2Ds) {
        src.updateMatrices();
        const origin = src.position.clone();
        const wavelengthM = src.wavelength * 1e-9;
        const n = mode === 'full' ? Math.max(4, rayCount) : 0;
        const totalEmittedRays = mode === 'full' ? n + 1 : 1;
        const perRayPower = src.power / totalEmittedRays;
        const footprint = estimateBeamletFootprint(src.beamRadius, totalEmittedRays);
        const { forward, right } = makeBasis(src.rotation);

        sourceRays.push(makeSourceRay(origin, forward, wavelengthM, perRayPower, footprint, src.id, true, 'point2d'));
        if (mode !== 'full') continue;

        for (let i = 0; i < n; i++) {
            const theta = (2 * Math.PI * i) / n;
            const dir = forward.clone().multiplyScalar(Math.cos(theta))
                .add(right.clone().multiplyScalar(Math.sin(theta)));
            sourceRays.push(makeSourceRay(origin, dir, wavelengthM, perRayPower, footprint, src.id, false, 'point2d'));
        }
    }

    // --- ConeSource3D: forward-facing cone with uniform solid-angle sampling ---
    const coneSources = components.filter(c => c instanceof ConeSource3D) as ConeSource3D[];
    for (const src of coneSources) {
        src.updateMatrices();
        const origin = src.position.clone();
        const wavelengthM = src.wavelength * 1e-9;
        const n = mode === 'full' ? Math.max(4, rayCount) : 0;
        const totalEmittedRays = mode === 'full' ? n + 1 : 1;
        const perRayPower = src.power / totalEmittedRays;
        const footprint = estimateBeamletFootprint(src.beamRadius, totalEmittedRays);
        const { forward, right, up } = makeBasis(src.rotation);
        const halfAngle = Math.max(1e-6, src.halfAngle);
        const cosHalf = Math.cos(halfAngle);

        sourceRays.push(makeSourceRay(origin, forward, wavelengthM, perRayPower, footprint, src.id, true, 'cone'));
        if (mode !== 'full') continue;

        // Stratified fibonacci spiral on the spherical cap.
        const phiGolden = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < n; i++) {
            // u ∈ [cosHalf, 1] uniform → sinθ correct for uniform solid-angle
            const u = cosHalf + (1 - cosHalf) * ((i + 0.5) / n);
            const sinTheta = Math.sqrt(Math.max(0, 1 - u * u));
            const phi = i * phiGolden;
            const dir = forward.clone().multiplyScalar(u)
                .add(right.clone().multiplyScalar(sinTheta * Math.cos(phi)))
                .add(up.clone().multiplyScalar(sinTheta * Math.sin(phi)));
            sourceRays.push(makeSourceRay(origin, dir, wavelengthM, perRayPower, footprint, src.id, false, 'cone'));
        }
    }

    // --- WedgeSource2D: planar fan in the component's forward / right plane ---
    const wedgeSources = components.filter(c => c instanceof WedgeSource2D) as WedgeSource2D[];
    for (const src of wedgeSources) {
        src.updateMatrices();
        const origin = src.position.clone();
        const wavelengthM = src.wavelength * 1e-9;
        const n = mode === 'full' ? Math.max(4, rayCount) : 0;
        const totalEmittedRays = mode === 'full' ? n + 1 : 1;
        const perRayPower = src.power / totalEmittedRays;
        const footprint = estimateBeamletFootprint(src.beamRadius, totalEmittedRays);
        const { forward, right } = makeBasis(src.rotation);
        const subtended = Math.max(1e-6, src.subtendedAngle);
        const halfFan = subtended / 2;

        sourceRays.push(makeSourceRay(origin, forward, wavelengthM, perRayPower, footprint, src.id, true, 'wedge'));
        if (mode !== 'full') continue;

        for (let i = 0; i < n; i++) {
            const frac = n === 1 ? 0.5 : i / (n - 1);
            const theta = -halfFan + frac * subtended;
            const dir = forward.clone().multiplyScalar(Math.cos(theta))
                .add(right.clone().multiplyScalar(Math.sin(theta)));
            sourceRays.push(makeSourceRay(origin, dir, wavelengthM, perRayPower, footprint, src.id, false, 'wedge'));
        }
    }

    // --- StructuredSource: ASCII-character bitmap of collimated rays ---
    //
    // The source emits exactly `rayCount` rays drawn from the rasterized character's
    // lit pixels.  The pattern extent is controlled by `beamRadius`, matching the
    // inspector label and the visible source aperture.
    const structuredSources = components.filter(c => c instanceof StructuredSource) as StructuredSource[];
    for (const src of structuredSources) {
        src.updateMatrices();
        const wavelengthM = src.wavelength * 1e-9;
        const { forward } = makeBasis(src.rotation);
        const halfDiam = Math.max(0.05, finiteNonNegative(src.beamRadius, src.diameter / 2));
        const totalRays = mode === 'full' ? Math.max(1, rayCount) : 1;

        // Footprint derives from the pattern extent and ray count.
        const footprint = Math.max(halfDiam / Math.sqrt(totalRays), 0.05);

        const pattern = rasterizeStructuredPattern(src.asciiChar, 16);
        const size = pattern.size;

        // Collect lit pixel indices for sampling.
        const lit: { px: number; py: number }[] = [];
        for (let py = 0; py < size; py++) {
            for (let px = 0; px < size; px++) {
                if (pattern.bits[py * size + px]) lit.push({ px, py });
            }
        }

        // Empty-pattern fallback: single center ray.
        if (lit.length === 0) {
            sourceRays.push(makeSourceRay(src.position.clone(), forward, wavelengthM, src.power, footprint, src.id, true, 'structured', Coherence.Coherent));
            continue;
        }

        const maskFn = (localX: number, localY: number): number => {
            const px = Math.floor(((localX / halfDiam) + 1) * 0.5 * size);
            const py = Math.floor((1 - ((localY / halfDiam) + 1) * 0.5) * size);
            if (px < 0 || px >= size || py < 0 || py >= size) return 0;
            return pattern.bits[py * size + px] ? 1 : 0;
        };

        sourceRays.push(...launchRigorousStructured({
            origin: src.position.clone(),
            direction: forward,
            beamRadius: halfDiam,
            wavelengthM,
            totalPower: src.power,
            targetRayCount: totalRays,
            maskFn,
            sourceId: src.id,
        }).rays);
    }

    // ── PMT preview ray ──
    const pmtComps = components.filter(c => c instanceof PMT) as PMT[];
    for (const pmt of pmtComps) {
        pmt.updateMatrices();
        const pmtDir = new Vector3(0, 0, 1).applyQuaternion(pmt.rotation).normalize();
        const pmtOrigin = pmt.position.clone().add(pmtDir.clone().multiplyScalar(1));
        const sampleComp = components.find(c => c instanceof Sample) as Sample | undefined;
        const emWl = sampleComp ? sampleComp.getEmissionWavelength() * 1e-9 : 520e-9;
        sourceRays.push(createRay({
            origin: pmtOrigin,
            direction: pmtDir,
            wavelength: emWl,
            intensity: 0.3,
            polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
            opticalPathLength: 0,
            footprintRadius: 0.1,
            coherenceMode: Coherence.Coherent,
            sourceId: `pmt_preview_${pmt.id}`,
            sourceKind: 'pmtPreview',
            packetLaunchRigor: 'geometricFallback',
        }));
    }

    return sourceRays;
}
