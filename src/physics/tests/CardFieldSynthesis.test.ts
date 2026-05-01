import { describe, expect, test } from 'bun:test';
import { Matrix4, Vector3 } from 'three';
import {
    adaptiveTerminalFieldWindow,
    analyzeTerminalField,
    collectTerminalPacketHitsFromRayPaths,
    fitZernikePupilFromHits,
    summarizePacketHitValidity,
    synthesizeTerminalAxialSectionsFromRayPaths,
    synthesizeTerminalFieldFromHits,
} from '../cardFieldSynthesis';
import { evaluateZernikeNoll } from '../PupilFunction';
import { createEpiFluorescenceScene } from '../../presets/epiFluorescence';
import { Card } from '../components/Card';
import { Camera } from '../components/Camera';
import { SphericalLens } from '../components/SphericalLens';
import { createSourceRays } from '../SourceRayFactory';
import { Solver1 } from '../Solver1';
import { Coherence, createRay } from '../types';

describe('terminal Gaussian Packet synthesis', () => {
    function packetRay(origin: Vector3, direction: Vector3) {
        return createRay({
            origin,
            direction,
            wavelength: 532e-9,
            intensity: 1,
            powerWeight: 1,
            polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
            opticalPathLength: 0,
            footprintRadius: 0.3,
            coherenceMode: Coherence.Coherent,
            sigmaU: 0.12,
            sigmaV: 0.12,
            curvatureRadiusU: Number.POSITIVE_INFINITY,
            curvatureRadiusV: Number.POSITIVE_INFINITY,
            packetStateMode: 'explicit' as const,
            sourceId: 'laser',
            sourceKind: 'laser',
            packetLaunchRigor: 'rigorous',
        });
    }

    test('single packet integrates close to its carried power', () => {
        const ray = createRay({
            origin: new Vector3(),
            direction: new Vector3(0, 0, 1),
            wavelength: 532e-9,
            intensity: 2,
            powerWeight: 2,
            polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
            opticalPathLength: 0,
            footprintRadius: 0.3,
            coherenceMode: Coherence.Coherent,
            sigmaU: 0.12,
            sigmaV: 0.12,
            curvatureRadiusU: Number.POSITIVE_INFINITY,
            curvatureRadiusV: Number.POSITIVE_INFINITY,
            packetStateMode: 'explicit',
            sourceId: 'laser',
        });

        const field = synthesizeTerminalFieldFromHits(
            [{ localPoint: { x: 0, y: 0 }, ray }],
            { width: 2, height: 2, resX: 96, resY: 96 },
        );
        const total = field.intensity.reduce((sum, value) => sum + value, 0);

        expect(total).toBeGreaterThan(1.95);
        expect(total).toBeLessThan(2.05);
    });

    test('card records terminal packet hits at the intersection plane', () => {
        const card = new Card(10, 10, 'Packet card');
        card.opaque = true;
        const ray = packetRay(new Vector3(1, -2, -10), new Vector3(0, 0, 1));

        new Solver1([card]).trace([ray]);

        expect(card.packetHits).toHaveLength(1);
        const hit = card.packetHits[0];
        expect(hit.detectorId).toBe(card.id);
        expect(hit.localPoint.x).toBeCloseTo(1, 9);
        expect(hit.localPoint.y).toBeCloseTo(-2, 9);
        expect(hit.localDirection?.z).toBeCloseTo(1, 9);
        expect(hit.ray.origin.z).toBeCloseTo(0, 9);
        expect(hit.ray.opticalPathLength).toBeCloseTo(10, 9);
        expect(hit.ray.packetStateMode).toBe('explicit');
    });

    test('camera records terminal packet hits and clears them for each trace', () => {
        const camera = new Camera(10, 10, 'Packet camera');
        const ray = packetRay(new Vector3(0, 0, -10), new Vector3(0, 0, 1));
        const solver = new Solver1([camera]);

        solver.trace([ray]);

        expect(camera.packetHits).toHaveLength(1);
        expect(camera.packetHits[0].ray.opticalPathLength).toBeCloseTo(10, 9);

        camera.packetHits.push({
            localPoint: { x: 99, y: 99 },
            ray,
            detectorId: camera.id,
        });
        solver.trace([ray]);

        expect(camera.packetHits).toHaveLength(1);
        expect(camera.packetHits[0].localPoint.x).toBeCloseTo(0, 9);
    });

    test('collects terminal packet hits on a virtual local plane', () => {
        const ray = packetRay(new Vector3(0, 0, -5), new Vector3(0, 0, 1));
        const paths = [[ray]];
        ray.interactionDistance = 10;

        const hits = collectTerminalPacketHitsFromRayPaths(paths, {
            worldToLocal: new Matrix4(),
            localToWorld: new Matrix4(),
            localZ: 0,
            width: 4,
            height: 4,
            detectorId: 'virtual-plane',
        });

        expect(hits).toHaveLength(1);
        expect(hits[0].detectorId).toBe('virtual-plane');
        expect(hits[0].localPoint.x).toBeCloseTo(0, 9);
        expect(hits[0].ray.origin.z).toBeCloseTo(0, 9);
        expect(hits[0].ray.opticalPathLength).toBeCloseTo(5, 9);
    });

    test('reconstructs Epi expander relay focal planes that forward rods cross', () => {
        const components = createEpiFluorescenceScene();
        const paths = new Solver1(components).trace(createSourceRays(components, 32, 'full'));
        const lenses = components.filter((component): component is SphericalLens =>
            component instanceof SphericalLens
        );

        const firstExpander = lenses.find(lens => lens.name.includes('Expander Lens 1'));
        const secondExpander = lenses.find(lens => lens.name.includes('Expander Lens 2'));
        expect(firstExpander).toBeDefined();
        expect(secondExpander).toBeDefined();

        const focalPlanes = [
            { lens: firstExpander!, localZ: firstExpander!.focalLength },
            { lens: secondExpander!, localZ: -secondExpander!.focalLength },
            { lens: secondExpander!, localZ: secondExpander!.focalLength },
        ];

        for (const { lens, localZ } of focalPlanes) {
            lens.updateMatrices();
            const hits = collectTerminalPacketHitsFromRayPaths(paths, {
                worldToLocal: lens.worldToLocal,
                localToWorld: lens.localToWorld,
                localZ,
                radius: lens.apertureRadius,
                detectorId: `${lens.id}:focal`,
            });
            const validity = summarizePacketHitValidity(hits);
            const window = adaptiveTerminalFieldWindow(hits, {
                maxWidth: lens.apertureRadius * 2,
                maxHeight: lens.apertureRadius * 2,
            });
            const field = synthesizeTerminalFieldFromHits(hits, {
                width: window.width,
                height: window.height,
                centerX: window.centerX,
                centerY: window.centerY,
                resX: 64,
                resY: 64,
            });
            let peak = 0;
            for (const value of field.intensity) peak = Math.max(peak, value);

            expect(hits.length).toBeGreaterThan(0);
            expect(validity.isPacketFieldValid).toBe(true);
            expect(validity.fallbackHits).toBe(0);
            expect(peak).toBeGreaterThan(0);
        }
    });

    test('does not reconstruct terminal packet fields from reverse camera sampling rays', () => {
        const backwardRay = packetRay(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
        backwardRay.isBackward = true;
        backwardRay.sourceId = 'solver3_camera';
        backwardRay.interactionDistance = 10;

        const hits = collectTerminalPacketHitsFromRayPaths([[backwardRay]], {
            worldToLocal: new Matrix4(),
            localToWorld: new Matrix4(),
            localZ: 0,
            width: 4,
            height: 4,
            detectorId: 'camera-plane',
        });

        expect(hits).toHaveLength(0);
    });

    test('summarizes packet launch validity for PSF analysis', () => {
        const rigorous = packetRay(new Vector3(), new Vector3(0, 0, 1));
        const fallback = createRay({
            ...rigorous,
            packetLaunchRigor: 'geometricFallback',
        });

        const valid = summarizePacketHitValidity([{ localPoint: { x: 0, y: 0 }, ray: rigorous }]);
        const invalid = summarizePacketHitValidity([
            { localPoint: { x: 0, y: 0 }, ray: rigorous },
            { localPoint: { x: 0, y: 0 }, ray: fallback },
        ]);

        expect(valid.isPsfValid).toBe(true);
        expect(valid.isPacketFieldValid).toBe(true);
        expect(invalid.isPsfValid).toBe(false);
        expect(invalid.isPacketFieldValid).toBe(false);
        expect(invalid.fallbackHits).toBe(1);
    });

    test('allows rigorous lamp packet fields but does not call them PSFs', () => {
        const lampRay = createRay({
            ...packetRay(new Vector3(), new Vector3(0, 0, 1)),
            coherenceMode: Coherence.Incoherent,
            sourceKind: 'lamp',
            packetLaunchRigor: 'rigorous',
        });

        const validity = summarizePacketHitValidity([{ localPoint: { x: 0, y: 0 }, ray: lampRay }]);

        expect(validity.isPacketFieldValid).toBe(true);
        expect(validity.isPsfValid).toBe(false);
        expect(validity.psfInvalidReason).toBe('incoherent source');
    });

    test('computes encircled energy, MTF, and Strehl metrics from a terminal field', () => {
        const ray = packetRay(new Vector3(), new Vector3(0, 0, 1));
        const field = synthesizeTerminalFieldFromHits(
            [{ localPoint: { x: 0, y: 0 }, ray }],
            { width: 4, height: 4, resX: 48, resY: 48 },
        );
        const metrics = analyzeTerminalField(field, {
            wavelengthM: ray.wavelength,
            numericalAperture: 0.2,
        });

        expect(metrics.totalPower).toBeGreaterThan(0.99);
        expect(metrics.ee50Radius ?? 0).toBeGreaterThan(0);
        expect(metrics.ee80Radius ?? 0).toBeGreaterThan(metrics.ee50Radius ?? 0);
        expect(metrics.radialMtf[0].value).toBeCloseTo(1, 6);
        expect(metrics.mtf50 ?? 0).toBeGreaterThan(0);
        expect(metrics.strehlRatio ?? 0).toBeGreaterThan(0);
    });

    test('computes axial xz and yz sections from terminal packet planes', () => {
        const ray = packetRay(new Vector3(0, 0, -5), new Vector3(0, 0, 1));
        ray.interactionDistance = 10;

        const sections = synthesizeTerminalAxialSectionsFromRayPaths(
            [[ray]],
            {
                worldToLocal: new Matrix4(),
                localToWorld: new Matrix4(),
                localZ: 0,
                width: 4,
                height: 4,
            },
            { centerX: 0, centerY: 0, width: 2, height: 2 },
            { resTransverse: 24, resZ: 9, axialDepth: 2 },
        );

        expect(sections.xz).toHaveLength(24 * 9);
        expect(sections.yz).toHaveLength(24 * 9);
        expect(Math.max(...sections.xz)).toBeGreaterThan(0);
        expect(Math.max(...sections.yz)).toBeGreaterThan(0);
    });

    test('fits low-order Zernike OPD from pupil packet hits', () => {
        const wavelengthMm = 532e-9 * 1e3;
        const defocusWaves = 0.25;
        const hits = [];
        for (let ring = 1; ring <= 4; ring++) {
            const rho = ring / 5;
            const count = ring * 8;
            for (let i = 0; i < count; i++) {
                const phi = 2 * Math.PI * i / count;
                const x = rho * Math.cos(phi);
                const y = rho * Math.sin(phi);
                const ray = packetRay(new Vector3(), new Vector3(0, 0, 1));
                ray.opticalPathLength = 12 + defocusWaves * evaluateZernikeNoll(4, rho, phi) * wavelengthMm;
                hits.push({ localPoint: { x, y }, ray });
            }
        }

        const fit = fitZernikePupilFromHits(hits, { pupilRadius: 1, maxIndex: 4 });
        const defocus = fit?.coefficients.find(coefficient => coefficient.index === 4);

        expect(fit).not.toBeNull();
        expect(defocus?.coefficientWaves ?? 0).toBeCloseTo(defocusWaves, 2);
        expect(fit!.residualRmsWaves).toBeLessThan(0.02);
    });
});
