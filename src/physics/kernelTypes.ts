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
    | 'slitAperture';

export interface KernelTraceComponent {
    id: string;
    name: string;
    kind: KernelComponentKind;
    absorptionCoeff: number;
    chkIntersection(ray: Ray): HitRecord | null;
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
}

export interface TraceSceneSnapshot {
    components: KernelTraceComponent[];
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
}
