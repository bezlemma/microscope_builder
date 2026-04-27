import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { Sample } from '../components/Sample';
import { Coherence, type Ray } from '../types';

function rayThroughSample(): Ray {
    return {
        origin: new Vector3(0, 0, -10),
        direction: new Vector3(0, 0, 1),
        wavelength: 500e-9,
        intensity: 1,
        footprintRadius: 0.1,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
        opticalPathLength: 0,
        coherenceMode: Coherence.Coherent,
    };
}

describe('Sample volume intersection', () => {
    test('uses colloid flow-cell bounds for field integration volume', () => {
        const sample = new Sample('Thin flow cell').configureColloidFlowCell({
            count: 1,
            width: 8,
            height: 8,
            depth: 0.0075,
        });

        const hit = sample.getVolumeIntersection(rayThroughSample());

        expect(hit).not.toBeNull();
        expect(hit!.tFar - hit!.tNear).toBeCloseTo(0.0075, 6);
    });
});
