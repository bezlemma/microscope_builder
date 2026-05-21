import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { applyCatalogPartToComponent, findCatalogPart } from '../../catalog/catalog';
import { getBuiltinZbbEzPackage } from '../../catalog/zbbEzCatalog';
import { Objective } from '../components/Objective';
import { Coherence, type Ray } from '../types';

function makeLocalRay(origin: Vector3, direction: Vector3): Ray {
    return {
        origin,
        direction: direction.clone().normalize(),
        wavelength: 532e-9,
        intensity: 1,
        polarization: {
            x: { re: 1, im: 0 },
            y: { re: 0, im: 0 },
            z: { re: 0, im: 0 },
        },
        opticalPathLength: 0,
        footprintRadius: 0.01,
        coherenceMode: Coherence.Incoherent,
    };
}

describe('ZBBez objective packages', () => {
    test('registers AMS-AGY v1 with forward and reverse black-box sources', () => {
        const zbbEz = getBuiltinZbbEzPackage('asi:54-10-5');
        expect(zbbEz).not.toBeNull();
        expect(zbbEz?.format).toBe('ZBBez');
        expect(zbbEz?.status).toBe('analytic-surrogate');
        expect(zbbEz?.directions.forward.wrapperFileName).toBe('54-10-5@450-700nm-tpf_BB.ZMX');
        expect(zbbEz?.directions.forward.blackBoxFileName).toBe('SOCC.ZBB');
        expect(zbbEz?.directions.reverse.wrapperFileName).toBe('54-10-5@450-700nm-tpf (Rev)_BB.ZMX');
        expect(zbbEz?.directions.reverse.blackBoxFileName).toBe('Rev V.10.ZBB');
        expect(zbbEz?.snoutEnvelope?.blackBoxLength).toBeCloseTo(25.322594113995482, 9);
    });

    test('registers Thorlabs TL10X-2P with forward and reverse archive sources', () => {
        const zbbEz = getBuiltinZbbEzPackage('thorlabs:TL10X-2P');
        expect(zbbEz).not.toBeNull();
        expect(zbbEz?.format).toBe('ZBBez');
        expect(zbbEz?.directions.forward.archiveUrl).toContain('ttn142896-s02.zar');
        expect(zbbEz?.directions.reverse.archiveUrl).toContain('ttn142896-s04.zar');
        expect(zbbEz?.directions.forward.transfer.focalLengthMm).toBeCloseTo(20, 6);
        expect(zbbEz?.directions.reverse.transfer.numericalAperture).toBeCloseTo(0.5, 6);
    });

    test('Thorlabs objective rays use the ZBBez forward and reverse transfer records', () => {
        const part = findCatalogPart('thorlabs:TL10X-2P');
        expect(part).not.toBeNull();

        const objective = new Objective();
        expect(applyCatalogPartToComponent(objective, part!)).toBe(true);
        objective.updateMatrices();

        const forwardRay = makeLocalRay(new Vector3(0, 0, -40), new Vector3(0, 0, 1));
        const forwardHit = objective.intersect(forwardRay);
        expect(forwardHit).not.toBeNull();
        const forwardResult = objective.interact(forwardRay, forwardHit!);
        expect(forwardResult.rays).toHaveLength(1);
        expect(forwardResult.rays[0].exitSurfaceId).toBe('TL10X-2P:zbbez:forward');
        expect(forwardResult.rays[0].direction.z).toBeGreaterThan(0.99);

        const reverseRay = makeLocalRay(new Vector3(0, 0, 40), new Vector3(0, 0, -1));
        const reverseHit = objective.intersect(reverseRay);
        expect(reverseHit).not.toBeNull();
        const reverseResult = objective.interact(reverseRay, reverseHit!);
        expect(reverseResult.rays).toHaveLength(1);
        expect(reverseResult.rays[0].exitSurfaceId).toBe('TL10X-2P:zbbez:reverse');
        expect(reverseResult.rays[0].direction.z).toBeLessThan(-0.99);
    });
});
