import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { createLensZooScene } from '../../presets/lensZoo';
import { createMZInterferometerScene } from '../../presets/mzInterferometer';

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
        ]);

        for (const [name, expected] of expectedNormals) {
            const component = scene.find(entry => entry.name === name);
            expect(component).toBeDefined();
            const forward = forwardOf(component!);
            expect(forward.distanceTo(expected)).toBeLessThan(1e-6);
        }
    });
});
