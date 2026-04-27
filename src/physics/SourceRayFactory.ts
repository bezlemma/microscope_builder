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
import { Ray, Coherence } from './types';
import { deterministicRandom } from './deterministicRandom';

/**
 * Build radius fractions for hierarchical ring distribution.
 * Level 0: full radius (marginal rays)
 * Level 1+: binary subdivision (1/2, 1/4, 3/4, 1/8, ...)
 */
function buildRadiusFractions(): number[] {
    const fractions: number[] = [1]; // ring 0 = marginal (full radius)
    let level = 1;
    while (fractions.length < 100) {
        const denom = 1 << level;
        for (let k = 1; k < denom; k += 2) {
            fractions.push(k / denom);
        }
        level++;
    }
    return fractions;
}

/** Cached radius fractions — only computed once. */
const _RADIUS_FRACTIONS = buildRadiusFractions();
void _RADIUS_FRACTIONS;

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
 * Generate laser/lamp beamlet rays that mathematically match a Gaussian
 * intensity profile.
 *
 *   I(r) = I₀ · exp(−2 r² / w²)           (1/e² beam radius = `beamRadius`)
 *
 * We sample each ray's radial position via the inverse CDF of the 2D Gaussian
 * so ray density itself matches the Gaussian density, and pair that with a
 * Fibonacci-sunflower angle so the transverse tiling is near-optimal. Every
 * ray carries the same (caller-supplied) intensity. As `totalRays` increases
 * the Monte-Carlo sum of identical-intensity Gaussian-distributed beamlets
 * converges smoothly to the continuous Gaussian profile — the image settles
 * instead of oscillating.
 *
 * @param origin            Centre of the beam at the source plane
 * @param direction         Beam propagation direction (normalized)
 * @param beamRadius        1/e² beam radius (mm)
 * @param totalRays         Number of off-axis rays to place
 * @param wavelength        Wavelength in meters
 * @param intensityPerRay   Intensity carried by each beamlet
 * @param coherenceMode     Coherent or Incoherent
 * @param sourceId          Source component ID
 * @param beamletFootprint  Visual footprint per beamlet (mm)
 */
function generateRingRays(
    origin: Vector3,
    direction: Vector3,
    beamRadius: number,
    totalRays: number,
    wavelength: number,
    intensityPerRay: number,
    coherenceMode: number,
    sourceId: string,
    beamletFootprint: number,
): Ray[] {
    const requested = Math.max(0, Math.floor(totalRays));
    if (requested === 0) return [];

    const rays: Ray[] = [];

    const up = new Vector3(0, 1, 0);
    if (Math.abs(direction.dot(up)) > 0.9) up.set(0, 0, 1);
    const right = new Vector3().crossVectors(direction, up).normalize();
    const trueUp = new Vector3().crossVectors(right, direction).normalize();

    // Golden-angle spiral for azimuthal placement — best-known low-discrepancy
    // tiling of a 2D disc for smooth coverage at any ray count.
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    // Radii from the inverse CDF of the 2D Gaussian beam, capped at the 1/e²
    // waist (u = 1 - e⁻² ≈ 0.865).  Without the cap, stratified u values
    // u = (i + 0.5)/N drive the outermost ray's radius arbitrarily large
    // (r ∝ √(-ln(1-u))), which appears as a single "stray" beam well below
    // / outside the rest of the bundle in lamp visualisations.  Capping at the
    // waist keeps the outer ray just at the visible beam edge.
    const U_MAX = 1 - Math.exp(-2); // ≈ 0.864664716...
    for (let i = 0; i < requested; i++) {
        const u = U_MAX * (i + 0.5) / requested;
        const r = beamRadius * Math.sqrt(-Math.log(1 - u) / 2);
        const phi = i * goldenAngle;

        rays.push({
            origin: origin.clone()
                .addScaledVector(right, Math.cos(phi) * r)
                .addScaledVector(trueUp, Math.sin(phi) * r),
            direction: direction.clone().normalize(),
            wavelength,
            intensity: intensityPerRay,
            polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
            opticalPathLength: 0,
            footprintRadius: beamletFootprint,
            coherenceMode,
            sourceId,
        });
    }
    return rays;
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
        const ringRays = mode === 'full' ? Math.max(1, rayCount) : 0;
        const totalBeamlets = 1 + ringRays;
        const beamletFootprint = estimateBeamletFootprint(laser.beamRadius, totalBeamlets);
        // Split the laser's total power evenly across the (center + ring) rays
        // so ∑ intensities = P exactly. Previously the center ray carried full
        // P while each ring ray got P/N, leading to a ~2× intensity spike on
        // the optical axis that focused to a hot dot in the camera image.
        const intensityPerRay = laser.power / totalBeamlets;

        // Center (main) ray — kept for visualization (thicker/brighter draw) but
        // with the same per-beamlet intensity as the Gaussian-distributed rays.
        sourceRays.push({
            origin: origin.clone(),
            direction: direction.clone(),
            wavelength,
            intensity: intensityPerRay,
            polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
            opticalPathLength: 0,
            footprintRadius: beamletFootprint,
            coherenceMode: Coherence.Coherent,
            isMainRay: true,
            sourceId: laser.id,
        });

        // Gaussian-distributed off-axis rays sampled via inverse-CDF stratification.
        if (mode === 'full') {
            sourceRays.push(...generateRingRays(
                origin, direction, laser.beamRadius, ringRays,
                wavelength, intensityPerRay, Coherence.Coherent, laser.id, beamletFootprint,
            ));
        }
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
            const totalBeamlets = effectiveSourcePoints * rayDirectionsPerPoint;
            const beamletFootprint = estimateBeamletFootprint(beamRadius, rayDirectionsPerPoint);
            const intensityPerRay = (lampPower / spectralWavelengths.length) / totalBeamlets;
            const sourceId = `${lamp.id}_${wavelengthNm}nm`;

            for (let sourcePointIndex = 0; sourcePointIndex < effectiveSourcePoints; sourcePointIndex++) {
                const origin = sourceOrigin(sourcePointIndex);

                // Center (main) ray
                sourceRays.push({
                    origin,
                    direction: direction.clone(),
                    wavelength,
                    intensity: intensityPerRay,
                    polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
                    opticalPathLength: 0,
                    footprintRadius: beamletFootprint,
                    coherenceMode: Coherence.Incoherent,
                    isMainRay: sourcePointIndex === 0,
                    sourceId,
                });

                // Ring rays
                if (mode === 'full') {
                    sourceRays.push(...generateRingRays(
                        origin, direction, beamRadius, totalRays,
                        wavelength, intensityPerRay, Coherence.Incoherent,
                        sourceId, beamletFootprint,
                    ));
                }
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
        mainRay: boolean,
    ): Ray => ({
        origin: origin.clone(),
        direction: direction.clone().normalize(),
        wavelength: wavelengthM,
        intensity,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
        opticalPathLength: 0,
        footprintRadius: footprint,
        coherenceMode: Coherence.Incoherent,
        isMainRay: mainRay,
        sourceId,
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
        sourceRays.push(makeSourceRay(origin, forward, wavelengthM, perRayPower, footprint, src.id, true));
        if (mode !== 'full') continue;

        // Fibonacci sphere for the remaining rays — uniform density over 4π.
        const phiGolden = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < n; i++) {
            const y = 1 - (2 * (i + 0.5)) / n;
            const r = Math.sqrt(Math.max(0, 1 - y * y));
            const phi = i * phiGolden;
            const dir = new Vector3(r * Math.cos(phi), y, r * Math.sin(phi));
            sourceRays.push(makeSourceRay(origin, dir, wavelengthM, perRayPower, footprint, src.id, false));
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

        sourceRays.push(makeSourceRay(origin, forward, wavelengthM, perRayPower, footprint, src.id, true));
        if (mode !== 'full') continue;

        for (let i = 0; i < n; i++) {
            const theta = (2 * Math.PI * i) / n;
            const dir = forward.clone().multiplyScalar(Math.cos(theta))
                .add(right.clone().multiplyScalar(Math.sin(theta)));
            sourceRays.push(makeSourceRay(origin, dir, wavelengthM, perRayPower, footprint, src.id, false));
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

        sourceRays.push(makeSourceRay(origin, forward, wavelengthM, perRayPower, footprint, src.id, true));
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
            sourceRays.push(makeSourceRay(origin, dir, wavelengthM, perRayPower, footprint, src.id, false));
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

        sourceRays.push(makeSourceRay(origin, forward, wavelengthM, perRayPower, footprint, src.id, true));
        if (mode !== 'full') continue;

        for (let i = 0; i < n; i++) {
            const frac = n === 1 ? 0.5 : i / (n - 1);
            const theta = -halfFan + frac * subtended;
            const dir = forward.clone().multiplyScalar(Math.cos(theta))
                .add(right.clone().multiplyScalar(Math.sin(theta)));
            sourceRays.push(makeSourceRay(origin, dir, wavelengthM, perRayPower, footprint, src.id, false));
        }
    }

    // --- StructuredSource: ASCII-character bitmap of collimated rays ---
    //
    // The source emits exactly `rayCount` rays drawn from the rasterized character's
    // lit pixels.  The pattern extent is fixed by `src.diameter` — `beamRadius`
    // affects only the cosmetic plate in the visualizer, never the beam itself.
    const structuredSources = components.filter(c => c instanceof StructuredSource) as StructuredSource[];
    for (const src of structuredSources) {
        src.updateMatrices();
        const wavelengthM = src.wavelength * 1e-9;
        const { forward, right, up } = makeBasis(src.rotation);
        const halfDiam = Math.max(0.05, src.diameter / 2);
        const totalRays = mode === 'full' ? Math.max(1, rayCount) : 1;

        // Footprint derives from the pattern extent and ray count (not from beamRadius).
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
            sourceRays.push(makeSourceRay(src.position.clone(), forward, wavelengthM, src.power, footprint, src.id, true));
            continue;
        }

        const perRayPower = src.power / totalRays;

        for (let i = 0; i < totalRays; i++) {
            // Deterministic stratified traversal over lit pixels. When rayCount
            // exceeds the pixel count we wrap with deterministic sub-pixel offsets
            // so table-preview rays are stable across drags and retraces.
            const frac = totalRays === 1 ? 0 : i / totalRays;
            const pixIdx = Math.floor(frac * lit.length) % lit.length;
            const { px, py } = lit[pixIdx];
            // Offset only when oversampling the pattern; keeps first pass pixel-aligned.
            const over = totalRays > lit.length;
            const ju = over ? deterministicRandom(i, px, py, size, 17) - 0.5 : 0;
            const jv = over ? deterministicRandom(i, px, py, size, 53) - 0.5 : 0;
            const u = ((px + 0.5 + ju) / size * 2 - 1) * halfDiam;
            const v = -((py + 0.5 + jv) / size * 2 - 1) * halfDiam;
            const origin = src.position.clone()
                .add(right.clone().multiplyScalar(u))
                .add(up.clone().multiplyScalar(v));
            sourceRays.push(makeSourceRay(
                origin, forward, wavelengthM, perRayPower, footprint, src.id, i === 0,
            ));
        }
    }

    // ── PMT preview ray ──
    const pmtComps = components.filter(c => c instanceof PMT) as PMT[];
    for (const pmt of pmtComps) {
        pmt.updateMatrices();
        const pmtDir = new Vector3(0, 0, 1).applyQuaternion(pmt.rotation).normalize();
        const pmtOrigin = pmt.position.clone().add(pmtDir.clone().multiplyScalar(1));
        const sampleComp = components.find(c => c instanceof Sample) as Sample | undefined;
        const emWl = sampleComp ? sampleComp.getEmissionWavelength() * 1e-9 : 520e-9;
        sourceRays.push({
            origin: pmtOrigin,
            direction: pmtDir,
            wavelength: emWl,
            intensity: 0.3,
            polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
            opticalPathLength: 0,
            footprintRadius: 0.1,
            coherenceMode: Coherence.Coherent,
            sourceId: `pmt_preview_${pmt.id}`,
        });
    }

    return sourceRays;
}
