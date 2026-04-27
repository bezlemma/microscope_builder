import { describe, expect, test } from 'bun:test';
import { createOpticalTrapScene } from '../../presets/opticalTrap';
import { Solver1 } from '../../physics/Solver1';
import { createSourceRays, stablePreviewSourceRays } from '../../physics/SourceRayFactory';
import { Blocker } from '../../physics/components/Blocker';
import { QPD } from '../../physics/components/QPD';
import {
    createDragPreviewSourceRays,
    DRAG_FORWARD_PREVIEW_NON_MAIN_RAYS,
    traceForwardWithDependencyCache,
    type ForwardTraceCache,
} from '../OpticalTable';

describe('forward trace dependency cache', () => {
    test('drag preview caps optical trap source rays', () => {
        const scene = createOpticalTrapScene();
        const full = createSourceRays(scene, 500, 'full');
        const preview = createDragPreviewSourceRays(scene, 500);

        expect(full).toHaveLength(501);
        expect(preview).toHaveLength(DRAG_FORWARD_PREVIEW_NON_MAIN_RAYS + 1);
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
        const first = traceForwardWithDependencyCache(new Solver1(scene), sourceRays, scene, cacheRef);

        dump!.position.y += 2;
        dump!.version++;

        const movedSourceRays = stablePreviewSourceRays(createSourceRays(scene, 144, 'full'), 72);
        const second = traceForwardWithDependencyCache(new Solver1(scene), movedSourceRays, scene, cacheRef);

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
        new Solver1(scene).trace(sourceRays);
        const directHits = qpd!.totalHits;
        const directSignal = qpd!.signalSum;

        const cacheRef: { current: ForwardTraceCache | null } = { current: null };
        qpd!.resetAccumulator();
        traceForwardWithDependencyCache(new Solver1(scene), sourceRays, scene, cacheRef);
        expect(qpd!.totalHits).toBe(directHits);
        expect(qpd!.signalSum).toBeCloseTo(directSignal, 12);

        qpd!.resetAccumulator();
        traceForwardWithDependencyCache(new Solver1(scene), sourceRays, scene, cacheRef);
        expect(qpd!.totalHits).toBe(directHits);
        expect(qpd!.signalSum).toBeCloseTo(directSignal, 12);
    });
});
