import { describe, expect, test } from 'bun:test';
import { Quaternion, Vector3 } from 'three';
import { PrismLens } from '../components/PrismLens';
import { Solver1 } from '../Solver1';
import { Coherence, Ray } from '../types';

function makeRay(y: number): Ray {
    return {
        origin: new Vector3(-200, y, 0),
        direction: new Vector3(1, 0, 0),
        wavelength: 600e-9,
        intensity: 1,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
        opticalPathLength: 0,
        footprintRadius: 0,
        coherenceMode: Coherence.Coherent,
    };
}

describe('Prism transport regression', () => {
    test('central prism-debug rays are not spuriously trapped at the apex', () => {
        const prism = new PrismLens(Math.PI / 3, 25, 25, '60° Prism', 1.5168);
        prism.setPosition(-50, -40, 0);
        const baseQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
        const tiltQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 30 * Math.PI / 180);
        prism.rotation.copy(tiltQuat.multiply(baseQuat));
        prism.version++;

        const solver = new Solver1([prism]);
        for (const y of [-44, -42, -40, -38, -36]) {
            const path = solver.trace([makeRay(y)])[0];
            const last = path[path.length - 1];
            expect(last.intensity).toBeGreaterThan(0);
            expect(path.length).toBeGreaterThanOrEqual(2);
        }
    });
});
