import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { createOpticalTrapScene } from '../../presets/opticalTrap';
import { ForwardTracer } from '../ForwardTracer';
import { createSourceRays } from '../SourceRayFactory';
import { Laser } from '../components/Laser';
import { Objective } from '../components/Objective';
import { MediumVolume } from '../components/MediumVolume';
import { QPD } from '../components/QPD';
import { TrappedBead } from '../components/TrappedBead';
import { Sample } from '../components/Sample';
import { Camera } from '../components/Camera';
import { Lamp } from '../components/Lamp';
import { Aperture } from '../components/Aperture';
import { Blocker } from '../components/Blocker';
import { traceStableTableOverlay } from '../tableTrace';
import type { Ray } from '../types';

function findComponent<T>(scene: unknown[], ctor: new (...args: any[]) => T): T {
    const component = scene.find(c => c instanceof ctor);
    expect(component).toBeDefined();
    return component as T;
}

function localForceFromWorld(bead: TrappedBead, worldForce: Vector3): Vector3 {
    bead.updateMatrices();
    const local = worldForce.clone().transformDirection(bead.worldToLocal);
    const magnitude = worldForce.length();
    if (magnitude > 0) local.multiplyScalar(magnitude);
    return local;
}

function traceTrap(offset: [number, number, number]) {
    const scene = createOpticalTrapScene();
    const bead = findComponent(scene, TrappedBead);
    bead.specimenOffset.set(...offset);
    const solver = new ForwardTracer(scene);
    const result = solver.traceWithBeamSegments(createSourceRays(scene, 144, 'full'));
    bead.accumulateGradientTrapForce(result.beamSegments);
    return { scene, bead, paths: result.paths, beamSegments: result.beamSegments };
}

function componentName(scene: unknown[], id: string | undefined): string | null {
    if (!id) return null;
    return (scene.find(c => (c as { id?: string }).id === id) as { name?: string } | undefined)?.name ?? null;
}

function visibleInteractionSequence(scene: unknown[], path: Ray[]): string[] {
    const names: string[] = [];
    for (const ray of path) {
        if (ray.suppressVisualization) break;
        const name = componentName(scene, ray.interactionComponentId);
        if (name) names.push(name);
    }
    return names;
}

function visiblePointSignature(path: Ray[]): string {
    const points: string[] = [];
    const pushPoint = (p: Vector3) => points.push(`${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`);
    for (const ray of path) {
        if (ray.entryPoint) pushPoint(ray.entryPoint);
        if (ray.internalPath) {
            for (const p of ray.internalPath) pushPoint(p);
        }
        pushPoint(ray.origin);
        if (ray.suppressVisualization) break;
    }
    return points.join('|');
}

function visibleNonDumpGeometry(scene: unknown[], paths: Ray[][], dumpName: string): string[] {
    return paths
        .filter(path => !visibleInteractionSequence(scene, path).includes(dumpName))
        .map(path => visiblePointSignature(path))
        .sort();
}

function visibleHitCount(scene: unknown[], paths: Ray[][], name: string): number {
    let count = 0;
    for (const path of paths) {
        for (const ray of path) {
            if (ray.suppressVisualization) break;
            if (componentName(scene, ray.interactionComponentId) === name) {
                count++;
                break;
            }
        }
    }
    return count;
}

describe('Optical Trap preset', () => {
    test('opens as a trap and QPD demo, not an auto-rendering camera scene', () => {
        const scene = createOpticalTrapScene();

        expect(scene.some(c => c instanceof Camera)).toBe(false);
        expect(scene.some(c => c instanceof Lamp)).toBe(false);
        expect(scene.some(c => c.name.includes('Back Pupil Tube'))).toBe(true);
        expect(scene.some(c => c.name.includes('QPD Beam Dump'))).toBe(false);
        expect(scene.some(c => c instanceof MediumVolume)).toBe(false);
        expect(scene.some(c => c.name === 'Flow Cell Water')).toBe(false);
    });

    test('routes the trapping laser through the objective before the trapped colloid', () => {
        const scene = createOpticalTrapScene();
        const laser = findComponent(scene, Laser);
        const solver = new ForwardTracer(scene);
        const paths = solver.trace(createSourceRays(scene, 16, 'full'));
        const mainPath = paths.find(path => {
            if (path[0]?.sourceId !== laser.id || !path[0]?.isMainRay) return false;
            const names = path
                .map(ray => scene.find(c => c.id === ray.interactionComponentId)?.name)
                .filter((name): name is string => Boolean(name));
            return names.some(name => name.includes('60x/1.4'));
        });
        expect(mainPath).toBeDefined();

        const names = mainPath!
            .map(ray => scene.find(c => c.id === ray.interactionComponentId)?.name)
            .filter((name): name is string => Boolean(name));
        const dm1Index = names.indexOf('DM1');
        const objectiveIndex = names.findIndex(name => name.includes('60x/1.4'));
        const beadIndex = names.indexOf('Trapped Colloid');

        expect(dm1Index).toBeGreaterThanOrEqual(0);
        expect(objectiveIndex).toBeGreaterThan(dm1Index);
        expect(beadIndex).toBeGreaterThan(objectiveIndex);

        const objective = findComponent(scene, Objective);
        const chamber = scene.find((c): c is Sample => c instanceof Sample && c.name === 'Trap Flow Cell')!;
        expect(chamber.flowCellDepth).toBeLessThan(objective.workingDistance * 2.1);
    });

    test('uses a micron-scale bead inside a colloid flow-cell sample holder', () => {
        const scene = createOpticalTrapScene();
        const flowCell = scene.find((c): c is Sample => c instanceof Sample && c.name === 'Trap Flow Cell');
        const bead = findComponent(scene, TrappedBead);

        expect(flowCell).toBeDefined();
        expect(flowCell!.specimenKind).toBe('colloids');
        expect(flowCell!.colloidSpheres).toHaveLength(640);
        expect(flowCell!.colloidSpheres[0]!.center.length()).toBeCloseTo(0, 12);
        expect(flowCell!.flowCellWidth).toBeCloseTo(8, 6);
        expect(flowCell!.flowCellHeight).toBeCloseTo(4, 6);
        expect(flowCell!.flowCellDepth).toBeCloseTo(0.0075, 6);
        expect(bead.diameter).toBeLessThanOrEqual(0.01);
        expect(bead.isSubComponent).toBe(true);
        expect(bead.parentSampleId).toBe(flowCell!.id);
        expect(bead.visualGlowRadius).toBeLessThanOrEqual(0.015);
        expect(bead.confinementHalfSize?.z).toBeCloseTo(flowCell!.flowCellDepth / 2, 6);
    });

    test('uses physical tube stops instead of decorative flat baffles', () => {
        const scene = createOpticalTrapScene();
        const apertures = new Map(
            scene.filter((c): c is Aperture => c instanceof Aperture).map(c => [c.name, c]),
        );

        expect(apertures.has('L1 Mount Stop')).toBe(false);
        expect(apertures.has('L1 Collimator Mount Stop')).toBe(false);
        expect(apertures.has('Condenser Mount Stop')).toBe(false);
        expect(apertures.has('Flow Cell Exit Iris')).toBe(false);
        expect(apertures.has('Objective Return Baffle')).toBe(false);
        expect(apertures.has('Flow Cell Scatter Baffle')).toBe(false);

        const tubeNames = ['Back Pupil Tube', 'Condenser Collection Tube'];
        for (const name of tubeNames) {
            const tube = apertures.get(name);
            expect(tube).toBeDefined();
            expect(tube!.openingDiameter).toBeLessThan(tube!.housingDiameter);
            expect(tube!.thickness).toBeGreaterThan(1);
        }
        for (const aperture of apertures.values()) {
            expect(aperture.housingDiameter).toBeLessThanOrEqual(50);
        }
    });

    test('dump hardware only exists where rays should actually terminate', () => {
        const scene = createOpticalTrapScene();
        const dm2Dump = scene.find((c): c is Blocker => c instanceof Blocker && c.name === 'DM2 Transmitted IR Dump');
        const qpd = findComponent(scene, QPD);

        expect(scene.some(c => c.name === 'Return Beam Dump')).toBe(false);
        expect(scene.some(c => c.name === 'QPD Beam Dump')).toBe(false);
        expect(dm2Dump).toBeDefined();
        expect(dm2Dump!.thickness).toBeLessThanOrEqual(4);
        expect(qpd.backstopTransmission).toBe(0);

        const solver = new ForwardTracer(scene);
        const paths = solver.trace(createSourceRays(scene, 72, 'full'));
        const hitNames = new Set(
            paths.flatMap(path =>
                path
                    .map(ray => scene.find(c => c.id === ray.interactionComponentId)?.name)
                    .filter((name): name is string => Boolean(name)),
            ),
        );

        expect(hitNames.has('Beam Dump')).toBe(true);
        expect(hitNames.has('DM2 Transmitted IR Dump')).toBe(true);
        expect(hitNames.has('QPD')).toBe(true);
    });

    test('does not leave visually significant trap rays escaping across the table', () => {
        const scene = createOpticalTrapScene();
        const laser = findComponent(scene, Laser);
        const solver = new ForwardTracer(scene);
        const paths = solver.trace(createSourceRays(scene, 72, 'full'));

        const escaping = paths.filter(path => {
            if (path.some(ray => ray.suppressVisualization)) return false;
            if (path[0]?.sourceId !== laser.id) return false;
            const last = path[path.length - 1];
            if (!last || last.interactionComponentId || last.terminationPoint) return false;
            const relativeIntensity = last.intensity / Math.max(path[0].intensity, 1e-12);
            return relativeIntensity >= 0.03;
        });

        expect(escaping).toHaveLength(0);
    });

    test('suppresses microscopic bead surface glints from the table ray overlay', () => {
        const scene = createOpticalTrapScene();
        const laser = findComponent(scene, Laser);
        const bead = findComponent(scene, TrappedBead);
        const solver = new ForwardTracer(scene);
        const paths = solver.trace(createSourceRays(scene, 72, 'full'));

        const hiddenBeadBranches = paths.filter(path =>
            path[0]?.sourceId === laser.id && path.some(ray => ray.suppressVisualization),
        );

        expect(hiddenBeadBranches.length).toBeGreaterThan(0);
        for (const path of hiddenBeadBranches) {
            const beadChildIndex = path.findIndex((_, index) =>
                index > 0 && path[index - 1]?.interactionComponentId === bead.id,
            );
            expect(beadChildIndex).toBeGreaterThan(0);
            expect(path[beadChildIndex]!.suppressVisualization).toBe(true);
        }
    });

    test('visible trap beam keeps a central post-bead branch while hiding off-axis bead fan rays', () => {
        const scene = createOpticalTrapScene();
        const laser = findComponent(scene, Laser);
        const bead = findComponent(scene, TrappedBead);
        const solver = new ForwardTracer(scene);
        const paths = solver.trace(createSourceRays(scene, 72, 'full'));

        const visibleMainAfterBead = paths.some(path => {
            if (path[0]?.sourceId !== laser.id || !path[0]?.isMainRay) return false;
            const beadIndex = path.findIndex(ray => ray.interactionComponentId === bead.id);
            if (beadIndex < 0) return false;
            return path.slice(beadIndex + 1).some(ray => !ray.suppressVisualization);
        });

        const hiddenOffAxisAfterBead = paths.some(path => {
            if (path[0]?.sourceId !== laser.id || path[0]?.isMainRay) return false;
            const beadIndex = path.findIndex(ray => ray.interactionComponentId === bead.id);
            if (beadIndex < 0) return false;
            return path.slice(beadIndex + 1).some(ray => ray.suppressVisualization);
        });

        expect(visibleMainAfterBead).toBe(true);
        expect(hiddenOffAxisAfterBead).toBe(true);
    });

    test('off-axis bead branches suppress open tails without hiding collected dump rays', () => {
        const scene = createOpticalTrapScene();
        const laser = findComponent(scene, Laser);
        const bead = findComponent(scene, TrappedBead);
        const solver = new ForwardTracer(scene);
        const paths = solver.trace(createSourceRays(scene, 144, 'full'));

        expect(visibleHitCount(scene, paths, 'DM2 Transmitted IR Dump')).toBeGreaterThan(20);

        const suppressedOpenTailBranches = paths.filter(path => {
            if (path[0]?.sourceId !== laser.id || path[0]?.isMainRay) return false;
            if (!path.some(ray => ray.interactionComponentId === bead.id)) return false;
            return path.some(ray => ray.suppressOpenTail);
        });

        expect(suppressedOpenTailBranches.length).toBeGreaterThan(0);
    });

    test('tiny drag of the transmitted IR dump keeps the collected beam visibly hitting it', () => {
        const scene = createOpticalTrapScene();
        const dump = scene.find((c): c is Blocker => c instanceof Blocker && c.name === 'DM2 Transmitted IR Dump');
        expect(dump).toBeDefined();

        const beforePaths = new ForwardTracer(scene).trace(createSourceRays(scene, 144, 'full'));
        const beforeHits = visibleHitCount(scene, beforePaths, dump!.name);

        dump!.position.y += 0.2;
        dump!.version++;

        const afterPaths = new ForwardTracer(scene).trace(createSourceRays(scene, 144, 'full'));
        const afterHits = visibleHitCount(scene, afterPaths, dump!.name);

        expect(beforeHits).toBeGreaterThan(20);
        expect(afterHits).toBeGreaterThan(20);
        expect(Math.abs(afterHits - beforeHits)).toBeLessThanOrEqual(
            Math.max(2, Math.ceil(beforeHits * 0.1)),
        );
    });

    test('tiny drag of the transmitted IR dump does not change upstream visible beam geometry', () => {
        const scene = createOpticalTrapScene();
        const dump = scene.find((c): c is Blocker => c instanceof Blocker && c.name === 'DM2 Transmitted IR Dump');
        expect(dump).toBeDefined();

        const beforePaths = new ForwardTracer(scene).trace(createSourceRays(scene, 72, 'full'));
        const before = visibleNonDumpGeometry(scene, beforePaths, dump!.name);

        dump!.position.y += 0.2;
        dump!.version++;

        const afterPaths = new ForwardTracer(scene).trace(createSourceRays(scene, 72, 'full'));
        const after = visibleNonDumpGeometry(scene, afterPaths, dump!.name);

        expect(after).toEqual(before);
    });

    test('moving an off-beam transmitted IR dump laterally does not change visible beam geometry', () => {
        const scene = createOpticalTrapScene();
        const dump = scene.find((c): c is Blocker => c instanceof Blocker && c.name === 'DM2 Transmitted IR Dump');
        expect(dump).toBeDefined();

        dump!.position.y += 45;
        dump!.version++;

        const beforePaths = new ForwardTracer(scene).trace(createSourceRays(scene, 144, 'full'));
        expect(visibleHitCount(scene, beforePaths, dump!.name)).toBe(0);
        const before = visibleNonDumpGeometry(scene, beforePaths, dump!.name);

        dump!.position.x -= 20;
        dump!.version++;
        const afterLeftPaths = new ForwardTracer(scene).trace(createSourceRays(scene, 144, 'full'));
        const afterLeft = visibleNonDumpGeometry(scene, afterLeftPaths, dump!.name);

        dump!.position.x += 40;
        dump!.version++;
        const afterRightPaths = new ForwardTracer(scene).trace(createSourceRays(scene, 144, 'full'));
        const afterRight = visibleNonDumpGeometry(scene, afterRightPaths, dump!.name);

        expect(visibleHitCount(scene, afterLeftPaths, dump!.name)).toBe(0);
        expect(visibleHitCount(scene, afterRightPaths, dump!.name)).toBe(0);
        expect(afterLeft).toEqual(before);
        expect(afterRight).toEqual(before);
    });

    test('drag pause prevents stochastic specimen motion from catching up on release', () => {
        const scene = createOpticalTrapScene();
        const sample = scene.find((c): c is Sample => c instanceof Sample && c.name === 'Trap Flow Cell');
        const bead = findComponent(scene, TrappedBead);
        expect(sample).toBeDefined();

        sample!.stepColloidDiffusion(0);
        bead.applyForceStep(0);

        const colloidBefore = sample!.colloidSpheres.map(s => s.center.clone());
        const beadBefore = bead.specimenOffset.clone();

        sample!.pauseColloidDiffusion();
        bead.pauseIntegrator();
        sample!.stepColloidDiffusion(10_000);
        bead.applyForceStep(10_000);

        for (let i = 0; i < colloidBefore.length; i++) {
            expect(sample!.colloidSpheres[i]!.center.distanceToSquared(colloidBefore[i]!)).toBe(0);
        }
        expect(bead.specimenOffset.distanceToSquared(beadBefore)).toBe(0);
    });

    test('stable table trace ignores dynamic bead offsets when an off-beam dump moves', () => {
        const scene = createOpticalTrapScene();
        const bead = findComponent(scene, TrappedBead);
        const dump = scene.find((c): c is Blocker => c instanceof Blocker && c.name === 'DM2 Transmitted IR Dump');
        expect(dump).toBeDefined();

        dump!.position.y += 45;
        dump!.version++;
        bead.specimenOffset.set(0.004, -0.003, 0.001);

        const trace = () => traceStableTableOverlay(
            scene,
            () => new ForwardTracer(scene).trace(createSourceRays(scene, 144, 'full')),
        );

        const beforePaths = trace();
        expect(visibleHitCount(scene, beforePaths, dump!.name)).toBe(0);
        const before = visibleNonDumpGeometry(scene, beforePaths, dump!.name);
        expect(bead.specimenOffset.x).toBeCloseTo(0.004, 12);

        bead.specimenOffset.set(-0.006, 0.002, -0.001);
        dump!.position.x += 30;
        dump!.version++;

        const afterPaths = trace();
        const after = visibleNonDumpGeometry(scene, afterPaths, dump!.name);
        expect(visibleHitCount(scene, afterPaths, dump!.name)).toBe(0);
        expect(after).toEqual(before);
        expect(bead.specimenOffset.x).toBeCloseTo(-0.006, 12);
    });

    test('stable table trace preserves live detector and bead accumulator state', () => {
        const scene = createOpticalTrapScene();
        const bead = findComponent(scene, TrappedBead);
        const qpd = findComponent(scene, QPD);
        bead.specimenOffset.set(0.004, -0.003, 0.001);
        bead.forceAccumulator.set(1, 2, 3);
        bead.hitsThisFrame = 4;
        qpd.quadrants = [1, 2, 3, 4];
        qpd.quadrantHits = [5, 6, 7, 8];
        qpd.totalHits = 26;
        qpd.gapPower = 0.25;
        qpd.blockedPower = 0.5;
        qpd.blockedHits = 2;
        qpd.momentX = 1.2;
        qpd.momentY = -0.8;
        qpd.momentXX = 0.4;
        qpd.momentYY = 0.6;

        traceStableTableOverlay(
            scene,
            () => new ForwardTracer(scene).trace(createSourceRays(scene, 144, 'full')),
        );

        expect(bead.specimenOffset.toArray()).toEqual([0.004, -0.003, 0.001]);
        expect(bead.forceAccumulator.toArray()).toEqual([1, 2, 3]);
        expect(bead.hitsThisFrame).toBe(4);
        expect(qpd.quadrants).toEqual([1, 2, 3, 4]);
        expect(qpd.quadrantHits).toEqual([5, 6, 7, 8]);
        expect(qpd.totalHits).toBe(26);
        expect(qpd.gapPower).toBe(0.25);
        expect(qpd.blockedPower).toBe(0.5);
        expect(qpd.blockedHits).toBe(2);
        expect(qpd.momentX).toBe(1.2);
        expect(qpd.momentY).toBe(-0.8);
        expect(qpd.momentXX).toBe(0.4);
        expect(qpd.momentYY).toBe(0.6);
    });

    test('forward traces reset QPD accumulators instead of accumulating history', () => {
        const scene = createOpticalTrapScene();
        const qpd = findComponent(scene, QPD);

        new ForwardTracer(scene).trace(createSourceRays(scene, 144, 'full'));
        const firstHits = qpd.totalHits;
        const firstSignal = qpd.signalSum;

        new ForwardTracer(scene).trace(createSourceRays(scene, 144, 'full'));

        expect(firstHits).toBeGreaterThan(0);
        expect(qpd.totalHits).toBe(firstHits);
        expect(qpd.signalSum).toBeCloseTo(firstSignal, 12);
    });

    test('live trace after stable overlay restores displaced bead ray momentum', () => {
        const scene = createOpticalTrapScene();
        const bead = findComponent(scene, TrappedBead);
        bead.specimenOffset.set(0, 0, 0.005);

        traceStableTableOverlay(
            scene,
            () => new ForwardTracer(scene).trace(createSourceRays(scene, 144, 'full')),
        );
        expect(bead.forceAccumulator.length()).toBe(0);

        new ForwardTracer(scene).trace(createSourceRays(scene, 144, 'full'));

        expect(bead.forceAccumulator.length()).toBeGreaterThan(0);
    });

    test('keeps the trapped bead inside the flow cell bounds', () => {
        const scene = createOpticalTrapScene();
        const bead = findComponent(scene, TrappedBead);
        expect(bead.confinementHalfSize).toBeDefined();
        bead.temperatureK = 0;
        bead.displayScale = 1000;

        bead.specimenOffset.set(100, -100, 100);
        expect(bead.applyForceStep(0)).toBe(true);
        let limit = bead.getConfinementLimit()!;
        expect(Math.abs(bead.specimenOffset.x)).toBeLessThanOrEqual(limit.x);
        expect(Math.abs(bead.specimenOffset.y)).toBeLessThanOrEqual(limit.y);
        expect(Math.abs(bead.specimenOffset.z)).toBeLessThanOrEqual(limit.z);

        bead.forceAccumulator.set(1000, -1000, 1000);
        bead.applyForceStep(100);

        limit = bead.getConfinementLimit()!;
        expect(Math.abs(bead.specimenOffset.x)).toBeLessThanOrEqual(limit.x);
        expect(Math.abs(bead.specimenOffset.y)).toBeLessThanOrEqual(limit.y);
        expect(Math.abs(bead.specimenOffset.z)).toBeLessThanOrEqual(limit.z);
    });

    test('dynamic bead motion does not invalidate the whole optical layout', () => {
        const { bead, beamSegments } = traceTrap([0.01, 0, -0.018]);
        const version = bead.version;

        bead.applyForceStep(0);
        bead.accumulateGradientTrapForce(beamSegments);
        bead.applyForceStep(16);

        expect(bead.version).toBe(version);
    });

    test('produces a live QPD signal from the forward scattered trap beam', () => {
        const { scene } = traceTrap([0, 0, -0.018]);
        const qpd = findComponent(scene, QPD);

        expect(qpd.totalHits).toBeGreaterThan(20);
        expect(qpd.signalSum).toBeGreaterThan(1);
    });

    test('gradient force pulls a displaced bead back toward the focus laterally', () => {
        const plusX = traceTrap([0.01, 0, 0]);
        const minusX = traceTrap([-0.01, 0, 0]);
        const plusY = traceTrap([0, 0.01, 0]);
        const minusY = traceTrap([0, -0.01, 0]);

        expect(localForceFromWorld(plusX.bead, plusX.bead.forceAccumulator).x).toBeLessThan(0);
        expect(localForceFromWorld(minusX.bead, minusX.bead.forceAccumulator).x).toBeGreaterThan(0);
        expect(localForceFromWorld(plusY.bead, plusY.bead.forceAccumulator).y).toBeLessThan(0);
        expect(localForceFromWorld(minusY.bead, minusY.bead.forceAccumulator).y).toBeGreaterThan(0);
    });

    test('gradient trap has a finite capture range', () => {
        const near = traceTrap([0.01, 0, 0]);
        const far = traceTrap([0.12, 0, 0]);

        expect(localForceFromWorld(near.bead, near.bead.forceAccumulator).length()).toBeGreaterThan(0);
        expect(localForceFromWorld(far.bead, far.bead.forceAccumulator).length()).toBeLessThan(1e-12);
    });

    test('passive colloids inside the trap volume are held by the sample trap zone', () => {
        const sample = new Sample('Colloid trap sample').configureColloidFlowCell({
            count: 1,
            radius: 0.0025,
            width: 1,
            height: 1,
            depth: 0.02,
            temperatureK: 0,
            diffusionScale: 0,
        });
        sample.colloidSpheres[0]!.center.set(0.012, 0, 0);

        sample.stepColloidDiffusion(0, [{ center: new Vector3(0, 0, 0), lateralRadius: 0.018, axialRange: 0.006 }]);
        sample.stepColloidDiffusion(100, [{ center: new Vector3(0, 0, 0), lateralRadius: 0.018, axialRange: 0.006 }]);

        expect(sample.colloidSpheres[0]!.center.x).toBeLessThan(0.012);
        expect(sample.colloidSpheres[0]!.center.x).toBeGreaterThanOrEqual(0);
    });

    test('force integration does not snap the bead across the trap center', () => {
        const bead = new TrappedBead(0.005, 1.59, 1.33, 'Trap stability bead');
        bead.temperatureK = 0;
        bead.thermalMotionScale = 0;
        bead.displayScale = 100000;
        bead.specimenOffset.set(0.004, 0, 0);

        bead.applyForceStep(0);
        bead.forceAccumulator.set(-1000, 0, 0);
        const before = bead.specimenOffset.clone();
        bead.applyForceStep(16);

        const moved = bead.specimenOffset.distanceTo(before);
        expect(moved).toBeLessThanOrEqual(bead.radius * 0.35 + 1e-9);
        expect(bead.specimenOffset.x).toBeGreaterThan(0);
    });

    test('initial condenser-side bead displacement is pulled toward the objective focus', () => {
        const { bead } = traceTrap([0, 0, 0.001]);
        const localForce = localForceFromWorld(bead, bead.forceAccumulator);

        expect(localForce.z).toBeLessThan(0);
    });
});
