import { Vector3 } from 'three';
import { GaussianBeamSegment, segmentBeamRadiiAtFraction } from '../physics/Solver2';
import { Coherence, JonesVector, Ray } from '../physics/types';

export interface BundleEnvelopeSample {
    fraction: number;
    center: Vector3;
    radius: number;
    edgeMin: Vector3;
    edgeMax: Vector3;
}

export interface BundleWaveSegment {
    key: string;
    bundleGroupKey: string;
    sourceId: string;
    start: Vector3;
    end: Vector3;
    direction: Vector3;
    radiusStart: number;
    radiusEnd: number;
    wavelength: number;
    power: number;
    polarization: JonesVector;
    opticalPathLength: number;
    refractiveIndex: number;
    coherenceMode: Coherence;
    memberCount: number;
    profile: BundleEnvelopeSample[];
    /** Reverse-traced ray bundle.  The wave animation flips direction so the
     *  visible wave crests propagate from the sample toward the source/camera,
     *  matching the physical direction of the actual emitted/scattered light
     *  (the reverse trace runs camera→sample for sampling reasons; the wave
     *  view cares about the physical light path, which is the opposite). */
    isBackward?: boolean;
}

export interface BundleWavePath {
    key: string;
    sourceId: string;
    segments: BundleWaveSegment[];
}

const MIN_SEGMENT_LENGTH = 0.1;
const DIRECTION_DOT_THRESHOLD = 0.85;
const SPATIAL_LINK_SCALE = 6;
const PATH_LINK_PADDING = 2;
const ENVELOPE_PROFILE_SAMPLES = 25;

interface SegmentCluster {
    direction: Vector3;
    members: GaussianBeamSegment[];
}

function buildLocalFrame(direction: Vector3): { right: Vector3; up: Vector3 } {
    const dir = direction.clone().normalize();
    const worldUp = Math.abs(dir.z) > 0.9 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    const right = new Vector3().crossVectors(dir, worldUp).normalize();
    const up = new Vector3().crossVectors(right, dir).normalize();
    return { right, up };
}

function buildDisplayWidthAxis(direction: Vector3): Vector3 | null {
    const projected = direction.clone();
    projected.z = 0;
    if (projected.lengthSq() < 1e-9) return null;
    projected.normalize();
    return new Vector3(-projected.y, projected.x, 0).normalize();
}

function averageDirection(segments: GaussianBeamSegment[]): Vector3 {
    const sum = new Vector3();
    for (const segment of segments) {
        sum.addScaledVector(segment.direction, Math.max(segment.power, 1e-6));
    }
    if (sum.lengthSq() < 1e-12) {
        return segments[0]?.direction.clone().normalize() ?? new Vector3(0, 0, 1);
    }
    return sum.normalize();
}

function segmentFootprintRadius(segment: GaussianBeamSegment, endpoint: 'start' | 'end'): number {
    const beamRadii = segmentBeamRadiiAtFraction(segment, endpoint === 'start' ? 0 : 1);
    return Math.max(beamRadii.wx, beamRadii.wy);
}

function projectedDistance(a: Vector3, b: Vector3, direction: Vector3): number {
    const offset = a.clone().sub(b);
    const along = direction.clone().multiplyScalar(offset.dot(direction));
    return offset.sub(along).length();
}

function areSpatialNeighbors(a: GaussianBeamSegment, b: GaussianBeamSegment, direction: Vector3): boolean {
    const aStartRadius = segmentFootprintRadius(a, 'start');
    const bStartRadius = segmentFootprintRadius(b, 'start');
    const aEndRadius = segmentFootprintRadius(a, 'end');
    const bEndRadius = segmentFootprintRadius(b, 'end');

    const startDistance = projectedDistance(a.start, b.start, direction);
    const endDistance = projectedDistance(a.end, b.end, direction);

    const maxStartDistance = Math.max(aStartRadius + bStartRadius, 0.5) * SPATIAL_LINK_SCALE;
    const maxEndDistance = Math.max(aEndRadius + bEndRadius, 0.5) * SPATIAL_LINK_SCALE;

    return startDistance <= maxStartDistance && endDistance <= maxEndDistance;
}

function splitByDirection(segments: GaussianBeamSegment[]): SegmentCluster[] {
    const directionClusters: SegmentCluster[] = [];

    for (const segment of segments) {
        let bestCluster: SegmentCluster | null = null;
        let bestDot = -1;

        for (const cluster of directionClusters) {
            const dot = cluster.direction.dot(segment.direction);
            if (dot > DIRECTION_DOT_THRESHOLD && dot > bestDot) {
                bestDot = dot;
                bestCluster = cluster;
            }
        }

        if (!bestCluster) {
            directionClusters.push({
                direction: segment.direction.clone().normalize(),
                members: [segment],
            });
            continue;
        }

        bestCluster.members.push(segment);
        bestCluster.direction = averageDirection(bestCluster.members);
    }

    const spatialClusters: SegmentCluster[] = [];

    for (const cluster of directionClusters) {
        const remaining = new Set(cluster.members.map((_, index) => index));

        while (remaining.size > 0) {
            const seedIndex = remaining.values().next().value as number;
            remaining.delete(seedIndex);

            const componentIndices = [seedIndex];
            const queue = [seedIndex];

            while (queue.length > 0) {
                const currentIndex = queue.shift()!;
                const currentSegment = cluster.members[currentIndex];

                for (const candidateIndex of Array.from(remaining)) {
                    const candidate = cluster.members[candidateIndex];
                    if (!areSpatialNeighbors(currentSegment, candidate, cluster.direction)) continue;
                    remaining.delete(candidateIndex);
                    queue.push(candidateIndex);
                    componentIndices.push(candidateIndex);
                }
            }

            const members = componentIndices.map(index => cluster.members[index]);
            spatialClusters.push({
                direction: averageDirection(members),
                members,
            });
        }
    }

    return spatialClusters;
}

function envelopeFromPoints(
    points: Vector3[],
    direction: Vector3
): { center: Vector3; radius: number; edgeMin: Vector3; edgeMax: Vector3 } {
    const { right, up } = buildLocalFrame(direction);
    const displayWidthAxis = buildDisplayWidthAxis(direction);
    const samplePoint = points[0]?.clone() ?? new Vector3();
    let minRight = Infinity;
    let maxRight = -Infinity;
    let minUp = Infinity;
    let maxUp = -Infinity;
    let alongSum = 0;
    let depthSum = 0;
    let count = 0;
    let minPoint = samplePoint.clone();
    let maxPoint = samplePoint.clone();

    for (const point of points) {
        const offset = point.clone().sub(samplePoint);
        const rightCoord = displayWidthAxis ? offset.dot(displayWidthAxis) : offset.dot(right);
        const upCoord = displayWidthAxis ? 0 : offset.dot(up);
        if (rightCoord < minRight) {
            minRight = rightCoord;
            minPoint = point.clone();
        }
        if (rightCoord > maxRight) {
            maxRight = rightCoord;
            maxPoint = point.clone();
        }
        minUp = Math.min(minUp, upCoord);
        maxUp = Math.max(maxUp, upCoord);
        alongSum += offset.dot(direction);
        depthSum += point.z;
        count += 1;
    }

    if (count === 0) {
        return {
            center: samplePoint.clone(),
            radius: 1e-5,
            edgeMin: samplePoint.clone(),
            edgeMax: samplePoint.clone(),
        };
    }

    const centerRight = (minRight + maxRight) * 0.5;
    const centerUp = (minUp + maxUp) * 0.5;
    const centerAlong = alongSum / count;
    const center = samplePoint.clone().addScaledVector(direction, centerAlong);
    let edgeMin = minPoint.clone();
    let edgeMax = maxPoint.clone();
    if (displayWidthAxis) {
        const meanDepth = depthSum / count;
        edgeMin.z = meanDepth;
        edgeMax.z = meanDepth;
        center.copy(edgeMin).add(edgeMax).multiplyScalar(0.5);
    } else {
        center
            .addScaledVector(right, centerRight)
            .addScaledVector(up, centerUp);
        edgeMin = center.clone().addScaledVector(right, minRight);
        edgeMax = center.clone().addScaledVector(right, maxRight);
    }

    let radius = 0.5 * edgeMin.distanceTo(edgeMax);
    if (!displayWidthAxis) {
        for (const point of points) {
            const offset = point.clone().sub(center);
            radius = Math.max(radius, Math.hypot(offset.dot(right), offset.dot(up)));
        }
    }

    return { center, radius: Math.max(radius, 1e-5), edgeMin, edgeMax };
}

function memberPointAtFraction(segment: GaussianBeamSegment, fraction: number): Vector3 {
    return segment.start.clone().lerp(segment.end, fraction);
}

function buildEnvelopeProfile(
    segments: GaussianBeamSegment[],
    direction: Vector3
): BundleEnvelopeSample[] {
    return Array.from({ length: ENVELOPE_PROFILE_SAMPLES }, (_, index) => {
        const fraction = index / (ENVELOPE_PROFILE_SAMPLES - 1);
        const points = segments.map(segment => memberPointAtFraction(segment, fraction));
        const envelope = envelopeFromPoints(points, direction);
        return {
            fraction,
            center: envelope.center,
            radius: envelope.radius,
            edgeMin: envelope.edgeMin,
            edgeMax: envelope.edgeMax,
        };
    });
}

function normalizeReverseSourceId(path: Ray[], pathIndex: number): string {
    const raw = path[0]?.sourceId ?? `reverse_path_${pathIndex}`;
    if (raw.startsWith('solver3_cam_') && raw.includes('_px')) {
        return raw.split('_px')[0];
    }
    const pmtMatch = raw.match(/^(pmt_backward_.+)_\d+$/);
    if (pmtMatch) {
        return pmtMatch[1];
    }
    if (raw.startsWith('solver3_')) {
        return 'solver3_reverse';
    }
    return raw;
}

function inferSegmentIOR(opticalDelta: number, geometricLength: number, fallback: number): number {
    if (geometricLength < 1e-6) return fallback;
    return Math.max(1, Math.min(2.5, opticalDelta / geometricLength || fallback));
}

function rayEndPoint(ray: Ray): Vector3 | null {
    if (ray.terminationPoint) return ray.terminationPoint.clone();
    if (ray.interactionDistance !== undefined && ray.interactionDistance > 1e-6) {
        return ray.origin.clone().add(ray.direction.clone().multiplyScalar(ray.interactionDistance));
    }
    return null;
}

function buildReverseBranch(path: Ray[], pathIndex: number): GaussianBeamSegment[] {
    const branch: GaussianBeamSegment[] = [];
    const sourceId = normalizeReverseSourceId(path, pathIndex);

    for (let rayIndex = 0; rayIndex < path.length; rayIndex++) {
        const ray = path[rayIndex];
        if (ray.intensity < 1e-6) break;

        const fallbackRadius = Math.max(ray.footprintRadius || 0.05, 0.05);
        const previousRay = rayIndex > 0 ? path[rayIndex - 1] : undefined;

        if (ray.entryPoint) {
            const internalPoints: Vector3[] = [ray.entryPoint.clone()];
            if (ray.internalPath) {
                for (const point of ray.internalPath) internalPoints.push(point.clone());
            }
            internalPoints.push(ray.origin.clone());

            let totalInternalLength = 0;
            for (let pointIndex = 0; pointIndex < internalPoints.length - 1; pointIndex++) {
                totalInternalLength += internalPoints[pointIndex].distanceTo(internalPoints[pointIndex + 1]);
            }

            let internalIOR = 1.5;
            if (previousRay && totalInternalLength > 1e-6) {
                const previousEnd = previousRay.origin.distanceTo(ray.entryPoint);
                const opticalDelta = ray.opticalPathLength - previousRay.opticalPathLength;
                internalIOR = inferSegmentIOR(opticalDelta - previousEnd, totalInternalLength, internalIOR);
            }

            let remainingLength = totalInternalLength;
            for (let pointIndex = 0; pointIndex < internalPoints.length - 1; pointIndex++) {
                const start = internalPoints[pointIndex];
                const end = internalPoints[pointIndex + 1];
                const direction = end.clone().sub(start);
                const length = direction.length();
                if (length < 1e-6) continue;
                direction.normalize();
                const opticalPathStart = ray.opticalPathLength - remainingLength * internalIOR;
                remainingLength -= length;
                branch.push({
                    start,
                    end,
                    direction,
                    wavelength: ray.wavelength,
                    power: ray.intensity,
                    sourceId,
                    bundleKey: `${sourceId}|reverse|${rayIndex}|internal`,
                    footprintStart: fallbackRadius,
                    footprintEnd: fallbackRadius,
                    polarization: ray.polarization,
                    opticalPathLength: opticalPathStart,
                    refractiveIndex: internalIOR,
                    coherenceMode: ray.coherenceMode,
                });
            }
        }

        const nextPoint = path[rayIndex + 1]?.entryPoint?.clone()
            ?? path[rayIndex + 1]?.origin?.clone()
            ?? rayEndPoint(ray);
        if (!nextPoint) continue;

        const direction = nextPoint.clone().sub(ray.origin);
        const length = direction.length();
        if (length < 1e-6) continue;
        direction.normalize();

        const nextOptical = path[rayIndex + 1]
            ? path[rayIndex + 1].opticalPathLength
            : ray.opticalPathLength + length;
        const refractiveIndex = inferSegmentIOR(nextOptical - ray.opticalPathLength, length, 1);

        branch.push({
            start: ray.origin.clone(),
            end: nextPoint,
            direction,
            wavelength: ray.wavelength,
            power: ray.intensity,
            sourceId,
            bundleKey: `${sourceId}|reverse|${rayIndex}|travel`,
            footprintStart: fallbackRadius,
            footprintEnd: fallbackRadius,
            polarization: ray.polarization,
            opticalPathLength: ray.opticalPathLength,
            refractiveIndex,
            coherenceMode: ray.coherenceMode,
        });
    }

    return branch;
}

export function buildBundleWaveSegmentsFromRayPaths(paths: Ray[][]): BundleWaveSegment[] {
    const branches = paths
        .map((path, pathIndex) => buildReverseBranch(path, pathIndex))
        .filter(branch => branch.length > 0);
    const bundles = buildBundleWaveSegments(branches);
    // Stamp reverse-trace flag so the visualizer can animate wave crests
    // running toward the source (camera) instead of away from it.
    for (const b of bundles) b.isBackward = true;
    return bundles;
}

function normalizeJones(jones: JonesVector): JonesVector {
    const norm = Math.hypot(
        jones.x.re, jones.x.im,
        jones.y.re, jones.y.im,
        jones.z.re, jones.z.im,
    ) || 1;

    return {
        x: { re: jones.x.re / norm, im: jones.x.im / norm },
        y: { re: jones.y.re / norm, im: jones.y.im / norm },
        z: { re: jones.z.re / norm, im: jones.z.im / norm },
    };
}

function averagePolarization(segments: GaussianBeamSegment[]): JonesVector {
    const sum: JonesVector = {
        x: { re: 0, im: 0 },
        y: { re: 0, im: 0 },
        z: { re: 0, im: 0 },
    };

    for (const segment of segments) {
        const weight = Math.max(segment.power, 1e-6);
        sum.x.re += segment.polarization.x.re * weight;
        sum.x.im += segment.polarization.x.im * weight;
        sum.y.re += segment.polarization.y.re * weight;
        sum.y.im += segment.polarization.y.im * weight;
        sum.z.re += segment.polarization.z.re * weight;
        sum.z.im += segment.polarization.z.im * weight;
    }

    return normalizeJones(sum);
}

export function buildBundleWaveSegments(branches: GaussianBeamSegment[][]): BundleWaveSegment[] {
    const grouped = new Map<string, GaussianBeamSegment[]>();

    for (const branch of branches) {
        for (const segment of branch) {
            const length = segment.start.distanceTo(segment.end);
            if (length < MIN_SEGMENT_LENGTH || segment.power < 1e-8) continue;

            const baseKey = segment.bundleKey ?? `${segment.sourceId ?? 'unknown'}|segment`;
            if (!grouped.has(baseKey)) grouped.set(baseKey, []);
            grouped.get(baseKey)!.push(segment);
        }
    }

    const bundles: BundleWaveSegment[] = [];

    for (const [baseKey, segments] of grouped) {
        const clusters = splitByDirection(segments);

        clusters.forEach((cluster, clusterIndex) => {
            const members = cluster.members;
            const seedDirection = averageDirection(members);
            let profile = buildEnvelopeProfile(members, seedDirection);
            const direction = profile[profile.length - 1].center.clone().sub(profile[0].center);
            const resolvedDirection = direction.lengthSq() > 1e-9
                ? direction.normalize()
                : seedDirection;
            profile = buildEnvelopeProfile(members, resolvedDirection);
            const startEnvelope = profile[0];
            const endEnvelope = profile[profile.length - 1];

            let totalPower = 0;
            let weightedWavelength = 0;
            let weightedOpticalPath = 0;
            let weightedIOR = 0;
            for (const segment of members) {
                const weight = Math.max(segment.power, 1e-6);
                totalPower += segment.power;
                weightedWavelength += segment.wavelength * weight;
                weightedOpticalPath += segment.opticalPathLength * weight;
                weightedIOR += (segment.refractiveIndex || 1.0) * weight;
            }
            const normalizationWeight = members.reduce((sum, segment) => sum + Math.max(segment.power, 1e-6), 0) || 1;

            bundles.push({
                key: `${baseKey}|cluster${clusterIndex}`,
                bundleGroupKey: baseKey,
                sourceId: members[0].sourceId ?? 'unknown',
                start: startEnvelope.center,
                end: endEnvelope.center,
                direction: resolvedDirection,
                radiusStart: startEnvelope.radius,
                radiusEnd: endEnvelope.radius,
                wavelength: weightedWavelength / normalizationWeight,
                power: totalPower,
                polarization: averagePolarization(members),
                opticalPathLength: weightedOpticalPath / normalizationWeight,
                refractiveIndex: weightedIOR / normalizationWeight,
                coherenceMode: members[0].coherenceMode,
                memberCount: members.length,
                profile,
            });
        });
    }

    bundles.sort((a, b) => a.opticalPathLength - b.opticalPathLength);
    return bundles;
}

function canAppendToPath(path: BundleWavePath, segment: BundleWaveSegment): boolean {
    const last = path.segments[path.segments.length - 1];
    if (!last) return false;
    if (last.sourceId !== segment.sourceId) return false;
    if (segment.opticalPathLength + 1e-6 < last.opticalPathLength) return false;

    const endpointGap = last.end.distanceTo(segment.start);
    const allowedGap = Math.max(last.radiusEnd, segment.radiusStart, 0.5) * 2 + PATH_LINK_PADDING;
    return endpointGap <= allowedGap;
}

export function buildBundleWavePaths(bundles: BundleWaveSegment[]): BundleWavePath[] {
    const bySource = new Map<string, BundleWaveSegment[]>();
    for (const bundle of bundles) {
        if (!bySource.has(bundle.sourceId)) bySource.set(bundle.sourceId, []);
        bySource.get(bundle.sourceId)!.push(bundle);
    }

    const paths: BundleWavePath[] = [];

    for (const [sourceId, sourceBundles] of bySource) {
        const ordered = [...sourceBundles].sort((a, b) => a.opticalPathLength - b.opticalPathLength);
        const sourcePaths: BundleWavePath[] = [];

        for (const bundle of ordered) {
            let bestPath: BundleWavePath | null = null;
            let bestGap = Infinity;

            for (const path of sourcePaths) {
                if (!canAppendToPath(path, bundle)) continue;
                const gap = path.segments[path.segments.length - 1].end.distanceTo(bundle.start);
                if (gap < bestGap) {
                    bestGap = gap;
                    bestPath = path;
                }
            }

            if (!bestPath) {
                sourcePaths.push({
                    key: `${sourceId}|path${sourcePaths.length}`,
                    sourceId,
                    segments: [bundle],
                });
                continue;
            }

            bestPath.segments.push(bundle);
        }

        paths.push(...sourcePaths);
    }

    return paths;
}
