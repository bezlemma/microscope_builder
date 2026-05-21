import { describe, expect, test } from 'bun:test';
import { Quaternion, Vector3 } from 'three';
import { createObliquePlaneMicroscopeScene } from '../../presets/obliquePlaneMicroscope';
import { AchromatDoublet } from '../components/AchromatDoublet';
import { Blocker } from '../components/Blocker';
import { Camera } from '../components/Camera';
import { Card } from '../components/Card';
import { CylindricalLens } from '../components/CylindricalLens';
import { DualGalvoScanHead } from '../components/DualGalvoScanHead';
import { GalvoScanHead } from '../components/GalvoScanHead';
import { IdealLens } from '../components/IdealLens';
import { Laser } from '../components/Laser';
import { Mirror } from '../components/Mirror';
import { Sample } from '../components/Sample';
import { createSourceRays } from '../SourceRayFactory';
import { PropertyAnimator } from '../PropertyAnimator';
import { ForwardTracer } from '../ForwardTracer';
import { BeamField } from '../BeamField';
import { ReverseTracer } from '../ReverseTracer';
import { Ray } from '../types';

function centralRayFrom(component: { id: string; position: Vector3; rotation: Quaternion }, wavelengthNm: number): Ray {
    const direction = new Vector3(0, 0, 1).applyQuaternion(component.rotation).normalize();
    return {
        origin: component.position.clone().add(direction.clone().multiplyScalar(3)),
        direction,
        wavelength: wavelengthNm * 1e-9,
        intensity: 1,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 } },
        opticalPathLength: 0,
        footprintRadius: 0,
        coherenceMode: 0,
        isMainRay: true,
        sourceId: component.id,
    };
}

function pathHitsComponent(paths: Ray[][], componentId: string): boolean {
    return paths.some(path => path.some(segment => segment.interactionComponentId === componentId));
}

function countSpecimenChordHits(paths: Ray[][], sample: Sample): number {
    let count = 0;
    for (const path of paths) {
        for (const ray of path) {
            if (ray.interactionComponentId !== sample.id) continue;
            const chordLength = sample.computeChordSegments(ray)
                .reduce((sum, segment) => sum + Math.max(0, segment.tEnd - segment.tStart), 0);
            if (chordLength > 0) count++;
        }
    }
    return count;
}

describe('Oblique Plane Light Sheet preset', () => {
    test('uses the oblique plane light-sheet component set without tutorial cards or ideal lenses', () => {
        const { scene } = createObliquePlaneMicroscopeScene();
        const camera = scene.find((component): component is Camera => component instanceof Camera);
        const names = scene.map(component => component.name);

        expect(scene.some(component => component instanceof Card)).toBe(false);
        expect(scene.some(component => component instanceof IdealLens)).toBe(false);
        expect(scene.some(component => component instanceof GalvoScanHead)).toBe(false);
        expect(scene.some(component => component instanceof DualGalvoScanHead)).toBe(false);

        for (const expected of [
            '488 nm excitation laser',
            'ND Wheel',
            'M1 Steering Mirror',
            'M2 Steering Mirror',
            'L1 Achromat (f=100)',
            'L2 Achromat (f=45)',
            'CL1 Cylindrical (f=50)',
            'CL2 Cylindrical (f=200)',
            'CL3 Cylindrical (f=100)',
            'L3 Achromat (f=150)',
            'L4 Achromat (f=100)',
            'DM Dichroic (LP 505)',
            'O1 Primary Objective (20x/1.0W)',
            'Post-Sample Beam Dump',
            'Emission Scan Mirror',
            'O2 Relay Objective (40x/0.8)',
            'TL2 Tube Lens (f=125)',
            'SL2 Scan Lens (f=150)',
            'M3 Fold Mirror',
            'O3 Re-imaging Objective (40x/0.8)',
            'TL3 Tube Lens (f=200)',
            'EF Emission Filter (LP 620)',
            'sCMOS Camera',
        ]) {
            expect(names).toContain(expected);
        }
        expect(names.filter(name => /laser|source/i.test(name))).toEqual(['488 nm excitation laser']);
        expect(camera?.sensorResX).toBe(16);
        expect(camera?.sensorResY).toBe(16);
        expect(camera?.samplesPerPixel).toBe(1);
    });

    test('post-sample beam dump terminates transmitted excitation tails', () => {
        const { scene } = createObliquePlaneMicroscopeScene();
        const laser = scene.find((component): component is Laser => component instanceof Laser);
        const sample = scene.find((component): component is Sample => component instanceof Sample);
        const dump = scene.find((component): component is Blocker =>
            component instanceof Blocker && component.name === 'Post-Sample Beam Dump',
        );
        expect(laser).toBeDefined();
        expect(sample).toBeDefined();
        expect(dump).toBeDefined();
        expect(dump!.position.y).toBeLessThan(sample!.position.y);

        const paths = new ForwardTracer(scene).trace(createSourceRays(scene, 36, 'full'));
        const sampleHitPaths = paths.filter(path => path.some(ray => ray.interactionComponentId === sample!.id));
        const dumpedPaths = sampleHitPaths.filter(path => {
            const last = path[path.length - 1];
            return last.interactionComponentId === dump!.id && Number.isFinite(last.interactionDistance ?? Infinity);
        });

        expect(sampleHitPaths.length).toBeGreaterThan(20);
        expect(dumpedPaths.length).toBeGreaterThan(sampleHitPaths.length * 0.9);
        for (const path of dumpedPaths) {
            const sampleRay = path.find(ray => ray.interactionComponentId === sample!.id);
            const last = path[path.length - 1];
            const terminal = last.origin.clone().addScaledVector(last.direction, last.interactionDistance ?? 0);
            expect(terminal.distanceTo(sampleRay!.origin)).toBeLessThan(20);
        }
    });

    test('cylindrical light-sheet lenses keep the Figure 4 focal sequence', () => {
        const { scene } = createObliquePlaneMicroscopeScene();
        const expected = new Map([
            ['CL1 Cylindrical (f=50)', 50],
            ['CL2 Cylindrical (f=200)', 200],
            ['CL3 Cylindrical (f=100)', 100],
        ]);

        for (const [name, focalLength] of expected) {
            const lens = scene.find((component): component is CylindricalLens =>
                component instanceof CylindricalLens && component.name === name,
            );
            expect(lens).toBeDefined();
            expect(lens!.r1 / (lens!.ior - 1)).toBeCloseTo(focalLength, 6);
        }
    });

    test('central excitation ray reaches the shared O1 sample plane', () => {
        const { scene } = createObliquePlaneMicroscopeScene();
        const laser = scene.find((component): component is Laser => component instanceof Laser);
        const sample = scene.find((component): component is Sample => component instanceof Sample);
        expect(laser).toBeDefined();
        expect(sample).toBeDefined();

        const paths = new ForwardTracer(scene).trace([centralRayFrom(laser!, laser!.wavelength)]);

        expect(pathHitsComponent(paths, sample!.id)).toBe(true);
    });

    test('488 nm excitation leaves O1 as a clearly oblique sheet', () => {
        const { scene } = createObliquePlaneMicroscopeScene();
        const laser = scene.find((component): component is Laser => component instanceof Laser);
        const sample = scene.find((component): component is Sample => component instanceof Sample);
        expect(laser).toBeDefined();
        expect(sample).toBeDefined();

        const paths = new ForwardTracer(scene).trace([centralRayFrom(laser!, laser!.wavelength)]);
        const sampleSegment = paths
            .flat()
            .find(ray => ray.sourceId === laser!.id && ray.interactionComponentId === sample!.id);
        expect(sampleSegment).toBeDefined();

        const objectiveAxis = new Vector3(0, -1, 0);
        const angleDeg = Math.acos(sampleSegment!.direction.dot(objectiveAxis)) * 180 / Math.PI;
        expect(angleDeg).toBeGreaterThan(20);
        expect(Math.abs(sampleSegment!.direction.x)).toBeGreaterThan(0.38);
        expect(Math.abs(sampleSegment!.direction.z)).toBeLessThan(0.12);

        const sourcePaths = new ForwardTracer(scene).trace(createSourceRays(scene, 36, 'full'));
        expect(countSpecimenChordHits(sourcePaths, sample!)).toBeGreaterThan(20);
    });

    test('central camera reverse ray walks the folded emission relay back to the sample', () => {
        const { scene } = createObliquePlaneMicroscopeScene();
        const camera = scene.find((component): component is Camera => component instanceof Camera);
        const sample = scene.find((component): component is Sample => component instanceof Sample);
        expect(camera).toBeDefined();
        expect(sample).toBeDefined();

        const paths = new ForwardTracer(scene).trace([centralRayFrom(camera!, sample!.getEmissionWavelength())]);

        expect(pathHitsComponent(paths, sample!.id)).toBe(true);
    });

    test('upstream oblique excitation excites the sample volume and camera image', () => {
        const { scene } = createObliquePlaneMicroscopeScene();
        const camera = scene.find((component): component is Camera => component instanceof Camera);
        const sample = scene.find((component): component is Sample => component instanceof Sample);
        expect(camera).toBeDefined();
        expect(sample).toBeDefined();
        const sourceRays = createSourceRays(scene, 36, 'full');
        const paths = new ForwardTracer(scene).trace(sourceRays);
        const beamSegments = new BeamField().propagate(paths, scene);
        const centerExcitation = BeamField.queryIntensityMultiBeam(
            sample!.position.x,
            sample!.position.y,
            sample!.position.z,
            beamSegments,
            sample!.getExcitationWavelength() * 1e-9,
        );
        const render = new ReverseTracer(scene, beamSegments).render(camera!, 16);
        const litPixels = Array.from(render.emissionImage).filter(value => value > 0).length;
        const terminalDistances = render.paths.map(path => {
            const last = path[path.length - 1];
            const terminal = last.terminationPoint ?? last.origin;
            return terminal.distanceTo(sample!.position);
        });

        expect(centerExcitation).toBeGreaterThan(0);
        expect(litPixels).toBeGreaterThan(20);
        expect(terminalDistances.length).toBeGreaterThan(0);
        expect(Math.max(...terminalDistances)).toBeLessThan(1);
    });

    test('preloads paused pan animations on the scan mirrors', () => {
        const result = createObliquePlaneMicroscopeScene();
        const emissionScanMirror = result.scene.find((component): component is Mirror =>
            component instanceof Mirror && component.name === 'Emission Scan Mirror',
        );
        const excitationScanMirror = result.scene.find((component): component is Mirror =>
            component instanceof Mirror && component.name === 'M2 Steering Mirror',
        );
        expect(emissionScanMirror).toBeDefined();
        expect(excitationScanMirror).toBeDefined();
        expect(result.animationPlaying).toBe(false);
        expect(result.animationSpeed).toBe(1);
        expect(result.rayCount).toBe(36);
        expect(result.scanSteps).toBe(8);
        expect(result.channels?.some(channel =>
            channel.targetId === emissionScanMirror!.id &&
            channel.property === 'panAngle' &&
            Math.abs((channel.to - channel.from) * 180 / Math.PI - 2) < 1e-9 &&
            channel.restoreValue === emissionScanMirror!.panAngle,
        )).toBe(true);
        expect(result.channels?.some(channel =>
            channel.targetId === excitationScanMirror!.id &&
            channel.property === 'panAngle' &&
            channel.restoreValue === excitationScanMirror!.panAngle,
        )).toBe(true);
    });

    test('excitation scan extrema remain visible and reach the sample', () => {
        const result = createObliquePlaneMicroscopeScene();
        const sample = result.scene.find((component): component is Sample =>
            component instanceof Sample && component.name === 'Oblique Plane Sample',
        );
        const excitationScanMirror = result.scene.find((component): component is Mirror =>
            component instanceof Mirror && component.name === 'M2 Steering Mirror',
        );
        const channel = result.channels?.find(ch => ch.targetId === excitationScanMirror?.id && ch.property === 'panAngle');
        expect(sample).toBeDefined();
        expect(excitationScanMirror).toBeDefined();
        expect(channel).toBeDefined();

        for (const panAngle of [channel!.from, channel!.restoreValue ?? excitationScanMirror!.panAngle, channel!.to]) {
            excitationScanMirror!.panAngle = panAngle;
            excitationScanMirror!.recomputeRotation();
            const paths = new ForwardTracer(result.scene).trace(createSourceRays(result.scene, 36, 'full'));
            expect(pathHitsComponent(paths, sample!.id)).toBe(true);
            expect(countSpecimenChordHits(paths, sample!)).toBeGreaterThan(0);
        }
    });

    test('camera reverse rays remain visible across the full OPM scan cycle', () => {
        const result = createObliquePlaneMicroscopeScene();
        const camera = result.scene.find((component): component is Camera => component instanceof Camera);
        expect(camera).toBeDefined();
        const animator = new PropertyAnimator();
        for (const channel of result.channels ?? []) animator.addChannel(channel);

        for (let step = 0; step < 8; step++) {
            animator.evaluateAt(4000 * step / 8, result.scene);
            result.scene.forEach(component => component.updateMatrices());
            const forwardPaths = new ForwardTracer(result.scene).trace(createSourceRays(result.scene, 36, 'full'));
            const beamSegments = new BeamField().propagate(forwardPaths, result.scene);
            const render = new ReverseTracer(result.scene, beamSegments).render(camera!, 16);
            const litPixels = Array.from(render.emissionImage).filter(value => value > 0).length;

            expect(render.paths.length).toBeGreaterThan(0);
            expect(litPixels).toBeGreaterThan(0);
        }
    });

    test('L3 and L4 stay centered on the scanned excitation bundle', () => {
        const result = createObliquePlaneMicroscopeScene();
        const l3 = result.scene.find((component): component is AchromatDoublet =>
            component instanceof AchromatDoublet && component.name === 'L3 Achromat (f=150)',
        );
        const l4 = result.scene.find((component): component is AchromatDoublet =>
            component instanceof AchromatDoublet && component.name === 'L4 Achromat (f=100)',
        );
        const excitationScanMirror = result.scene.find((component): component is Mirror =>
            component instanceof Mirror && component.name === 'M2 Steering Mirror',
        );
        const channel = result.channels?.find(ch => ch.targetId === excitationScanMirror?.id && ch.property === 'panAngle');
        expect(l3).toBeDefined();
        expect(l4).toBeDefined();
        expect(excitationScanMirror).toBeDefined();
        expect(channel).toBeDefined();

        for (const panAngle of [channel!.from, channel!.restoreValue ?? excitationScanMirror!.panAngle, channel!.to]) {
            excitationScanMirror!.panAngle = panAngle;
            excitationScanMirror!.recomputeRotation();
            result.scene.forEach(component => component.updateMatrices());

            const paths = new ForwardTracer(result.scene).trace(createSourceRays(result.scene, 200, 'full'));
            let maxL3PlaneRadius = 0;
            let maxL4PlaneRadius = 0;
            let measuredL3Rays = 0;
            let measuredL4Rays = 0;

            for (const path of paths) {
                for (let i = 0; i < path.length - 1; i++) {
                    if (path[i].interactionComponentId === excitationScanMirror!.id) {
                        const afterMirror = path[i + 1];
                        const origin = afterMirror.origin.clone().applyMatrix4(l3!.worldToLocal);
                        const direction = afterMirror.direction.clone().transformDirection(l3!.worldToLocal).normalize();
                        if (Math.abs(direction.z) < 1e-9) continue;
                        const t = -origin.z / direction.z;
                        if (t <= 0) continue;
                        const l3PlanePoint = origin.addScaledVector(direction, t);
                        maxL3PlaneRadius = Math.max(maxL3PlaneRadius, Math.hypot(l3PlanePoint.x, l3PlanePoint.y));
                        measuredL3Rays++;
                    }
                    if (path[i].interactionComponentId === l3!.id) {
                        const afterL3 = path[i + 1];
                        const origin = afterL3.origin.clone().applyMatrix4(l4!.worldToLocal);
                        const direction = afterL3.direction.clone().transformDirection(l4!.worldToLocal).normalize();
                        if (Math.abs(direction.z) < 1e-9) continue;
                        const t = -origin.z / direction.z;
                        if (t <= 0) continue;
                        const l4PlanePoint = origin.addScaledVector(direction, t);
                        maxL4PlaneRadius = Math.max(maxL4PlaneRadius, Math.hypot(l4PlanePoint.x, l4PlanePoint.y));
                        measuredL4Rays++;
                    }
                }
            }

            expect(measuredL3Rays).toBeGreaterThan(150);
            expect(measuredL4Rays).toBeGreaterThan(150);
            expect(l3!.apertureRadius).toBeCloseTo(12.5, 6);
            expect(l4!.apertureRadius).toBeCloseTo(12.5, 6);
            expect(maxL3PlaneRadius).toBeLessThan(5);
            expect(maxL4PlaneRadius).toBeLessThan(5);
        }
    });
});
