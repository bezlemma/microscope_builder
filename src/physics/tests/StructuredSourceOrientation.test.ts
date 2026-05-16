import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { StructuredSource } from '../components/StructuredSource';
import { createSourceRays } from '../SourceRayFactory';

/**
 * Regression for the buildPerpBasis bug: an "L" pattern emitted by a
 * StructuredSource oriented with pointAlong(1,0,0) used to be rotated 90°
 * because the emission basis was built from `direction` alone, ignoring
 * the source's actual local +X/+Y axes.
 */
describe('StructuredSource pattern orientation', () => {
    test('emits "L" with its tall axis along the source local +Y direction', () => {
        const src = new StructuredSource('L source');
        src.asciiChar = 'L';
        src.beamRadius = 5;
        // pointAlong(1,0,0) makes local +Z = world +X, local +Y = world +Z,
        // local +X = world +Y.
        src.pointAlong(1, 0, 0);

        const rays = createSourceRays([src], 1024, 'full');

        // The L glyph is taller than it is wide. The source's local +Y axis
        // (which lands at world +Z under pointAlong(1,0,0)) is where the
        // vertical bar lives. The local +X axis (world +Y) is the foot.
        const localY = new Vector3(0, 0, 1); // source local +Y in world
        const localX = new Vector3(0, 1, 0); // source local +X in world

        let yExtent = 0;
        let xExtent = 0;
        for (const ray of rays) {
            const r = ray.origin.clone().sub(src.position);
            yExtent = Math.max(yExtent, Math.abs(r.dot(localY)));
            xExtent = Math.max(xExtent, Math.abs(r.dot(localX)));
        }

        // The vertical bar of L should make the local-Y extent comparable to
        // beamRadius. The foot makes the local-X extent meaningful but smaller.
        // Before the fix this was reversed (yExtent < xExtent).
        expect(yExtent).toBeGreaterThan(xExtent);
    });

    test('foot of L lives at low source local +Y (below the centre)', () => {
        const src = new StructuredSource('L source');
        src.asciiChar = 'L';
        src.beamRadius = 5;
        src.pointAlong(1, 0, 0);

        const rays = createSourceRays([src], 1024, 'full');

        // For the L bitmap, the foot is the only stroke at +X high (rightmost
        // pixels). Find the rays with the largest local-X projection — they
        // should sit at low/negative local-Y (the foot's row).
        const localY = new Vector3(0, 0, 1); // source local +Y in world
        const localX = new Vector3(0, 1, 0); // source local +X in world

        const projected = rays.map(ray => {
            const r = ray.origin.clone().sub(src.position);
            return { x: r.dot(localX), y: r.dot(localY) };
        });

        const sortedByX = [...projected].sort((a, b) => b.x - a.x);
        const topTen = sortedByX.slice(0, 10);
        const meanFootY = topTen.reduce((s, p) => s + p.y, 0) / topTen.length;

        // The L's foot is at low pattern Y (bottom of bitmap), which maps to
        // negative source local +Y.
        expect(meanFootY).toBeLessThan(0);
    });
});
