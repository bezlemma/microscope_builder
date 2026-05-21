import { Quaternion } from 'three';
import { OpticalComponent } from '../physics/Component';
import { Camera } from '../physics/components/Camera';
import { Card } from '../physics/components/Card';
import { CurvedMirror } from '../physics/components/CurvedMirror';
import { PrismLens } from '../physics/components/PrismLens';
import {
    TUTORIAL_FIRST_MIRROR_NAME,
    TUTORIAL_FIRST_TARGET_NAME,
    TUTORIAL_SECOND_MIRROR_NAME,
    TUTORIAL_SECOND_TARGET_NAME,
} from '../presets/tutorialNames';
import type { Ray } from '../physics/types';

export interface TutorialMirrorStatus {
    firstMirror: CurvedMirror | null;
    secondMirror: CurvedMirror | null;
    firstTarget: CurvedMirror | null;
    secondTarget: CurvedMirror | null;
    firstPlaced: boolean;
    secondPlaced: boolean;
}

const MIRROR_TARGET_TOLERANCE_MM = 6;
const MIRROR_ANGLE_TOLERANCE_RAD = 0.1;

function componentByName<T extends OpticalComponent>(
    components: OpticalComponent[],
    name: string,
    ctor: abstract new (...args: never[]) => T,
    ghost: boolean,
): T | null {
    return components.find((c): c is T =>
        c instanceof ctor
        && c.name === name
        && Boolean(c.isGhost) === ghost,
    ) ?? null;
}

function poseMatches(real: OpticalComponent | null, ghost: OpticalComponent | null): boolean {
    if (!real || !ghost) return false;
    const distance = real.position.distanceTo(ghost.position);
    if (distance > MIRROR_TARGET_TOLERANCE_MM) return false;

    const realRotation = real.rotation instanceof Quaternion ? real.rotation : new Quaternion();
    const ghostRotation = ghost.rotation instanceof Quaternion ? ghost.rotation : new Quaternion();
    return realRotation.angleTo(ghostRotation) <= MIRROR_ANGLE_TOLERANCE_RAD;
}

export function getTutorialMirrorStatus(components: OpticalComponent[]): TutorialMirrorStatus {
    const firstMirror = componentByName(components, TUTORIAL_FIRST_MIRROR_NAME, CurvedMirror, false);
    const secondMirror = componentByName(components, TUTORIAL_SECOND_MIRROR_NAME, CurvedMirror, false);
    const firstTarget = componentByName(components, TUTORIAL_FIRST_TARGET_NAME, CurvedMirror, true);
    const secondTarget = componentByName(components, TUTORIAL_SECOND_TARGET_NAME, CurvedMirror, true);

    return {
        firstMirror,
        secondMirror,
        firstTarget,
        secondTarget,
        firstPlaced: poseMatches(firstMirror, firstTarget),
        secondPlaced: poseMatches(secondMirror, secondTarget),
    };
}

export function isTutorialRainbowComplete(components: OpticalComponent[], paths: Ray[][]): boolean {
    const prism = components.find((c): c is PrismLens =>
        c instanceof PrismLens && c.name === 'Dispersion Prism',
    );
    const screen = components.find((c): c is Card =>
        c instanceof Card && c.name === 'Screen',
    );
    if (!prism || !screen || paths.length === 0) return false;

    let pathsThroughPrism = 0;
    let prismThenScreen = 0;
    const wavelengths = new Set<number>();
    const exitSurfaces = new Set<string>();

    for (const path of paths) {
        let sawPrism = false;
        let reachedScreenAfterPrism = false;

        for (const ray of path) {
            if (ray.interactionComponentId === prism.id) {
                sawPrism = true;
            }

            if (sawPrism && ray.exitSurfaceId?.startsWith(`${prism.name}:`)) {
                exitSurfaces.add(ray.exitSurfaceId);
            }

            if (sawPrism && ray.interactionComponentId === screen.id) {
                reachedScreenAfterPrism = true;
            }
        }

        if (!sawPrism) continue;
        pathsThroughPrism++;
        if (reachedScreenAfterPrism) {
            prismThenScreen++;
            wavelengths.add(Math.round((path[0]?.wavelength ?? 0) * 1e9));
        }
    }

    return pathsThroughPrism > 0
        && prismThenScreen === pathsThroughPrism
        && wavelengths.size >= 3
        && exitSurfaces.size === 1;
}

export function isTutorialStageOneComplete(components: OpticalComponent[], paths: Ray[][]): boolean {
    const mirrorStatus = getTutorialMirrorStatus(components);
    return mirrorStatus.firstPlaced
        && mirrorStatus.secondPlaced
        && isTutorialRainbowComplete(components, paths);
}

export function findTutorialCameraTarget(components: OpticalComponent[]): Camera | null {
    return components.find((c): c is Camera =>
        c instanceof Camera
        && Boolean(c.isGhost)
        && c.name === 'Camera Target',
    ) ?? null;
}

export function findNearestRealTutorialCamera(
    components: OpticalComponent[],
    target: Camera,
): Camera | null {
    let best: Camera | null = null;
    let bestDistance = Infinity;
    for (const component of components) {
        if (!(component instanceof Camera) || component.isGhost) continue;
        const distance = component.position.distanceTo(target.position);
        if (distance < bestDistance) {
            best = component;
            bestDistance = distance;
        }
    }
    return best;
}

export function isCameraOnTutorialTarget(camera: Camera | null, target: Camera | null): boolean {
    if (!camera || !target) return false;
    const distance = camera.position.distanceTo(target.position);
    if (distance > 8) return false;
    return camera.rotation.angleTo(target.rotation) <= 0.16;
}

export function copyTutorialCameraDetectorSettings(source: Camera, target: Camera): void {
    target.width = source.width;
    target.height = source.height;
    target.sensorResX = source.sensorResX;
    target.sensorResY = source.sensorResY;
    target.sensorNA = source.sensorNA;
    target.samplesPerPixel = source.samplesPerPixel;
    target.detectorLaunchModel = source.detectorLaunchModel;
    target.fieldPixelPitchOverrideX = source.fieldPixelPitchOverrideX;
    target.fieldPixelPitchOverrideY = source.fieldPixelPitchOverrideY;
    target.markReverseTracerStale();
    target.version++;
}
