import { describe, expect, test } from 'bun:test';
import { PrismLens } from '../../physics/components/PrismLens';
import { PolygonScanner } from '../../physics/components/PolygonScanner';
import { deserializeScene, serializeScene } from '../ubzSerializer';

function expectVertexClose(actual: [number, number], expected: [number, number]) {
    expect(actual[0]).toBeCloseTo(expected[0], 6);
    expect(actual[1]).toBeCloseTo(expected[1], 6);
}

describe('UBZ polygon optics', () => {
    test('round-trips editable prism vertices and face curvature', () => {
        const prism = new PrismLens();
        prism.setVertices([
            [10, 1],
            [-6, -8],
            [-4, 9],
        ]);
        prism.setFaceCurvature(1, 42);

        const scene = deserializeScene(serializeScene([prism]));
        expect(scene).toHaveLength(1);
        expect(scene[0]).toBeInstanceOf(PrismLens);

        const loaded = scene[0] as PrismLens;
        expect(loaded.vertices).toHaveLength(3);
        for (let i = 0; i < prism.vertices.length; i++) {
            expectVertexClose(loaded.vertices[i], prism.vertices[i]);
        }
        expect(loaded.faceROC[1]).toBeCloseTo(42, 6);
    });

    test('round-trips polygon scanner as polygon scanner, not as prism', () => {
        const scanner = new PolygonScanner({ numFaces: 6, inscribedRadius: 10, faceHeight: 12, scanAngle: 0.2 });
        scanner.setVertices([
            [12, 0],
            [6, 8],
            [-4, 10],
            [-11, 2],
            [-8, -7],
            [5, -9],
        ]);
        scanner.setFaceCurvature(2, 55);
        scanner.applyScanAngle(0.35);

        const scene = deserializeScene(serializeScene([scanner]));
        expect(scene).toHaveLength(1);
        expect(scene[0]).toBeInstanceOf(PolygonScanner);

        const loaded = scene[0] as PolygonScanner;
        expect(loaded.vertices).toHaveLength(6);
        for (let i = 0; i < scanner.vertices.length; i++) {
            expectVertexClose(loaded.vertices[i], scanner.vertices[i]);
        }
        expect(loaded.faceROC[2]).toBeCloseTo(55, 6);
        expect(loaded.scanAngle).toBeCloseTo(0.35, 6);
    });
});
