import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { childRay, Coherence, type Ray } from '../types';

function parentRay(): Ray {
    return {
        origin: new Vector3(0, 0, 0),
        direction: new Vector3(1, 0, 0),
        wavelength: 532e-9,
        intensity: 1,
        footprintRadius: 0.1,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
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
});
