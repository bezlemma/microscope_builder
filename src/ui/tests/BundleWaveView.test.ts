import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { Coherence, Ray } from '../../physics/types';
import { GaussianBeamSegment } from '../../physics/Solver2';
import { createBeamExpanderScene } from '../../presets/beamExpander';
import { createSourceRays } from '../../physics/SourceRayFactory';
import { Solver1 } from '../../physics/Solver1';
import { buildBundleWavePaths, buildBundleWaveSegments, buildBundleWaveSegmentsFromRayPaths } from '../bundleView';
import { buildWavePathRenderData } from '../bundleWaveRender';

function makeSegment(overrides: Partial<GaussianBeamSegment>): GaussianBeamSegment {
    return {
        start: new Vector3(0, 0, 0),
        end: new Vector3(0, 0, 20),
        direction: new Vector3(0, 0, 1),
        wavelength: 532e-9,
        power: 1,
        sourceId: 'laser-a',
        bundleKey: 'laser-a|air|0|lens',
        footprintStart: 0.25,
        footprintEnd: 0.25,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
        opticalPathLength: 0,
        refractiveIndex: 1,
        coherenceMode: Coherence.Coherent,
        ...overrides,
    };
}

function makeReversePath(overrides: {
    sourceId: string;
    origin: Vector3;
    entryPoint?: Vector3;
    nextOrigin: Vector3;
    wavelength?: number;
}): Ray[] {
    const wavelength = overrides.wavelength ?? 532e-9;
    const startRay: Ray = {
        origin: overrides.origin.clone(),
        direction: overrides.nextOrigin.clone().sub(overrides.origin).normalize(),
        wavelength,
        intensity: 1,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
        opticalPathLength: 0,
        footprintRadius: 0.25,
        coherenceMode: Coherence.Incoherent,
        isBackward: true,
        sourceId: overrides.sourceId,
        entryPoint: overrides.entryPoint?.clone(),
    };
    const secondRay: Ray = {
        origin: overrides.nextOrigin.clone(),
        direction: new Vector3(-1, 0, 0),
        wavelength,
        intensity: 1,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
        opticalPathLength: overrides.origin.distanceTo(overrides.nextOrigin),
        footprintRadius: 0.25,
        coherenceMode: Coherence.Incoherent,
        isBackward: true,
        sourceId: overrides.sourceId,
        interactionDistance: 20,
    };
    return [startRay, secondRay];
}

describe('Bundle wave grouping', () => {
    test('groups same-source parallel beamlets into one bundle envelope', () => {
        const bundles = buildBundleWaveSegments([[
            makeSegment({
                start: new Vector3(-1, 0, 0),
                end: new Vector3(-1, 0, 20),
            }),
            makeSegment({
                start: new Vector3(0, 0, 0),
                end: new Vector3(0, 0, 20),
            }),
            makeSegment({
                start: new Vector3(1, 0, 0),
                end: new Vector3(1, 0, 20),
            }),
        ]]);

        expect(bundles).toHaveLength(1);
        expect(bundles[0].memberCount).toBe(3);
        expect(bundles[0].radiusStart).toBeCloseTo(1, 4);
        expect(bundles[0].radiusEnd).toBeCloseTo(1, 4);
    });

    test('splits clearly different outgoing directions into separate bundles', () => {
        const bundles = buildBundleWaveSegments([[
            makeSegment({
                direction: new Vector3(0, 0, 1),
                end: new Vector3(0, 0, 20),
            }),
            makeSegment({
                direction: new Vector3(1, 0, 0).normalize(),
                end: new Vector3(20, 0, 0),
            }),
        ]]);

        expect(bundles).toHaveLength(2);
        expect(bundles.every(bundle => bundle.memberCount === 1)).toBe(true);
    });

    test('keeps spatially separated parallel beam families as separate bundles', () => {
        const bundles = buildBundleWaveSegments([[
            makeSegment({
                start: new Vector3(-6, 0, 0),
                end: new Vector3(-6, 0, 20),
            }),
            makeSegment({
                start: new Vector3(-5, 0, 0),
                end: new Vector3(-5, 0, 20),
            }),
            makeSegment({
                start: new Vector3(5, 0, 0),
                end: new Vector3(5, 0, 20),
            }),
            makeSegment({
                start: new Vector3(6, 0, 0),
                end: new Vector3(6, 0, 20),
            }),
        ]]);

        expect(bundles).toHaveLength(2);
        expect(bundles.every(bundle => bundle.memberCount === 2)).toBe(true);
    });

    test('keeps a ring-distributed single beam as one bundle', () => {
        const radius = 3;
        const segments = Array.from({ length: 8 }, (_, index) => {
            const angle = (index / 8) * Math.PI * 2;
            return makeSegment({
                start: new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0),
                end: new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 20),
            });
        });

        const bundles = buildBundleWaveSegments([segments]);

        expect(bundles).toHaveLength(1);
        expect(bundles[0].memberCount).toBe(8);
    });

    test('connects consecutive bundle segments into one continuous wave path', () => {
        const bundles = buildBundleWaveSegments([[
            makeSegment({
                bundleKey: 'laser-a|air|0|left',
                start: new Vector3(0, 0, 0),
                end: new Vector3(0, 0, 20),
                opticalPathLength: 0,
            }),
            makeSegment({
                bundleKey: 'laser-a|glass|1|lens',
                start: new Vector3(0, 0, 20),
                end: new Vector3(2, 0, 35),
                direction: new Vector3(2, 0, 15).normalize(),
                opticalPathLength: 20,
            }),
            makeSegment({
                bundleKey: 'laser-a|air|2|right',
                start: new Vector3(2, 0, 35),
                end: new Vector3(4, 0, 55),
                direction: new Vector3(2, 0, 20).normalize(),
                opticalPathLength: 35,
            }),
        ]]);

        const paths = buildBundleWavePaths(bundles);

        expect(paths).toHaveLength(1);
        expect(paths[0].segments).toHaveLength(3);
    });

    test('centers the bundle envelope from the marginal rays instead of power weighting', () => {
        const bundles = buildBundleWaveSegments([[
            makeSegment({
                start: new Vector3(-2, 0, 0),
                end: new Vector3(-2, 0, 20),
                power: 20,
            }),
            makeSegment({
                start: new Vector3(0, 0, 0),
                end: new Vector3(0, 0, 20),
                power: 1,
            }),
            makeSegment({
                start: new Vector3(2, 0, 0),
                end: new Vector3(2, 0, 20),
                power: 1,
            }),
        ]]);

        expect(bundles).toHaveLength(1);
        expect(bundles[0].start.x).toBeCloseTo(0, 4);
        expect(bundles[0].end.x).toBeCloseTo(0, 4);
        expect(bundles[0].radiusStart).toBeCloseTo(2, 4);
        expect(bundles[0].radiusEnd).toBeCloseTo(2, 4);
    });

    test('captures an internal waist when marginal rays cross inside a segment', () => {
        const bundles = buildBundleWaveSegments([[
            makeSegment({
                start: new Vector3(-2, 0, 0),
                end: new Vector3(2, 0, 20),
                direction: new Vector3(4, 0, 20).normalize(),
            }),
            makeSegment({
                start: new Vector3(0, 0, 0),
                end: new Vector3(0, 0, 20),
            }),
            makeSegment({
                start: new Vector3(2, 0, 0),
                end: new Vector3(-2, 0, 20),
                direction: new Vector3(-4, 0, 20).normalize(),
            }),
        ]]);

        expect(bundles).toHaveLength(1);
        expect(bundles[0].radiusStart).toBeCloseTo(2, 4);
        expect(bundles[0].radiusEnd).toBeCloseTo(2, 4);
        const midSample = bundles[0].profile[Math.floor(bundles[0].profile.length / 2)];
        expect(midSample.radius).toBeLessThan(0.15);
    });

    test('beam expander preset narrows to the visible top-down waist', () => {
        const scene = createBeamExpanderScene();
        const sourceRays = createSourceRays(scene, 32, 'full');
        const solver = new Solver1(scene);
        const beamSegments = solver.buildBeamSegments(solver.trace(sourceRays));
        const bundles = buildBundleWaveSegments(beamSegments);
        const freeSpaceBundles = bundles.filter(bundle => bundle.key.includes('|air|1|'));

        expect(freeSpaceBundles.length).toBeGreaterThan(0);
        const minRadius = Math.min(
            ...freeSpaceBundles.flatMap(bundle => bundle.profile.map(sample => sample.radius)),
        );
        expect(minRadius).toBeLessThan(0.1);
    });

    test('preserves slanted boundary edges for oblique prism-like segments', () => {
        const startA = new Vector3(0, 0, 0);
        const startB = new Vector3(1, 1, 0);
        const startC = new Vector3(2, 2, 0);
        const delta = new Vector3(12, 6, 0);
        const bundles = buildBundleWaveSegments([[
            makeSegment({
                start: startA,
                end: startA.clone().add(delta),
                direction: delta.clone().normalize(),
            }),
            makeSegment({
                start: startB,
                end: startB.clone().add(delta),
                direction: delta.clone().normalize(),
            }),
            makeSegment({
                start: startC,
                end: startC.clone().add(delta),
                direction: delta.clone().normalize(),
            }),
        ]]);

        expect(bundles).toHaveLength(1);
        const startSample = bundles[0].profile[0];
        const endpointDistances = [
            startSample.edgeMin.distanceTo(startA),
            startSample.edgeMin.distanceTo(startC),
            startSample.edgeMax.distanceTo(startA),
            startSample.edgeMax.distanceTo(startC),
        ];
        const orderedPairError = endpointDistances[0] + endpointDistances[3];
        const reversedPairError = endpointDistances[1] + endpointDistances[2];
        expect(Math.min(orderedPairError, reversedPairError)).toBeLessThan(1e-4);
        expect(Math.abs(startSample.edgeMax.x - startSample.edgeMin.x)).toBeGreaterThan(1.5);
        expect(Math.abs(startSample.edgeMax.y - startSample.edgeMin.y)).toBeGreaterThan(1.5);
    });

    test('wave render data bends smoothly through refractive interfaces', () => {
        const bundles = buildBundleWaveSegments([[
            makeSegment({
                bundleKey: 'laser-a|air|0|prism-in',
                start: new Vector3(0, 0, 0),
                end: new Vector3(12, 0, 0),
                direction: new Vector3(1, 0, 0),
                opticalPathLength: 0,
            }),
            makeSegment({
                bundleKey: 'laser-a|glass|1|prism-mid',
                start: new Vector3(12, 0, 0),
                end: new Vector3(20, -8, 0),
                direction: new Vector3(1, -1, 0).normalize(),
                refractiveIndex: 1.5,
                opticalPathLength: 12,
            }),
        ]]);

        const paths = buildBundleWavePaths(bundles);
        expect(paths).toHaveLength(1);

        const renderData = buildWavePathRenderData(paths[0]);
        const boundaryIndex = renderData.waveSamples.findIndex(sample => sample.axisPoint.distanceTo(new Vector3(12, 0, 0)) < 0.5);
        const firstGlassIndex = renderData.waveSamples.findIndex((sample, index) => index > boundaryIndex && sample.refractiveIndex > 1.2);
        let lastAirIndex = -1;
        for (let index = 0; index < boundaryIndex; index++) {
            if (renderData.waveSamples[index].refractiveIndex < 1.2) {
                lastAirIndex = index;
            }
        }

        expect(boundaryIndex).toBeGreaterThan(3);
        expect(boundaryIndex).toBeLessThan(renderData.waveSamples.length - 6);
        expect(firstGlassIndex).toBeGreaterThan(boundaryIndex);
        expect(lastAirIndex).toBeGreaterThan(0);

        const before = renderData.waveSamples[boundaryIndex - 2].axisPoint.clone()
            .sub(renderData.waveSamples[boundaryIndex - 3].axisPoint)
            .normalize();
        const through = renderData.waveSamples[boundaryIndex + 1].axisPoint.clone()
            .sub(renderData.waveSamples[boundaryIndex - 1].axisPoint)
            .normalize();
        const after = renderData.waveSamples[boundaryIndex + 5].axisPoint.clone()
            .sub(renderData.waveSamples[boundaryIndex + 4].axisPoint)
            .normalize();
        const beforePhaseStep = (
            renderData.waveSamples[lastAirIndex].opticalDistance
            - renderData.waveSamples[lastAirIndex - 1].opticalDistance
        ) / renderData.waveSamples[lastAirIndex].axisPoint.distanceTo(renderData.waveSamples[lastAirIndex - 1].axisPoint);
        const afterPhaseStep = (
            renderData.waveSamples[firstGlassIndex + 1].opticalDistance
            - renderData.waveSamples[firstGlassIndex].opticalDistance
        ) / renderData.waveSamples[firstGlassIndex + 1].axisPoint.distanceTo(renderData.waveSamples[firstGlassIndex].axisPoint);

        expect(before.dot(new Vector3(1, 0, 0))).toBeGreaterThan(0.95);
        expect(after.dot(new Vector3(1, -1, 0).normalize())).toBeGreaterThan(0.95);
        expect(through.dot(new Vector3(1, 0, 0))).toBeLessThan(0.99);
        expect(through.dot(new Vector3(1, -1, 0).normalize())).toBeLessThan(0.98);
        expect(beforePhaseStep).toBeCloseTo(1.0, 1);
        expect(afterPhaseStep).toBeCloseTo(1.5, 1);
    });

    test('groups reverse camera rays into detector-level bundles', () => {
        const reversePaths = [
            makeReversePath({
                sourceId: 'solver3_cam_camA_px0_py0_s0_wl532',
                origin: new Vector3(10, -1, 0),
                nextOrigin: new Vector3(0, -1, 0),
            }),
            makeReversePath({
                sourceId: 'solver3_cam_camA_px1_py0_s0_wl532',
                origin: new Vector3(10, 1, 0),
                nextOrigin: new Vector3(0, 1, 0),
            }),
        ];

        const bundles = buildBundleWaveSegmentsFromRayPaths(reversePaths);
        const paths = buildBundleWavePaths(bundles);

        expect(bundles.length).toBeGreaterThanOrEqual(1);
        expect(bundles.some(bundle => bundle.memberCount >= 2)).toBe(true);
        expect(paths.some(path => path.segments.length >= 1)).toBe(true);
    });
});
