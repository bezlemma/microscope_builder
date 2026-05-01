import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { childRay, Coherence, createRay, type Ray } from '../types';
import { collimatedPacketQFromSourceCellArea } from '../coherentPacketLaunch';
import { Mirror } from '../components/Mirror';
import { IdealLens } from '../components/IdealLens';
import { MediumVolume } from '../components/MediumVolume';
import { Solver1 } from '../Solver1';
import { applyPacketMediumIndex } from '../rayTransport';

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
        sourceCellArea: 0.04,
        packetQ: collimatedPacketQFromSourceCellArea(532e-9, 1, 0.04),
        packetStateMode: 'explicit',
        sigmaU: 0.1,
        sigmaV: 0.1,
        curvatureRadiusU: Number.POSITIVE_INFINITY,
        curvatureRadiusV: Number.POSITIVE_INFINITY,
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

    test('propagates Gaussian Packet state when a child moves downstream', () => {
        const child = childRay(parentRay(), {
            origin: new Vector3(10, 0, 0),
            opticalPathLength: 10,
        });

        expect(child.packetStateMode).toBe('explicit');
        expect(child.packetQ).toBeDefined();
        expect(child.packetQ!.uu.re).toBeGreaterThan(9.9);
        expect(child.packetQ!.vv.re).toBeGreaterThan(9.9);
        expect(child.sigmaU ?? 0).toBeGreaterThan(0);
        expect(child.sigmaV ?? 0).toBeGreaterThan(0);
        expect(child.majorAxis?.dot(child.direction) ?? 1).toBeCloseTo(0, 6);
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

    test('reflective components reflect the packet transverse frame', () => {
        const mirror = new Mirror(25.4, 6, 'Packet mirror');
        mirror.reflectAt(
            10, 0, 0,
            new Vector3(1, 0, 0),
            new Vector3(0, 1, 0),
        );
        const ray = createRay({
            ...parentRay(),
            origin: new Vector3(0, 0, 0),
            direction: new Vector3(1, 0, 0),
            majorAxis: new Vector3(0, 1, 0),
        });

        const path = new Solver1([mirror]).trace([ray])[0];
        const reflected = path?.[1];

        expect(reflected).toBeDefined();
        expect(reflected!.direction.dot(new Vector3(0, 1, 0))).toBeGreaterThan(0.99);
        expect(Math.abs(reflected!.majorAxis!.dot(new Vector3(1, 0, 0)))).toBeGreaterThan(0.99);
        expect(Math.abs(reflected!.majorAxis!.dot(reflected!.direction))).toBeLessThan(1e-6);
    });

    test('lens-like components apply a paraxial q transform to packet state', () => {
        const lens = new IdealLens(20, 10, 'Packet lens');
        lens.pointAlong(1, 0, 0);
        lens.setPosition(10, 0, 0);
        const ray = createRay({
            ...parentRay(),
            origin: new Vector3(0, 0, 0),
            direction: new Vector3(1, 0, 0),
            majorAxis: new Vector3(0, 1, 0),
        });

        const path = new Solver1([lens]).trace([ray])[0];
        const transmitted = path?.[1];

        expect(transmitted).toBeDefined();
        expect(transmitted!.packetQ).toBeDefined();
        expect(Math.abs(transmitted!.packetQ!.uu.re - 10)).toBeGreaterThan(1);
        expect(transmitted!.packetStateMode).toBe('explicit');
    });

    test('medium index changes preserve the physical packet width', () => {
        const ray = createRay(parentRay());
        const converted = applyPacketMediumIndex(ray, 1.5);

        expect(converted.currentMediumIndex).toBeCloseTo(1.5, 12);
        expect(converted.packetStateMode).toBe('explicit');
        expect(converted.sigmaU).toBeCloseTo(ray.sigmaU!, 9);
        expect(converted.sigmaV).toBeCloseTo(ray.sigmaV!, 9);
        expect(converted.curvatureRadiusU).toBeCloseTo(ray.curvatureRadiusU!, 9);
    });

    test('medium volumes update packet medium on entry and exit', () => {
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
            majorAxis: new Vector3(1, 0, 0),
            currentMediumIndex: 1,
        });

        const paths = new Solver1([volume]).trace([ray]);
        const transmittedPath = paths.find(path => (path[1]?.currentMediumIndex ?? 1) > 1.2);

        expect(transmittedPath).toBeDefined();
        expect(transmittedPath![1].currentMediumIndex).toBeCloseTo(volume.getInteriorIor(ray.wavelength), 9);
        expect(transmittedPath![2].currentMediumIndex).toBeCloseTo(volume.getExteriorIor(ray.wavelength), 9);
    });
});
