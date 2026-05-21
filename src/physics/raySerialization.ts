import { Vector3 } from 'three';
import type { Ray } from './types';

export interface SerializedVector3 {
    x: number;
    y: number;
    z: number;
}

export interface SerializedRay {
    origin: SerializedVector3;
    direction: SerializedVector3;
    wavelength: number;
    bandwidth?: number;
    intensity: number;
    powerWeight?: number;
    currentMediumIndex?: number;
    opticalPathLength: number;
    phase?: number;
    footprintRadius: number;
    coherenceMode: number;
    sourceId?: string;
    sourceKind?: Ray['sourceKind'];
    packetLaunchRigor?: Ray['packetLaunchRigor'];
    sourcePosition?: SerializedVector3;
    isMainRay?: boolean;
    isBackward?: boolean;
    polarization?: Ray['polarization'];
    interactionDistance?: number;
    interactionComponentId?: string;
    entryPoint?: SerializedVector3;
    internalPath?: SerializedVector3[];
    terminationPoint?: SerializedVector3;
    exitSurfaceId?: string;
    suppressVisualization?: boolean;
    suppressOpenTail?: boolean;
}

export type SerializedPath = SerializedRay[];

export function serializeVector3(vector: SerializedVector3): SerializedVector3 {
    return { x: vector.x, y: vector.y, z: vector.z };
}

export function deserializeVector3(vector: SerializedVector3): Vector3 {
    return new Vector3(vector.x, vector.y, vector.z);
}

function serializeRay(ray: Ray): SerializedRay {
    return {
        origin: serializeVector3(ray.origin),
        direction: serializeVector3(ray.direction),
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
        sourcePosition: ray.sourcePosition ? serializeVector3(ray.sourcePosition) : undefined,
        isMainRay: ray.isMainRay,
        isBackward: ray.isBackward,
        polarization: ray.polarization,
        interactionDistance: ray.interactionDistance,
        interactionComponentId: ray.interactionComponentId,
        entryPoint: ray.entryPoint ? serializeVector3(ray.entryPoint) : undefined,
        internalPath: ray.internalPath?.map(serializeVector3),
        terminationPoint: ray.terminationPoint ? serializeVector3(ray.terminationPoint) : undefined,
        exitSurfaceId: ray.exitSurfaceId,
        suppressVisualization: ray.suppressVisualization,
        suppressOpenTail: ray.suppressOpenTail,
    };
}

export function serializePath(path: Ray[]): SerializedPath {
    return path.map(serializeRay);
}

export function deserializeRayPath(path: SerializedPath): Ray[] {
    return path.map(ray => ({
        origin: deserializeVector3(ray.origin),
        direction: deserializeVector3(ray.direction),
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
        sourcePosition: ray.sourcePosition ? deserializeVector3(ray.sourcePosition) : undefined,
        isMainRay: ray.isMainRay,
        isBackward: ray.isBackward,
        polarization: ray.polarization ?? { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
        interactionDistance: ray.interactionDistance,
        interactionComponentId: ray.interactionComponentId,
        entryPoint: ray.entryPoint ? deserializeVector3(ray.entryPoint) : undefined,
        internalPath: ray.internalPath?.map(deserializeVector3),
        terminationPoint: ray.terminationPoint ? deserializeVector3(ray.terminationPoint) : undefined,
        exitSurfaceId: ray.exitSurfaceId,
        suppressVisualization: ray.suppressVisualization,
        suppressOpenTail: ray.suppressOpenTail,
    }));
}
