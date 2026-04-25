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
import { Camera } from '../components/Camera';
import { Lamp } from '../components/Lamp';

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
        expect(scene.some(c => c.name.includes('Back Pupil Stop'))).toBe(true);
        expect(scene.some(c => c.name.includes('QPD Beam Dump'))).toBe(true);
    });

    test('routes the trapping laser through the objective before the sample chamber', () => {
        const scene = createOpticalTrapScene();
        const laser = findComponent(scene, Laser);
        const solver = new Solver1(scene);
        const paths = solver.trace(createSourceRays(scene, 16, 'full'));
        const mainPath = paths.find(path => path[0]?.sourceId === laser.id && path[0]?.isMainRay);
        expect(mainPath).toBeDefined();

        const names = mainPath!
            .map(ray => scene.find(c => c.id === ray.interactionComponentId)?.name)
            .filter((name): name is string => Boolean(name));
        const dm1Index = names.indexOf('DM1');
        const objectiveIndex = names.findIndex(name => name.includes('60x/1.4'));
        const mediumIndex = names.indexOf('Trap Chamber Medium');

        expect(dm1Index).toBeGreaterThanOrEqual(0);
        expect(objectiveIndex).toBeGreaterThan(dm1Index);
        expect(mediumIndex).toBeGreaterThan(objectiveIndex);

        const objective = findComponent(scene, Objective);
        const chamber = findComponent(scene, MediumVolume);
        expect(chamber.depth).toBeLessThan(objective.workingDistance * 2.1);
    });

    test('produces a live QPD signal from the forward scattered trap beam', () => {
        const { scene } = traceTrap([0, 0, -1.5]);
        const qpd = findComponent(scene, QPD);

        expect(qpd.totalHits).toBeGreaterThan(20);
        expect(qpd.signalSum).toBeGreaterThan(1);
    });

    test('gradient force pulls a displaced bead back toward the focus laterally', () => {
        const plusX = traceTrap([1, 0, 0]);
        const minusX = traceTrap([-1, 0, 0]);
        const plusY = traceTrap([0, 1, 0]);
        const minusY = traceTrap([0, -1, 0]);

        expect(localForceFromWorld(plusX.bead, plusX.bead.forceAccumulator).x).toBeLessThan(0);
        expect(localForceFromWorld(minusX.bead, minusX.bead.forceAccumulator).x).toBeGreaterThan(0);
        expect(localForceFromWorld(plusY.bead, plusY.bead.forceAccumulator).y).toBeLessThan(0);
        expect(localForceFromWorld(minusY.bead, minusY.bead.forceAccumulator).y).toBeGreaterThan(0);
    });

    test('initial sample-side bead displacement is pulled toward the objective focus', () => {
        const { bead } = traceTrap([0, 0, -1.5]);
        const localForce = localForceFromWorld(bead, bead.forceAccumulator);

        expect(localForce.z).toBeGreaterThan(0);
    });
});
