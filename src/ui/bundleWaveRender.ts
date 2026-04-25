import { Vector3 } from 'three';
import { BundleEnvelopeSample, BundleWavePath, BundleWaveSegment } from './bundleView';
import { JonesVector } from '../physics/types';

const WAVE_SAMPLES_PER_MM = 5;
const MIN_WAVE_SAMPLES = 20;
const MAX_WAVE_SAMPLES = 1200;
const FIELD_TICK_SPACING_MM = 0.2;
const MAX_INTERFACE_BLEND_MM = 6;
const MIN_BLEND_SAMPLES = 3;

export interface WaveRenderSample {
    axisPoint: Vector3;
    right: Vector3;
    up: Vector3;
    radius: number;
    wavelength: number;
    opticalDistance: number;
    polarization: JonesVector;
    refractiveIndex: number;
    /** True for reverse-trace bundle samples — see BundleWaveSegment.isBackward. */
    isBackward?: boolean;
}

export interface WavePathRenderData {
    waveSamples: WaveRenderSample[];
    tickSamples: WaveRenderSample[];
}

function buildLocalFrame(direction: Vector3): { right: Vector3; up: Vector3 } {
    const dir = direction.clone().normalize();
    const worldUp = Math.abs(dir.z) > 0.9 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    const right = new Vector3().crossVectors(dir, worldUp).normalize();
    const up = new Vector3().crossVectors(right, dir).normalize();
    return { right, up };
}

function envelopeSampleAtFraction(segment: BundleWaveSegment, fraction: number): BundleEnvelopeSample {
    const profile = segment.profile;
    if (profile.length === 0) {
        const center = segment.start.clone().lerp(segment.end, fraction);
        const radius = segment.radiusStart + (segment.radiusEnd - segment.radiusStart) * fraction;
        const right = buildLocalFrame(segment.direction).right;
        return {
            fraction,
            center,
            radius,
            edgeMin: center.clone().addScaledVector(right, -radius),
            edgeMax: center.clone().addScaledVector(right, radius),
        };
    }

    if (fraction <= profile[0].fraction) {
        return {
            fraction,
            center: profile[0].center.clone(),
            radius: profile[0].radius,
            edgeMin: profile[0].edgeMin.clone(),
            edgeMax: profile[0].edgeMax.clone(),
        };
    }

    const last = profile[profile.length - 1];
    if (fraction >= last.fraction) {
        return {
            fraction,
            center: last.center.clone(),
            radius: last.radius,
            edgeMin: last.edgeMin.clone(),
            edgeMax: last.edgeMax.clone(),
        };
    }

    for (let index = 1; index < profile.length; index++) {
        const next = profile[index];
        if (fraction > next.fraction) continue;
        const prev = profile[index - 1];
        const span = Math.max(next.fraction - prev.fraction, 1e-9);
        const localT = (fraction - prev.fraction) / span;
        return {
            fraction,
            center: prev.center.clone().lerp(next.center, localT),
            radius: prev.radius + (next.radius - prev.radius) * localT,
            edgeMin: prev.edgeMin.clone().lerp(next.edgeMin, localT),
            edgeMax: prev.edgeMax.clone().lerp(next.edgeMax, localT),
        };
    }

    return {
        fraction,
        center: last.center.clone(),
        radius: last.radius,
        edgeMin: last.edgeMin.clone(),
        edgeMax: last.edgeMax.clone(),
    };
}

function segmentWaveSampleCount(segment: BundleWaveSegment): number {
    const length = segment.start.distanceTo(segment.end);
    return Math.max(MIN_WAVE_SAMPLES, Math.min(MAX_WAVE_SAMPLES, Math.round(length * WAVE_SAMPLES_PER_MM)));
}

function sampleSegment(segment: BundleWaveSegment, fraction: number): WaveRenderSample {
    const envelope = envelopeSampleAtFraction(segment, fraction);
    const { right, up } = buildLocalFrame(segment.direction);
    const segLength = segment.start.distanceTo(segment.end);
    return {
        axisPoint: envelope.center,
        right,
        up,
        radius: envelope.radius,
        wavelength: segment.wavelength,
        opticalDistance: segment.opticalPathLength + fraction * segLength * (segment.refractiveIndex || 1.0),
        polarization: segment.polarization,
        refractiveIndex: segment.refractiveIndex || 1.0,
        isBackward: segment.isBackward,
    };
}

function buildSegmentSamples(segment: BundleWaveSegment): WaveRenderSample[] {
    const sampleCount = segmentWaveSampleCount(segment);
    return Array.from({ length: sampleCount }, (_, index) => {
        const fraction = sampleCount === 1 ? 0 : index / (sampleCount - 1);
        return sampleSegment(segment, fraction);
    });
}

function smoothstep(value: number): number {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
}

function bezierPoint(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number): Vector3 {
    const omt = 1 - t;
    return p0.clone().multiplyScalar(omt * omt * omt)
        .add(p1.clone().multiplyScalar(3 * omt * omt * t))
        .add(p2.clone().multiplyScalar(3 * omt * t * t))
        .add(p3.clone().multiplyScalar(t * t * t));
}

function blendOrthogonalVector(a: Vector3, b: Vector3, direction: Vector3, fallback: Vector3, t: number): Vector3 {
    const blended = a.clone().lerp(b, smoothstep(t));
    blended.addScaledVector(direction, -blended.dot(direction));
    if (blended.lengthSq() < 1e-9) {
        blended.copy(fallback);
        blended.addScaledVector(direction, -blended.dot(direction));
    }
    if (blended.lengthSq() < 1e-9) {
        return fallback.clone();
    }
    return blended.normalize();
}

function transitionBlendSampleCount(samples: WaveRenderSample[], segment: BundleWaveSegment): number {
    if (samples.length < 6) return 0;
    const segmentLength = segment.start.distanceTo(segment.end);
    const spacing = segmentLength / Math.max(samples.length - 1, 1);
    const requested = Math.round(Math.min(segmentLength * 0.35, MAX_INTERFACE_BLEND_MM) / Math.max(spacing, 1e-6));
    return Math.max(0, Math.min(samples.length - 2, Math.max(MIN_BLEND_SAMPLES, requested)));
}

function buildInterfaceTransition(
    prevSegment: BundleWaveSegment,
    nextSegment: BundleWaveSegment,
    prevAnchor: WaveRenderSample,
    prevBoundary: WaveRenderSample,
    nextBoundary: WaveRenderSample,
    nextAnchor: WaveRenderSample,
    sampleCount: number
): WaveRenderSample[] {
    const boundaryPoint = prevBoundary.axisPoint.clone().lerp(nextBoundary.axisPoint, 0.5);
    const incomingDistance = Math.max(prevAnchor.axisPoint.distanceTo(boundaryPoint), 1e-3);
    const outgoingDistance = Math.max(boundaryPoint.distanceTo(nextAnchor.axisPoint), 1e-3);
    const prevDirection = prevSegment.direction.clone().normalize();
    const nextDirection = nextSegment.direction.clone().normalize();
    const boundaryDirection = prevDirection.clone().add(nextDirection);
    if (boundaryDirection.lengthSq() < 1e-9) {
        boundaryDirection.copy(nextDirection);
    } else {
        boundaryDirection.normalize();
    }

    const firstControl1 = prevAnchor.axisPoint.clone().addScaledVector(prevDirection, incomingDistance * 0.45);
    const firstControl2 = boundaryPoint.clone().addScaledVector(boundaryDirection, -incomingDistance * 0.25);
    const secondControl1 = boundaryPoint.clone().addScaledVector(boundaryDirection, outgoingDistance * 0.25);
    const secondControl2 = nextAnchor.axisPoint.clone().addScaledVector(nextDirection, -outgoingDistance * 0.45);
    const fallbackFrame = buildLocalFrame(boundaryDirection);
    const incomingCount = Math.max(1, Math.floor(sampleCount / 2));
    const outgoingCount = Math.max(1, sampleCount - incomingCount);
    const boundaryOpticalDistance = 0.5 * (prevBoundary.opticalDistance + nextBoundary.opticalDistance);

    const incomingPoints = Array.from({ length: incomingCount }, (_, index) =>
        bezierPoint(prevAnchor.axisPoint, firstControl1, firstControl2, boundaryPoint, (index + 1) / (incomingCount + 1))
    );
    const outgoingPoints = Array.from({ length: outgoingCount }, (_, index) =>
        bezierPoint(boundaryPoint, secondControl1, secondControl2, nextAnchor.axisPoint, (index + 1) / (outgoingCount + 1))
    );

    const transitionSamples: WaveRenderSample[] = [];
    let incomingArc = 0;
    let previousPoint = prevAnchor.axisPoint;

    for (let index = 0; index < incomingPoints.length; index++) {
        const point = incomingPoints[index];
        incomingArc += previousPoint.distanceTo(point);
        previousPoint = point;
        const blendT = smoothstep((index + 1) / (incomingCount + 1));
        const direction = prevDirection.clone().lerp(boundaryDirection, blendT).normalize();
        const right = blendOrthogonalVector(prevAnchor.right, fallbackFrame.right, direction, fallbackFrame.right, blendT);
        const up = new Vector3().crossVectors(right, direction).normalize();
        transitionSamples.push({
            axisPoint: point,
            right,
            up,
            radius: prevAnchor.radius + (prevBoundary.radius - prevAnchor.radius) * blendT,
            wavelength: prevAnchor.wavelength,
            opticalDistance: prevAnchor.opticalDistance + incomingArc * prevAnchor.refractiveIndex,
            polarization: prevAnchor.polarization,
            refractiveIndex: prevAnchor.refractiveIndex,
            isBackward: prevAnchor.isBackward,
        });
    }

    transitionSamples.push({
        axisPoint: boundaryPoint,
        right: fallbackFrame.right.clone(),
        up: fallbackFrame.up.clone(),
        radius: 0.5 * (prevBoundary.radius + nextBoundary.radius),
        wavelength: 0.5 * (prevBoundary.wavelength + nextBoundary.wavelength),
        opticalDistance: boundaryOpticalDistance,
        polarization: nextBoundary.polarization,
        refractiveIndex: nextBoundary.refractiveIndex,
        isBackward: nextBoundary.isBackward,
    });

    let outgoingArc = 0;
    previousPoint = boundaryPoint;

    for (let index = 0; index < outgoingPoints.length; index++) {
        const point = outgoingPoints[index];
        outgoingArc += previousPoint.distanceTo(point);
        previousPoint = point;
        const blendT = smoothstep((index + 1) / (outgoingCount + 1));
        const direction = boundaryDirection.clone().lerp(nextDirection, blendT).normalize();
        const right = blendOrthogonalVector(fallbackFrame.right, nextAnchor.right, direction, fallbackFrame.right, blendT);
        const up = new Vector3().crossVectors(right, direction).normalize();
        transitionSamples.push({
            axisPoint: point,
            right,
            up,
            radius: nextBoundary.radius + (nextAnchor.radius - nextBoundary.radius) * blendT,
            wavelength: nextAnchor.wavelength,
            opticalDistance: boundaryOpticalDistance + outgoingArc * nextAnchor.refractiveIndex,
            polarization: nextAnchor.polarization,
            refractiveIndex: nextAnchor.refractiveIndex,
            isBackward: nextAnchor.isBackward,
        });
    }

    return transitionSamples;
}

function cumulativeSpacingSamples(samples: WaveRenderSample[]): WaveRenderSample[] {
    if (samples.length <= 2) return samples;

    const selected: WaveRenderSample[] = [samples[0]];
    let accumulated = 0;
    let nextTarget = FIELD_TICK_SPACING_MM;

    for (let index = 1; index < samples.length; index++) {
        accumulated += samples[index - 1].axisPoint.distanceTo(samples[index].axisPoint);
        if (accumulated + 1e-6 < nextTarget) continue;
        selected.push(samples[index]);
        nextTarget += FIELD_TICK_SPACING_MM;
    }

    const last = samples[samples.length - 1];
    if (selected[selected.length - 1] !== last) {
        selected.push(last);
    }
    return selected;
}

export function buildWavePathRenderData(path: BundleWavePath): WavePathRenderData {
    if (path.segments.length === 0) {
        return { waveSamples: [], tickSamples: [] };
    }

    const segmentSamples = path.segments.map(buildSegmentSamples);
    const waveSamples: WaveRenderSample[] = [...segmentSamples[0]];

    for (let segmentIndex = 0; segmentIndex < path.segments.length - 1; segmentIndex++) {
        const prevSegment = path.segments[segmentIndex];
        const nextSegment = path.segments[segmentIndex + 1];
        const prevSamples = segmentSamples[segmentIndex];
        const nextSamples = segmentSamples[segmentIndex + 1];
        const prevBlendCount = transitionBlendSampleCount(prevSamples, prevSegment);
        const nextBlendCount = transitionBlendSampleCount(nextSamples, nextSegment);

        if (prevBlendCount === 0 || nextBlendCount === 0) {
            waveSamples.push(...nextSamples.slice(1));
            continue;
        }

        waveSamples.splice(Math.max(0, waveSamples.length - prevBlendCount), prevBlendCount);

        const prevAnchor = prevSamples[prevSamples.length - prevBlendCount - 1];
        const prevBoundary = prevSamples[prevSamples.length - 1];
        const nextBoundary = nextSamples[0];
        const nextAnchor = nextSamples[nextBlendCount];
        const transitionSamples = buildInterfaceTransition(
            prevSegment,
            nextSegment,
            prevAnchor,
            prevBoundary,
            nextBoundary,
            nextAnchor,
            prevBlendCount + nextBlendCount
        );

        waveSamples.push(...transitionSamples);
        waveSamples.push(...nextSamples.slice(nextBlendCount + 1));
    }

    return {
        waveSamples,
        tickSamples: cumulativeSpacingSamples(waveSamples),
    };
}
