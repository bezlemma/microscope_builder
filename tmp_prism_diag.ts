import { PrismLens } from './src/physics/components/PrismLens';
import { SphericalLens } from './src/physics/components/SphericalLens';
import { Solver1 } from './src/physics/Solver1';
import { Vector3, Quaternion, Euler } from 'three';
import { writeFileSync } from 'fs';

const lines: string[] = [];
const log = (s: string) => lines.push(s);

// Reproduce exact user scenario: prism at 30° + lens in path

const p = new PrismLens(Math.PI / 3, 25, 25, 'T', 1.5168);
p.setPosition(-50, -40, 0);

const baseQuat = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0));
const worldZQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 30 * Math.PI / 180);
const finalQuat = worldZQuat.clone().multiply(baseQuat);
const euler = new Euler().setFromQuaternion(finalQuat);
p.setRotation(euler.x, euler.y, euler.z);

// Create source rays mimicking the laser's cylindrical beam pattern
// beamRadius = 2mm, rays at ring of r=2, angles 0, 90, 180, 270 degrees
// plus central ray
const beamRadius = 2;
const direction = new Vector3(1, 0, 0);
const laserOrigin = new Vector3(-75, -40, 0);  // offset by 5 from laser position
const up = new Vector3(0, 1, 0);
const right = new Vector3(0, 0, 1); // cross(direction, up) = (0,0,1) for (1,0,0) dir

const sourceRays: any[] = [];
const labels: string[] = [];

// Central ray
sourceRays.push({
    origin: laserOrigin.clone(),
    direction: direction.clone(),
    wavelength: 532e-9, intensity: 1,
    polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
    opticalPathLength: 0, footprintRadius: 0, coherenceMode: 0
});
labels.push('center');

// Ring rays at beamRadius 
for (let i = 0; i < 24; i++) {
    const phi = (i / 24) * Math.PI * 2;
    const offset = new Vector3()
        .addScaledVector(up, Math.sin(phi) * beamRadius)
        .addScaledVector(right, Math.cos(phi) * beamRadius);
    sourceRays.push({
        origin: laserOrigin.clone().add(offset),
        direction: direction.clone(),
        wavelength: 532e-9, intensity: 1,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
        opticalPathLength: 0, footprintRadius: 0, coherenceMode: 0
    });
    const y = laserOrigin.y + Math.sin(phi) * beamRadius;
    const z = laserOrigin.z + Math.cos(phi) * beamRadius;
    labels.push(`ring(${y.toFixed(1)},${z.toFixed(1)})`);
}

log("=== PRISM ALONE (25 rays) ===\n");
const solverNoLens = new Solver1([p]);
const pathsNoLens = solverNoLens.trace(sourceRays.map(r => ({...r, origin: r.origin.clone(), direction: r.direction.clone()})));
let totalExitNoLens = 0;
for (let i = 0; i < pathsNoLens.length; i++) {
    const last = pathsNoLens[i][pathsNoLens[i].length - 1];
    const isAlive = last.intensity > 0 && !last.terminationPoint;
    if (isAlive) totalExitNoLens++;
}
log(`Total live exit rays: ${totalExitNoLens} / ${pathsNoLens.length}`);

// Place lens on upper exit beam
const exitRays = pathsNoLens.filter(p => {
    const l = p[p.length-1];
    return l.intensity > 0 && !l.terminationPoint && l.direction.y > 0;
});
if (exitRays.length > 0) {
    const refRay = exitRays[0][exitRays[0].length - 1];
    const lensPos = refRay.origin.clone().add(refRay.direction.clone().multiplyScalar(40));
    
    const lens = new SphericalLens(50, -50, 5, 8, 'L1', 1.5168);
    lens.setPosition(lensPos.x, lensPos.y, 0);
    lens.setRotation(0, Math.PI / 2, 0);
    
    log(`\nLens placed at (${lensPos.x.toFixed(1)}, ${lensPos.y.toFixed(1)}, ${lensPos.z.toFixed(1)})`);
    
    log("\n=== PRISM + LENS (25 rays) ===\n");
    const solverWithLens = new Solver1([p, lens]);
    const pathsWithLens = solverWithLens.trace(sourceRays.map(r => ({...r, origin: r.origin.clone(), direction: r.direction.clone()})));
    
    // Compare paths
    let totalExitWithLens = 0;
    let diffs = 0;
    for (let i = 0; i < pathsWithLens.length; i++) {
        const pathNew = pathsWithLens[i];
        const pathOld = pathsNoLens[i];
        const lastNew = pathNew[pathNew.length - 1];
        const lastOld = pathOld[pathOld.length - 1];
        const isAliveNew = lastNew.intensity > 0 && !lastNew.terminationPoint;
        const isAliveOld = lastOld.intensity > 0 && !lastOld.terminationPoint;
        if (isAliveNew) totalExitWithLens++;
        
        // Check if the EXIT from the prism is different (path[1] in both cases)
        if (pathNew.length >= 2 && pathOld.length >= 2) {
            const prismExitNew = pathNew[1];
            const prismExitOld = pathOld[1];
            const dirDiff = prismExitNew.direction.distanceTo(prismExitOld.direction);
            const origDiff = prismExitNew.origin.distanceTo(prismExitOld.origin);
            if (dirDiff > 0.001 || origDiff > 0.01) {
                diffs++;
                log(`  *** DIFF at ${labels[i]}: prism exit changed!`);
                log(`    Old: origin=(${prismExitOld.origin.x.toFixed(2)},${prismExitOld.origin.y.toFixed(2)}) dir=(${prismExitOld.direction.x.toFixed(4)},${prismExitOld.direction.y.toFixed(4)})`);
                log(`    New: origin=(${prismExitNew.origin.x.toFixed(2)},${prismExitNew.origin.y.toFixed(2)}) dir=(${prismExitNew.direction.x.toFixed(4)},${prismExitNew.direction.y.toFixed(4)})`);
            }
        }
        
        // Check if path length changed
        if (pathNew.length !== pathOld.length) {
            log(`  Path ${labels[i]}: ${pathOld.length} → ${pathNew.length} segments`);
        }
    }
    
    log(`\nTotal live exit rays: no-lens=${totalExitNoLens}, with-lens=${totalExitWithLens}`);
    log(`Prism-exit direction diffs: ${diffs}`);
    
    // CRITICAL: Check if adding the lens caused the prism to produce DIFFERENT results
    // by checking if any source ray hits the lens FIRST 
    log(`\n=== ORDER CHECK ===\n`);
    for (let i = 0; i < sourceRays.length; i++) {
        const r = {...sourceRays[i], origin: sourceRays[i].origin.clone(), direction: sourceRays[i].direction.clone()};
        const prismT = p.chkIntersection(r)?.t;
        const lensT = lens.chkIntersection(r)?.t;
        if (lensT !== undefined && prismT !== undefined && lensT < prismT) {
            log(`  *** GHOST: ${labels[i]} hits lens(t=${lensT.toFixed(2)}) BEFORE prism(t=${prismT.toFixed(2)}) ***`);
        }
    }
}

writeFileSync('tmp_prism_output.txt', lines.join('\n'));
console.log('Done.');
