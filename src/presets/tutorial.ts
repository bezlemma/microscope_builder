import { OpticalComponent } from '../physics/Component';
import { Camera } from '../physics/components/Camera';
import { Lamp } from '../physics/components/Lamp';
import { Card } from '../physics/components/Card';
import { CurvedMirror } from '../physics/components/CurvedMirror';
import { PrismLens } from '../physics/components/PrismLens';
import { createBrightfieldScene } from './brightfield';
import {
    TUTORIAL_FIRST_MIRROR_NAME,
    TUTORIAL_FIRST_TARGET_NAME,
    TUTORIAL_SECOND_MIRROR_NAME,
    TUTORIAL_SECOND_TARGET_NAME,
} from './tutorialNames';

import type { PresetResult } from '../state/store';

const TUTORIAL_MICROSCOPE_LENGTH_SCALE = 0.75;
const TUTORIAL_MIRROR_THICKNESS = 3;

/**
 * Tutorial Preset — folded 3× reflective Keplerian beam expander, broadband.
 *
 *   Lamp   at (-87.5, 12.5)              — emits white light along +X.
 *   First mirror target at (12.5, 12.5)       — concave, folds beam to +Y.
 *   Second mirror target at (12.5, 12.5 + D)  — concave, folds beam to +X.
 *   Prism  at (162.5, 12.5 + D)          — disperses the expanded white beam.
 *   Card    at (337.5, 12.5 + D + 30)    — screen, catches the rainbow spectrum.
 *
 * CurvedMirror convention: radiusOfCurvature > 0 = concave (focusing).  Each
 * mirror sits at a 45° fold; the effective tangential focal length is
 *   f_t = R · cos 45° / 2,
 * so the Keplerian expander collimates when D = (R1 + R2) · cos 45° / 2.
 * R1 = 100 mm and R2 = 300 mm give 3× magnification and D ≈ 141.42 mm.
 */
export function createTutorialScene(): PresetResult {
    const scene: OpticalComponent[] = [];

    const R1 = 100;
    const R2 = 300;
    const D = (Math.abs(R1) + Math.abs(R2)) * Math.SQRT1_2 / 2; // 141.42 mm

    const FIRST_MIRROR_POS = { x: 12.5, y: 12.5 };
    const SECOND_MIRROR_POS = { x: 12.5, y: 12.5 + D };

    // Lamp — broadband white light source, emits along +X.  The prism farther
    // down the path will fan its discrete wavelengths into a rainbow on the
    // screen, which is the visual payoff for the tutorial.
    const lamp = new Lamp("Lamp Source");
    lamp.setPosition(-87.5, 12.5, 0);
    lamp.pointAlong(1, 0, 0);
    lamp.beamRadius = 1.2;
    scene.push(lamp);

    const firstTarget = new CurvedMirror(25.4, R1, TUTORIAL_MIRROR_THICKNESS, TUTORIAL_FIRST_TARGET_NAME);
    firstTarget.isGhost = true;
    firstTarget.setPosition(FIRST_MIRROR_POS.x, FIRST_MIRROR_POS.y, 0);
    firstTarget.panAngle = -Math.PI / 4;
    firstTarget.recomputeRotation();
    scene.push(firstTarget);

    const secondTarget = new CurvedMirror(25.4, R2, TUTORIAL_MIRROR_THICKNESS, TUTORIAL_SECOND_TARGET_NAME);
    secondTarget.isGhost = true;
    secondTarget.setPosition(SECOND_MIRROR_POS.x, SECOND_MIRROR_POS.y, 0);
    secondTarget.panAngle = 3 * Math.PI / 4;
    secondTarget.recomputeRotation();
    scene.push(secondTarget);

    const firstMirror = new CurvedMirror(25.4, R1, TUTORIAL_MIRROR_THICKNESS, TUTORIAL_FIRST_MIRROR_NAME);
    firstMirror.setPosition(FIRST_MIRROR_POS.x + 87.5, FIRST_MIRROR_POS.y + 37.5, 0);
    firstMirror.panAngle = -Math.PI / 4;
    firstMirror.recomputeRotation();
    scene.push(firstMirror);

    const secondMirror = new CurvedMirror(25.4, R2, TUTORIAL_MIRROR_THICKNESS, TUTORIAL_SECOND_MIRROR_NAME);
    secondMirror.setPosition(SECOND_MIRROR_POS.x + 87.5, SECOND_MIRROR_POS.y - 62.5, 0);
    secondMirror.panAngle = 3 * Math.PI / 4;
    secondMirror.recomputeRotation();
    scene.push(secondMirror);

    // Prism — placed along the +X expanded beam from the second mirror. Equilateral
    // triangle, oriented so the beam enters one face at moderate incidence
    // and exits dispersed downward.
    const prism = new PrismLens(Math.PI/3, 30, 30, "Dispersion Prism", 1.5168);
    prism.setPosition(80, 150, 0);
    prism.panAngle = 55;
    prism.tiltAngle = 0;
    prism.rollAngle = Math.PI / 2;
    prism.recomputeRotation();
    scene.push(prism);

    // Card — screen positioned at (237.5, 87.5) to catch the dispersed rainbow
    // after the prism bends the beam downward.
    const card = new Card(80, 80, "Screen");
    card.opaque = true;
    card.setPosition(180.5, 50.5, 0);
    card.panAngle = Math.PI - Math.PI / 6;
    card.recomputeRotation();
    scene.push(card);

    return {
        scene,
        rayCount: 200,
        description:
            "Follow the arrows: drag each highlighted mirror onto its matching outline. The prism splits the expanded white beam into a rainbow on the screen.",
    };
}

function copyCameraSettings(source: Camera, target: Camera): void {
    target.sensorResX = source.sensorResX;
    target.sensorResY = source.sensorResY;
    target.sensorNA = source.sensorNA;
    target.samplesPerPixel = source.samplesPerPixel;
    target.detectorLaunchModel = source.detectorLaunchModel;
    target.fieldPixelPitchOverrideX = source.fieldPixelPitchOverrideX;
    target.fieldPixelPitchOverrideY = source.fieldPixelPitchOverrideY;
}

/**
 * Tutorial 2 — the smallest useful transmitted-light microscope exercise.
 *
 * It starts from the known-good brightfield microscope, removes the real
 * camera, and leaves a ghost detector target for the user to complete.
 */
export function createTutorialMicroscopeScene(): PresetResult {
    const brightfield = createBrightfieldScene({ lengthScale: TUTORIAL_MICROSCOPE_LENGTH_SCALE });
    const realCamera = brightfield.find((c): c is Camera => c instanceof Camera);
    const scene = brightfield.filter(c => !(c instanceof Camera));

    if (realCamera) {
        const ghostCamera = new Camera(realCamera.width, realCamera.height, 'Camera Target');
        ghostCamera.isGhost = true;
        copyCameraSettings(realCamera, ghostCamera);
        ghostCamera.setPosition(realCamera.position.x, realCamera.position.y, realCamera.position.z);
        ghostCamera.panAngle = realCamera.panAngle;
        ghostCamera.tiltAngle = realCamera.tiltAngle;
        ghostCamera.rollAngle = realCamera.rollAngle;
        ghostCamera.recomputeRotation();
        scene.push(ghostCamera);
    }

    return {
        scene,
        description: "Drag a camera from Detectors onto the ghost camera target to complete the simplest brightfield microscope.",
    };
}
