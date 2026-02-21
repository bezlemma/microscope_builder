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

    test("Concave Lens Divergence: Ray at r=7 should exit and diverge", () => {
        // Concave lens (f approx -20mm). Curvature -0.05.
        // Aperture 10. Thickness 5.
        // R approx -20.
        // Ray enters at r=7 — within the physical glass body, well inside the rim.
        // At r=9, the refracted internal ray diverges enough to hit the cylindrical
        // rim wall and undergo TIR (physically correct absorption). r=7 stays 
        // within the optical surface and properly exits through the back.
        const concaveLens = new SphericalLens(-0.05, 10, 5, "Concave");
        
        const ray: Ray = {
            origin: new Vector3(7, 0, -10),
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
            // Ray should exit (it's within the physical glass body)
            expect(result.rays.length).toBe(1);
            // Exit ray should diverge outward (positive x-direction for r=7 entry)
            if (result.rays.length > 0) {
                expect(result.rays[0].direction.x).toBeGreaterThan(0);
            }
        }
    });

    /**
     * CONDENSER LENS TEST — uses the exact lens from the Transmission Microscope preset.
     * 
     * This catches the real bugs visible in the app:
     *   1) Rays stopping at the lens edge instead of passing through
     *   2) Rays going through the lens UNBENT (direction unchanged)
     *   3) The "sheet of glass" artifact (SDF sphere extending beyond physical aperture)
     *
     * Condenser: plano-convex, f=25mm, R1=∞ (flat), R2=-12.5mm, ior=1.5
     * Aperture radius=10mm, thickness=4mm.
     * Positioned at (-25, 0, 0), rotated π/2 about Y (optical axis → world +X).
     * Laser fires from (-80, 0, 0) in +X direction.
     */
    test("Condenser lens from Transmission Microscope: rays must refract, not stop or pass straight", () => {
        const { Solver1 } = require("../Solver1");

        // Exact condenser from TransmissionFluorescence.ts
        const condenser = new SphericalLens(1/25, 10, 4, "Condenser", 1e9, -12.5, 1.5);
        condenser.setPosition(-25, 0, 0);
        condenser.setRotation(0, Math.PI / 2, 0); // Optical axis → world +X

        const solver = new Solver1([condenser]);

        // Test rays at multiple Y-offsets within the aperture
        // All should pass through (TIR at extreme angles is clamped to grazing exit)
        const offsets = [0, 1, 2, 3, 5, 7, 8, 8.5, 9];
        const results: { offset: number; pathLen: number; dirY: number; passed: boolean }[] = [];

        for (const yOff of offsets) {
            const ray: Ray = {
                origin: new Vector3(-80, yOff, 0),
                direction: new Vector3(1, 0, 0),
                wavelength: 550e-9,
                intensity: 1,
                polarization: { x: {re:1, im:0}, y: {re:0, im:0} },
                opticalPathLength: 0,
                footprintRadius: 0,
                coherenceMode: Coherence.Incoherent
            };

            const paths = solver.trace([ray]);
            const path = paths[0];
            results.push({
                offset: yOff,
                pathLen: path.length,
                dirY: path.length > 1 ? path[1].direction.y : 0,
                passed: path.length > 1
            });
        }

        // DEBUG: Print all results for diagnosis
        console.log("\n--- Condenser Lens Test Results ---");
        for (const r of results) {
            const status = !r.passed ? "STOPPED" : (r.offset > 0 && Math.abs(r.dirY) < 1e-3 ? "UNBENT" : "OK");
            console.log(`  Y=${r.offset}mm: path=${r.pathLen} segments, exit dirY=${r.dirY.toFixed(6)} → ${status}`);
        }

        // ASSERTION 1: ALL rays within the aperture must pass through
        for (const r of results) {
            expect(r.passed).toBe(true);
        }

        // ASSERTION 2: Off-axis rays must be BENT
        for (const r of results) {
            if (r.offset > 0) {
                expect(r.dirY).toBeLessThan(-1e-3);
            }
        }

        // ASSERTION 3: On-axis ray should pass roughly straight through
        const axial = results.find(r => r.offset === 0)!;
        expect(Math.abs(axial.dirY)).toBeLessThan(5e-3);
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
