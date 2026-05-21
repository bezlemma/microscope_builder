import { Matrix4, Vector3 } from 'three';
import { OpticalComponent } from './Component';
import { Camera } from './components/Camera';
import { Laser } from './components/Laser';
import { Lamp } from './components/Lamp';
import { PMT } from './components/PMT';
import { Sample } from './components/Sample';
import { Aperture } from './components/Aperture';
import { SlitAperture } from './components/SlitAperture';
import { PointSourceBase } from './components/PointSourceBase';
import { ConeSource3D } from './components/ConeSource3D';
import { WedgeSource2D } from './components/WedgeSource2D';
import { StructuredSource } from './components/StructuredSource';
import {
    BeamFieldSnapshot,
    CameraKernelSnapshot,
    KernelComponentKind,
    KernelSampleComponent,
    KernelTraceComponent,
    PMTKernelSnapshot,
    TraceSceneSnapshot,
} from './kernelTypes';
import { GaussianBeamSegment } from './BeamField';

const WORLD_BOUNDS_CORNERS = [
    [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1],
    [1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1],
] as const;

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
    if (component instanceof ConeSource3D) return 'coneSource';
    if (component instanceof WedgeSource2D) return 'wedgeSource';
    if (component instanceof StructuredSource) return 'structuredSource';
    if (component instanceof PointSourceBase) return 'pointSource';
    return 'optic';
}

function resolveOpeningRadius(component: OpticalComponent): number | undefined {
    // Aperture-like components expose `openingDiameter`; slit apertures expose
    // `slitWidth`. We pick the smaller half-dimension so importance sampling
    // fits inside the actual clear aperture. Other components return undefined.
    if (component instanceof Aperture) return component.openingDiameter / 2;
    if (component instanceof SlitAperture) return Math.min(component.slitWidth, component.slitHeight) / 2;
    return undefined;
}

function computeWorldBounds(component: OpticalComponent): KernelTraceComponent['worldBounds'] {
    component.updateMatrices();
    const min = component.bounds.min;
    const max = component.bounds.max;
    const p = new Vector3();
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const corner of WORLD_BOUNDS_CORNERS) {
        p.set(
            corner[0] ? max.x : min.x,
            corner[1] ? max.y : min.y,
            corner[2] ? max.z : min.z,
        ).applyMatrix4(component.localToWorld);
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.z < minZ) minZ = p.z;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
        if (p.z > maxZ) maxZ = p.z;
    }

    return { minX, minY, minZ, maxX, maxY, maxZ };
}

function baseComponentSnapshot(component: OpticalComponent): KernelTraceComponent {
    const worldBounds = computeWorldBounds(component);
    return {
        id: component.id,
        name: component.name,
        kind: resolveKernelKind(component),
        absorptionCoeff: component.absorptionCoeff,
        position: component.position,
        localToWorld: component.localToWorld,
        worldBounds,
        openingRadius: resolveOpeningRadius(component),
        chkIntersection: (ray, maxDistance) => component.chkIntersection(ray, maxDistance),
        interact: (ray, hit) => component.interact(ray, hit),
    };
}

export function createTraceSceneSnapshot(scene: OpticalComponent[]): TraceSceneSnapshot {
    const components: KernelTraceComponent[] = [];
    const samples: KernelSampleComponent[] = [];

    for (const component of scene) {
        const base = baseComponentSnapshot(component);
        components.push(base);

        if (component instanceof Sample) {
            const sampleSnapshot: KernelSampleComponent = {
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
                getInteractionIntersection: (worldRay) => component.getInteractionIntersection(worldRay),
            };
            samples.push(sampleSnapshot);
        }
    }

    return { components, samples, sample: samples[0] };
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
        sampleOffset: pmt.sampleOffset,
    };
}
