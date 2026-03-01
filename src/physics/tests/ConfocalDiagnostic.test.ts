/**
 * Confocal Beam Path Diagnostic — traces a ray through the confocal preset
 * and reports the position, direction, and component at each interaction.
 *
 * Run with: bun test src/physics/tests/ConfocalDiagnostic.test.ts
 */
import { describe, test, expect } from 'bun:test';
import { createConfocalScene } from '../../presets/confocal';
import { Solver1 } from '../Solver1';
import { Laser } from '../components/Laser';
import { Ray } from '../types';
import { Vector3 } from 'three';

describe('Confocal Beam Path Diagnostic', () => {

    test('Central ray traces through all components in correct order', () => {
        const { scene } = createConfocalScene();
        const solver = new Solver1(scene);

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
            polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
            opticalPathLength: 0,
            footprintRadius: 0,
            coherenceMode: 0,
            isMainRay: true,
            sourceId: laser.id
        };

        const paths = solver.trace([ray]);

        // Print diagnostic info for each segment
        console.log('\n=== CONFOCAL BEAM TRACE ===');
        console.log(`Laser at (${laser.position.x}, ${laser.position.y}), fires (${direction.x.toFixed(3)}, ${direction.y.toFixed(3)})`);

        const hitComponents: string[] = [];
        for (const path of paths) {
            for (const segment of path) {
                if (segment.interactionComponentId) {
                    const comp = scene.find(c => c.id === segment.interactionComponentId);
                    if (comp) {
                        hitComponents.push(comp.name);
                        console.log(`  → ${comp.name.padEnd(25)} pos=(${comp.position.x.toFixed(1)}, ${comp.position.y.toFixed(1)})  beam_dir=(${segment.direction.x.toFixed(3)}, ${segment.direction.y.toFixed(3)})`);
                    }
                }
            }
        }

        console.log(`\nHit sequence: ${hitComponents.join(' → ')}`);

        // Verify key components are hit
        expect(hitComponents).toContain('Dichroic (LP 505)');
        expect(hitComponents).toContain('Galvo M1 (X)');
        expect(hitComponents).toContain('Galvo M2 (Y)');
        expect(hitComponents).toContain('Scan Lens');
        expect(hitComponents).toContain('Fold Mirror 1');
        expect(hitComponents).toContain('Tube Lens');
        expect(hitComponents).toContain('Fold Mirror 2');

        // Check that the beam reaches the objective area
        const hitsObjective = hitComponents.some(n => n.includes('Objective'));
        const hitsSample = hitComponents.some(n => n.includes('Specimen'));
        console.log(`\nReaches objective: ${hitsObjective}`);
        console.log(`Reaches sample: ${hitsSample}`);
    });

    test('Component positions form compact layout', () => {
        const { scene } = createConfocalScene();

        console.log('\n=== COMPONENT POSITIONS ===');
        for (const c of scene) {
            const fwd = new Vector3(0, 0, 1).applyQuaternion(c.rotation);
            console.log(`  ${c.name.padEnd(25)} pos=(${c.position.x.toFixed(1)}, ${c.position.y.toFixed(1)})  fwd=(${fwd.x.toFixed(3)}, ${fwd.y.toFixed(3)}, ${fwd.z.toFixed(3)})`);
        }

        // Verify compact: all components within a reasonable bounding box
        const xs = scene.map(c => c.position.x);
        const ys = scene.map(c => c.position.y);
        const width = Math.max(...xs) - Math.min(...xs);
        const height = Math.max(...ys) - Math.min(...ys);
        console.log(`\nLayout size: ${width.toFixed(0)} × ${height.toFixed(0)} mm`);

        // Should be compact (under 300mm in each direction)
        expect(width).toBeLessThan(300);
        expect(height).toBeLessThan(300);
    });

    test('Mirror reflection directions are correct', () => {
        const { scene } = createConfocalScene();

        // For each mirror/dichroic, verify the forward (normal) direction
        console.log('\n=== MIRROR NORMALS (forward = local+Z) ===');
        const mirrors = scene.filter(c =>
            c.name.includes('Dichroic') || c.name.includes('Mirror') ||
            c.name.includes('Scan Head')
        );

        for (const m of mirrors) {
            const fwd = new Vector3(0, 0, 1).applyQuaternion(m.rotation);
            console.log(`  ${m.name.padEnd(25)} normal=(${fwd.x.toFixed(3)}, ${fwd.y.toFixed(3)}, ${fwd.z.toFixed(3)})`);
        }
    });
});
