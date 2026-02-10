import { describe, expect, test } from "bun:test";
import React from 'react';
// import { render, fireEvent, screen } from '@testing-library/react'; // Can't easily use RTL with Bun yet without setup
// Instead, we will test the logic by instantiating the Component and checking its methods/properties directly
// verifying that the data structure supports the new features.

import { SphericalLens } from '../../physics/components/SphericalLens';

describe("Inspector Logic - Lens Radii", () => {
    test("SphericalLens supports asymmetric radii", () => {
        const lens = new SphericalLens(0.02, 10, 5, "TestLens");
        
        // Default symmetric
        const rInitial = lens.getRadii();
        expect(rInitial.R1).toBeCloseTo(50);
        expect(rInitial.R2).toBeCloseTo(-50);
        
        // Modify manually (simulating Inspector)
        lens.r1 = 100;
        lens.r2 = -30;
        
        const rNew = lens.getRadii();
        expect(rNew.R1).toBe(100);
        expect(rNew.R2).toBe(-30);
    });

    test("SphericalLens handles Infinity for Plano", () => {
        const lens = new SphericalLens(0.02, 10, 5, "TestLens");
        
        // Set plano-convex
        lens.r1 = 1e9; // Infinity
        lens.r2 = -50;
        
        const r = lens.getRadii();
        expect(r.R1).toBeGreaterThan(1e8);
        expect(r.R2).toBe(-50);
        
        // Verify intersection logic handles large R
        // (This is implicitly tested in Solver tests via getRadii usage)
    });
});
