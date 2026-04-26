import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { createOpticalTrapScene } from '../../presets/opticalTrap';
import { Solver1 } from '../Solver1';
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
    const solver = new Solver1(scene);
    const result = solver.traceWithBeamSegments(createSourceRays(scene, 144, 'full'));
    bead.accumulateGradientTrapForce(result.beamSegments);
    return { scene, bead, paths: result.paths, beamSegments: result.beamSegments };
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
        const solver = new Solver1(scene);
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
        expect(flowCell!.colloidSpheres).toHaveLength(320);
        expect(flowCell!.flowCellWidth).toBeCloseTo(8, 6);
        expect(flowCell!.flowCellHeight).toBeCloseTo(8, 6);
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

        const solver = new Solver1(scene);
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
        const solver = new Solver1(scene);
        const paths = solver.trace(createSourceRays(scene, 72, 'full'));

        const escaping = paths.filter(path => {
            if (path[0]?.sourceId !== laser.id) return false;
            const last = path[path.length - 1];
            if (!last || last.interactionComponentId || last.terminationPoint) return false;
            const relativeIntensity = last.intensity / Math.max(path[0].intensity, 1e-12);
            return relativeIntensity >= 0.03;
        });

        expect(escaping).toHaveLength(0);
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
