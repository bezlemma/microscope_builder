import { Vector3 } from 'three';
import { OpticalComponent } from '../physics/Component';
import { AchromatDoublet } from '../physics/components/AchromatDoublet';
import { Blocker } from '../physics/components/Blocker';
import { Camera } from '../physics/components/Camera';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { Filter } from '../physics/components/Filter';
import { Laser } from '../physics/components/Laser';
import { Mirror } from '../physics/components/Mirror';
import { Objective } from '../physics/components/Objective';
import { Sample } from '../physics/components/Sample';
import { generateChannelId, type AnimationChannel } from '../physics/PropertyAnimator';
import { SpectralProfile } from '../physics/SpectralProfile';
import type { PresetResult } from '../state/store';

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

function makePlanoConvexAchromat(focalLengthMm: number, apertureRadius: number, name: string): AchromatDoublet {
    return makeAchromat(focalLengthMm, apertureRadius, name);
}

function makeCylindricalLens(focalLengthMm: number, apertureRadius: number, name: string): CylindricalLens {
    const ior = 1.5168;
    const radius = (ior - 1) * focalLengthMm;
    const lens = new CylindricalLens(radius, 1e9, apertureRadius, 25.4, 4, name, ior);
    return lens;
}

function place(component: OpticalComponent, x: number, y: number, direction: Vector3): OpticalComponent {
    component.setPosition(x, y, 0);
    component.pointAlong(direction.x, direction.y, direction.z);
    return component;
}

function setCylindricalRoll(lens: CylindricalLens, roll: number): void {
    lens.rollAngle = roll;
    lens.recomputeRotation();
}

/**
 * Oblique Plane Light Sheet microscope.
 *
 * Based on the Sheung Lab Figure 4/5 topology:
 * excitation shaping optics (L1-L4, CL1-CL3), a wavelength-splitting
 * dichroic feeding a shared O1/sample axis, and an emission relay with a
 * animated scan mirror, O2/O3 remote-refocus pair, emission filter, and camera.
 */
export function createObliquePlaneMicroscopeScene(): PresetResult {
    const scene: OpticalComponent[] = [];

    const dRight = new Vector3(1, 0, 0);
    const dUp = new Vector3(0, 1, 0);
    const dDown = new Vector3(0, -1, 0);
    const cameraArm = new Vector3(0.46, -0.89, 0).normalize();
    const excitationIntoDichroic = new Vector3(0.9961, 0.0887, 0).normalize();
    const excitationToO1 = new Vector3(-3.9, -65, 0).normalize();
    const EXCITATION_SCAN_CENTER_RAD = (2.25 * Math.PI) / 180;
    const EXCITATION_SCAN_HALF_ANGLE_RAD = (0.5 * Math.PI) / 180;

    // Excitation arm: 488 nm laser, two steering mirrors, and the L/CL light-sheet shaper.
    const laser = new Laser('488 nm excitation laser');
    place(laser, -460, 250, dRight);
    laser.wavelength = 488;
    laser.beamRadius = 0.55;
    laser.power = 0.10;
    scene.push(laser);

    const ndWheel = new Filter(
        25,
        2,
        new SpectralProfile('longpass', 1, [], 1),
        'ND Wheel',
    );
    place(ndWheel, -380, 250, dRight);
    scene.push(ndWheel);

    const mirror1 = new Mirror(25.4, 4, 'M1 Steering Mirror');
    mirror1.reflectAt(-300, 250, 0, dRight, dDown);
    scene.push(mirror1);

    const l1 = makePlanoConvexAchromat(100, 12.5, 'L1 Achromat (f=100)');
    place(l1, -300, 175, dDown);
    scene.push(l1);

    const l2 = makePlanoConvexAchromat(45, 10, 'L2 Achromat (f=45)');
    place(l2, -300, 115, dDown);
    scene.push(l2);

    const cl1 = makeCylindricalLens(50, 10, 'CL1 Cylindrical (f=50)');
    place(cl1, -300, 55, dDown);
    setCylindricalRoll(cl1, Math.PI / 2);
    scene.push(cl1);

    const cl2 = makeCylindricalLens(200, 12.7, 'CL2 Cylindrical (f=200)');
    place(cl2, -300, -5, dDown);
    setCylindricalRoll(cl2, Math.PI / 2);
    scene.push(cl2);

    const cl3 = makeCylindricalLens(100, 12.7, 'CL3 Cylindrical (f=100)');
    place(cl3, -300, -65, dDown);
    setCylindricalRoll(cl3, Math.PI / 2);
    scene.push(cl3);

    const excitationScanCenterDirection = dRight.clone().applyAxisAngle(
        new Vector3(0, 0, 1),
        2 * EXCITATION_SCAN_CENTER_RAD,
    );
    const excitationScanMirror = new Mirror(25.4, 4, 'M2 Steering Mirror');
    excitationScanMirror.reflectAt(-300, -185, 0, dDown, excitationScanCenterDirection);
    const EXCITATION_SCAN_CENTER_PAN = excitationScanMirror.panAngle;
    scene.push(excitationScanMirror);

    const l3 = makePlanoConvexAchromat(150, 12.5, 'L3 Achromat (f=150)');
    place(l3, -205, -177.5, dRight);
    scene.push(l3);

    const l4 = makePlanoConvexAchromat(100, 12.5, 'L4 Achromat (f=100)');
    place(l4, -95, -168.5, dRight);
    scene.push(l4);

    // Shared microscope axis: 488 nm reflects into O1 with a slight out-of-plane
    // pupil offset so the sample-side sheet emerges obliquely through the specimen.
    const dichroic = new DichroicMirror(
        30,
        2,
        new SpectralProfile('longpass', 505, [], 4),
        'DM Dichroic (LP 505)',
    );
    place(dichroic, 0, -160.5, excitationIntoDichroic.clone().sub(excitationToO1).normalize());
    scene.push(dichroic);

    const objective1 = new Objective({
        magnification: 20,
        NA: 1.00,
        immersionIndex: 1.33,
        workingDistance: 10,
        tubeLensFocal: 200,
        diameter: 28,
        name: 'O1 Primary Objective (20x/1.0W)',
    });
    place(objective1, 0, -250, dUp);
    scene.push(objective1);

    const sample = new Sample('Oblique Plane Sample');
    sample.excitationSpectrum = new SpectralProfile('bandpass', 488, [{ center: 488, width: 30 }], 5);
    sample.emissionSpectrum = new SpectralProfile('bandpass', 660, [{ center: 660, width: 40 }], 5);
    sample.fluorescenceEfficiency = 0.7;
    sample.specimenOffset.set(0.25, 0, -0.5);
    sample.setPosition(0, -260, 0);
    sample.pointAlong(0, 1, 0);
    scene.push(sample);

    const sampleDump = new Blocker(42, 3, 'Post-Sample Beam Dump');
    place(sampleDump, 0, -268, dUp);
    scene.push(sampleDump);

    // Emission relay: O1 -> TL1/SL1 -> animated scan mirror -> O2/TL2/SL2 -> M3 -> O3/TL3/EF -> camera.
    const tubeLens1 = makeAchromat(200, 12.5, 'TL1 Tube Lens (f=200)');
    place(tubeLens1, 0, -60, dUp);
    scene.push(tubeLens1);

    const scanLens1 = makeAchromat(75, 12.5, 'SL1 Scan Lens (f=75)');
    place(scanLens1, 0, 100, dUp);
    scene.push(scanLens1);

    const EMISSION_SCAN_MIN_RAD = 0;
    const EMISSION_SCAN_MAX_RAD = (2.0 * Math.PI) / 180;
    const EMISSION_SCAN_CENTER_RAD = (EMISSION_SCAN_MIN_RAD + EMISSION_SCAN_MAX_RAD) / 2;
    const EMISSION_SCAN_HALF_ANGLE_RAD = (EMISSION_SCAN_MAX_RAD - EMISSION_SCAN_MIN_RAD) / 2;
    const emissionScanCenterDirection = dRight.clone().applyAxisAngle(
        new Vector3(0, 0, 1),
        2 * EMISSION_SCAN_CENTER_RAD,
    );
    const emissionScanMirror = new Mirror(24, 4, 'Emission Scan Mirror');
    emissionScanMirror.reflectAt(0, 175, 0, dUp, emissionScanCenterDirection);
    const EMISSION_SCAN_CENTER_PAN = emissionScanMirror.panAngle;
    scene.push(emissionScanMirror);

    const objective2 = new Objective({
        magnification: 40,
        NA: 0.80,
        immersionIndex: 1.0,
        workingDistance: 2.0,
        tubeLensFocal: 200,
        diameter: 18,
        name: 'O2 Relay Objective (40x/0.8)',
    });
    place(objective2, 115, 175, dRight);
    scene.push(objective2);

    const tubeLens2 = makeAchromat(125, 12.5, 'TL2 Tube Lens (f=125)');
    place(tubeLens2, 205, 175, dRight);
    scene.push(tubeLens2);

    const scanLens2 = makeAchromat(150, 12.5, 'SL2 Scan Lens (f=150)');
    place(scanLens2, 305, 175, dRight);
    scene.push(scanLens2);

    const mirror3 = new Mirror(25.4, 4, 'M3 Fold Mirror');
    mirror3.reflectAt(405, 175, 0, dRight, cameraArm);
    scene.push(mirror3);

    const pO3 = new Vector3(405, 175, 0).add(cameraArm.clone().multiplyScalar(78));
    const objective3 = new Objective({
        magnification: 40,
        NA: 0.80,
        immersionIndex: 1.0,
        workingDistance: 5.3,
        tubeLensFocal: 200,
        diameter: 18,
        name: 'O3 Re-imaging Objective (40x/0.8)',
    });
    place(objective3, pO3.x, pO3.y, cameraArm);
    scene.push(objective3);

    const pTL3 = new Vector3(405, 175, 0).add(cameraArm.clone().multiplyScalar(170));
    const tubeLens3 = makeAchromat(200, 12.5, 'TL3 Tube Lens (f=200)');
    place(tubeLens3, pTL3.x, pTL3.y, cameraArm);
    scene.push(tubeLens3);

    const pFilter = new Vector3(405, 175, 0).add(cameraArm.clone().multiplyScalar(245));
    const emissionFilter = new Filter(
        30,
        2,
        new SpectralProfile('longpass', 620, [], 5),
        'EF Emission Filter (LP 620)',
    );
    place(emissionFilter, pFilter.x, pFilter.y, cameraArm);
    scene.push(emissionFilter);

    const pCamera = new Vector3(405, 175, 0).add(cameraArm.clone().multiplyScalar(345));
    const camera = new Camera(13, 13, 'sCMOS Camera');
    place(camera, pCamera.x, pCamera.y, cameraArm.clone().negate());
    camera.sensorNA = 0;
    camera.samplesPerPixel = 1;
    camera.sensorResX = 16;
    camera.sensorResY = 16;
    camera.width = 0.024;
    camera.height = 0.024;
    scene.push(camera);

    const channels: AnimationChannel[] = [
        {
            id: generateChannelId(),
            targetId: excitationScanMirror.id,
            property: 'panAngle',
            from: EXCITATION_SCAN_CENTER_PAN - EXCITATION_SCAN_HALF_ANGLE_RAD,
            to: EXCITATION_SCAN_CENTER_PAN + EXCITATION_SCAN_HALF_ANGLE_RAD,
            easing: 'sinusoidal',
            periodMs: 4000,
            repeat: true,
            restoreValue: EXCITATION_SCAN_CENTER_PAN,
        },
        {
            id: generateChannelId(),
            targetId: emissionScanMirror.id,
            property: 'panAngle',
            from: EMISSION_SCAN_CENTER_PAN - EMISSION_SCAN_HALF_ANGLE_RAD,
            to: EMISSION_SCAN_CENTER_PAN + EMISSION_SCAN_HALF_ANGLE_RAD,
            easing: 'sinusoidal',
            periodMs: 4000,
            repeat: true,
            restoreValue: EMISSION_SCAN_CENTER_PAN,
        },
    ];

    return {
        scene,
        channels,
        animationPlaying: false,
        animationSpeed: 1.0,
        scanSteps: 8,
        rayCount: 36,
        rayConfig: {
            minRayOpacity: 0.10,
            maxRayOpacity: 0.75,
        },
    };
}
