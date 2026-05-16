import { deserializeScene } from '../state/ubzSerializer';
import { createSourceRays, stablePreviewSourceRays } from './SourceRayFactory';
import { Solver1 } from './Solver1';
import { traceStableTableOverlay } from './tableTrace';
import type { Ray } from './types';
import type { GaussianBeamSegment } from './Solver2';
import type { SerializedPath, SerializedRay } from './solver3Worker';

export interface ForwardTraceRequest {
    type: 'trace-forward';
    jobId: number;
    sceneText: string;
    forwardRayCount: number;
    sourceRayLimit: number;
    includeBeamSegments?: boolean;
    returnPaths?: boolean;
}

export interface ForwardTraceDone {
    type: 'forward-done';
    jobId: number;
    paths?: SerializedPath[];
    beamSegments?: SerializedBeamSegment[][];
    sourceRayCount: number;
}

export interface ForwardTraceError {
    type: 'forward-error';
    jobId: number;
    message: string;
}

export type Solver1WorkerRequest = ForwardTraceRequest;
export type Solver1WorkerResponse = ForwardTraceDone | ForwardTraceError;

export interface SerializedBeamSegment {
    start: { x: number; y: number; z: number };
    end: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
    wavelength: number;
    bandwidth?: number;
    power: number;
    sourceId?: string;
    bundleKey?: string;
    footprintStart?: number;
    footprintEnd?: number;
    beamRadiusStart?: number;
    beamRadiusEnd?: number;
    polarization: GaussianBeamSegment['polarization'];
    opticalPathLength: number;
    refractiveIndex: number;
    coherenceMode: number;
}

function serializeRay(ray: Ray): SerializedRay {
    return {
        origin: { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z },
        direction: { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z },
        wavelength: ray.wavelength,
        bandwidth: ray.bandwidth,
        intensity: ray.intensity,
        powerWeight: ray.powerWeight,
        currentMediumIndex: ray.currentMediumIndex,
        opticalPathLength: ray.opticalPathLength,
        phase: ray.phase,
        footprintRadius: ray.footprintRadius,
        coherenceMode: ray.coherenceMode,
        sourceId: ray.sourceId,
        sourceKind: ray.sourceKind,
        packetLaunchRigor: ray.packetLaunchRigor,
        sourcePosition: ray.sourcePosition
            ? { x: ray.sourcePosition.x, y: ray.sourcePosition.y, z: ray.sourcePosition.z }
            : undefined,
        isMainRay: ray.isMainRay,
        isBackward: ray.isBackward,
        polarization: ray.polarization,
        interactionDistance: ray.interactionDistance,
        interactionComponentId: ray.interactionComponentId,
        entryPoint: ray.entryPoint
            ? { x: ray.entryPoint.x, y: ray.entryPoint.y, z: ray.entryPoint.z }
            : undefined,
        internalPath: ray.internalPath?.map(p => ({ x: p.x, y: p.y, z: p.z })),
        terminationPoint: ray.terminationPoint
            ? { x: ray.terminationPoint.x, y: ray.terminationPoint.y, z: ray.terminationPoint.z }
            : undefined,
        exitSurfaceId: ray.exitSurfaceId,
        suppressVisualization: ray.suppressVisualization,
        suppressOpenTail: ray.suppressOpenTail,
    };
}

function serializePath(path: Ray[]): SerializedPath {
    return path.map(serializeRay);
}

function serializeBeamSegment(segment: GaussianBeamSegment): SerializedBeamSegment {
    return {
        start: { x: segment.start.x, y: segment.start.y, z: segment.start.z },
        end: { x: segment.end.x, y: segment.end.y, z: segment.end.z },
        direction: { x: segment.direction.x, y: segment.direction.y, z: segment.direction.z },
        wavelength: segment.wavelength,
        bandwidth: segment.bandwidth,
        power: segment.power,
        sourceId: segment.sourceId,
        bundleKey: segment.bundleKey,
        footprintStart: segment.footprintStart,
        footprintEnd: segment.footprintEnd,
        beamRadiusStart: segment.beamRadiusStart,
        beamRadiusEnd: segment.beamRadiusEnd,
        polarization: segment.polarization,
        opticalPathLength: segment.opticalPathLength,
        refractiveIndex: segment.refractiveIndex,
        coherenceMode: segment.coherenceMode,
    };
}

function post(msg: Solver1WorkerResponse) {
    (self as unknown as Worker).postMessage(msg);
}

(self as unknown as Worker).onmessage = (event: MessageEvent<Solver1WorkerRequest>) => {
    const msg = event.data;
    if (msg.type !== 'trace-forward') return;

    try {
        const components = deserializeScene(msg.sceneText);
        const result = traceStableTableOverlay(components, () => {
            const fullSourceRays = createSourceRays(components, msg.forwardRayCount, 'full');
            const sourceRays = msg.sourceRayLimit < msg.forwardRayCount
                ? stablePreviewSourceRays(fullSourceRays, msg.sourceRayLimit)
                : fullSourceRays;
            const solver = new Solver1(components);
            const traceResult = msg.includeBeamSegments
                ? solver.traceWithBeamSegments(sourceRays)
                : { paths: solver.trace(sourceRays), beamSegments: undefined };
            return { ...traceResult, sourceRayCount: sourceRays.length };
        });
        post({
            type: 'forward-done',
            jobId: msg.jobId,
            paths: msg.returnPaths === false ? undefined : result.paths.map(serializePath),
            beamSegments: result.beamSegments?.map(branch => branch.map(serializeBeamSegment)),
            sourceRayCount: result.sourceRayCount,
        });
    } catch (error) {
        post({
            type: 'forward-error',
            jobId: msg.jobId,
            message: error instanceof Error ? error.message : String(error),
        });
    }
};
