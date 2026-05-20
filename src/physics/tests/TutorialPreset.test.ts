import { describe, expect, test } from 'bun:test';
import { createTutorialMicroscopeScene, createTutorialScene } from '../../presets/tutorial';
import { createSourceRays } from '../SourceRayFactory';
import { ForwardTracer } from '../ForwardTracer';
import { ReverseTracer } from '../ReverseTracer';
import { Camera } from '../components/Camera';
import { Card } from '../components/Card';
import { CurvedMirror } from '../components/CurvedMirror';
import { Objective } from '../components/Objective';
import { Sample } from '../components/Sample';
import {
    copyTutorialCameraDetectorSettings,
    isCameraOnTutorialTarget,
    isTutorialStageOneComplete,
} from '../../ui/tutorialLogic';

function placeMirrorOnGhost(scene: unknown[], mirrorName: string, targetName: string): void {
    const mirror = scene.find((c): c is CurvedMirror => c instanceof CurvedMirror && c.name === mirrorName);
    const target = scene.find((c): c is CurvedMirror => c instanceof CurvedMirror && c.name === targetName);
    expect(mirror).toBeDefined();
    expect(target).toBeDefined();

    mirror!.setPosition(target!.position.x, target!.position.y, target!.position.z);
    mirror!.panAngle = target!.panAngle;
    mirror!.tiltAngle = target!.tiltAngle;
    mirror!.rollAngle = target!.rollAngle;
    mirror!.recomputeRotation();
}

describe('Tutorial preset flow', () => {
    test('does not mark the beam-expander tutorial complete before mirror alignment', () => {
        const { scene } = createTutorialScene();
        const solver = new ForwardTracer(scene);
        const paths = solver.trace(createSourceRays(scene, 32, 'full'));

        expect(isTutorialStageOneComplete(scene, paths)).toBe(false);
    });

    test('marks tutorial 1 complete only when the aligned mirrors produce a prism rainbow on the screen', () => {
        const { scene } = createTutorialScene();
        placeMirrorOnGhost(scene, 'M1', 'M1 Target');
        placeMirrorOnGhost(scene, 'M2', 'M2 Target');

        const solver = new ForwardTracer(scene);
        const paths = solver.trace(createSourceRays(scene, 32, 'full'));
        const screen = scene.find((c): c is Card => c instanceof Card && c.name === 'Screen');
        expect(screen).toBeDefined();

        const wavelengthsAtScreen = new Set<number>();
        for (const path of paths) {
            if (path.some(ray => ray.interactionComponentId === screen!.id)) {
                wavelengthsAtScreen.add(Math.round(path[0]!.wavelength * 1e9));
            }
        }

        expect(wavelengthsAtScreen.size).toBeGreaterThanOrEqual(7);
        expect(isTutorialStageOneComplete(scene, paths)).toBe(true);
    });

    test('tutorial 2 starts as a microscope with a ghost camera target but no real camera', () => {
        const { scene } = createTutorialMicroscopeScene();

        expect(scene.some(c => c instanceof Sample)).toBe(true);
        expect(scene.some(c => c instanceof Objective)).toBe(true);
        expect(scene.filter(c => c instanceof Camera && !c.isGhost)).toHaveLength(0);
        expect(scene.filter(c => c instanceof Camera && Boolean(c.isGhost) && c.name === 'Camera Target')).toHaveLength(1);
    });

    test('a camera placed at tutorial 2 target can form an image', () => {
        const { scene } = createTutorialMicroscopeScene();
        const ghost = scene.find((c): c is Camera => c instanceof Camera && Boolean(c.isGhost) && c.name === 'Camera Target');
        expect(ghost).toBeDefined();

        const camera = new Camera(ghost!.width, ghost!.height, 'User Camera');
        camera.sensorResX = 4;
        camera.sensorResY = 4;
        camera.sensorNA = ghost!.sensorNA;
        camera.samplesPerPixel = 4;
        camera.setPosition(ghost!.position.x, ghost!.position.y, ghost!.position.z);
        camera.panAngle = ghost!.panAngle;
        camera.tiltAngle = ghost!.tiltAngle;
        camera.rollAngle = ghost!.rollAngle;
        camera.recomputeRotation();
        scene.push(camera);

        expect(isCameraOnTutorialTarget(camera, ghost!)).toBe(true);

        const forwardTracer = new ForwardTracer(scene);
        const trace = forwardTracer.traceWithBeamSegments(createSourceRays(scene, 24, 'center'));
        const reverseTrace = new ReverseTracer(scene, trace.beamSegments);
        const result = reverseTrace.render(camera, 16);

        expect(result.paths.length).toBeGreaterThan(0);
        expect(result.emissionImage.length).toBe(16);
    });

    test('tutorial 2 camera target does not accept a merely dropped camera', () => {
        const { scene } = createTutorialMicroscopeScene();
        const ghost = scene.find((c): c is Camera => c instanceof Camera && Boolean(c.isGhost) && c.name === 'Camera Target');
        expect(ghost).toBeDefined();

        const camera = new Camera(13, 13, 'Dropped Camera');
        camera.setPosition(ghost!.position.x - 80, ghost!.position.y - 40, ghost!.position.z);
        camera.pointAlong(1, 0, 0);

        expect(isCameraOnTutorialTarget(camera, ghost!)).toBe(false);
    });

    test('tutorial 2 copies detector settings from the ghost target without moving the user camera', () => {
        const { scene } = createTutorialMicroscopeScene();
        const ghost = scene.find((c): c is Camera => c instanceof Camera && Boolean(c.isGhost) && c.name === 'Camera Target');
        expect(ghost).toBeDefined();

        const camera = new Camera(13, 13, 'Dropped Camera');
        camera.setPosition(123, 45, 0);
        camera.pointAlong(-1, 0, 0);
        expect(camera.sensorResX).not.toBe(ghost!.sensorResX);
        expect(camera.sensorNA).not.toBe(ghost!.sensorNA);

        copyTutorialCameraDetectorSettings(ghost!, camera);

        expect(camera.position.x).toBe(123);
        expect(camera.position.y).toBe(45);
        expect(camera.sensorResX).toBe(ghost!.sensorResX);
        expect(camera.sensorResY).toBe(ghost!.sensorResY);
        expect(camera.sensorNA).toBe(ghost!.sensorNA);
        expect(camera.samplesPerPixel).toBe(ghost!.samplesPerPixel);
    });
});
