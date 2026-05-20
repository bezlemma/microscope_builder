import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { createLensZooScene } from '../../presets/lensZoo';
import { createMZInterferometerScene } from '../../presets/mzInterferometer';
import { Blocker } from '../components/Blocker';
import { Card } from '../components/Card';
import { OpticalWindow } from '../components/OpticalWindow';
import { Solver1 } from '../Solver1';
import { createSourceRays } from '../SourceRayFactory';

function forwardOf(component: { rotation: any }): Vector3 {
    return new Vector3(0, 0, 1).applyQuaternion(component.rotation).normalize();
}

function upOf(component: { rotation: any }): Vector3 {
    return new Vector3(0, 1, 0).applyQuaternion(component.rotation).normalize();
}

describe('Preset orientation regressions', () => {
    test('Lens Zoo prism keeps its upright prism clocking', () => {
        const scene = createLensZooScene();
        const prism = scene.find(component => component.name === '60° Prism');
        expect(prism).toBeDefined();

        const forward = forwardOf(prism!);
        const up = upOf(prism!);

        expect(forward.x).toBeGreaterThan(0.99);
        expect(Math.abs(forward.y)).toBeLessThan(1e-6);
        expect(up.y).toBeGreaterThan(0.99);
    });

    test('Mach-Zehnder optics use the intended in-plane fold normals', () => {
        const scene = createMZInterferometerScene();
        const expectedNormals = new Map<string, Vector3>([
            ['BS1 (50/50)', new Vector3(1, -1, 0).normalize()],
            ['Mirror A', new Vector3(-1, 1, 0).normalize()],
            ['Mirror B', new Vector3(1, -1, 0).normalize()],
            ['BS2 (50/50)', new Vector3(-1, 1, 0).normalize()],
            ['BS2 Upper Beam Dump', new Vector3(0, 1, 0)],
        ]);

        for (const [name, expected] of expectedNormals) {
            const component = scene.find(entry => entry.name === name);
            expect(component).toBeDefined();
            const forward = forwardOf(component!);
            expect(forward.distanceTo(expected)).toBeLessThan(1e-6);
        }
    });

    test('Mach-Zehnder catches the unused BS2 output with an upper beam dump', () => {
        const scene = createMZInterferometerScene();
        const dump = scene.find((component): component is Blocker =>
            component instanceof Blocker && component.name === 'BS2 Upper Beam Dump',
        );
        expect(dump).toBeDefined();

        const paths = new Solver1(scene).trace(createSourceRays(scene, 8, 'center'));
        const dumpHits = paths.filter(path => path.some(ray => ray.interactionComponentId === dump!.id));

        expect(dumpHits.length).toBeGreaterThanOrEqual(2);
    });

    test('Mach-Zehnder compensation plate adds physical optical phase to one arm', () => {
        const scene = createMZInterferometerScene();
        const phaseTrim = scene.find((component): component is OpticalWindow =>
            component instanceof OpticalWindow && component.name === 'Arm A Compensation Plate',
        );
        const detector = scene.find((component): component is Card =>
            component instanceof Card && component.name === 'MZ Detector',
        );
        expect(phaseTrim).toBeDefined();
        expect(detector).toBeDefined();

        new Solver1(scene).trace(createSourceRays(scene, 1, 'center'));
        expect(detector!.hits).toHaveLength(2);
        const [baseA, baseB] = detector!.hits;
        const baseDeltaOpl = Math.abs(baseA.ray.opticalPathLength - baseB.ray.opticalPathLength);

        phaseTrim!.opticalPathOffsetMm = 532e-6 / 2;
        phaseTrim!.version++;
        new Solver1(scene).trace(createSourceRays(scene, 1, 'center'));

        expect(detector!.hits).toHaveLength(2);
        const [a, b] = detector!.hits;
        const shiftedDeltaOpl = Math.abs(a.ray.opticalPathLength - b.ray.opticalPathLength);
        const halfWaveMm = a.ray.wavelength * 1e3 / 2;
        const deltaChange = shiftedDeltaOpl - baseDeltaOpl;

        expect(a.ray.intensity).toBeCloseTo(b.ray.intensity, 9);
        expect(Math.min(Math.abs(deltaChange - halfWaveMm), Math.abs(deltaChange + halfWaveMm))).toBeLessThan(1e-9);
    });
});
