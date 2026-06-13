import { Matrix4, Vector3 } from 'three';
import { childRay, Coherence, type Ray } from './types';
import { evaluateZernikeNoll, zernikeNollLabel } from './PupilFunction';
import { gaussianPeakIntensity } from './BeamField';

export interface TerminalPacketHit {
    localPoint: { x: number; y: number };
    localDirection?: Vector3;
    ray: Ray;
    detectorId?: string;
}

export interface TerminalFieldData {
    resX: number;
    resY: number;
    extentWidth: number;
    extentHeight: number;
    centerX: number;
    centerY: number;
    pixelArea: number;
    intensity: Float32Array;
}

export interface TerminalFieldWindow {
    centerX: number;
    centerY: number;
    width: number;
    height: number;
}

export interface PacketPlaneSpec {
    worldToLocal: Matrix4;
    localToWorld: Matrix4;
    localZ: number;
    width?: number;
    height?: number;
    radius?: number;
    detectorId?: string;
}

export interface PacketHitValidity {
    totalHits: number;
    rigorousHits: number;
    fallbackHits: number;
    unknownHits: number;
    isPacketFieldValid: boolean;
    isPsfValid: boolean;
    psfInvalidReason?: string;
}

export interface EncircledEnergySample {
    radius: number;
    fraction: number;
}

export interface RadialMtfSample {
    spatialFrequency: number;
    value: number;
}

export interface TerminalFieldMetrics {
    totalPower: number;
    peakPowerDensity: number;
    centroidX: number;
    centroidY: number;
    rmsRadius: number;
    ee50Radius: number | null;
    ee80Radius: number | null;
    strehlRatio: number | null;
    mtf50: number | null;
    encircledEnergy: EncircledEnergySample[];
    radialMtf: RadialMtfSample[];
}

export interface TerminalAxialSections {
    resTransverse: number;
    resZ: number;
    transverseWidthX: number;
    transverseWidthY: number;
    axialDepth: number;
    centerX: number;
    centerY: number;
    baseLocalZ: number;
    xz: Float32Array;
    yz: Float32Array;
}

export interface ZernikeFitCoefficient {
    index: number;
    label: string;
    coefficientWaves: number;
    coefficientMm: number;
}

export interface ZernikePupilFit {
    sampleCount: number;
    pupilRadius: number;
    wavelengthM: number;
    referenceOplMm: number;
    rmsWaves: number;
    residualRmsWaves: number;
    peakToValleyWaves: number;
    coefficients: ZernikeFitCoefficient[];
}

function toVec3(v: { x: number; y: number; z: number }): Vector3 {
    return v instanceof Vector3 ? v : new Vector3(v.x, v.y, v.z);
}

function raySegmentEnd(path: Ray[], index: number): Vector3 | null {
    const ray = path[index];
    if (!ray) return null;
    if (ray.terminationPoint) return toVec3(ray.terminationPoint);
    if (ray.interactionDistance !== undefined) {
        return toVec3(ray.origin).clone().add(toVec3(ray.direction).clone().multiplyScalar(ray.interactionDistance));
    }
    const next = path[index + 1];
    if (next) return toVec3(next.origin);
    return null;
}

function pointInsidePacketPlane(spec: PacketPlaneSpec, localPoint: Vector3): boolean {
    if (spec.radius !== undefined) {
        return localPoint.x * localPoint.x + localPoint.y * localPoint.y <= spec.radius * spec.radius;
    }
    const halfW = Math.max(spec.width ?? 0, 0) * 0.5;
    const halfH = Math.max(spec.height ?? 0, 0) * 0.5;
    if (halfW <= 0 || halfH <= 0) return true;
    return Math.abs(localPoint.x) <= halfW && Math.abs(localPoint.y) <= halfH;
}

export function collectTerminalPacketHitsFromRayPaths(
    rayPaths: Ray[][],
    spec: PacketPlaneSpec,
): TerminalPacketHit[] {
    const hits: TerminalPacketHit[] = [];

    for (const path of rayPaths) {
        for (let rayIndex = 0; rayIndex < path.length; rayIndex++) {
            const ray = path[rayIndex];
            if (!ray || Math.max(ray.powerWeight ?? ray.intensity, 0) <= 0) continue;
            if (ray.isBackward || ray.sourceId?.startsWith('reverse_trace_')) continue;

            const endWorld = raySegmentEnd(path, rayIndex);
            if (!endWorld) continue;

            const startLocal = toVec3(ray.origin).clone().applyMatrix4(spec.worldToLocal);
            const endLocal = endWorld.clone().applyMatrix4(spec.worldToLocal);
            const dz = endLocal.z - startLocal.z;
            if (Math.abs(dz) < 1e-12) continue;

            const t = (spec.localZ - startLocal.z) / dz;
            if (t < -1e-9 || t > 1 + 1e-9) continue;
            if (t <= 1e-9 && rayIndex > 0) continue;

            const clampedT = Math.max(0, Math.min(1, t));
            const hitLocal = startLocal.clone().lerp(endLocal, clampedT);
            if (!pointInsidePacketPlane(spec, hitLocal)) continue;

            const hitWorld = hitLocal.clone().applyMatrix4(spec.localToWorld);
            const distance = Math.max(hitWorld.clone().sub(toVec3(ray.origin)).dot(toVec3(ray.direction).clone().normalize()), 0);
            const refractiveIndex = ray.currentMediumIndex ?? 1;
            const terminalRay = childRay(ray, {
                origin: hitWorld,
                opticalPathLength: ray.opticalPathLength + distance * refractiveIndex,
            });
            hits.push({
                localPoint: { x: hitLocal.x, y: hitLocal.y },
                localDirection: toVec3(ray.direction).clone().transformDirection(spec.worldToLocal).normalize(),
                ray: terminalRay,
                detectorId: spec.detectorId,
            });
        }
    }

    return hits;
}

export function summarizePacketHitValidity(hits: TerminalPacketHit[]): PacketHitValidity {
    let rigorousHits = 0;
    let fallbackHits = 0;
    let unknownHits = 0;
    const sourceIds = new Set<string>();
    const sourceKinds = new Set<string>();
    let allCoherent = true;

    for (const hit of hits) {
        if (hit.ray.packetLaunchRigor === 'rigorous') rigorousHits++;
        else if (hit.ray.packetLaunchRigor === 'geometricFallback') fallbackHits++;
        else unknownHits++;
        sourceIds.add(hit.ray.sourceId ?? '__anonymous__');
        sourceKinds.add(hit.ray.sourceKind ?? '__unknown__');
        allCoherent &&= hit.ray.coherenceMode === Coherence.Coherent;
    }

    const isPacketFieldValid = hits.length > 0 && fallbackHits === 0 && unknownHits === 0;
    let psfInvalidReason: string | undefined;
    if (!isPacketFieldValid) {
        psfInvalidReason = 'fallback source';
    } else if (!allCoherent) {
        psfInvalidReason = 'incoherent source';
    } else if (sourceIds.size !== 1) {
        psfInvalidReason = 'multiple sources';
    } else if (sourceKinds.size !== 1 || !sourceKinds.has('laser')) {
        psfInvalidReason = 'not point-like';
    }

    return {
        totalHits: hits.length,
        rigorousHits,
        fallbackHits,
        unknownHits,
        isPacketFieldValid,
        isPsfValid: psfInvalidReason === undefined && hits.length > 0,
        psfInvalidReason,
    };
}

export function synthesizeTerminalFieldFromHits(
    hits: TerminalPacketHit[],
    options: {
        width: number;
        height: number;
        resX: number;
        resY: number;
        centerX?: number;
        centerY?: number;
    },
): TerminalFieldData {
    const resX = Math.max(1, Math.floor(options.resX));
    const resY = Math.max(1, Math.floor(options.resY));
    const intensity = new Float32Array(resX * resY);
    const pixelArea = Math.max(options.width / resX, 1e-12) * Math.max(options.height / resY, 1e-12);
    const centerX = options.centerX ?? 0;
    const centerY = options.centerY ?? 0;

    for (let y = 0; y < resY; y++) {
        const v = centerY + ((y + 0.5) / resY - 0.5) * options.height;
        for (let x = 0; x < resX; x++) {
            const u = centerX + ((x + 0.5) / resX - 0.5) * options.width;
            const index = y * resX + x;
            intensity[index] = synthesizeTerminalPoint(hits, u, v) * pixelArea;
        }
    }

    return {
        resX,
        resY,
        extentWidth: options.width,
        extentHeight: options.height,
        centerX,
        centerY,
        pixelArea,
        intensity,
    };
}

export function adaptiveTerminalFieldWindow(
    hits: TerminalPacketHit[],
    options: {
        maxWidth: number;
        maxHeight: number;
        minWidth?: number;
        minHeight?: number;
        marginSigmas?: number;
    },
): TerminalFieldWindow {
    const maxWidth = Math.max(options.maxWidth, 1e-6);
    const maxHeight = Math.max(options.maxHeight, 1e-6);
    if (hits.length === 0) {
        return { centerX: 0, centerY: 0, width: maxWidth, height: maxHeight };
    }

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxSigma = 0;
    let weightedX = 0;
    let weightedY = 0;
    let totalWeight = 0;

    for (const hit of hits) {
        minX = Math.min(minX, hit.localPoint.x);
        maxX = Math.max(maxX, hit.localPoint.x);
        minY = Math.min(minY, hit.localPoint.y);
        maxY = Math.max(maxY, hit.localPoint.y);
        const weight = Math.max(hit.ray.powerWeight ?? hit.ray.intensity, 0);
        weightedX += hit.localPoint.x * weight;
        weightedY += hit.localPoint.y * weight;
        totalWeight += weight;
        maxSigma = Math.max(
            maxSigma,
            (hit.ray.footprintRadius ?? 0) / Math.SQRT2,
        );
    }

    const safeSigma = Math.max(maxSigma, 0.001);
    const margin = Math.max(safeSigma * (options.marginSigmas ?? 8), 0.01);
    const minWidth = Math.max(options.minWidth ?? 0, safeSigma * 12, 0.05);
    const minHeight = Math.max(options.minHeight ?? 0, safeSigma * 12, 0.05);
    const centerX = totalWeight > 0 ? weightedX / totalWeight : (minX + maxX) * 0.5;
    const centerY = totalWeight > 0 ? weightedY / totalWeight : (minY + maxY) * 0.5;
    const halfWidth = Math.max(Math.abs(maxX - centerX), Math.abs(centerX - minX)) + margin;
    const halfHeight = Math.max(Math.abs(maxY - centerY), Math.abs(centerY - minY)) + margin;
    const width = Math.min(maxWidth, Math.max(halfWidth * 2, minWidth));
    const height = Math.min(maxHeight, Math.max(halfHeight * 2, minHeight));

    return {
        centerX,
        centerY,
        width,
        height,
    };
}

export function synthesizeTerminalPoint(hits: TerminalPacketHit[], u: number, v: number): number {
    let incoherent = 0;
    const coherentGroups = new Map<string, { re: number; im: number }>();

    for (const hit of hits) {
        const ray = hit.ray;
        const power = Math.max(ray.powerWeight ?? ray.intensity, 0);
        if (power <= 0) continue;

        const w = Math.max(ray.footprintRadius, 0.001);
        const wx = w;
        const wy = w;
        const du = u - hit.localPoint.x;
        const dv = v - hit.localPoint.y;
        const envelope = Math.exp(-((du * du) / (wx * wx) + (dv * dv) / (wy * wy)));
        if (envelope < 1e-8) continue;

        const density = gaussianPeakIntensity(power, wx, wy);
        const localIntensity = density * envelope * envelope;
        if (ray.coherenceMode !== Coherence.Coherent) {
            incoherent += localIntensity;
            continue;
        }

        const wavelengthMm = Math.max(ray.wavelength * 1e3, 1e-12);
        const phase = ray.phase ?? ((2 * Math.PI * ray.opticalPathLength) / wavelengthMm);
        const amplitude = Math.sqrt(density) * envelope;

        // Bin coherent contributions by sourceId, wavelength, and the
        // optical-path-length bin (size = coherence length L_c = λ²/Δλ).
        // Rays in the same bin interfere; rays in different bins of the same
        // source-and-wavelength add as intensities, mirroring how a finite-
        // bandwidth source decoheres beamlets that drift out of step.
        const bandwidthM = ray.bandwidth ?? 0;
        const lcMm = bandwidthM > 0
            ? (ray.wavelength * ray.wavelength / bandwidthM) * 1e3
            : Number.POSITIVE_INFINITY;
        const oplBin = Number.isFinite(lcMm) ? Math.floor(ray.opticalPathLength / lcMm) : 0;
        const key = `${ray.sourceId ?? '__anonymous__'}:${Math.round(ray.wavelength * 1e12)}:${oplBin}`;
        const group = coherentGroups.get(key) ?? { re: 0, im: 0 };
        group.re += amplitude * Math.cos(phase);
        group.im += amplitude * Math.sin(phase);
        coherentGroups.set(key, group);
    }

    let total = incoherent;
    for (const group of coherentGroups.values()) {
        total += group.re * group.re + group.im * group.im;
    }
    return total;
}

export function synthesizeTerminalAxialSectionsFromRayPaths(
    rayPaths: Ray[][],
    spec: PacketPlaneSpec,
    window: TerminalFieldWindow,
    options: {
        resTransverse?: number;
        resZ?: number;
        axialDepth?: number;
    } = {},
): TerminalAxialSections {
    const resTransverse = Math.max(8, Math.floor(options.resTransverse ?? 48));
    const resZ = Math.max(5, Math.floor(options.resZ ?? 33));
    const transverseWidthX = Math.max(window.width, 1e-6);
    const transverseWidthY = Math.max(window.height, 1e-6);
    const axialDepth = Math.max(
        options.axialDepth ?? Math.max(transverseWidthX, transverseWidthY, 0.25) * 3,
        1e-6,
    );
    const xz = new Float32Array(resTransverse * resZ);
    const yz = new Float32Array(resTransverse * resZ);

    for (let zi = 0; zi < resZ; zi++) {
        const zOffset = ((zi + 0.5) / resZ - 0.5) * axialDepth;
        const hits = collectTerminalPacketHitsFromRayPaths(rayPaths, {
            ...spec,
            localZ: spec.localZ + zOffset,
        });
        for (let ti = 0; ti < resTransverse; ti++) {
            const x = window.centerX + ((ti + 0.5) / resTransverse - 0.5) * transverseWidthX;
            const y = window.centerY + ((ti + 0.5) / resTransverse - 0.5) * transverseWidthY;
            const index = zi * resTransverse + ti;
            xz[index] = synthesizeTerminalPoint(hits, x, window.centerY);
            yz[index] = synthesizeTerminalPoint(hits, window.centerX, y);
        }
    }

    return {
        resTransverse,
        resZ,
        transverseWidthX,
        transverseWidthY,
        axialDepth,
        centerX: window.centerX,
        centerY: window.centerY,
        baseLocalZ: spec.localZ,
        xz,
        yz,
    };
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | null {
    const n = rhs.length;
    const a = matrix.map((row, i) => [...row, rhs[i]]);

    for (let col = 0; col < n; col++) {
        let pivot = col;
        let pivotAbs = Math.abs(a[col][col]);
        for (let row = col + 1; row < n; row++) {
            const valueAbs = Math.abs(a[row][col]);
            if (valueAbs > pivotAbs) {
                pivot = row;
                pivotAbs = valueAbs;
            }
        }

        if (pivotAbs < 1e-12) return null;
        if (pivot !== col) {
            const tmp = a[col];
            a[col] = a[pivot];
            a[pivot] = tmp;
        }

        const pivotValue = a[col][col];
        for (let j = col; j <= n; j++) a[col][j] /= pivotValue;

        for (let row = 0; row < n; row++) {
            if (row === col) continue;
            const factor = a[row][col];
            if (Math.abs(factor) < 1e-14) continue;
            for (let j = col; j <= n; j++) {
                a[row][j] -= factor * a[col][j];
            }
        }
    }

    return a.map(row => row[n]);
}

export function fitZernikePupilFromHits(
    hits: TerminalPacketHit[],
    options: {
        pupilRadius: number;
        maxIndex?: number;
    },
): ZernikePupilFit | null {
    const pupilRadius = Math.max(options.pupilRadius, 1e-9);
    const samples: Array<{
        rho: number;
        phi: number;
        opdWaves: number;
        weight: number;
        wavelengthMm: number;
        oplMm: number;
    }> = [];
    let weightedOpl = 0;
    let totalWeight = 0;
    let wavelengthWeighted = 0;

    for (const hit of hits) {
        const xNorm = hit.localPoint.x / pupilRadius;
        const yNorm = hit.localPoint.y / pupilRadius;
        const rho = Math.hypot(xNorm, yNorm);
        if (rho > 1 + 1e-9) continue;
        const wavelengthMm = Math.max(hit.ray.wavelength * 1e3, 1e-12);
        const weight = Math.max(hit.ray.powerWeight ?? hit.ray.intensity, 0);
        if (weight <= 0) continue;
        weightedOpl += hit.ray.opticalPathLength * weight;
        wavelengthWeighted += wavelengthMm * weight;
        totalWeight += weight;
        samples.push({
            rho,
            phi: Math.atan2(yNorm, xNorm),
            opdWaves: 0,
            weight,
            wavelengthMm,
            oplMm: hit.ray.opticalPathLength,
        });
    }

    if (samples.length < 4 || totalWeight <= 0) return null;

    const referenceOplMm = weightedOpl / totalWeight;
    const wavelengthMm = wavelengthWeighted / totalWeight;
    for (const sample of samples) {
        sample.opdWaves = (sample.oplMm - referenceOplMm) / sample.wavelengthMm;
    }

    const modeIndices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
        .filter(index => index <= (options.maxIndex ?? 11));
    while (modeIndices.length > Math.max(1, samples.length - 1)) {
        modeIndices.pop();
    }
    if (modeIndices.length === 0) return null;

    const n = modeIndices.length;
    const normal = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
    const rhs = Array.from({ length: n }, () => 0);

    for (const sample of samples) {
        const basis = modeIndices.map(index => evaluateZernikeNoll(index, sample.rho, sample.phi));
        for (let i = 0; i < n; i++) {
            rhs[i] += sample.weight * basis[i] * sample.opdWaves;
            for (let j = 0; j < n; j++) {
                normal[i][j] += sample.weight * basis[i] * basis[j];
            }
        }
    }

    const ridge = Math.max(totalWeight, 1) * 1e-9;
    for (let i = 0; i < n; i++) normal[i][i] += ridge;

    const solved = solveLinearSystem(normal, rhs);
    if (!solved) return null;

    let weightedOpdSq = 0;
    let weightedResidualSq = 0;
    let minOpd = Number.POSITIVE_INFINITY;
    let maxOpd = Number.NEGATIVE_INFINITY;
    for (const sample of samples) {
        let fitted = 0;
        for (let i = 0; i < n; i++) {
            fitted += solved[i] * evaluateZernikeNoll(modeIndices[i], sample.rho, sample.phi);
        }
        const residual = sample.opdWaves - fitted;
        weightedOpdSq += sample.weight * sample.opdWaves * sample.opdWaves;
        weightedResidualSq += sample.weight * residual * residual;
        minOpd = Math.min(minOpd, sample.opdWaves);
        maxOpd = Math.max(maxOpd, sample.opdWaves);
    }

    return {
        sampleCount: samples.length,
        pupilRadius,
        wavelengthM: wavelengthMm / 1e3,
        referenceOplMm,
        rmsWaves: Math.sqrt(weightedOpdSq / totalWeight),
        residualRmsWaves: Math.sqrt(weightedResidualSq / totalWeight),
        peakToValleyWaves: maxOpd - minOpd,
        coefficients: modeIndices.map((index, i) => ({
            index,
            label: zernikeNollLabel(index),
            coefficientWaves: solved[i],
            coefficientMm: solved[i] * wavelengthMm,
        })),
    };
}

function interpolateRadiusForFraction(samples: EncircledEnergySample[], fraction: number): number | null {
    if (samples.length === 0) return null;
    let prev = samples[0];
    if (prev.fraction >= fraction) return prev.radius;
    for (let i = 1; i < samples.length; i++) {
        const next = samples[i];
        if (next.fraction < fraction) {
            prev = next;
            continue;
        }
        const span = Math.max(next.fraction - prev.fraction, 1e-12);
        const t = (fraction - prev.fraction) / span;
        return prev.radius + (next.radius - prev.radius) * t;
    }
    return null;
}

function interpolateMtf50(samples: RadialMtfSample[]): number | null {
    if (samples.length === 0) return null;
    let prev = samples[0];
    for (let i = 1; i < samples.length; i++) {
        const next = samples[i];
        if (next.value > 0.5) {
            prev = next;
            continue;
        }
        const span = Math.max(prev.value - next.value, 1e-12);
        const t = (prev.value - 0.5) / span;
        return prev.spatialFrequency + (next.spatialFrequency - prev.spatialFrequency) * t;
    }
    return null;
}

export function analyzeTerminalField(
    field: TerminalFieldData,
    options: {
        wavelengthM?: number;
        numericalAperture?: number | null;
        encircledBins?: number;
        mtfBins?: number;
        mtfAngles?: number;
    } = {},
): TerminalFieldMetrics {
    const width = Math.max(field.extentWidth, 1e-12);
    const height = Math.max(field.extentHeight, 1e-12);
    const centerX = field.centerX ?? 0;
    const centerY = field.centerY ?? 0;
    const pixelW = width / field.resX;
    const pixelH = height / field.resY;
    const pixelArea = field.pixelArea || Math.max(pixelW * pixelH, 1e-12);

    let totalPower = 0;
    let weightedX = 0;
    let weightedY = 0;
    let peakPixelPower = 0;
    for (let y = 0; y < field.resY; y++) {
        const v = centerY + ((y + 0.5) / field.resY - 0.5) * height;
        for (let x = 0; x < field.resX; x++) {
            const u = centerX + ((x + 0.5) / field.resX - 0.5) * width;
            const power = Math.max(field.intensity[y * field.resX + x], 0);
            totalPower += power;
            weightedX += power * u;
            weightedY += power * v;
            peakPixelPower = Math.max(peakPixelPower, power);
        }
    }

    if (totalPower <= 0) {
        return {
            totalPower: 0,
            peakPowerDensity: 0,
            centroidX: 0,
            centroidY: 0,
            rmsRadius: 0,
            ee50Radius: null,
            ee80Radius: null,
            strehlRatio: null,
            mtf50: null,
            encircledEnergy: [],
            radialMtf: [],
        };
    }

    const centroidX = weightedX / totalPower;
    const centroidY = weightedY / totalPower;
    let secondMoment = 0;
    const radialPixels: { radius: number; power: number }[] = [];
    for (let y = 0; y < field.resY; y++) {
        const v = centerY + ((y + 0.5) / field.resY - 0.5) * height;
        for (let x = 0; x < field.resX; x++) {
            const u = centerX + ((x + 0.5) / field.resX - 0.5) * width;
            const power = Math.max(field.intensity[y * field.resX + x], 0);
            const radius = Math.hypot(u - centroidX, v - centroidY);
            secondMoment += power * radius * radius;
            radialPixels.push({ radius, power });
        }
    }
    radialPixels.sort((a, b) => a.radius - b.radius);

    const encircledBins = Math.max(4, Math.floor(options.encircledBins ?? 32));
    const maxRadius = radialPixels[radialPixels.length - 1]?.radius ?? 0;
    const encircledEnergy: EncircledEnergySample[] = [];
    let cursor = 0;
    let cumulative = 0;
    for (let i = 0; i < encircledBins; i++) {
        const radius = maxRadius * (i + 1) / encircledBins;
        while (cursor < radialPixels.length && radialPixels[cursor].radius <= radius) {
            cumulative += radialPixels[cursor].power;
            cursor++;
        }
        encircledEnergy.push({ radius, fraction: cumulative / totalPower });
    }

    const mtfBins = Math.max(2, Math.floor(options.mtfBins ?? 24));
    const mtfAngles = Math.max(4, Math.floor(options.mtfAngles ?? 12));
    const nyquist = 0.5 / Math.max(pixelW, pixelH, 1e-12);
    const radialMtf: RadialMtfSample[] = [];
    for (let bin = 0; bin < mtfBins; bin++) {
        const spatialFrequency = nyquist * bin / Math.max(mtfBins - 1, 1);
        let magnitudeSum = 0;
        for (let angleIndex = 0; angleIndex < mtfAngles; angleIndex++) {
            const theta = 2 * Math.PI * angleIndex / mtfAngles;
            const fu = spatialFrequency * Math.cos(theta);
            const fv = spatialFrequency * Math.sin(theta);
            let re = 0;
            let im = 0;
            for (let y = 0; y < field.resY; y++) {
                const v = centerY + ((y + 0.5) / field.resY - 0.5) * height;
                for (let x = 0; x < field.resX; x++) {
                    const u = centerX + ((x + 0.5) / field.resX - 0.5) * width;
                    const power = Math.max(field.intensity[y * field.resX + x], 0);
                    const phase = -2 * Math.PI * (fu * (u - centroidX) + fv * (v - centroidY));
                    re += power * Math.cos(phase);
                    im += power * Math.sin(phase);
                }
            }
            magnitudeSum += Math.hypot(re, im) / totalPower;
        }
        radialMtf.push({
            spatialFrequency,
            value: Math.min(1, Math.max(0, magnitudeSum / mtfAngles)),
        });
    }

    const wavelengthMm = options.wavelengthM ? options.wavelengthM * 1e3 : null;
    const na = options.numericalAperture ?? null;
    const idealPeakDensity = wavelengthMm && na && na > 0
        ? totalPower * Math.PI * na * na / (wavelengthMm * wavelengthMm)
        : null;
    const peakPowerDensity = peakPixelPower / pixelArea;

    return {
        totalPower,
        peakPowerDensity,
        centroidX,
        centroidY,
        rmsRadius: Math.sqrt(secondMoment / totalPower),
        ee50Radius: interpolateRadiusForFraction(encircledEnergy, 0.5),
        ee80Radius: interpolateRadiusForFraction(encircledEnergy, 0.8),
        strehlRatio: idealPeakDensity && idealPeakDensity > 0 ? peakPowerDensity / idealPeakDensity : null,
        mtf50: interpolateMtf50(radialMtf),
        encircledEnergy,
        radialMtf,
    };
}
