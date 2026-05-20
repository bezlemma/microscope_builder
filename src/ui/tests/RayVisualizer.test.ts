import { describe, expect, test } from 'bun:test';
import {
    additivePacketOpacityScale,
    batchedRegularRays,
    buildPathDrawSegments,
    coherentBranchDisplayStyle,
    coherentDisplayRGB,
    isMainRayPath,
    lampDisplayPacketCount,
    opacityFromRelativeRange,
    openTailSuppressionExpired,
    relativePathIntensity,
    polarizationOpacityFromRelativeRange,
    shouldDrawLampDisplayPath,
    shouldDrawPolarizationOpenTail,
    shouldDrawPolarizationPath,
    terminalVisualizationDistance,
} from '../RayVisualizer';
import { createOpticalTrapScene } from '../../presets/opticalTrap';
import { createBeamExpanderScene } from '../../presets/beamExpander';
import { ForwardTracer } from '../../physics/ForwardTracer';
import { createSourceRays } from '../../physics/SourceRayFactory';
import { traceStableTableOverlay } from '../../physics/tableTrace';
import { Blocker } from '../../physics/components/Blocker';
import { Coherence, type Ray } from '../../physics/types';
import { AdditiveBlending, Vector3 } from 'three';

function testRay(overrides: Partial<Ray>): Ray {
    return {
        origin: new Vector3(),
        direction: new Vector3(1, 0, 0),
        wavelength: 780e-9,
        intensity: 1,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
        opticalPathLength: 0,
        footprintRadius: 0.1,
        coherenceMode: Coherence.Coherent,
        ...overrides,
    };
}

describe('RayVisualizer coherent branch display', () => {
    test('keeps low-power dichroic split branches visibly bundled', () => {
        const dm2LeakageBranch = coherentBranchDisplayStyle(0.092, 0.4);

        expect(dm2LeakageBranch.opacity).toBeGreaterThan(0.2);
        expect(dm2LeakageBranch.lineWidth).toBe(0.75);
    });

    test('far-red coherent color stays red-only under additive overdraw', () => {
        const rgb = coherentDisplayRGB(780e-9);

        expect(rgb.r).toBeGreaterThan(0.5);
        expect(rgb.g).toBe(0);
        expect(rgb.b).toBe(0);
    });

    test('opacity range maps the dimmest rendered ray to the left handle', () => {
        expect(opacityFromRelativeRange(0.03, 0.03, 1, 0, 1)).toBe(0);
        expect(opacityFromRelativeRange(1, 0.03, 1, 0, 1)).toBe(1);
        expect(opacityFromRelativeRange(0.03, 0.03, 1, 0.33, 1)).toBeCloseTo(0.33, 6);
    });

    test('display intensity follows fractional loss, not source packet power', () => {
        const sparsePath = [
            testRay({ intensity: 0.1 }),
            testRay({ intensity: 0.05 }),
        ];
        const densePath = [
            testRay({ intensity: 0.001 }),
            testRay({ intensity: 0.0005 }),
        ];

        expect(relativePathIntensity(sparsePath, sparsePath[1])).toBeCloseTo(0.5, 12);
        expect(relativePathIntensity(densePath, densePath[1])).toBeCloseTo(0.5, 12);
        expect(opacityFromRelativeRange(
            relativePathIntensity(sparsePath, sparsePath[1]),
            1e-3,
            1,
            0,
            1,
        )).toBeCloseTo(opacityFromRelativeRange(
            relativePathIntensity(densePath, densePath[1]),
            1e-3,
            1,
            0,
            1,
        ), 12);
    });

    test('batched ray opacity remains material alpha, not premultiplied color', () => {
        const rendered = batchedRegularRays([{
            key: 'dim-ray',
            points: [new Vector3(0, 0, 0), new Vector3(1, 0, 0)],
            color: { r: 1, g: 1, b: 1 },
            opacity: 0.25,
            lineWidth: 0.75,
            dashed: false,
            blending: AdditiveBlending,
            renderOrder: 20,
            depthWrite: false,
            segments: true,
            vertexColors: [[0, 1, 1], [0, 1, 1]],
        }]);

        expect(rendered.batches).toHaveLength(1);
        expect(rendered.batches[0].opacity).toBeCloseTo(0.25, 12);
        expect(rendered.batches[0].vertexColors[0]).toEqual([0, 1, 1]);
    });

    test('polarization opacity can suppress PBS-scale leakage without dimming the main branch', () => {
        expect(polarizationOpacityFromRelativeRange(3e-5, 0, 1)).toBeLessThan(0.001);
        expect(polarizationOpacityFromRelativeRange(1, 0, 1)).toBe(1);
    });

    test('beam expander blue rays stay batched without dropping launch or lens segments', () => {
        const visibleWidth = (values: number[]) => Math.max(...values) - Math.min(...values);

        for (const rayCount of [32, 85, 103, 116, 1000]) {
            const scene = createBeamExpanderScene();
            const sourceRays = createSourceRays(scene, rayCount, 'full');
            const paths = new ForwardTracer(scene).trace(sourceRays)
                .filter(path => Math.abs((path[0]?.wavelength ?? 0) - 490e-9) < 1e-15);
            const firstSegments = paths.map(path => {
                const shouldDrawOpenTail = isMainRayPath(path)
                    || relativePathIntensity(path, path[path.length - 1]) >= 3e-2;
                return buildPathDrawSegments(
                    path,
                    shouldDrawOpenTail,
                    openTailSuppressionExpired(path),
                )[0];
            }).filter((segment): segment is NonNullable<typeof segment> => Boolean(segment));

            expect(paths).toHaveLength(rayCount + 1);
            expect(firstSegments).toHaveLength(rayCount + 1);
            expect(firstSegments.every(segment => segment.ray.intensity > 0)).toBe(true);
            expect(visibleWidth(firstSegments.map(segment => segment.start.y)))
                .toBeGreaterThan(rayCount <= 32 ? 3.1 : 3.55);
            expect(visibleWidth(firstSegments.map(segment => segment.end.y)))
                .toBeGreaterThan(rayCount <= 32 ? 3.1 : 3.55);

            const allSegments = paths.flatMap(path => {
                const shouldDrawOpenTail = isMainRayPath(path)
                    || relativePathIntensity(path, path[path.length - 1]) >= 3e-2;
                return buildPathDrawSegments(
                    path,
                    shouldDrawOpenTail,
                    openTailSuppressionExpired(path),
                );
            });

            const rendered = batchedRegularRays(allSegments.map((segment, index) => ({
                key: `blue-segment-${rayCount}-${index}`,
                points: [segment.start, segment.end],
                color: { r: 1, g: 1, b: 1 },
                opacity: 1,
                lineWidth: 0.75,
                dashed: false,
                blending: AdditiveBlending,
                renderOrder: 20,
                depthWrite: false,
                segments: true,
                vertexColors: [[0, 1, 1], [0, 1, 1]],
            })));
            const batchedSegmentCount = rendered.batches
                .reduce((sum, batch) => sum + batch.points.length / 2, 0);
            expect(batchedSegmentCount).toBe(allSegments.length);
            expect(batchedSegmentCount).toBeGreaterThan((rayCount + 1) * 2);
            expect(rendered.individual).toHaveLength(0);
        }
    });

    test('source launch segments stay visible when a later segment is dim', () => {
        const source = testRay({
            origin: new Vector3(0, 0, 0),
            intensity: 1,
        });
        const dimTerminal = testRay({
            origin: new Vector3(10, 0, 0),
            intensity: 1e-4,
            interactionDistance: 5,
        });
        const path = [source, dimTerminal];
        const segments = buildPathDrawSegments(path, false, false);

        expect(relativePathIntensity(path, dimTerminal)).toBeLessThan(1e-3);
        expect(segments).toHaveLength(2);
        expect(segments[0].ray).toBe(source);
        expect(relativePathIntensity(path, segments[0].ray)).toBe(1);
    });

    test('visual segment cutoff is relative to source power, not ray-count power', () => {
        const path = [
            testRay({
                origin: new Vector3(0, 0, 0),
                intensity: 1e-9,
            }),
            testRay({
                origin: new Vector3(10, 0, 0),
                intensity: 5e-12,
                interactionDistance: 5,
            }),
        ];

        const segments = buildPathDrawSegments(path, true, false);

        expect(relativePathIntensity(path, path[1])).toBeCloseTo(0.005, 12);
        expect(segments.length).toBeGreaterThanOrEqual(2);
    });

    test('additive lamp packet opacity preserves wavelength energy as sampling increases', () => {
        const defaultPacketCount = 17;
        const densePacketCount = 151;

        expect(additivePacketOpacityScale(defaultPacketCount, defaultPacketCount)).toBe(1);
        expect(
            additivePacketOpacityScale(densePacketCount, defaultPacketCount) * densePacketCount,
        ).toBeCloseTo(defaultPacketCount, 12);
    });

    test('lamp display caps high-density wavelength packets without using the cap as trace physics', () => {
        const densePacketCount = 2857;
        const displayed = Array.from({ length: densePacketCount }, (_, ordinal) =>
            shouldDrawLampDisplayPath(ordinal, densePacketCount)
        ).filter(Boolean).length;

        expect(lampDisplayPacketCount(114)).toBe(114);
        expect(lampDisplayPacketCount(densePacketCount)).toBe(512);
        expect(displayed).toBeLessThanOrEqual(512);
        expect(additivePacketOpacityScale(lampDisplayPacketCount(densePacketCount)))
            .toBeGreaterThan(additivePacketOpacityScale(densePacketCount));
    });

    test('draws finite terminal absorber segments even when open tails are suppressed', () => {
        const finiteComponentHit = terminalVisualizationDistance({
            interactionDistance: 25,
            suppressOpenTail: true,
            terminationPoint: undefined,
        }, false);

        expect(finiteComponentHit).toBe(25);
    });

    test('polarization view suppresses only truly extinct non-main leak branches even when they hit hardware', () => {
        const path = [
            testRay({ intensity: 1, isMainRay: false }),
            testRay({
                origin: new Vector3(10, 0, 0),
                intensity: 1e-7,
                isMainRay: false,
                interactionDistance: 25,
                interactionComponentId: 'laser-housing',
            }),
        ];

        expect(shouldDrawPolarizationPath(path)).toBe(false);
    });

    test('polarization view draws open tails for every branch above its draw threshold', () => {
        const path = [
            testRay({ intensity: 1, isMainRay: false }),
            testRay({
                origin: new Vector3(10, 0, 0),
                intensity: 0.005,
                isMainRay: false,
            }),
        ];

        expect(shouldDrawPolarizationPath(path)).toBe(true);
        expect(shouldDrawPolarizationOpenTail(path)).toBe(true);
        expect(terminalVisualizationDistance(path[1], shouldDrawPolarizationOpenTail(path))).toBe(1000);
    });

    test('a weak split child from the chief source ray is still drawable', () => {
        const path = [
            testRay({ intensity: 1, isMainRay: true }),
            testRay({
                origin: new Vector3(10, 0, 0),
                intensity: 1,
                isMainRay: true,
            }),
            testRay({
                origin: new Vector3(20, 0, 0),
                intensity: 1e-5,
                isMainRay: false,
            }),
        ];

        expect(isMainRayPath(path)).toBe(false);
        expect(shouldDrawPolarizationPath(path)).toBe(true);
        expect(shouldDrawPolarizationOpenTail(path)).toBe(true);
    });

    test('polarization view does not revive a path by backing up before an extinct child', () => {
        const path = [
            testRay({ intensity: 1, isMainRay: false }),
            testRay({
                origin: new Vector3(10, 0, 0),
                intensity: 1,
                isMainRay: false,
            }),
            testRay({
                origin: new Vector3(20, 0, 0),
                intensity: 1e-7,
                isMainRay: false,
            }),
        ];

        expect(shouldDrawPolarizationPath(path)).toBe(false);
    });

    test('still suppresses infinite escape tails when requested', () => {
        const openTail = terminalVisualizationDistance({
            interactionDistance: undefined,
            suppressOpenTail: true,
            terminationPoint: undefined,
        }, true);

        expect(openTail).toBeNull();
    });

    test('draws a suppressed branch again after a downstream optic changes direction', () => {
        const path = [
            testRay({ direction: new Vector3(1, 0, 0) }),
            testRay({
                origin: new Vector3(1, 0, 0),
                direction: new Vector3(1, 0, 0),
                suppressOpenTail: true,
                interactionDistance: 2,
                interactionComponentId: 'mirror',
            }),
            testRay({
                origin: new Vector3(3, 0, 0),
                direction: new Vector3(0, 1, 0),
                suppressOpenTail: true,
            }),
        ];

        expect(openTailSuppressionExpired(path)).toBe(true);
        expect(terminalVisualizationDistance(path[2], true, openTailSuppressionExpired(path))).toBe(1000);
    });

    test('keeps raw bead-scatter escape tails suppressed before downstream optics bend them', () => {
        const path = [
            testRay({ direction: new Vector3(1, 0, 0) }),
            testRay({
                origin: new Vector3(1, 0, 0),
                direction: new Vector3(1, 0, 0),
                suppressOpenTail: true,
            }),
        ];

        expect(openTailSuppressionExpired(path)).toBe(false);
        expect(terminalVisualizationDistance(path[1], true, openTailSuppressionExpired(path))).toBeNull();
    });

    test('shows optical-trap bead-scattered rays that terminate on the DM2 dump', () => {
        const scene = createOpticalTrapScene();
        const dump = scene.find(component => component.name === 'DM2 Transmitted IR Dump');
        expect(dump).toBeDefined();

        const paths = traceStableTableOverlay(
            scene,
            () => new ForwardTracer(scene).trace(createSourceRays(scene, 144, 'full')),
        );
        const collectedOffAxisPath = paths.find(path => {
            const last = path[path.length - 1];
            return path[0]?.isMainRay !== true
                && last?.interactionComponentId === dump!.id
                && last.suppressOpenTail === true;
        });

        expect(collectedOffAxisPath).toBeDefined();
        const lastRay = collectedOffAxisPath![collectedOffAxisPath!.length - 1];
        expect(terminalVisualizationDistance(lastRay, false)).toBeGreaterThan(0);
    });

    test('draws trap bundle tails after the DM2 dump is moved off the collected beam', () => {
        const scene = createOpticalTrapScene();
        const dump = scene.find((component): component is Blocker =>
            component instanceof Blocker && component.name === 'DM2 Transmitted IR Dump',
        );
        expect(dump).toBeDefined();

        dump!.position.y += 45;
        dump!.version++;

        const paths = traceStableTableOverlay(
            scene,
            () => new ForwardTracer(scene).trace(createSourceRays(scene, 144, 'full')),
        );
        const escapedOffAxisPaths = paths.filter(path => {
            const last = path[path.length - 1];
            return path[0]?.isMainRay !== true
                && last?.interactionComponentId === undefined
                && last?.suppressOpenTail === true;
        });
        const drawableEscapedOffAxisPaths = escapedOffAxisPaths.filter(openTailSuppressionExpired);

        expect(drawableEscapedOffAxisPaths.length).toBeGreaterThan(20);
        for (const path of drawableEscapedOffAxisPaths) {
            const last = path[path.length - 1];
            expect(terminalVisualizationDistance(last, true, openTailSuppressionExpired(path))).toBe(1000);
        }
    });
});
