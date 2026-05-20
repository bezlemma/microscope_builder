import { Vector3 } from 'three';
import { GaussianBeamSegment } from './Solver2';
import { HitRecord, InteractionResult, Ray } from './types';

export type KernelComponentKind =
    | 'optic'
    | 'camera'
    | 'laser'
    | 'lamp'
    | 'pmt'
    | 'sample'
    | 'aperture'
    | 'slitAperture'
    | 'pointSource'
    | 'coneSource'
    | 'wedgeSource'
    | 'structuredSource';

export interface KernelTraceComponent {
    id: string;
    name: string;
    kind: KernelComponentKind;
    absorptionCoeff: number;
    /** World-space centre of the component (read from the underlying instance). */
    position: Vector3;
    /** World-space AABB used by the Solver 3 scene accelerator. */
    worldBounds: {
        minX: number;
        minY: number;
        minZ: number;
        maxX: number;
        maxY: number;
        maxZ: number;
    };
    /** Clear-aperture radius (mm) exposed for detector importance sampling.
     *  Zero (or undefined) means the detector sampler falls back to a generic
     *  target disc. Set for Aperture / SlitAperture so
     *  PMT backward rays correctly aim at the actual pinhole. */
    openingRadius?: number;
    chkIntersection(ray: Ray, maxDistance?: number): HitRecord | null;
    interact(ray: Ray, hit: HitRecord): InteractionResult;
}

export interface KernelSampleComponent extends KernelTraceComponent {
    kind: 'sample';
    fluorescenceEfficiency: number;
    absorption: number;
    getEmissionWavelength(): number;
    getExcitationWavelength(): number;
    emissionTransmission(wavelengthNm: number): number;
    computeChordLength(worldRay: Ray): { chordLength: number; midT: number };
    computeChordSegments(worldRay: Ray): { tStart: number; tEnd: number }[];
    getVolumeIntersection(worldRay: Ray): { tNear: number; tFar: number } | null;
    getInteractionIntersection(worldRay: Ray): { tNear: number; tFar: number } | null;
}

export interface TraceSceneSnapshot {
    components: KernelTraceComponent[];
    samples: KernelSampleComponent[];
    /** First sample, kept for legacy single-sample callers and visual fallbacks. */
    sample?: KernelSampleComponent;
}

export interface BeamFieldSnapshot {
    branches: GaussianBeamSegment[][];
}

export interface DetectorBasisSnapshot {
    id: string;
    name: string;
    position: Vector3;
    forward: Vector3;
    uAxis: Vector3;
    vAxis: Vector3;
}

export interface CameraKernelSnapshot extends DetectorBasisSnapshot {
    width: number;
    height: number;
    sensorResX: number;
    sensorResY: number;
    sensorNA: number;
    samplesPerPixel: number;
}

export interface PMTKernelSnapshot extends DetectorBasisSnapshot {
    sensorNA: number;
    samplesPerPixel: number;
    sampleOffset: number;
}
