import { Vector3 } from 'three';
import { OpticalComponent } from './Component';
import { Aperture } from './components/Aperture';
import { Camera } from './components/Camera';
import { Lamp } from './components/Lamp';
import { Laser } from './components/Laser';
import { PMT } from './components/PMT';
import { Sample } from './components/Sample';
import { SlitAperture } from './components/SlitAperture';
import { GaussianBeamSegment } from './Solver2';
import { Coherence } from './types';

export const SOLVER3_KERNEL_ABI_VERSION = 1;
export const PACKED_COMPONENT_MATRIX_STRIDE = 16;
export const PACKED_COMPONENT_BOUNDS_STRIDE = 6;
export const PACKED_DETECTOR_BASIS_STRIDE = 12;
export const PACKED_BEAM_SEGMENT_SCALAR_STRIDE = 27;
export const SOLVER3_KERNEL_STATUS_OK = 0;
export const SOLVER3_KERNEL_STATUS_UNSUPPORTED_ABI = 1;
export const SOLVER3_KERNEL_STATUS_UNIMPLEMENTED = 2;

export const DETECTOR_KIND_CAMERA = 1;
export const DETECTOR_KIND_PMT = 2;

const COMPONENT_KIND_CODE: Record<string, number> = {
    optic: 0,
    camera: 1,
    laser: 2,
    lamp: 3,
    pmt: 4,
    sample: 5,
    aperture: 6,
    slitAperture: 7,
};

function componentKindCode(component: OpticalComponent): number {
    if (component instanceof Camera) return COMPONENT_KIND_CODE.camera;
    if (component instanceof Laser) return COMPONENT_KIND_CODE.laser;
    if (component instanceof Lamp) return COMPONENT_KIND_CODE.lamp;
    if (component instanceof PMT) return COMPONENT_KIND_CODE.pmt;
    if (component instanceof Sample) return COMPONENT_KIND_CODE.sample;
    if (component instanceof Aperture) return COMPONENT_KIND_CODE.aperture;
    if (component instanceof SlitAperture) return COMPONENT_KIND_CODE.slitAperture;
    return COMPONENT_KIND_CODE.optic;
}

function copyMatrix(target: Float64Array, offset: number, elements: readonly number[]): void {
    target.set(elements, offset);
}

function writeDetectorBasis(target: Float64Array, position: { x: number; y: number; z: number }, forward: { x: number; y: number; z: number }, uAxis: { x: number; y: number; z: number }, vAxis: { x: number; y: number; z: number }): void {
    target[0] = position.x;
    target[1] = position.y;
    target[2] = position.z;
    target[3] = forward.x;
    target[4] = forward.y;
    target[5] = forward.z;
    target[6] = uAxis.x;
    target[7] = uAxis.y;
    target[8] = uAxis.z;
    target[9] = vAxis.x;
    target[10] = vAxis.y;
    target[11] = vAxis.z;
}

function matrixDirection(component: { localToWorld: { elements: readonly number[] } }, x: number, y: number, z: number): Vector3 {
    return new Vector3(x, y, z).transformDirection(component.localToWorld as any).normalize();
}

export interface PackedTraceScene {
    abiVersion: number;
    componentKinds: Uint8Array;
    componentAbsorptionCoeff: Float64Array;
    localToWorldMatrices: Float64Array;
    worldToLocalMatrices: Float64Array;
    localBounds: Float64Array;
    componentIds: string[];
    componentNames: string[];
    componentVersions: Uint32Array;
    sampleComponentIndex: number;
    sampleScalars: Float64Array | null;
}

export interface PackedBeamField {
    abiVersion: number;
    branchOffsets: Uint32Array;
    segmentScalars: Float64Array;
    coherenceModes: Uint8Array;
}

export interface PackedCameraKernel {
    abiVersion: number;
    id: string;
    name: string;
    basis: Float64Array;
    scalars: Float64Array;
    ints: Uint32Array;
}

export interface PackedPMTKernel {
    abiVersion: number;
    id: string;
    name: string;
    basis: Float64Array;
    scalars: Float64Array;
    ints: Uint32Array;
}

export interface Solver3PacketHeader {
    abiVersion: number;
    traceComponentCount: number;
    beamBranchCount: number;
    beamSegmentCount: number;
    detectorKind: number;
}

export function createPackedTraceScene(scene: OpticalComponent[]): PackedTraceScene {
    const count = scene.length;
    const componentKinds = new Uint8Array(count);
    const componentAbsorptionCoeff = new Float64Array(count);
    const localToWorldMatrices = new Float64Array(count * PACKED_COMPONENT_MATRIX_STRIDE);
    const worldToLocalMatrices = new Float64Array(count * PACKED_COMPONENT_MATRIX_STRIDE);
    const localBounds = new Float64Array(count * PACKED_COMPONENT_BOUNDS_STRIDE);
    const componentIds = new Array<string>(count);
    const componentNames = new Array<string>(count);
    const componentVersions = new Uint32Array(count);
    let sampleComponentIndex = -1;
    let sampleScalars: Float64Array | null = null;

    for (let i = 0; i < count; i++) {
        const component = scene[i];
        component.updateMatrices();

        componentKinds[i] = componentKindCode(component);
        componentAbsorptionCoeff[i] = component.absorptionCoeff;
        copyMatrix(localToWorldMatrices, i * PACKED_COMPONENT_MATRIX_STRIDE, component.localToWorld.elements);
        copyMatrix(worldToLocalMatrices, i * PACKED_COMPONENT_MATRIX_STRIDE, component.worldToLocal.elements);
        localBounds.set([
            component.bounds.min.x,
            component.bounds.min.y,
            component.bounds.min.z,
            component.bounds.max.x,
            component.bounds.max.y,
            component.bounds.max.z,
        ], i * PACKED_COMPONENT_BOUNDS_STRIDE);
        componentIds[i] = component.id;
        componentNames[i] = component.name;
        componentVersions[i] = component.version;

        if (component instanceof Sample) {
            sampleComponentIndex = i;
            sampleScalars = new Float64Array([
                component.fluorescenceEfficiency,
                component.absorption,
                component.getExcitationWavelength(),
                component.getEmissionWavelength(),
            ]);
        }
    }

    return {
        abiVersion: SOLVER3_KERNEL_ABI_VERSION,
        componentKinds,
        componentAbsorptionCoeff,
        localToWorldMatrices,
        worldToLocalMatrices,
        localBounds,
        componentIds,
        componentNames,
        componentVersions,
        sampleComponentIndex,
        sampleScalars,
    };
}

export function createPackedBeamField(beamSegments: GaussianBeamSegment[][]): PackedBeamField {
    const branchOffsets = new Uint32Array(beamSegments.length + 1);
    let totalSegments = 0;
    for (let i = 0; i < beamSegments.length; i++) {
        branchOffsets[i] = totalSegments;
        totalSegments += beamSegments[i].length;
    }
    branchOffsets[beamSegments.length] = totalSegments;

    const segmentScalars = new Float64Array(totalSegments * PACKED_BEAM_SEGMENT_SCALAR_STRIDE);
    const coherenceModes = new Uint8Array(totalSegments);

    let segmentIndex = 0;
    for (const branch of beamSegments) {
        for (const segment of branch) {
            const base = segmentIndex * PACKED_BEAM_SEGMENT_SCALAR_STRIDE;
            segmentScalars.set([
                segment.start.x, segment.start.y, segment.start.z,
                segment.end.x, segment.end.y, segment.end.z,
                segment.direction.x, segment.direction.y, segment.direction.z,
                segment.wavelength,
                segment.power,
                segment.qx_start.re, segment.qx_start.im,
                segment.qx_end.re, segment.qx_end.im,
                segment.qy_start.re, segment.qy_start.im,
                segment.qy_end.re, segment.qy_end.im,
                segment.footprintStart ?? -1,
                segment.footprintEnd ?? -1,
                segment.opticalPathLength,
                segment.refractiveIndex,
                segment.polarization.x.re,
                segment.polarization.x.im,
                segment.polarization.y.re,
                segment.polarization.y.im,
            ], base);
            coherenceModes[segmentIndex] = segment.coherenceMode === Coherence.Coherent ? 1 : 0;
            segmentIndex += 1;
        }
    }

    return {
        abiVersion: SOLVER3_KERNEL_ABI_VERSION,
        branchOffsets,
        segmentScalars,
        coherenceModes,
    };
}

export function createPackedCameraKernel(camera: Camera): PackedCameraKernel {
    camera.updateMatrices();
    const basis = new Float64Array(PACKED_DETECTOR_BASIS_STRIDE);
    writeDetectorBasis(
        basis,
        camera.position,
        matrixDirection(camera, 0, 0, 1),
        matrixDirection(camera, -1, 0, 0),
        matrixDirection(camera, 0, -1, 0),
    );
    const scalars = new Float64Array([camera.width, camera.height, camera.sensorNA]);
    const ints = new Uint32Array([camera.sensorResX, camera.sensorResY, camera.samplesPerPixel]);

    return {
        abiVersion: SOLVER3_KERNEL_ABI_VERSION,
        id: camera.id,
        name: camera.name,
        basis,
        scalars,
        ints,
    };
}

export function createPackedPMTKernel(pmt: PMT): PackedPMTKernel {
    pmt.updateMatrices();
    const basis = new Float64Array(PACKED_DETECTOR_BASIS_STRIDE);
    writeDetectorBasis(
        basis,
        pmt.position,
        matrixDirection(pmt, 0, 0, 1),
        matrixDirection(pmt, 1, 0, 0),
        matrixDirection(pmt, 0, 1, 0),
    );
    const scalars = new Float64Array([pmt.sensorNA]);
    const ints = new Uint32Array([pmt.samplesPerPixel]);

    return {
        abiVersion: SOLVER3_KERNEL_ABI_VERSION,
        id: pmt.id,
        name: pmt.name,
        basis,
        scalars,
        ints,
    };
}

export function createSolver3PacketHeader(
    traceScene: PackedTraceScene,
    beamField: PackedBeamField,
    detectorKind: number,
): Solver3PacketHeader {
    return {
        abiVersion: SOLVER3_KERNEL_ABI_VERSION,
        traceComponentCount: traceScene.componentKinds.length,
        beamBranchCount: Math.max(0, beamField.branchOffsets.length - 1),
        beamSegmentCount: beamField.coherenceModes.length,
        detectorKind,
    };
}
