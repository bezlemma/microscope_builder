import { describe, expect, test } from "bun:test";
import { Vector3 } from "three";
import { SphericalLens } from "../components/SphericalLens";
import { Ray, Coherence } from "../types";

describe("SphericalLens", () => {
    // Setup standard lens
    // Curvature 0.02 [1/mm]. f approx R/(n-1). R = 2(0.5)/0.02 = 50mm. f=50mm.
    // Aperture 10mm. Thickness 5mm.
    const lens = new SphericalLens(0.02, 10, 5, "TestLens"); 
    
    test("Ray through center should pass straight", () => {
        const ray: Ray = {
            origin: new Vector3(0, 0, -20),
            direction: new Vector3(0, 0, 1),
            wavelength: 500e-9,
            intensity: 1,
            polarization: { x: {re:1, im:0}, y: {re:0, im:0} },
            opticalPathLength: 0,
            footprintRadius: 0,
            coherenceMode: Coherence.Incoherent
        };
        
        // Ray is already in "Local" space if we assume lens is at origin
        const hit = lens.intersect(ray);
        
        expect(hit).not.toBeNull();
        if (hit) {
            const result = lens.interact(ray, hit);
            expect(result.rays.length).toBe(1);
            const outRay = result.rays[0];
            // Direction should be roughly (0,0,1)
            expect(outRay.direction.x).toBeCloseTo(0);
            expect(outRay.direction.y).toBeCloseTo(0);
            expect(outRay.direction.z).toBeCloseTo(1);
        }
    });

    test("Ghost Geometry Check: Ray outside aperture should be blocked", () => {
        // Aperture radius is 10.
        // Shoot ray at x=12.
        const ray: Ray = {
            origin: new Vector3(12, 0, -20),
            direction: new Vector3(0, 0, 1),
            wavelength: 500e-9,
            intensity: 1,
            polarization: { x: {re:1, im:0}, y: {re:0, im:0} },
            opticalPathLength: 0,
            footprintRadius: 0,
            coherenceMode: Coherence.Incoherent
        };

        const hit = lens.intersect(ray);
        // Intersect filters by aperture radius now.
        // So intersect should return null (ray misses the lens physical body).
        expect(hit).toBeNull();
    });

    test("Concave Lens Divergence Block: Ray diverging into aperture wall", () => {
        // Concave lens (f approx -20mm). Curvature -0.05.
        // Aperture 10. Thickness 5.
        // R approx -20.
        // Ray enters at 9. Diverges. Should hit side.
        const concaveLens = new SphericalLens(-0.05, 10, 5, "Concave");
        
        const ray: Ray = {
            origin: new Vector3(9, 0, -10),
            direction: new Vector3(0, 0, 1),
            wavelength: 500e-9,
            intensity: 1,
            polarization: { x: {re:1, im:0}, y: {re:0, im:0} },
            opticalPathLength: 0,
            footprintRadius: 0,
            coherenceMode: Coherence.Incoherent
        };
        
        const hit = concaveLens.intersect(ray);
        expect(hit).not.toBeNull();
        
        if (hit) {
            const result = concaveLens.interact(ray, hit);
            // Ray enters at 9. Diverges strongly.
            // Should hit cylinder wall (r=10) or exit sphere at r>10.
            // In both cases, interact should return 0 rays (Absorbed).
             if (result.rays.length > 0) {
                const r = result.rays[0];
                console.log(`Concave Failed! Ray exited at r=${Math.sqrt(r.origin.x**2+r.origin.y**2).toFixed(3)}`);
            }
            expect(result.rays.length).toBe(0);
        }
    });

    test("Rotated Lens (via Solver1 pipeline): Off-axis ray should converge", () => {
        // This test exercises the FULL chkIntersection() -> interact() pipeline
        // with a rotated lens, which is the codepath where coordinate-space bugs appear.
        // Setup: Lens at origin, rotated 90° so optical axis aligns with world +X.
        // Fire a parallel ray offset in Y, verify it refracts inward (toward axis).
        
        const { Solver1 } = require("../Solver1");
        
        const rotatedLens = new SphericalLens(0.02, 10, 5, "RotatedLens");
        rotatedLens.setPosition(0, 0, 0);
        rotatedLens.setRotation(0, Math.PI / 2, 0); // Optical axis -> World +X
        
        const ray: Ray = {
            origin: new Vector3(-20, 3, 0), // Off-axis in Y
            direction: new Vector3(1, 0, 0), // Parallel to optical axis
            wavelength: 500e-9,
            intensity: 1,
            polarization: { x: {re:1, im:0}, y: {re:0, im:0} },
            opticalPathLength: 0,
            footprintRadius: 0,
            coherenceMode: Coherence.Incoherent
        };
        
        const solver = new Solver1([rotatedLens]);
        const paths = solver.trace([ray]);
        const path = paths[0];
        
        // Path should have at least 2 segments (source ray + refracted ray)
        expect(path.length).toBeGreaterThanOrEqual(2);
        
        if (path.length >= 2) {
            const outRay = path[1];
            // For a positive (convex) lens with ray at Y=+3:
            // Output ray should deflect DOWNWARD (negative Y component)
            // This confirms refraction toward the focal point.
            expect(outRay.direction.y).toBeLessThan(0);
            
            // Direction should still be mostly +X (not wildly deflected)
            expect(outRay.direction.x).toBeGreaterThan(0.9);
            
            // Origin should be near the lens (X near 0, not teleported)
            expect(Math.abs(outRay.origin.x)).toBeLessThan(5);
        }
    });
});
