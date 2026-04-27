import { describe, expect, test } from 'bun:test';
import { ConeSource3D } from '../components/ConeSource3D';
import { Lamp } from '../components/Lamp';
import { Laser } from '../components/Laser';
import { PointSource2D } from '../components/PointSource2D';
import { PointSource3D } from '../components/PointSource3D';
import { StructuredSource } from '../components/StructuredSource';
import { WedgeSource2D } from '../components/WedgeSource2D';
import { Solver1 } from '../Solver1';
import { createSourceRays } from '../SourceRayFactory';

function totalIntensityFor(component: { id: string }, rayCount: number): number {
    return createSourceRays([component as any], rayCount, 'full')
        .reduce((sum, ray) => sum + ray.intensity, 0);
}

describe('SourceRayFactory', () => {
    test('conserves point and angular source power including the main ray', () => {
        const sources = [
            new PointSource2D('Point 2D'),
            new PointSource3D('Point 3D'),
            new ConeSource3D('Cone 3D'),
            new WedgeSource2D('Wedge 2D'),
        ];

        for (const source of sources) {
            source.power = 2.5;
            expect(totalIntensityFor(source, 4)).toBeCloseTo(2.5, 6);
        }
    });

    test('zero-power point source emits zero-intensity rays', () => {
        const source = new PointSource3D('Dark point');
        source.power = 0;
        const rays = createSourceRays([source], 4, 'full');
        expect(rays.length).toBeGreaterThan(0);
        expect(rays.reduce((sum, ray) => sum + ray.intensity, 0)).toBe(0);
    });

    test('off laser emits no source rays while preserving configured power', () => {
        const laser = new Laser('Toggle laser');
        laser.power = 7;
        laser.isOn = false;

        expect(createSourceRays([laser], 8, 'full')).toHaveLength(0);
        expect(laser.power).toBe(7);
    });

    test('conserves lamp power across wavelengths and ray counts', () => {
        const lamp = new Lamp('Broadband lamp');
        lamp.power = 2.5;
        lamp.spectralWavelengths = [500, 600];

        for (const rayCount of [1, 4, 16, 64]) {
            expect(totalIntensityFor(lamp, rayCount)).toBeCloseTo(2.5, 6);
        }
    });

    test('zero-power lamp emits zero-intensity rays', () => {
        const lamp = new Lamp('Dark lamp');
        lamp.power = 0;
        lamp.spectralWavelengths = [500];

        const rays = createSourceRays([lamp], 4, 'full');
        expect(rays.length).toBeGreaterThan(0);
        expect(rays.reduce((sum, ray) => sum + ray.intensity, 0)).toBe(0);
    });

    test('empty lamp spectrum fallback preserves Solver2 beam power', () => {
        const lamp = new Lamp('Fallback lamp');
        lamp.power = 2;
        lamp.spectralWavelengths = [];

        const rays = createSourceRays([lamp], 4, 'full');
        expect(new Set(rays.map(ray => ray.sourceId))).toEqual(new Set([`${lamp.id}_550nm`]));
        expect(rays.reduce((sum, ray) => sum + ray.intensity, 0)).toBeCloseTo(2, 6);

        const beamSegments = new Solver1([lamp]).traceWithBeamSegments(rays).beamSegments;
        const totalBeamPower = beamSegments.reduce((sum, branch) => sum + (branch[0]?.power ?? 0), 0);
        expect(totalBeamPower).toBeCloseTo(2, 6);
    });

    test('lamp center mode honors extended source points without changing total power', () => {
        const lamp = new Lamp('Extended lamp');
        lamp.power = 3;
        lamp.spectralWavelengths = [500];
        lamp.sourcePointCount = 4;
        lamp.emitterRadius = 2;

        const rays = createSourceRays([lamp], 8, 'center');
        const origins = new Set(rays.map(ray => ray.origin.toArray().map(v => v.toFixed(6)).join(',')));

        expect(rays).toHaveLength(4);
        expect(origins.size).toBeGreaterThan(1);
        expect(rays.filter(ray => ray.isMainRay)).toHaveLength(1);
        expect(rays.reduce((sum, ray) => sum + ray.intensity, 0)).toBeCloseTo(3, 6);
    });

    test('structured source preview rays are deterministic when oversampled', () => {
        const source = new StructuredSource('Pattern source');
        source.asciiChar = 'M';
        source.diameter = 8;

        const first = createSourceRays([source], 256, 'full');
        const second = createSourceRays([source], 256, 'full');

        expect(second).toHaveLength(first.length);
        for (let i = 0; i < first.length; i++) {
            expect(second[i].origin.x).toBeCloseTo(first[i].origin.x, 12);
            expect(second[i].origin.y).toBeCloseTo(first[i].origin.y, 12);
            expect(second[i].origin.z).toBeCloseTo(first[i].origin.z, 12);
            expect(second[i].direction.x).toBeCloseTo(first[i].direction.x, 12);
            expect(second[i].direction.y).toBeCloseTo(first[i].direction.y, 12);
            expect(second[i].direction.z).toBeCloseTo(first[i].direction.z, 12);
        }
    });
});
