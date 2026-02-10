import { describe, expect, test } from "bun:test";
import { Vector3 } from "three";
import { SphericalLens } from "../components/SphericalLens";
import { Laser } from "../components/Laser";
import { Solver1 } from "../Solver1";
import { Ray, Coherence } from "../types";

describe("Ghost Intersection Debugging", () => {
    test("Beam Expander Ghost Ray", () => {
        // 1. Setup Scene (matches beamExpander.ts)
        const scene = [];

        // Laser (Not strictly needed for Solver1 if we provide rays manually, but good for context)
        // NOTE: We do NOT add the Laser to the scene for the trace, 
        // because the manually created ray starts "at" the laser face.
        // If the Laser is in the scene, the ray might hit the laser housing immediately and die.
        const laser = new Laser("Laser");
        laser.setPosition(-150, 0, 0);
        // scene.push(laser); // Commented out to prevent self-intersection

        // Lens 1: f=50, Aperture=15, Thickness=4
        // Moved to Y=17 per user report
        const lens1 = new SphericalLens(1/50.0, 15, 4, "Expander Lens 1");
        lens1.setPosition(-100, 17, 0); 
        lens1.setRotation(0, Math.PI / 2, 0); // Face +X
        scene.push(lens1);

        // Lens 2: f=100, Aperture=25, Thickness=4
        const lens2 = new SphericalLens(1/100.0, 25, 4, "Expander Lens 2");
        lens2.setPosition(50, 0, 0);
        lens2.setRotation(0, Math.PI / 2, 0);
        scene.push(lens2);

        // 2. Define Marginal Ray
        // Laser at -150. Beam Radius 2.
        // Marginal Ray at Y = +4.
        // Lens 1 is at Y=17, effectiveApertureRadius ~14.
        // Bottom edge of physical lens is at Y = 17 - 14 = 3.
        // So Ray at Y=4 is 13mm from center, inside the physical lens.
        const ray: Ray = {
            origin: new Vector3(-150, 4, 0),
            direction: new Vector3(1, 0, 0),
            wavelength: 532e-9,
            intensity: 1,
            polarization: { x: {re:1, im:0}, y: {re:0, im:0} },
            opticalPathLength: 0,
            footprintRadius: 0,
            coherenceMode: Coherence.Incoherent
        };

        // 3. Trace
        const solver = new Solver1(scene);
        const paths = solver.trace([ray]);
        const path = paths[0];

        // DEBUG: Find who we hit
        console.log("--- DEBUG: Intersection Check ---");
        scene.forEach(c => {
            const hit = c.chkIntersection(ray);
            if (hit) {
                console.log(`Component '${c.name}' hit at t=${hit.t.toFixed(3)}`);
            } else {
                console.log(`Component '${c.name}' missed`);
            }
        });

        // 4. Analyze Path
        console.log("--- Ray Path Analysis ---");
        path.forEach((r, i) => {
            console.log(`Segment ${i}: Origin (${r.origin.x.toFixed(3)}, ${r.origin.y.toFixed(3)}, ${r.origin.z.toFixed(3)}) -> Dir (${r.direction.x.toFixed(3)}, ${r.direction.y.toFixed(3)}, ${r.direction.z.toFixed(3)})`);
            if (r.interactionDistance) {
                const hitPoint = r.origin.clone().add(r.direction.clone().multiplyScalar(r.interactionDistance));
                console.log(`    Hit at distance ${r.interactionDistance.toFixed(3)} => (${hitPoint.x.toFixed(3)}, ${hitPoint.y.toFixed(3)}, ${hitPoint.z.toFixed(3)})`);
            }
        });

        // 5. Assertions (Based on expected behavior)
        // Ray should hit Lens 1 (x ~ -100)
        // Then it should travel to Lens 2 (x ~ 50) OR miss it if deflected too much.
        // It should NOT hit anything at x=0 (unless ghost).

        // Check Segment 0 (Laser -> Lens 1)
        const firstHit = path[0].interactionDistance;
        expect(firstHit).not.toBeUndefined();
        const hit1 = path[0].origin.clone().add(path[0].direction.clone().multiplyScalar(firstHit!));
        
        // At Y=4 (13mm from center Y=17), the convex surface (R=50) curves back by ~1.7mm.
        // Vertex at -102. Hit at approximately -100.3.
        expect(hit1.x).toBeCloseTo(-100, 0); // Within ~2mm of lens center X
        
        // CRITICAL CHECK: Lens Exit
        // If the ray hits the edge (cylinder), it is absorbed (path.length == 1).
        // If it exits the face, path.length > 1.
        // Both are valid, but the "Ghost" (teleportation) is invalid.
        
        if (path.length > 1) {
            const exitPoint = path[1].origin;
            const distInside = hit1.distanceTo(exitPoint);
            
            console.log(`    Distance traveled inside lens: ${distInside.toFixed(3)} mm`);
            
            // Lens thickness is 4mm. Sag is ~2.3mm. Max path ~7mm.
            // If it's > 20mm, it definitely teleported to a ghost surface.
            expect(distInside).toBeLessThan(10.0); 
        } else {
            console.log("    Ray absorbed at lens edge (Correct behavior for grazing ray)");
        }

        // Check "Ghost" hit
        // User reported deflection at ~100mm later.
        // -100 + 100 = 0.
        // If there is a segment ending near x=0, that's the bug.
        
        // Note: My robust SphericalLens might have already fixed this by ensuring the ray exits correctly or is absorbed.
        // If it was absorbed at the edge (cylindrical hit), path might end at lens 1.
        
        if (path.length > 2) {
             const secondHitDist = path[1].interactionDistance;
             if (secondHitDist) {
                 const hit2 = path[1].origin.clone().add(path[1].direction.clone().multiplyScalar(secondHitDist));
                 console.log(`    Potential Ghost Hit at X=${hit2.x.toFixed(3)}`);
                 
                 // If hit2.x is around 0, that's the ghost!
                 // Lens 2 is at 50.
                 // Anything between -90 and 40 is suspicious.
                 const isGhost = (hit2.x > -90 && hit2.x < 40);
                 expect(isGhost).toBe(false);
             }
        }
    });
});