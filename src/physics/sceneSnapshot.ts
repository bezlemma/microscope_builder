import { Matrix4, Vector3 } from 'three';
import { OpticalComponent } from './Component';
import { Camera } from './components/Camera';
import { Laser } from './components/Laser';
import { Lamp } from './components/Lamp';
import { PMT } from './components/PMT';
import { Sample } from './components/Sample';
import { Aperture } from './components/Aperture';
import { SlitAperture } from './components/SlitAperture';
import {
    BeamFieldSnapshot,
    CameraKernelSnapshot,
    KernelComponentKind,
    KernelSampleComponent,
    KernelTraceComponent,
    PMTKernelSnapshot,
    TraceSceneSnapshot,
} from './kernelTypes';
import { GaussianBeamSegment } from './Solver2';

function cloneDirection(matrix: Matrix4, axis: Vector3): Vector3 {
    return axis.clone().transformDirection(matrix).normalize();
}

function resolveKernelKind(component: OpticalComponent): KernelComponentKind {
    if (component instanceof Camera) return 'camera';
    if (component instanceof Laser) return 'laser';
    if (component instanceof Lamp) return 'lamp';
    if (component instanceof PMT) return 'pmt';
    if (component instanceof Sample) return 'sample';
    if (component instanceof Aperture) return 'aperture';
    if (component instanceof SlitAperture) return 'slitAperture';
    return 'optic';
}

function baseComponentSnapshot(component: OpticalComponent): KernelTraceComponent {
    return {
        id: component.id,
        name: component.name,
        kind: resolveKernelKind(component),
        absorptionCoeff: component.absorptionCoeff,
        chkIntersection: (ray) => component.chkIntersection(ray),
        interact: (ray, hit) => component.interact(ray, hit),
    };
}

export function createTraceSceneSnapshot(scene: OpticalComponent[]): TraceSceneSnapshot {
    const components: KernelTraceComponent[] = [];
    let sampleSnapshot: KernelSampleComponent | undefined;

    for (const component of scene) {
        const base = baseComponentSnapshot(component);
        components.push(base);

        if (component instanceof Sample) {
            sampleSnapshot = {
                ...base,
                kind: 'sample',
                fluorescenceEfficiency: component.fluorescenceEfficiency,
                absorption: component.absorption,
                getEmissionWavelength: () => component.getEmissionWavelength(),
                getExcitationWavelength: () => component.getExcitationWavelength(),
                emissionTransmission: (wavelengthNm: number) => component.emissionSpectrum.getTransmission(wavelengthNm),
                computeChordLength: (worldRay) => component.computeChordLength(worldRay),
                computeChordSegments: (worldRay) => component.computeChordSegments(worldRay),
                getVolumeIntersection: (worldRay) => component.getVolumeIntersection(worldRay),
            };
        }
    }

    return { components, sample: sampleSnapshot };
}

export function createBeamFieldSnapshot(beamSegments: GaussianBeamSegment[][]): BeamFieldSnapshot {
    return { branches: beamSegments };
}

export function createCameraKernelSnapshot(camera: Camera): CameraKernelSnapshot {
    camera.updateMatrices();
    const matrix = camera.localToWorld;
    return {
        id: camera.id,
        name: camera.name,
        position: new Vector3().setFromMatrixPosition(matrix),
        forward: cloneDirection(matrix, new Vector3(0, 0, 1)),
        uAxis: cloneDirection(matrix, new Vector3(-1, 0, 0)),
        vAxis: cloneDirection(matrix, new Vector3(0, -1, 0)),
        width: camera.width,
        height: camera.height,
        sensorResX: camera.sensorResX,
        sensorResY: camera.sensorResY,
        sensorNA: camera.sensorNA,
        samplesPerPixel: camera.samplesPerPixel,
    };
}

export function createPMTKernelSnapshot(pmt: PMT): PMTKernelSnapshot {
    pmt.updateMatrices();
    const matrix = pmt.localToWorld;
    return {
        id: pmt.id,
        name: pmt.name,
        position: new Vector3().setFromMatrixPosition(matrix),
        forward: cloneDirection(matrix, new Vector3(0, 0, 1)),
        uAxis: cloneDirection(matrix, new Vector3(1, 0, 0)),
        vAxis: cloneDirection(matrix, new Vector3(0, 1, 0)),
        sensorNA: pmt.sensorNA,
        samplesPerPixel: pmt.samplesPerPixel,
    };
}
