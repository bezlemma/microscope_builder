/**
 * Confocal Beam Diagnostic — standalone script.
 * Run: bun run src/physics/tests/confocal_diag.ts
 * Output: confocal_diag.txt
 */
import { createConfocalScene } from '../../presets/confocal';
import { Solver1 } from '../Solver1';
import { Laser } from '../components/Laser';
import { Ray } from '../types';
import { Vector3 } from 'three';
import { writeFileSync } from 'fs';

const out: string[] = [];
function log(s: string) { out.push(s); }

const { scene } = createConfocalScene();
const solver = new Solver1(scene);
const laser = scene.find(c => c instanceof Laser) as Laser;

// Central ray
const dir = new Vector3(0, 0, 1).applyQuaternion(laser.rotation).normalize();
const origin = laser.position.clone().add(dir.clone().multiplyScalar(3));
const ray: Ray = {
    origin, direction: dir,
    wavelength: laser.wavelength * 1e-9, intensity: 1.0,
    polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
    opticalPathLength: 0, footprintRadius: 0, coherenceMode: 0,
    isMainRay: true, sourceId: laser.id
};

log('=== COMPONENT POSITIONS ===');
for (const c of scene) {
    const fwd = new Vector3(0, 0, 1).applyQuaternion(c.rotation);
    log(`  ${c.name.padEnd(25)} pos=(${c.position.x.toFixed(1)}, ${c.position.y.toFixed(1)})  fwd=(${fwd.x.toFixed(3)}, ${fwd.y.toFixed(3)}, ${fwd.z.toFixed(3)})`);
}

log('\n=== BEAM TRACE ===');
log(`Laser at (${laser.position.x}, ${laser.position.y}), fires (${dir.x.toFixed(3)}, ${dir.y.toFixed(3)})`);

const paths = solver.trace([ray]);
const hits: string[] = [];
for (const path of paths) {
    for (const seg of path) {
        if (seg.interactionComponentId) {
            const comp = scene.find(c => c.id === seg.interactionComponentId);
            if (comp) {
                hits.push(comp.name);
                log(`  → ${comp.name.padEnd(25)} beam_at=(${seg.origin.x.toFixed(1)}, ${seg.origin.y.toFixed(1)})  beam_dir=(${seg.direction.x.toFixed(3)}, ${seg.direction.y.toFixed(3)})`);
            }
        }
    }
}

log(`\nHit sequence: ${hits.join(' → ')}`);

// Check expected order
const expected = ['Dichroic', 'Scan Head', 'Scan Lens', 'Fold Mirror 1', 'Tube Lens', 'Fold Mirror 2', 'Objective', 'Specimen'];
for (const name of expected) {
    const found = hits.some(h => h.includes(name));
    log(`  ${found ? '✓' : '✗'} ${name}`);
}

// Layout bounds
const xs = scene.map(c => c.position.x);
const ys = scene.map(c => c.position.y);
log(`\nLayout: x=[${Math.min(...xs).toFixed(0)}, ${Math.max(...xs).toFixed(0)}]  y=[${Math.min(...ys).toFixed(0)}, ${Math.max(...ys).toFixed(0)}]`);
log(`Size: ${(Math.max(...xs) - Math.min(...xs)).toFixed(0)} × ${(Math.max(...ys) - Math.min(...ys)).toFixed(0)} mm`);

const result = out.join('\n');
writeFileSync('confocal_diag.txt', result);
console.log(result);
console.log('\n→ Written to confocal_diag.txt');
