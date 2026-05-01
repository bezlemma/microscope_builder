import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { ConeSource3D } from '../components/ConeSource3D';
import { Lamp } from '../components/Lamp';
import { Laser } from '../components/Laser';
import { PointSource2D } from '../components/PointSource2D';
import { PointSource3D } from '../components/PointSource3D';
import { StructuredSource } from '../components/StructuredSource';
import { WedgeSource2D } from '../components/WedgeSource2D';
import { Solver1 } from '../Solver1';
import { segmentBeamEnvelopeRadii } from '../Solver2';
import { createSourceRays } from '../SourceRayFactory';
import { Coherence, Ray } from '../types';
import { coherentLaunchSigmaFromCellArea } from '../coherentPacketLaunch';

function totalIntensityFor(component: { id: string }, rayCount: number): number {
    return createSourceRays([component as any], rayCount, 'full')
        .reduce((sum, ray) => sum + ray.intensity, 0);
}

function reconstructedIrradiance(rays: Ray[], sample: Vector3): number {
    return rays.reduce((sum, ray) => {
        const footprint = Math.max(ray.footprintRadius ?? 0, 1e-9);
        const offset = sample.clone().sub(ray.origin);
        const longitudinal = offset.dot(ray.direction);
        offset.addScaledVector(ray.direction, -longitudinal);
        const q = offset.lengthSq() / (footprint * footprint);
        return sum + ray.intensity * Math.exp(-2 * q) * 2 / (Math.PI * footprint * footprint);
    }, 0);
}

function radialGaussianProfileError(rayCount: number): number {
    const laser = new Laser('Gaussian laser');
    laser.power = 1;
    laser.beamRadius = 2;

    const rays = createSourceRays([laser], rayCount, 'full');
    const center = rays[0].origin.clone();
    const direction = rays[0].direction.clone().normalize();
    const upSeed = Math.abs(direction.dot(new Vector3(0, 1, 0))) > 0.9
        ? new Vector3(0, 0, 1)
        : new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(direction, upSeed).normalize();
    const up = new Vector3().crossVectors(right, direction).normalize();
    const peak = 2 * laser.power / (Math.PI * laser.beamRadius * laser.beamRadius);
    const radii = [0, 0.25, 0.5, 0.75, 1, 1.25].map(fraction => fraction * laser.beamRadius);
    const angularSamples = 48;
    let squaredError = 0;
    let samples = 0;

    for (const radius of radii) {
        const expected = Math.exp(-2 * radius * radius / (laser.beamRadius * laser.beamRadius));
        for (let i = 0; i < angularSamples; i++) {
            const angle = 2 * Math.PI * i / angularSamples;
            const sample = center.clone()
                .addScaledVector(right, Math.cos(angle) * radius)
                .addScaledVector(up, Math.sin(angle) * radius);
            const actual = reconstructedIrradiance(rays, sample) / peak;
            squaredError += (actual - expected) ** 2;
            samples++;
        }
    }

    return Math.sqrt(squaredError / samples);
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

    test('Solver2 segments keep whole laser envelope separate from beamlet footprints', () => {
        const laser = new Laser('Wide laser');
        laser.beamRadius = 2;
        laser.pointAlong(1, 0, 0);

        const rays = createSourceRays([laser], 32, 'full');
        const segments = new Solver1([laser]).traceWithBeamSegments(rays).beamSegments
            .map(branch => branch[0])
            .filter(segment => segment !== undefined);

        expect(segments.length).toBeGreaterThan(0);
        const firstSegment = segments[0];
        expect(firstSegment).toBeDefined();
        if (!firstSegment) throw new Error('Expected at least one beam segment');
        const envelope = segmentBeamEnvelopeRadii(firstSegment, 0);
        expect(envelope.wx).toBeGreaterThan(1.7);
        expect(envelope.wx).toBeLessThan(2.2);
        expect(firstSegment.footprintStart ?? 0).toBeGreaterThan(0);
        expect(firstSegment.footprintStart ?? 0).toBeLessThan(0.8);
    });

    test('laser beamlets reconstruct and converge to the configured Gaussian irradiance', () => {
        const coarseError = radialGaussianProfileError(32);
        const fineError = radialGaussianProfileError(512);

        expect(fineError).toBeLessThan(coarseError);
        expect(fineError).toBeLessThan(0.08);
    });

    test('laser Gaussian beamlets conserve power with equal normalized kernels', () => {
        const laser = new Laser('Power laser');
        laser.power = 3;
        laser.beamRadius = 2;

        const rays = createSourceRays([laser], 128, 'full');
        const powers = rays.map(ray => ray.intensity);

        expect(powers.reduce((sum, power) => sum + power, 0)).toBeCloseTo(3, 6);
        expect(Math.min(...powers)).toBeCloseTo(Math.max(...powers), 12);
        expect(rays[0].footprintRadius).toBeGreaterThan(0.6);
        expect(rays[0].footprintRadius).toBeLessThan(laser.beamRadius);
    });

    test('laser launch carries explicit Gaussian Packet metadata', () => {
        const laser = new Laser('Packet laser');
        laser.power = 1.25;
        laser.beamRadius = 1.5;

        const rays = createSourceRays([laser], 48, 'full');
        const totalPower = rays.reduce((sum, ray) => sum + (ray.powerWeight ?? 0), 0);

        expect(totalPower).toBeCloseTo(laser.power, 6);
        expect(rays.length).toBe(49);
        for (const ray of rays) {
            expect(ray.packetStateMode).toBe('explicit');
            expect(ray.packetQ).toBeDefined();
            expect(ray.sourceCellArea ?? 0).toBeGreaterThan(0);
            expect(ray.sigmaU ?? 0).toBeCloseTo(coherentLaunchSigmaFromCellArea(ray.sourceCellArea ?? 0), 9);
            expect(ray.sigmaV ?? 0).toBeCloseTo(coherentLaunchSigmaFromCellArea(ray.sourceCellArea ?? 0), 9);
            expect(Math.abs(ray.majorAxis?.dot(ray.direction) ?? 1)).toBeLessThan(1e-6);
        }
    });

    test('marks Gaussian beam launches as rigorous packet samples', () => {
        const laser = new Laser('Rigorous laser');
        const lamp = new Lamp('Rigorous lamp');
        const structured = new StructuredSource('Rigorous pattern');
        structured.asciiChar = 'A';

        for (const source of [laser, lamp, structured]) {
            const rays = createSourceRays([source], 16, 'full');
            expect(rays.length).toBeGreaterThan(0);
            expect(rays.every(ray => ray.packetLaunchRigor === 'rigorous')).toBe(true);
        }
    });

    test('marks geometric angular sources as packet reconstruction fallbacks', () => {
        const sources = [
            new PointSource2D('Fallback point 2D'),
            new PointSource3D('Fallback point 3D'),
            new ConeSource3D('Fallback cone'),
            new WedgeSource2D('Fallback wedge'),
        ];

        for (const source of sources) {
            const rays = createSourceRays([source], 8, 'full');
            expect(rays.length).toBeGreaterThan(0);
            expect(rays.every(ray => ray.packetLaunchRigor === 'geometricFallback')).toBe(true);
        }
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
        source.beamRadius = 4;

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

    test('structured source beam radius controls emitted pattern size', () => {
        const source = new StructuredSource('Pattern source');
        source.asciiChar = 'M';

        source.beamRadius = 2;
        const small = createSourceRays([source], 256, 'full');
        const smallExtent = Math.max(...small.map(ray => ray.origin.distanceTo(source.position)));

        source.beamRadius = 6;
        const large = createSourceRays([source], 256, 'full');
        const largeExtent = Math.max(...large.map(ray => ray.origin.distanceTo(source.position)));

        expect(smallExtent).toBeGreaterThan(1);
        expect(smallExtent).toBeLessThanOrEqual(2.01);
        expect(largeExtent).toBeGreaterThan(smallExtent * 2.5);
        expect(largeExtent).toBeLessThanOrEqual(6.01);
    });

    test('structured source emits a coherent laser-derived pattern without changing total power', () => {
        const source = new StructuredSource('Pattern source');
        source.asciiChar = 'A';
        source.power = 0.75;

        const rays = createSourceRays([source], 256, 'full');

        expect(rays.length).toBeGreaterThan(0);
        expect(rays.every(ray => ray.coherenceMode === Coherence.Coherent)).toBe(true);
        expect(rays.reduce((sum, ray) => sum + ray.intensity, 0)).toBeCloseTo(0.75, 6);
    });
});
