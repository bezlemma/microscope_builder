import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { createOpticalTrapScene } from '../../presets/opticalTrap';
import { ForwardTracer } from '../../physics/ForwardTracer';
import { createSourceRays, stablePreviewSourceRays } from '../../physics/SourceRayFactory';
import { Blocker } from '../../physics/components/Blocker';
import { Laser } from '../../physics/components/Laser';
import { QPD } from '../../physics/components/QPD';
import { Sample } from '../../physics/components/Sample';
import { TrappedBead } from '../../physics/components/TrappedBead';
import { Coherence } from '../../physics/types';
import type { GaussianBeamSegment } from '../../physics/BeamField';
import {
    colloidTrapZonesBySample,
    createDragPreviewSourceRays,
    traceForwardWithDependencyCache,
    type ForwardTraceCache,
} from '../OpticalTable';

describe('forward trace dependency cache', () => {
    test('drag preview keeps the configured source ray set', () => {
        const scene = createOpticalTrapScene();
        const full = createSourceRays(scene, 500, 'full');
        const preview = createDragPreviewSourceRays(scene, 500);

        expect(full).toHaveLength(501);
        expect(preview).toHaveLength(full.length);
        expect(preview.some(ray => ray.isMainRay)).toBe(true);
    });

    test('moving an absorber retraces whole affected source families', () => {
        const scene = createOpticalTrapScene();
        const dump = scene.find((component): component is Blocker =>
            component instanceof Blocker && component.name === 'DM2 Transmitted IR Dump',
        );
        expect(dump).toBeDefined();

        const cacheRef: { current: ForwardTraceCache | null } = { current: null };
        const sourceRays = stablePreviewSourceRays(createSourceRays(scene, 144, 'full'), 72);
        const first = traceForwardWithDependencyCache(new ForwardTracer(scene), sourceRays, scene, cacheRef);

        dump!.position.y += 2;
        dump!.version++;

        const movedSourceRays = stablePreviewSourceRays(createSourceRays(scene, 144, 'full'), 72);
        const second = traceForwardWithDependencyCache(new ForwardTracer(scene), movedSourceRays, scene, cacheRef);

        const firstPaths = new Set(first.paths);
        const firstBySource = new Map<string, number>();
        const reusedBySource = new Map<string, number>();
        for (const path of first.paths) {
            const key = path[0]?.sourceId ?? '__unknown__';
            firstBySource.set(key, (firstBySource.get(key) ?? 0) + 1);
        }
        for (const path of second.paths) {
            const key = path[0]?.sourceId ?? '__unknown__';
            if (firstPaths.has(path)) {
                reusedBySource.set(key, (reusedBySource.get(key) ?? 0) + 1);
            }
        }

        expect(second.changedComponents.map(component => component.id)).toEqual([dump!.id]);
        for (const [sourceId, sourcePathCount] of firstBySource) {
            const reusedCount = reusedBySource.get(sourceId) ?? 0;
            expect(reusedCount === 0 || reusedCount === sourcePathCount).toBe(true);
        }
    });

    test('populates detector side effects for cached traces', () => {
        const scene = createOpticalTrapScene();
        const qpd = scene.find((component): component is QPD => component instanceof QPD);
        expect(qpd).toBeDefined();

        const sourceRays = stablePreviewSourceRays(createSourceRays(scene, 144, 'full'), 72);
        new ForwardTracer(scene).trace(sourceRays);
        const directHits = qpd!.totalHits;
        const directSignal = qpd!.signalSum;

        const cacheRef: { current: ForwardTraceCache | null } = { current: null };
        qpd!.resetAccumulator();
        traceForwardWithDependencyCache(new ForwardTracer(scene), sourceRays, scene, cacheRef);
        expect(qpd!.totalHits).toBe(directHits);
        expect(qpd!.signalSum).toBeCloseTo(directSignal, 12);

        qpd!.resetAccumulator();
        traceForwardWithDependencyCache(new ForwardTracer(scene), sourceRays, scene, cacheRef);
        expect(qpd!.totalHits).toBe(directHits);
        expect(qpd!.signalSum).toBeCloseTo(directSignal, 12);
    });

    test('colloid trap zones require powered beam segments reaching the bead', () => {
        const scene = createOpticalTrapScene();
        const sample = scene.find((component): component is Sample =>
            component instanceof Sample && component.name === 'Trap Flow Cell',
        );
        const laser = scene.find((component): component is Laser => component instanceof Laser);
        expect(sample).toBeDefined();
        expect(laser).toBeDefined();

        const poweredResult = new ForwardTracer(scene).traceWithBeamSegments(createSourceRays(scene, 144, 'full'));
        expect(colloidTrapZonesBySample(scene, poweredResult.beamSegments).get(sample!.id)?.length).toBeGreaterThan(0);

        laser!.isOn = false;
        laser!.version++;
        const darkResult = new ForwardTracer(scene).traceWithBeamSegments(createSourceRays(scene, 144, 'full'));
        expect(colloidTrapZonesBySample(scene, darkResult.beamSegments).get(sample!.id)).toBeUndefined();
    });

    test('colloid trap zones require a local 3D intensity maximum', () => {
        const sample = new Sample('Synthetic flow cell').configureColloidFlowCell({ count: 0 });
        const bead = new TrappedBead(0.005, 1.59, 1.33, 'Synthetic trap bead');
        bead.parentSampleId = sample.id;
        bead.gradientForceScale = 1e6;
        const passThroughSegment: GaussianBeamSegment = {
            start: new Vector3(0, 0, -1),
            end: new Vector3(0, 0, 1),
            direction: new Vector3(0, 0, 1),
            wavelength: 780e-9,
            power: 120,
            sourceId: 'synthetic',
            bundleKey: `synthetic|air|0|${bead.id}`,
            footprintStart: 0.05,
            footprintEnd: 0.05,
            polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
            opticalPathLength: 0,
            refractiveIndex: 1,
            coherenceMode: Coherence.Coherent,
        };

        expect(colloidTrapZonesBySample([sample, bead], [[passThroughSegment]]).get(sample.id)).toBeUndefined();
    });

    test('colloid trap zone strength tracks delivered trap power', () => {
        const scene = createOpticalTrapScene();
        const sample = scene.find((component): component is Sample =>
            component instanceof Sample && component.name === 'Trap Flow Cell',
        );
        const laser = scene.find((component): component is Laser => component instanceof Laser);
        expect(sample).toBeDefined();
        expect(laser).toBeDefined();

        const strongResult = new ForwardTracer(scene).traceWithBeamSegments(createSourceRays(scene, 144, 'full'));
        const strongZone = colloidTrapZonesBySample(scene, strongResult.beamSegments).get(sample!.id)?.[0];
        expect(strongZone?.stiffnessPerSecond).toBeGreaterThan(10);

        laser!.power *= 0.5;
        laser!.version++;
        const weakResult = new ForwardTracer(scene).traceWithBeamSegments(createSourceRays(scene, 144, 'full'));
        const weakZone = colloidTrapZonesBySample(scene, weakResult.beamSegments).get(sample!.id)?.[0];
        expect(weakZone?.stiffnessPerSecond).toBeGreaterThan(1);
        expect(weakZone!.stiffnessPerSecond!).toBeLessThan(strongZone!.stiffnessPerSecond! * 0.6);
        expect(weakZone!.stiffnessPerSecond!).toBeGreaterThan(strongZone!.stiffnessPerSecond! * 0.4);
    });
});
