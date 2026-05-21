import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { Mirror } from '../physics/components/Mirror';
import { Blocker } from '../physics/components/Blocker';
import { Filter } from '../physics/components/Filter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { Objective } from '../physics/components/Objective';
import { Sample } from '../physics/components/Sample';
import { PMT } from '../physics/components/PMT';
import { Aperture } from '../physics/components/Aperture';
import { AchromatDoublet } from '../physics/components/AchromatDoublet';
import { SpectralProfile } from '../physics/SpectralProfile';
import { AnimationChannel } from '../physics/PropertyAnimator';
import { DualGalvoScanHead } from '../physics/components/DualGalvoScanHead';

import { Vector3 } from 'three';

export interface ConfocalPresetResult {
    scene: OpticalComponent[];
    channels: AnimationChannel[];
    animationPlaying: boolean;
    animationSpeed: number;
    description?: string;
    rayCount?: number;
}

/**
 * Confocal Laser-Scanning Microscope — compact "backwards E" layout:
 *
 * - top horizontal line: laser conditioning
 * - middle horizontal line: PMT branch
 * - vertical spine: feed mirror -> dichroic -> dual galvo
 * - bottom horizontal line: galvo -> scan lens -> tube lens -> objective -> sample
 *
 * Excitation:
 *   Laser -> telescope -> feed mirror -> dichroic (transmit) -> dual galvo -> microscope row
 * Emission:
 *   Sample -> microscope row -> dual galvo -> dichroic (reflect) -> PMT row
 */
export function createConfocalScene(): ConfocalPresetResult {
    const scene: OpticalComponent[] = [];

    const mirrorThickness = 2;
    const mirrorSpacing = 15;
    const zExcitation = mirrorSpacing;
    const sampleHolderGapMm = 0.25;
    const achromat200 = {
        r1: 77.4, r2: -87.6, r3: 291.1,
        t1: 4.0, t2: 2.5,
        ior1: 1.658, ior2: 1.750,
    };
    const makeScaledAchromat = (
        focalScale: number, apertureRadius: number, name: string,
    ) => new AchromatDoublet(
        achromat200.r1 * focalScale, achromat200.r2 * focalScale, achromat200.r3 * focalScale,
        achromat200.t1, achromat200.t2, apertureRadius,
        achromat200.ior1, achromat200.ior2, name,
    );

    // ═══ Top horizontal line: laser conditioning ═══
    const laser = new Laser('488 nm Laser');
    laser.setPosition(-232.5, 112.5, 0);
    laser.pointAlong(1, 0, 0);
    laser.beamRadius = 0.1;
    laser.wavelength = 488;
    laser.power = 1.0;
    scene.push(laser);

    const preLens20 = makeScaledAchromat(0.1, 5, 'Pre-Galvo Lens (f=20)');
    preLens20.setPosition(-132.5, 112.5, 0);
    preLens20.pointAlong(1, 0, 0);
    scene.push(preLens20);

    const preLens100 = makeScaledAchromat(0.5, 12.5, 'Pre-Galvo Lens (f=100)');
    preLens100.setPosition(-12.5, 112.5, 0);
    preLens100.pointAlong(1, 0, 0);
    scene.push(preLens100);

    const preIris = new Aperture(6, 25, 'Pre-Galvo Iris');
    preIris.setPosition(37.5, 112.5, 0);
    preIris.pointAlong(1, 0, 0);
    scene.push(preIris);

    // Feed mirror: reflects beam from +X to -Y
    const feedMirror = new Mirror(25, mirrorThickness, 'Feed Mirror');
    feedMirror.reflectAt(87.5, 112.5, 0, new Vector3(1, 0, 0), new Vector3(0, -1, 0));
    scene.push(feedMirror);

    // Three-way junction dichroic
    const dichroic = new DichroicMirror(
        25, mirrorThickness,
        new SpectralProfile('shortpass', 505, [], 5),
        'Dichroic (SP 505)'
    );
    dichroic.setPosition(87.5, 62.5, 0);
    dichroic.pointAlong(1, 1, 0);
    scene.push(dichroic);

    // Dual galvo scan head
    const scanHead = new DualGalvoScanHead(mirrorSpacing, 12, 'Dual Galvo Scan Head');
    scanHead.setPosition(87.5, 12.5, 0);
    scanHead.pointAlong(0, -1, 0);
    scene.push(scanHead, scanHead.mirror1, scanHead.mirror2);

    // ═══ Bottom horizontal microscope row at z = mirrorSpacing ═══
    const scanLens = new AchromatDoublet(
        19.4, -21.9, 72.8,
        6.0, 2.5,
        12.5,
        1.658, 1.750,
        'Scan Lens (f≈50)'
    );
    scanLens.setPosition(37.5, 12.5, zExcitation);
    scanLens.pointAlong(-1, 0, 0);
    scene.push(scanLens);

    const tubeLens = new AchromatDoublet(
        77.4, -87.6, 291.1,
        4.0, 2.5,
        12.5,
        1.658, 1.750,
        'Tube Lens (f≈200)'
    );
    tubeLens.setPosition(-212.5, 12.5, zExcitation);
    tubeLens.pointAlong(-1, 0, 0);
    scene.push(tubeLens);

    const objective = new Objective({
        magnification: 10, NA: 0.5, immersionIndex: 1.33,
        workingDistance: 5.0, tubeLensFocal: 200,
        name: '10x/0.5W Objective',
    });
    objective.setPosition(-412.5, 12.5, zExcitation);
    objective.pointAlong(1, 0, 0);
    scene.push(objective);

    const sample = new Sample('Specimen (Fluo)');
    sample.excitationSpectrum = new SpectralProfile('bandpass', 500, [{ center: 488, width: 30 }]);
    sample.emissionSpectrum = new SpectralProfile('bandpass', 500, [{ center: 520, width: 40 }]);
    objective.updateMatrices();
    const focusWorld = new Vector3(0, 0, -objective.focalLength).applyMatrix4(objective.localToWorld);
    const sampleNormal = objective.getSampleSideNormalWorld();

    const holderCenter = focusWorld.clone().add(sampleNormal.clone().multiplyScalar(sampleHolderGapMm));
    sample.setPosition(holderCenter.x, holderCenter.y, holderCenter.z);
    sample.pointAlong(1, 0, 0);
    sample.specimenOffset.set(0, 0, -sampleHolderGapMm);
    scene.push(sample);
    const blocker = new Blocker(30, 2, 'Beam Stop');
    const blockerCenter = focusWorld.clone().add(sampleNormal.clone().multiplyScalar(25));
    blocker.setPosition(blockerCenter.x, blockerCenter.y, blockerCenter.z);
    blocker.pointAlong(-1, 0, 0);
    scene.push(blocker);

    // ═══ Middle horizontal PMT row at z = 0 ═══
    const emFilter = new Filter(
        25, 2,
        new SpectralProfile('bandpass', 520, [{ center: 520, width: 40 }]),
        'Em Filter (BP520/40)'
    );
    emFilter.setPosition(-12.5, 62.5, 0);
    emFilter.pointAlong(-1, 0, 0);
    scene.push(emFilter);

    const pmtLens = makeScaledAchromat(0.525, 12.5, 'PMT Lens (f=105)');
    pmtLens.setPosition(-112.5, 62.5, 0);
    pmtLens.pointAlong(-1, 0, 0);
    scene.push(pmtLens);

    const pinhole = new Aperture(0.05, 12.5, 'Confocal Pinhole');
    pinhole.setPosition(-212.5, 62.5, 0);
    pinhole.pointAlong(-1, 0, 0);
    scene.push(pinhole);

    const pmt = new PMT(10, 10, 'PMT');
    pmt.setPosition(-287.5, 62.5, 0);
    pmt.pointAlong(1, 0, 0);
    pmt.sensorNA = 0.01;
    pmt.samplesPerPixel = 12;
    pmt.pmtSampleHz = 1024;
    // 32×32 keeps the default raster quick while giving enough pixels for the
    // Mickey specimen to read as a shape instead of a handful of dots.
    pmt.scanResX = 32;
    pmt.scanResY = 32;
    scene.push(pmt);

    // Galvo scan parameters
    const CONFOCAL_SCAN_X_HALF_ANGLE_DEG = 6;
    const CONFOCAL_SCAN_Y_HALF_ANGLE_DEG = 6;
    scanHead.scanAmplitudeX = CONFOCAL_SCAN_X_HALF_ANGLE_DEG * Math.PI / 180;
    scanHead.scanHzX = 32;
    scanHead.scanAmplitudeY = CONFOCAL_SCAN_Y_HALF_ANGLE_DEG * Math.PI / 180;
    scanHead.scanHzY = 1;

    pmt.connectGalvo(scanHead);

    return {
        scene,
        channels: scanHead.getAnimationChannels(),
        animationPlaying: false,
        animationSpeed: 0.1,
        rayCount: 16,
        description: 'Laser-scanning confocal microscope with a descanned PMT and pinhole.',
    };
}
