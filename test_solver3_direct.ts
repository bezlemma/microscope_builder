import { createEpiFluorescenceScene } from './src/presets/epiFluorescence';
import { Laser } from './src/physics/components/Laser';
import { Coherence, Ray } from './src/physics/types';
import { Solver1 } from './src/physics/Solver1';
import { Vector3 } from 'three';
import { Solver2, beamRadius } from './src/physics/Solver2';
import { Solver3 } from './src/physics/Solver3';
import { Camera } from './src/physics/components/Camera';

function run() {
    const scene = createEpiFluorescenceScene();
    
    // Find Camera
    const camera = scene.find(c => c instanceof Camera) as Camera;
    if (!camera) throw new Error("No camera found");
    
    // Step 1: Forward Ray Trace
    // Find Lasers and generate source rays
    const sourceRays: Ray[] = [];
    for (const c of scene) {
        if (c instanceof Laser) {
            const origin = c.position.clone();
            const direction = new Vector3(1, 0, 0).applyQuaternion(c.rotation).normalize();
            origin.add(direction.clone().multiplyScalar(5));
            sourceRays.push({
                origin: origin.clone(),
                direction: direction.clone(),
                wavelength: c.wavelength * 1e-9,
                intensity: c.power,
                polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
                opticalPathLength: 0,
                footprintRadius: c.beamRadius,
                coherenceMode: Coherence.Coherent,
                isMainRay: true,
                sourceId: c.id
            });
        }
    }

    // Step 1: Forward Ray Trace
    const s1 = new Solver1(scene);
    const s1Result = s1.trace(sourceRays);
    
    // Step 2: Forward Beam Trace (Excitation)
    const s2 = new Solver2();
    const beamSegs = s2.propagate(s1Result, scene);
    console.log(`\n\n=== S2 BEAM SEGS (${beamSegs.length} branches) ===`);
    for (let b=0; b<beamSegs.length; b++) {
        for (let s=0; s<beamSegs[b].length; s++) {
            const seg = beamSegs[b][s];
            console.log(` Branch ${b} Seg ${s}: power=${seg.power.toFixed(3)} start=(${seg.start.x.toFixed(1)}, ${seg.start.y.toFixed(1)}, ${seg.start.z.toFixed(1)}) end=(${seg.end.x.toFixed(1)}, ${seg.end.y.toFixed(1)}, ${seg.end.z.toFixed(1)}) radius_start=${beamRadius(seg.qx_start, seg.wavelength).toFixed(5)} radius_end=${beamRadius(seg.qx_end, seg.wavelength).toFixed(5)}`);
        }
    }
    console.log(`====================================\n\n`);
    
    
    // Step 3: Backward Monte Carlo Tracer (Emission)
    const s3 = new Solver3(scene, beamSegs);
    const s3Result = s3.render(camera, 5); // few paths for fast test
    
    let maxE = 0;
    let nonZero = 0;
    for (let i = 0; i < s3Result.emissionImage.length; i++) {
        const val = s3Result.emissionImage[i];
        if (val > maxE) maxE = val;
        if (val > 1e-4) nonZero++;
    }
    
    console.log(`Max Emission Radiance: ${maxE}`);
    console.log(`Non-zero pixels: ${nonZero} / ${s3Result.emissionImage.length}`);
}

run();
