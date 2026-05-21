import type { GaussianBeamSegment } from './BeamField';
import { deserializeVector3, serializeVector3, type SerializedVector3 } from './raySerialization';

export interface SerializedBeamSegment {
    start: SerializedVector3;
    end: SerializedVector3;
    direction: SerializedVector3;
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

export function serializeBeamSegment(segment: GaussianBeamSegment): SerializedBeamSegment {
    return {
        start: serializeVector3(segment.start),
        end: serializeVector3(segment.end),
        direction: serializeVector3(segment.direction),
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

export function deserializeBeamSegments(branches: SerializedBeamSegment[][]): GaussianBeamSegment[][] {
    return branches.map(branch => branch.map(segment => ({
        start: deserializeVector3(segment.start),
        end: deserializeVector3(segment.end),
        direction: deserializeVector3(segment.direction),
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
    })));
}
