import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { childRay, Coherence, createRay, type Ray } from '../types';
import { MediumVolume } from '../components/MediumVolume';
import { Solver1 } from '../Solver1';

function parentRay(): Ray {
    return {
        origin: new Vector3(0, 0, 0),
        direction: new Vector3(1, 0, 0),
        wavelength: 532e-9,
        intensity: 1,
        footprintRadius: 0.1,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 } },
        opticalPathLength: 0,
        coherenceMode: Coherence.Coherent,
        entryPoint: new Vector3(1, 0, 0),
        internalPath: [new Vector3(2, 0, 0)],
        terminationPoint: new Vector3(3, 0, 0),
        interactionDistance: 4,
        interactionComponentId: 'component',
        exitSurfaceId: 'optic:front',
        suppressVisualization: true,
        suppressOpenTail: true,
    };
}

describe('childRay', () => {
    test('strips parent-only visualization metadata', () => {
        const child = childRay(parentRay(), { origin: new Vector3(5, 0, 0) });

        expect(child.entryPoint).toBeUndefined();
        expect(child.internalPath).toBeUndefined();
        expect(child.terminationPoint).toBeUndefined();
        expect(child.interactionDistance).toBeUndefined();
        expect(child.interactionComponentId).toBeUndefined();
        expect(child.exitSurfaceId).toBeUndefined();
        expect(child.suppressVisualization).toBeUndefined();
        expect(child.suppressOpenTail).toBe(true);
    });

    test('recomputes phase when a child changes optical path length', () => {
        const child = childRay(parentRay(), {
            origin: new Vector3(10, 0, 0),
            opticalPathLength: 10,
        });
        const expectedPhase = (2 * Math.PI * 10) / (child.wavelength * 1e3);

        expect(child.phase).toBeCloseTo(expectedPhase, 9);
    });

    test('keeps powerWeight aligned when legacy components override intensity', () => {
        const child = childRay(parentRay(), { intensity: 0.25 });

        expect(child.intensity).toBeCloseTo(0.25, 12);
        expect(child.powerWeight).toBeCloseTo(0.25, 12);
    });

    test('medium volumes update the current medium index on entry and exit', () => {
        const volume = new MediumVolume({
            width: 20,
            height: 20,
            depth: 10,
            refractiveIndex: 1.33,
            exteriorRefractiveIndex: 1,
            name: 'Packet medium',
        });
        const ray = createRay({
            ...parentRay(),
            origin: new Vector3(0, 0, -10),
            direction: new Vector3(0, 0, 1),
            currentMediumIndex: 1,
        });

        const paths = new Solver1([volume]).trace([ray]);
        const transmittedPath = paths.find(path => (path[1]?.currentMediumIndex ?? 1) > 1.2);

        expect(transmittedPath).toBeDefined();
        expect(transmittedPath![1].currentMediumIndex).toBeCloseTo(volume.getInteriorIor(ray.wavelength), 9);
        expect(transmittedPath![2].currentMediumIndex).toBeCloseTo(volume.getExteriorIor(ray.wavelength), 9);
    });
});
