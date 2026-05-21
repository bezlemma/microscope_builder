import { describe, test, expect } from 'bun:test';
import { createConfocalScene } from '../../presets/confocal';
import { ForwardTracer } from '../ForwardTracer';
import { ReverseTracer } from '../ReverseTracer';
import { Laser } from '../components/Laser';
import { PMT } from '../components/PMT';
import { Objective } from '../components/Objective';
import { createSourceRays } from '../SourceRayFactory';
import { setProperty } from '../PropertyAnimator';
import { Ray } from '../types';
import { Vector3 } from 'three';

describe('Confocal preset regressions', () => {

    test('Central ray traces through all components in correct order', () => {
        const { scene } = createConfocalScene();
        const solver = new ForwardTracer(scene);

        // Find the laser
        const laser = scene.find(c => c instanceof Laser) as Laser;
        expect(laser).toBeDefined();

        // Create central ray from laser
        const origin = laser.position.clone();
        const direction = new Vector3(0, 0, 1).applyQuaternion(laser.rotation).normalize();
        origin.add(direction.clone().multiplyScalar(3)); // advance past self

        const ray: Ray = {
            origin,
            direction,
            wavelength: laser.wavelength * 1e-9,
            intensity: 1.0,
            polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
            opticalPathLength: 0,
            footprintRadius: 0,
            coherenceMode: 0,
            isMainRay: true,
            sourceId: laser.id
        };

        const paths = solver.trace([ray]);

        const hitComponents: string[] = [];
        for (const path of paths) {
            for (const segment of path) {
                if (segment.interactionComponentId) {
                    const comp = scene.find(c => c.id === segment.interactionComponentId);
                    if (comp) {
                        hitComponents.push(comp.name);
                    }
                }
            }
        }

        // Verify key components are hit
        expect(hitComponents).toContain('Dichroic (SP 505)');
        expect(hitComponents).toContain('Galvo M1');
        expect(hitComponents).toContain('Galvo M2');
        expect(hitComponents).toContain('Scan Lens (f≈50)');
        expect(hitComponents).toContain('Tube Lens (f≈200)');

        // Check that the beam reaches the objective area
        const hitsObjective = hitComponents.some(n => n.includes('Objective'));
        const hitsSample = hitComponents.some(n => n.includes('Specimen'));
        expect(hitsObjective).toBe(true);
        expect(hitsSample).toBe(true);
    });

    test('Component positions form compact layout', () => {
        const { scene } = createConfocalScene();

        // Verify compact: all components within a reasonable bounding box
        const xs = scene.map(c => c.position.x);
        const ys = scene.map(c => c.position.y);
        const width = Math.max(...xs) - Math.min(...xs);
        const height = Math.max(...ys) - Math.min(...ys);

        // The current preset keeps the microscope in one horizontal table row.
        expect(width).toBeLessThan(650);
        expect(height).toBeLessThan(150);
    });

    test('Confocal objective keeps a plausible physical aperture', () => {
        const { scene } = createConfocalScene();
        const objective = scene.find(c => c instanceof Objective) as Objective;
        expect(objective).toBeDefined();
        expect(objective.magnification).toBe(10);
        expect(objective.NA).toBe(0.5);
        expect(objective.apertureRadius * 2).toBeLessThanOrEqual(25);
    });

    test('PMT center raster pixel has Mickey signal and dark corners', () => {
        const { scene, channels } = createConfocalScene();
        const pmt = scene.find(c => c instanceof PMT) as PMT;
        expect(pmt).toBeDefined();

        const xCh = channels.find(ch => ch.targetId === pmt.xAxisComponentId && ch.property === pmt.xAxisProperty);
        const yCh = channels.find(ch => ch.targetId === pmt.yAxisComponentId && ch.property === pmt.yAxisProperty);
        expect(xCh).toBeDefined();
        expect(yCh).toBeDefined();

        const byId = new Map(scene.map(c => [c.id, c]));
        const xTarget = byId.get(xCh!.targetId)!;
        const yTarget = byId.get(yCh!.targetId)!;
        pmt.samplesPerPixel = 4;

        const renderAt = (xf: number, yf: number) => {
            setProperty(yTarget, yCh!.property, yCh!.from + (yCh!.to - yCh!.from) * yf);
            setProperty(xTarget, xCh!.property, xCh!.from + (xCh!.to - xCh!.from) * xf);
            const forwardTracer = new ForwardTracer(scene);
            const beamSegs = forwardTracer.traceWithBeamSegments(createSourceRays(scene, 8, 'full')).beamSegments;
            return new ReverseTracer(scene, beamSegs).renderPMTPixel(pmt);
        };

        const center = renderAt(0.5, 0.5);
        const corner = renderAt(0, 0);

        expect(center.radiance).toBeGreaterThan(1);
        expect(center.excitation).toBeGreaterThan(1);
        expect(corner.radiance).toBeLessThan(center.radiance * 0.25);
    });
});
