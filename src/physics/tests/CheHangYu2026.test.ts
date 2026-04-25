import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';

import { createCheHangYu2026Scene } from '../../presets/CheHangYu2026';
import { Solver1 } from '../Solver1';
import { Solver3 } from '../Solver3';
import { createSourceRays } from '../SourceRayFactory';
import { AchromatDoublet } from '../components/AchromatDoublet';
import { DichroicMirror } from '../components/DichroicMirror';
import { GalvoScanHead } from '../components/GalvoScanHead';
import { IdealLens } from '../components/IdealLens';
import { Laser } from '../components/Laser';
import { PMT } from '../components/PMT';
import { Sample } from '../components/Sample';
import { SphericalLens } from '../components/SphericalLens';
import { Coherence, Ray } from '../types';

function centralLaserRay(laser: Laser): Ray {
    const direction = new Vector3(0, 0, 1).applyQuaternion(laser.rotation).normalize();
    return {
        origin: laser.position.clone().addScaledVector(direction, 3),
        direction,
        wavelength: laser.wavelength * 1e-9,
        intensity: 1,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
        opticalPathLength: 0,
        footprintRadius: laser.beamRadius,
        coherenceMode: Coherence.Coherent,
        isMainRay: true,
        sourceId: laser.id,
    };
}

function traceLaserHitNames(scanX = 0, scanY = 0): string[] {
    const { scene } = createCheHangYu2026Scene();
    const laser = scene.find(c => c instanceof Laser) as Laser;
    const galvos = scene.filter(c => c instanceof GalvoScanHead) as GalvoScanHead[];
    const resonant = galvos.find(g => g.name.includes('Resonant'));
    const slow = galvos.find(g => g.name.includes('Slow'));
    expect(resonant).toBeDefined();
    expect(slow).toBeDefined();
    resonant!.scanX = scanX;
    slow!.scanY = scanY;

    const paths = new Solver1(scene).trace([centralLaserRay(laser)]);
    const mainPath = paths[0] ?? [];
    return mainPath
        .map(ray => ray.interactionComponentId
            ? scene.find(c => c.id === ray.interactionComponentId)?.name
            : undefined)
        .filter((name): name is string => !!name);
}

describe('Che-Hang Yu 2026 preset', () => {
    test('uses thick lens components instead of ideal lenses', () => {
        const { scene } = createCheHangYu2026Scene();

        expect(scene.some(component => component instanceof IdealLens)).toBe(false);
        expect(scene.filter(component => component instanceof AchromatDoublet).length).toBeGreaterThanOrEqual(5);
        expect(scene.some(component => component instanceof SphericalLens)).toBe(true);
    });

    test('uses a visible fluorescence surrogate with a matching dichroic', () => {
        const { scene } = createCheHangYu2026Scene();
        const laser = scene.find(c => c instanceof Laser) as Laser;
        const sample = scene.find(c => c instanceof Sample) as Sample;
        const dichroic = scene.find(c => c instanceof DichroicMirror) as DichroicMirror;

        expect(laser.wavelength).toBe(460);
        expect(sample.getExcitationWavelength()).toBe(460);
        expect(sample.getEmissionWavelength()).toBe(510);
        expect(dichroic.spectralProfile.getTransmission(460)).toBeGreaterThan(0.9);
        expect(dichroic.spectralProfile.getTransmission(510)).toBeLessThan(0.1);
    });

    test('binds PMT raster axes to the resonant and slow scanners', () => {
        const { scene, channels } = createCheHangYu2026Scene();
        const pmt = scene.find(c => c instanceof PMT) as PMT;
        const galvos = scene.filter(c => c instanceof GalvoScanHead) as GalvoScanHead[];
        const resonant = galvos.find(g => g.name.includes('Resonant'))!;
        const slow = galvos.find(g => g.name.includes('Slow'))!;
        const scanChannels = channels ?? [];

        expect(pmt.xAxisComponentId).toBe(resonant.id);
        expect(pmt.xAxisProperty).toBe('scanX');
        expect(pmt.yAxisComponentId).toBe(slow.id);
        expect(pmt.yAxisProperty).toBe('scanY');
        expect(scanChannels.some(ch => ch.targetId === resonant.id && ch.property === 'scanX')).toBe(true);
        expect(scanChannels.some(ch => ch.targetId === slow.id && ch.property === 'scanY')).toBe(true);
    });

    test('routes the central excitation beam through the objective before the sample', () => {
        const names = traceLaserHitNames();
        const objectiveIndex = names.findIndex(name => name.includes('Nikon 16'));
        const sampleIndex = names.findIndex(name => name.includes('GCaMP6s'));

        expect(names).toContain('LSM54-1050 Scan Lens 1 (thick f=54)');
        expect(names).toContain('LSM54-1050 Scan Lens 2 (thick f=54)');
        expect(names).toContain('LSM54-1050 Imaging Scan Lens (thick f=54)');
        expect(names).toContain('TTL200MP Tube Lens (thick f=200)');
        expect(objectiveIndex).toBeGreaterThan(-1);
        expect(sampleIndex).toBeGreaterThan(-1);
        expect(objectiveIndex).toBeLessThan(sampleIndex);
    });

    test('single-axis scan extrema still reach the specimen', () => {
        const halfAngle = (2.5 * Math.PI) / 180;
        for (const [scanX, scanY] of [
            [halfAngle, 0],
            [-halfAngle, 0],
            [0, halfAngle],
            [0, -halfAngle],
        ]) {
            const names = traceLaserHitNames(scanX, scanY);
            expect(names.some(name => name.includes('Nikon 16'))).toBe(true);
            expect(names.some(name => name.includes('GCaMP6s'))).toBe(true);
        }
    });

    test('PMT center pixel receives fluorescent signal', () => {
        const { scene } = createCheHangYu2026Scene();
        const pmt = scene.find(c => c instanceof PMT) as PMT;
        pmt.samplesPerPixel = 4;

        const beamSegments = new Solver1(scene)
            .traceWithBeamSegments(createSourceRays(scene, 24, 'full'))
            .beamSegments;
        const pixel = new Solver3(scene, beamSegments).renderPMTPixel(pmt);

        expect(pixel.radiance).toBeGreaterThan(0.01);
        expect(pixel.excitation).toBeGreaterThan(0.01);
        expect(pixel.bestPath).not.toBeNull();
    });
});
