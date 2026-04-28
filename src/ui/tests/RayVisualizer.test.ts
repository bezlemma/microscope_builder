import { describe, expect, test } from 'bun:test';
import { coherentBranchDisplayStyle, openTailSuppressionExpired, terminalVisualizationDistance } from '../RayVisualizer';
import { createOpticalTrapScene } from '../../presets/opticalTrap';
import { Solver1 } from '../../physics/Solver1';
import { createSourceRays } from '../../physics/SourceRayFactory';
import { traceStableTableOverlay } from '../../physics/tableTrace';
import { Blocker } from '../../physics/components/Blocker';
import { Coherence, type Ray } from '../../physics/types';
import { Vector3 } from 'three';

function testRay(overrides: Partial<Ray>): Ray {
    return {
        origin: new Vector3(),
        direction: new Vector3(1, 0, 0),
        wavelength: 780e-9,
        intensity: 1,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
        opticalPathLength: 0,
        footprintRadius: 0.1,
        coherenceMode: Coherence.Coherent,
        ...overrides,
    };
}

describe('RayVisualizer coherent branch display', () => {
    test('keeps low-power dichroic split branches visibly bundled', () => {
        const dm2LeakageBranch = coherentBranchDisplayStyle(0.092, 0.4);

        expect(dm2LeakageBranch.opacity).toBeGreaterThan(0.2);
        expect(dm2LeakageBranch.lineWidth).toBeGreaterThanOrEqual(1.5);
    });

    test('draws finite terminal absorber segments even when open tails are suppressed', () => {
        const finiteComponentHit = terminalVisualizationDistance({
            interactionDistance: 25,
            suppressOpenTail: true,
            terminationPoint: undefined,
        }, false);

        expect(finiteComponentHit).toBe(25);
    });

    test('still suppresses infinite escape tails when requested', () => {
        const openTail = terminalVisualizationDistance({
            interactionDistance: undefined,
            suppressOpenTail: true,
            terminationPoint: undefined,
        }, true);

        expect(openTail).toBeNull();
    });

    test('draws a suppressed branch again after a downstream optic changes direction', () => {
        const path = [
            testRay({ direction: new Vector3(1, 0, 0) }),
            testRay({
                origin: new Vector3(1, 0, 0),
                direction: new Vector3(1, 0, 0),
                suppressOpenTail: true,
                interactionDistance: 2,
                interactionComponentId: 'mirror',
            }),
            testRay({
                origin: new Vector3(3, 0, 0),
                direction: new Vector3(0, 1, 0),
                suppressOpenTail: true,
            }),
        ];

        expect(openTailSuppressionExpired(path)).toBe(true);
        expect(terminalVisualizationDistance(path[2], true, openTailSuppressionExpired(path))).toBe(1000);
    });

    test('keeps raw bead-scatter escape tails suppressed before downstream optics bend them', () => {
        const path = [
            testRay({ direction: new Vector3(1, 0, 0) }),
            testRay({
                origin: new Vector3(1, 0, 0),
                direction: new Vector3(1, 0, 0),
                suppressOpenTail: true,
            }),
        ];

        expect(openTailSuppressionExpired(path)).toBe(false);
        expect(terminalVisualizationDistance(path[1], true, openTailSuppressionExpired(path))).toBeNull();
    });

    test('shows optical-trap bead-scattered rays that terminate on the DM2 dump', () => {
        const scene = createOpticalTrapScene();
        const dump = scene.find(component => component.name === 'DM2 Transmitted IR Dump');
        expect(dump).toBeDefined();

        const paths = traceStableTableOverlay(
            scene,
            () => new Solver1(scene).trace(createSourceRays(scene, 144, 'full')),
        );
        const collectedOffAxisPath = paths.find(path => {
            const last = path[path.length - 1];
            return path[0]?.isMainRay !== true
                && last?.interactionComponentId === dump!.id
                && last.suppressOpenTail === true;
        });

        expect(collectedOffAxisPath).toBeDefined();
        const lastRay = collectedOffAxisPath![collectedOffAxisPath!.length - 1];
        expect(terminalVisualizationDistance(lastRay, false)).toBeGreaterThan(0);
    });

    test('draws trap bundle tails after the DM2 dump is moved off the collected beam', () => {
        const scene = createOpticalTrapScene();
        const dump = scene.find((component): component is Blocker =>
            component instanceof Blocker && component.name === 'DM2 Transmitted IR Dump',
        );
        expect(dump).toBeDefined();

        dump!.position.y += 45;
        dump!.version++;

        const paths = traceStableTableOverlay(
            scene,
            () => new Solver1(scene).trace(createSourceRays(scene, 144, 'full')),
        );
        const escapedOffAxisPaths = paths.filter(path => {
            const last = path[path.length - 1];
            return path[0]?.isMainRay !== true
                && last?.interactionComponentId === undefined
                && last?.suppressOpenTail === true;
        });
        const drawableEscapedOffAxisPaths = escapedOffAxisPaths.filter(openTailSuppressionExpired);

        expect(drawableEscapedOffAxisPaths.length).toBeGreaterThan(20);
        for (const path of drawableEscapedOffAxisPaths) {
            const last = path[path.length - 1];
            expect(terminalVisualizationDistance(last, true, openTailSuppressionExpired(path))).toBe(1000);
        }
    });
});
