import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { Aperture } from '../components/Aperture';
import { BeamSplitter } from '../components/BeamSplitter';
import { Filter } from '../components/Filter';
import { IdealLens } from '../components/IdealLens';
import { Objective } from '../components/Objective';
import { Waveplate } from '../components/Waveplate';
import { SpectralProfile } from '../SpectralProfile';
import { Solver1 } from '../Solver1';
import { Coherence, createRay, type Ray } from '../types';
import { evaluateZernikeNoll } from '../PupilFunction';

function packetRay(overrides: Partial<Ray> = {}): Ray {
    return createRay({
        origin: new Vector3(0, 0, -10),
        direction: new Vector3(0, 0, 1),
        wavelength: 532e-9,
        intensity: 1,
        powerWeight: 1,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
        opticalPathLength: 0,
        footprintRadius: 0.5,
        coherenceMode: Coherence.Coherent,
        packetQ: {
            uu: { re: 0, im: 1e6 },
            uv: { re: 0, im: 0 },
            vv: { re: 0, im: 1e6 },
        },
        packetStateMode: 'explicit',
        sigmaU: 8,
        sigmaV: 8,
        curvatureRadiusU: Number.POSITIVE_INFINITY,
        curvatureRadiusV: Number.POSITIVE_INFINITY,
        sourceId: 'packet-test',
        sourceKind: 'laser',
        packetLaunchRigor: 'rigorous',
        ...overrides,
    });
}

describe('packet component conformance', () => {
    test('beam splitters scale packet power and conserve split power', () => {
        const splitter = new BeamSplitter(25.4, 2, 0.35, 'Packet splitter');
        const paths = new Solver1([splitter]).trace([packetRay()]);
        const children = paths.map(path => path[1]).filter((ray): ray is Ray => Boolean(ray));

        expect(children).toHaveLength(2);
        expect(children.reduce((sum, ray) => sum + (ray.powerWeight ?? 0), 0)).toBeCloseTo(1, 9);
        const weights = children.map(ray => ray.powerWeight ?? 0).sort((a, b) => a - b);
        expect(weights[0]).toBeCloseTo(0.35, 9);
        expect(weights[1]).toBeCloseTo(0.65, 9);
        for (const child of children) {
            expect(child.packetStateMode).toBe('explicit');
            expect(Math.abs(child.majorAxis!.dot(child.direction))).toBeLessThan(1e-6);
        }
    });

    test('filters scale powerWeight when legacy code only changes intensity', () => {
        const filter = new Filter(
            25.4,
            3,
            new SpectralProfile('longpass', 500, [], 1),
            'Packet filter',
        );
        const paths = new Solver1([filter]).trace([packetRay()]);
        const child = paths[0]?.[1];

        expect(child).toBeDefined();
        expect(child!.intensity).toBeGreaterThan(0.99);
        expect(child!.powerWeight).toBeCloseTo(child!.intensity, 12);
        expect(child!.packetStateMode).toBe('explicit');
    });

    test('polarizers update Jones state and packet power without dropping q-state', () => {
        const polarizer = new Waveplate('polarizer', 12.5, Math.PI / 2, 'Packet polarizer');
        const input = packetRay({
            polarization: {
                x: { re: Math.SQRT1_2, im: 0 },
                y: { re: Math.SQRT1_2, im: 0 },
            },
        });

        const child = new Solver1([polarizer]).trace([input])[0]?.[1];

        expect(child).toBeDefined();
        expect(child!.powerWeight).toBeCloseTo(0.5, 9);
        expect(child!.polarization.x.re).toBeCloseTo(0, 9);
        expect(child!.polarization.y.re).toBeCloseTo(1, 9);
        expect(child!.packetStateMode).toBe('explicit');
        expect(child!.packetQ).toBeDefined();
    });

    test('packet radius does not change geometric aperture intersection', () => {
        const aperture = new Aperture(2, 10, 'Packet-blind aperture');
        const widePacketCenterlinePass = packetRay({
            origin: new Vector3(0.5, 0, -10),
            footprintRadius: 100,
            majorLength: 100,
        });

        const hit = aperture.chkIntersection(widePacketCenterlinePass);
        expect(hit).toBeDefined();
        expect(hit!.isBlocked).toBe(false);
    });

    test('thin lenses focus a collimated packet q-state near the focal distance', () => {
        const lens = new IdealLens(50, 20, 'Packet focus lens');
        const child = new Solver1([lens]).trace([packetRay()])[0]?.[1];

        expect(child).toBeDefined();
        expect(child!.packetQ).toBeDefined();
        const focusDistance = -child!.packetQ!.uu.re;
        expect(focusDistance).toBeGreaterThan(45);
        expect(focusDistance).toBeLessThan(55);
    });

    test('objectives also apply their packet focusing transform', () => {
        const objective = new Objective({
            magnification: 10,
            tubeLensFocal: 200,
            workingDistance: 10,
            NA: 0.25,
            name: 'Packet objective',
        });
        const f = objective.focalLength;
        const child = new Solver1([objective]).trace([packetRay({
            origin: new Vector3(0, 0, -30),
            direction: new Vector3(0, 0, 1),
        })])[0]?.[1];

        expect(child).toBeDefined();
        expect(child!.packetQ).toBeDefined();
        const focusDistance = -child!.packetQ!.uu.re;
        expect(focusDistance).toBeGreaterThan(f * 0.75);
        expect(focusDistance).toBeLessThan(f * 1.25);
    });

    test('objective pupil Zernike coefficients add wavefront OPL', () => {
        const baseObjective = new Objective({
            magnification: 10,
            tubeLensFocal: 200,
            workingDistance: 10,
            NA: 0.25,
            name: 'Base objective',
        });
        const aberratedObjective = new Objective({
            magnification: 10,
            tubeLensFocal: 200,
            workingDistance: 10,
            NA: 0.25,
            name: 'Aberrated objective',
        });
        aberratedObjective.pupil = {
            aberrations: {
                referenceWavelengthNm: 532,
                coefficients: [{ index: 4, coefficient: 0.5 }],
            },
            apodization: null,
        };
        const input = packetRay({
            origin: new Vector3(0, 0, -30),
            direction: new Vector3(0, 0, 1),
        });

        const base = new Solver1([baseObjective]).trace([input])[0]?.[1];
        const aberrated = new Solver1([aberratedObjective]).trace([input])[0]?.[1];
        const expectedDeltaMm = 0.5 * evaluateZernikeNoll(4, 0, 0) * 532e-6;

        expect(base).toBeDefined();
        expect(aberrated).toBeDefined();
        expect(aberrated!.opticalPathLength - base!.opticalPathLength).toBeCloseTo(expectedDeltaMm, 9);
    });
});
