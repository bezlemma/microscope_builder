import { Vector3 } from 'three';
import { Coherence, Ray, createRay } from './types';
import { collimatedPacketQFromSourceCellArea } from './coherentPacketLaunch';

export interface LaunchRigor {
    rigorous: boolean;
    oneLiner?: string;
    details?: string;
}

export const LAUNCH_RIGOR: Record<string, LaunchRigor> = {
    Laser: {
        rigorous: true,
        oneLiner: 'Gaussian Packet source-plane quadrature, sigma/d = 0.7',
    },
    StructuredSource: {
        rigorous: true,
        oneLiner: 'Gaussian Packet source-plane quadrature over rasterized mask',
    },
    Lamp: {
        rigorous: true,
        oneLiner: 'independent emitter and wavelength groups, each packetized like a beam',
    },
    PointSource3D: {
        rigorous: false,
        oneLiner: 'directional Gaussian Packet frame not ported yet',
    },
    PointSource2D: {
        rigorous: false,
        oneLiner: 'directional Gaussian Packet frame not ported yet',
    },
    ConeSource3D: {
        rigorous: false,
        oneLiner: 'directional cap Gaussian Packet frame not ported yet',
    },
    WedgeSource2D: {
        rigorous: false,
        oneLiner: 'directional fan Gaussian Packet frame not ported yet',
    },
};

export function getLaunchRigor(component: { constructor: { name: string } }): LaunchRigor | null {
    return LAUNCH_RIGOR[component.constructor.name] ?? null;
}

export const HEX_GABOR_FACTOR = 0.7;
const LEGACY_DISPLAY_BANDWIDTH_SCALE = 1.2;
const LEGACY_DISPLAY_MAX_FRACTION = 0.95;
const LEGACY_DISPLAY_MIN_FRACTION = 0.08;

function displayFootprintRadius(beamRadius: number, packetCount: number, packetSigma: number): number {
    if (packetCount <= 1) return Math.max(beamRadius, Math.SQRT2 * packetSigma, 0.05);
    const bandwidthFraction = Math.min(
        LEGACY_DISPLAY_MAX_FRACTION,
        Math.max(LEGACY_DISPLAY_MIN_FRACTION, LEGACY_DISPLAY_BANDWIDTH_SCALE * packetCount ** (-1 / 6)),
    );
    return Math.max(beamRadius * bandwidthFraction, Math.SQRT2 * packetSigma, 0.05);
}

function buildPerpBasis(forward: Vector3): { right: Vector3; up: Vector3 } {
    const f = forward.clone().normalize();
    let upHint = new Vector3(0, 1, 0);
    if (Math.abs(f.dot(upHint)) > 0.9) upHint = new Vector3(0, 0, 1);
    const right = new Vector3().crossVectors(f, upHint).normalize();
    const up = new Vector3().crossVectors(right, f).normalize();
    return { right, up };
}

function haltonFrac(index: number, base: number): number {
    let f = 1;
    let r = 0;
    let i = index + 1;
    while (i > 0) {
        f /= base;
        r += f * (i % base);
        i = Math.floor(i / base);
    }
    return r;
}

function profileAmplitude(
    kind: 'gaussian' | 'flat' | 'superGaussian',
    localX: number,
    localY: number,
    beamRadius: number,
): number {
    const rSq = localX * localX + localY * localY;
    const w = Math.max(beamRadius, 1e-12);
    if (kind === 'flat') return rSq <= w * w ? 1 : 0;
    if (kind === 'superGaussian') return Math.exp(-Math.pow(rSq / (w * w), 3));
    return Math.exp(-rSq / (w * w));
}

function sampleProfilePositions(
    N: number,
    beamRadius: number,
    profileFn: (x: number, y: number) => number,
): Array<{ x: number; y: number }> {
    const grid = 96;
    const pixelW = 2 * beamRadius / grid;
    const cellCount = grid * grid;
    const weights = new Float64Array(cellCount);
    let totalWeight = 0;
    for (let j = 0; j < grid; j++) {
        const y = (j + 0.5) * pixelW - beamRadius;
        for (let i = 0; i < grid; i++) {
            const x = (i + 0.5) * pixelW - beamRadius;
            if (x * x + y * y > beamRadius * beamRadius) continue;
            const amp = Math.max(0, profileFn(x, y));
            const weight = amp * amp;
            weights[j * grid + i] = weight;
            totalWeight += weight;
        }
    }

    const positions: Array<{ x: number; y: number }> = [];
    if (totalWeight <= 0) {
        for (let i = 0; i < N; i++) {
            const r = Math.sqrt(haltonFrac(i, 2)) * beamRadius;
            const theta = 2 * Math.PI * haltonFrac(i, 3);
            positions.push({ x: r * Math.cos(theta), y: r * Math.sin(theta) });
        }
        return positions;
    }

    const cdf = new Float64Array(cellCount);
    let running = 0;
    for (let i = 0; i < cellCount; i++) {
        running += weights[i];
        cdf[i] = running;
    }

    for (let i = 0; i < N; i++) {
        const target = ((i + haltonFrac(i, 2)) / N) * totalWeight;
        let lo = 0;
        let hi = cellCount - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cdf[mid] < target) lo = mid + 1;
            else hi = mid;
        }
        const px = lo % grid;
        const py = Math.floor(lo / grid);
        const jx = haltonFrac(i, 3) - 0.5;
        const jy = haltonFrac(i, 5) - 0.5;
        positions.push({
            x: (px + 0.5 + jx) * pixelW - beamRadius,
            y: (py + 0.5 + jy) * pixelW - beamRadius,
        });
    }

    return positions;
}

export interface RigorousRayLaunch {
    packetSigma: number;
    rayCount: number;
    rays: Ray[];
}

export function launchRigorousLaser(params: {
    origin: Vector3;
    direction: Vector3;
    beamRadius: number;
    wavelengthM: number;
    bandwidth?: number;
    totalPower: number;
    targetRayCount: number;
    intensityProfile: 'gaussian' | 'flat' | 'superGaussian';
    sourceId: string;
    sourceKind: Ray['sourceKind'];
    coherenceMode: Coherence;
    polarization?: Ray['polarization'];
}): RigorousRayLaunch {
    const {
        origin,
        direction,
        beamRadius,
        wavelengthM,
        totalPower,
        targetRayCount,
        intensityProfile,
        sourceId,
        sourceKind,
        coherenceMode,
        bandwidth,
        polarization,
    } = params;

    const N = Math.max(1, Math.floor(targetRayCount));
    const safeRadius = Math.max(beamRadius, 0.001);
    const positions = sampleProfilePositions(N, safeRadius, (x, y) =>
        profileAmplitude(intensityProfile, x, y, safeRadius)
    );
    positions.sort((a, b) => (a.x * a.x + a.y * a.y) - (b.x * b.x + b.y * b.y));
    const diskArea = Math.PI * safeRadius * safeRadius;
    const cellArea = diskArea / Math.max(positions.length, 1);
    const sigma = HEX_GABOR_FACTOR * Math.sqrt(cellArea / (Math.sqrt(3) / 2));
    const packetQ = collimatedPacketQFromSourceCellArea(wavelengthM, 1, cellArea);
    const displayFootprint = displayFootprintRadius(safeRadius, positions.length, sigma);
    const { right, up } = buildPerpBasis(direction);
    const dir = direction.clone().normalize();
    const jones = polarization ?? { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } };
    const intensityPerRay = totalPower / Math.max(positions.length, 1);
    const rays = positions.map((p, index) => {
        const rayOrigin = origin.clone()
            .addScaledVector(right, p.x)
            .addScaledVector(up, p.y);
        return createRay({
            origin: rayOrigin,
            direction: dir.clone(),
            wavelength: wavelengthM,
            bandwidth: bandwidth ?? 0,
            intensity: intensityPerRay,
            powerWeight: intensityPerRay,
            polarization: jones,
            opticalPathLength: 0,
            phase: 0,
            footprintRadius: displayFootprint,
            coherenceMode,
            sourceId,
            sourceKind,
            packetLaunchRigor: 'rigorous',
            sourcePosition: rayOrigin.clone(),
            sourceCellArea: cellArea,
            sigmaU: sigma,
            sigmaV: sigma,
            curvatureRadiusU: Number.POSITIVE_INFINITY,
            curvatureRadiusV: Number.POSITIVE_INFINITY,
            packetQ,
            packetStateMode: 'explicit',
            transverseProfile: 'gaussian',
            transverseProfileOrder: 1,
            majorAxis: right.clone(),
            majorLength: Math.max(3 * sigma, 0.001),
            tanAlpha: (wavelengthM * 1e3) / (Math.PI * Math.max(safeRadius, 0.001)),
            isMainRay: index === 0,
        });
    });

    return { packetSigma: sigma, rayCount: rays.length, rays };
}

export function launchRigorousStructured(params: {
    origin: Vector3;
    direction: Vector3;
    beamRadius: number;
    wavelengthM: number;
    bandwidth?: number;
    totalPower: number;
    targetRayCount: number;
    maskFn: (localX: number, localY: number) => number;
    sourceId: string;
    polarization?: Ray['polarization'];
}): RigorousRayLaunch {
    return launchRigorousMaskedSource({
        ...params,
        sourceKind: 'structured',
        coherenceMode: Coherence.Coherent,
    });
}

export function launchRigorousMaskedSource(params: {
    origin: Vector3;
    direction: Vector3;
    beamRadius: number;
    wavelengthM: number;
    bandwidth?: number;
    totalPower: number;
    targetRayCount: number;
    maskFn: (localX: number, localY: number) => number;
    sourceId: string;
    sourceKind: Ray['sourceKind'];
    coherenceMode: Coherence;
    polarization?: Ray['polarization'];
}): RigorousRayLaunch {
    const {
        origin, direction, beamRadius, wavelengthM, totalPower, targetRayCount,
        maskFn, sourceId, sourceKind, coherenceMode, bandwidth, polarization,
    } = params;
    const N = Math.max(1, Math.floor(targetRayCount));
    const safeRadius = Math.max(beamRadius, 0.001);
    const positions = sampleProfilePositions(N, safeRadius, maskFn);
    positions.sort((a, b) => (a.x * a.x + a.y * a.y) - (b.x * b.x + b.y * b.y));
    const diskArea = Math.PI * safeRadius * safeRadius;
    const cellArea = diskArea / Math.max(positions.length, 1);
    const sigma = HEX_GABOR_FACTOR * Math.sqrt(cellArea / (Math.sqrt(3) / 2));
    const packetQ = collimatedPacketQFromSourceCellArea(wavelengthM, 1, cellArea);
    const displayFootprint = displayFootprintRadius(safeRadius, positions.length, sigma);
    const { right, up } = buildPerpBasis(direction);
    const dir = direction.clone().normalize();
    const jones = polarization ?? { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } };
    const intensityPerRay = totalPower / Math.max(positions.length, 1);
    const rays = positions.map((p, index) => {
        const rayOrigin = origin.clone()
            .addScaledVector(right, p.x)
            .addScaledVector(up, p.y);
        return createRay({
            origin: rayOrigin,
            direction: dir.clone(),
            wavelength: wavelengthM,
            bandwidth: bandwidth ?? 0,
            intensity: intensityPerRay,
            powerWeight: intensityPerRay,
            polarization: jones,
            opticalPathLength: 0,
            phase: 0,
            footprintRadius: displayFootprint,
            coherenceMode,
            sourceId,
            sourceKind,
            packetLaunchRigor: 'rigorous',
            sourcePosition: rayOrigin.clone(),
            sourceCellArea: cellArea,
            sigmaU: sigma,
            sigmaV: sigma,
            curvatureRadiusU: Number.POSITIVE_INFINITY,
            curvatureRadiusV: Number.POSITIVE_INFINITY,
            packetQ,
            packetStateMode: 'explicit',
            transverseProfile: 'gaussian',
            transverseProfileOrder: 1,
            majorAxis: right.clone(),
            majorLength: Math.max(3 * sigma, 0.001),
            tanAlpha: (wavelengthM * 1e3) / (Math.PI * Math.max(safeRadius, 0.001)),
            isMainRay: index === 0,
        });
    });
    return { packetSigma: sigma, rayCount: rays.length, rays };
}

export function launchRigorousLampEmitterPoint(params: {
    origin: Vector3;
    direction: Vector3;
    beamRadius: number;
    wavelengthM: number;
    bandwidth?: number;
    totalPower: number;
    targetRayCount: number;
    intensityProfile: 'flat' | 'superGaussian';
    sourceId: string;
    polarization?: Ray['polarization'];
}): RigorousRayLaunch {
    return launchRigorousLaser({
        ...params,
        sourceKind: 'lamp',
        coherenceMode: Coherence.Incoherent,
    });
}
