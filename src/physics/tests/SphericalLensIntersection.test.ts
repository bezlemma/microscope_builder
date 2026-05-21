import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { SphericalLens } from '../components/SphericalLens';
import { ForwardTracer } from '../ForwardTracer';
import { Ray, Coherence } from '../types';

describe('Spherical lens intersection regressions', () => {
    test('beam expander grazing ray does not teleport to a ghost surface', () => {
        const lens1 = new SphericalLens(1 / 50, 15, 4, 'Expander Lens 1');
        lens1.setPosition(-100, 17, 0);
        lens1.setRotation(0, Math.PI / 2, 0);

        const lens2 = new SphericalLens(1 / 100, 25, 4, 'Expander Lens 2');
        lens2.setPosition(50, 0, 0);
        lens2.setRotation(0, Math.PI / 2, 0);

        const ray: Ray = {
            origin: new Vector3(-150, 4, 0),
            direction: new Vector3(1, 0, 0),
            wavelength: 532e-9,
            intensity: 1,
            polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
            opticalPathLength: 0,
            footprintRadius: 0,
            coherenceMode: Coherence.Incoherent,
        };

        const [path] = new ForwardTracer([lens1, lens2]).trace([ray]);
        expect(path).toBeDefined();
        if (!path) throw new Error('Expected traced ray path');

        const firstHitDistance = path[0].interactionDistance;
        expect(firstHitDistance).not.toBeUndefined();

        const firstHit = path[0].origin.clone().addScaledVector(path[0].direction, firstHitDistance!);
        expect(firstHit.x).toBeCloseTo(-100, 0);

        if (path.length > 1) {
            const distanceInsideLens = firstHit.distanceTo(path[1].origin);
            expect(distanceInsideLens).toBeLessThan(10);
        }

        const secondHitDistance = path[1]?.interactionDistance;
        if (secondHitDistance) {
            const secondHit = path[1].origin.clone().addScaledVector(path[1].direction, secondHitDistance);
            expect(secondHit.x > -90 && secondHit.x < 40).toBe(false);
        }
    });
});
