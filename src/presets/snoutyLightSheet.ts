import { Vector3 } from 'three';
import { OpticalComponent } from '../physics/Component';
import { AchromatDoublet } from '../physics/components/AchromatDoublet';
import { Blocker } from '../physics/components/Blocker';
import { Camera } from '../physics/components/Camera';
import { ConeSource3D } from '../physics/components/ConeSource3D';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { Filter } from '../physics/components/Filter';
import { GalvoScanHead } from '../physics/components/GalvoScanHead';
import { Laser } from '../physics/components/Laser';
import { Objective } from '../physics/components/Objective';
import { Sample } from '../physics/components/Sample';
import { SpectralProfile } from '../physics/SpectralProfile';
import type { PresetResult } from '../state/store';
import { findCatalogPart, makeCatalogAttachment } from '../catalog/catalog';

const achromat200 = {
    r1: 77.4,
    r2: -87.6,
    r3: 291.1,
    t1: 4.0,
    t2: 2.5,
    ior1: 1.658,
    ior2: 1.750,
};

function makeAchromat(focalLengthMm: number, apertureRadius: number, name: string): AchromatDoublet {
    const scale = focalLengthMm / 200;
    return new AchromatDoublet(
        achromat200.r1 * scale,
        achromat200.r2 * scale,
        achromat200.r3 * scale,
        achromat200.t1,
        achromat200.t2,
        apertureRadius,
        achromat200.ior1,
        achromat200.ior2,
        name,
    );
}

function makeCylindricalLens(focalLengthMm: number, apertureRadius: number, name: string): CylindricalLens {
    const ior = 1.5168;
    const radius = (ior - 1) * focalLengthMm;
    return new CylindricalLens(radius, 1e9, apertureRadius, 25.4, 4, name, ior);
}

function placeAt<T extends OpticalComponent>(component: T, position: Vector3, direction: Vector3): T {
    component.setPosition(position.x, position.y, position.z);
    component.pointAlong(direction.x, direction.y, direction.z);
    return component;
}

function place<T extends OpticalComponent>(component: T, x: number, y: number, direction: Vector3): T {
    return placeAt(component, new Vector3(x, y, 0), direction);
}

function placeReflectorAt<T extends OpticalComponent>(
    component: T,
    position: Vector3,
    incomingDirection: Vector3,
    outgoingDirection: Vector3,
): T {
    const incoming = incomingDirection.clone().normalize();
    const outgoing = outgoingDirection.clone().normalize();
    const normal = incoming.sub(outgoing);
    if (normal.lengthSq() < 1e-12) {
        throw new Error('Reflector placement requires distinct incoming and outgoing directions.');
    }
    normal.normalize();
    component.setPosition(position.x, position.y, position.z);
    component.pointAlong(normal.x, normal.y, normal.z);
    return component;
}

/**
 * Appendix-style high-NA single-objective light-sheet path.
 *
 * The emission path follows the York/Sikking appendix train:
 * sample -> O1 -> TL1 -> SL1 -> G1 -> SL2 -> TL2 -> D -> O2 -> O2* -> tilted O3 -> TL3 -> camera.
 */
export function createSnoutyLightSheetScene(): PresetResult {
    const scene: OpticalComponent[] = [];

    const dRight = new Vector3(1, 0, 0);
    const dLeft = new Vector3(-1, 0, 0);
    const dUp = new Vector3(0, 1, 0);
    const tertiaryAxis = new Vector3(Math.cos(Math.PI / 3), Math.sin(Math.PI / 3), 0).normalize();

    const sample = new Sample('S Sample, live-cell index 1.35-1.4');
    sample.excitationSpectrum = new SpectralProfile('bandpass', 488, [{ center: 488, width: 30 }], 4);
    sample.emissionSpectrum = new SpectralProfile('bandpass', 525, [{ center: 525, width: 50 }], 4);
    sample.fluorescenceEfficiency = 0.8;
    sample.absorption = 0.05;
    sample.specimenOffset.set(0, 0, -0.8);
    place(sample, -2.82, 0, dLeft);
    scene.push(sample);

    const excitationDump = new Blocker(90, 5, 'Post-Sample Excitation Beam Dump');
    place(excitationDump, -35, 0, dRight);
    scene.push(excitationDump);

    const fluorescenceSource = new ConeSource3D('525 nm Sample Fluorescence Cone');
    fluorescenceSource.wavelength = 525;
    fluorescenceSource.beamRadius = 0.06;
    fluorescenceSource.power = 0.025;
    fluorescenceSource.halfAngle = Math.asin(1.35 / 1.406);
    place(fluorescenceSource, -2.02, 0, dRight);
    scene.push(fluorescenceSource);

    const objective1 = new Objective({
        magnification: 100,
        NA: 1.35,
        immersionIndex: 1.406,
        workingDistance: 0.30,
        tubeLensFocal: 200,
        diameter: 28,
        name: 'O1 Nikon 100x/1.35 Silicone Primary',
    });
    objective1.setImmersionMedium('silicone');
    objective1.coverslipThickness = 0.17;
    objective1.fieldNumber = 22;
    place(objective1, 0, 0, dRight);
    scene.push(objective1);

    const tubeLens1 = makeAchromat(200, 12.5, 'TL1 Nikon MXA22018 Tube Lens (f=200)');
    place(tubeLens1, 120, 0, dRight);
    scene.push(tubeLens1);

    const scanLens1 = makeAchromat(70, 12.5, 'SL1 Thorlabs CLS-SL Scan Lens (f=70)');
    place(scanLens1, 390, 0, dRight);
    scene.push(scanLens1);

    const galvo1 = new GalvoScanHead(5, 2, 'G1 Thorlabs GVS201 1D Galvo Scan Mirror');
    placeReflectorAt(galvo1, new Vector3(460, 0, 0), dRight, dUp);
    scene.push(galvo1);

    const scanLens2 = makeAchromat(39, 10, 'SL2 Thorlabs LSM03-VIS Scan Lens (f=39)');
    place(scanLens2, 460, 39, dUp);
    scene.push(scanLens2);

    const tubeLens2 = makeAchromat(200, 12.5, 'TL2 Nikon MXA22018 Tube Lens (f=200)');
    place(tubeLens2, 460, 278, dUp);
    scene.push(tubeLens2);

    const dichroic = new DichroicMirror(
        30,
        2,
        new SpectralProfile('longpass', 505, [], 4),
        'D Quad Dichroic, 488 Reflect / Emission Pass',
    );
    placeAt(dichroic, new Vector3(460, 345, 0), new Vector3(-1, 1, 0).normalize());
    scene.push(dichroic);

    const excitationLaser = new Laser('488 nm Sheet Coupling Laser');
    excitationLaser.wavelength = 488;
    excitationLaser.beamRadius = 0.45;
    excitationLaser.power = 0.12;
    place(excitationLaser, 610, 345, dLeft);
    scene.push(excitationLaser);

    const excitationFilter = new Filter(
        25,
        2,
        new SpectralProfile('bandpass', 488, [{ center: 488, width: 10 }], 3),
        'EX 488/10 Clean-up Filter',
    );
    place(excitationFilter, 570, 345, dLeft);
    scene.push(excitationFilter);

    const sheetLens = makeCylindricalLens(75, 10, 'CL Sheet-Forming Cylindrical Lens');
    sheetLens.rollAngle = Math.PI / 2;
    sheetLens.recomputeRotation();
    place(sheetLens, 520, 345, dLeft);
    scene.push(sheetLens);

    const objective2 = new Objective({
        magnification: 40,
        NA: 0.95,
        immersionIndex: 1.0,
        workingDistance: 0.25,
        tubeLensFocal: 200,
        diameter: 22,
        name: 'O2 Nikon 40x/0.95 Air Remote Objective',
    });
    objective2.setImmersionMedium('air');
    objective2.coverslipThickness = 0;
    objective2.fieldNumber = 22;
    place(objective2, 460, 405, dUp.clone().negate());
    scene.push(objective2);

    const remoteImagePlane = new Vector3(460, 410, 0);
    const remoteWindow = new Filter(
        4,
        0.17,
        new SpectralProfile('longpass', 350, [], 2),
        'O2* Remote Coverslip Window',
    );
    placeAt(remoteWindow, remoteImagePlane.clone(), dUp);
    scene.push(remoteWindow);

    const objective3 = new Objective({
        magnification: 40,
        NA: 1.0,
        immersionIndex: 1.0,
        workingDistance: 0,
        tubeLensFocal: 200,
        diameter: 26,
        mechanicalStyle: 'snout',
        snoutRadius: 3.38,
        snoutLength: 11,
        snoutCutOffset: 0.75,
        snoutCutAngle: -Math.PI / 2,
        name: 'O3 ASI AMS-AGY v1 Snout Objective (NA 1.0, EFL 5 mm, WD 0)',
    });
    objective3.setImmersionMedium('air');
    objective3.coverslipThickness = 0;
    objective3.fieldNumber = 0.25;
    const amsAgyV1Part = findCatalogPart('asi:54-10-5');
    if (amsAgyV1Part) objective3.catalog = makeCatalogAttachment(amsAgyV1Part);
    placeAt(objective3, remoteImagePlane.clone().add(tertiaryAxis.clone().multiplyScalar(5)), tertiaryAxis);
    objective3.rollAngle = -Math.PI / 2;
    objective3.recomputeRotation();
    scene.push(objective3);

    const emissionFilter = new Filter(
        25,
        3,
        new SpectralProfile('bandpass', 525, [{ center: 525, width: 50 }], 5),
        'E Quad Emission Filter / BP 525/50',
    );
    placeAt(emissionFilter, objective3.position.clone().add(tertiaryAxis.clone().multiplyScalar(88)), tertiaryAxis);
    scene.push(emissionFilter);

    const tubeLens3 = makeAchromat(200, 12.5, 'TL3 Nikon MXA22018 Tube Lens (f=200)');
    placeAt(tubeLens3, objective3.position.clone().add(tertiaryAxis.clone().multiplyScalar(200)), tertiaryAxis);
    scene.push(tubeLens3);

    const camera = new Camera(13.312, 13.312, 'C PCO edge 4.2 sCMOS Camera');
    camera.sensorResX = 16;
    camera.sensorResY = 16;
    camera.sensorNA = 1.0 / 100;
    camera.samplesPerPixel = 4;
    placeAt(camera, tubeLens3.position.clone().add(tertiaryAxis.clone().multiplyScalar(200)), tertiaryAxis.clone().negate());
    scene.push(camera);

    return {
        scene,
        channels: [],
        animationPlaying: false,
        animationSpeed: 1.0,
        scanSteps: 1,
        rayCount: 64,
        rayConfig: {
            minRayOpacity: 0.08,
            maxRayOpacity: 0.72,
        },
    };
}
