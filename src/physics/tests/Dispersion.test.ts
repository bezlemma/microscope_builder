import { describe, expect, test } from "bun:test";
import {
    calculateRefractiveIndex,
    MATERIAL_PRESETS,
    createConstantMaterial,
    getMaterialNames,
} from "../Dispersion";

describe("Dispersion", () => {
    // ─── Sellmeier Type 1: N-BK7 ─────────────────────────────────────

    test("N-BK7 at d-line (587.56nm) should match catalog value", () => {
        const n = calculateRefractiveIndex(MATERIAL_PRESETS['N-BK7'], 587.56);
        // Schott catalog: n_d = 1.51680
        expect(n).toBeCloseTo(1.5168, 3);
    });

    test("N-BK7 at F-line (486.13nm, blue) should be higher than d-line", () => {
        const nBlue = calculateRefractiveIndex(MATERIAL_PRESETS['N-BK7'], 486.13);
        const nD = calculateRefractiveIndex(MATERIAL_PRESETS['N-BK7'], 587.56);
        // Blue bends more → higher IoR
        expect(nBlue).toBeGreaterThan(nD);
        // Catalog: n_F ≈ 1.52238
        expect(nBlue).toBeCloseTo(1.5224, 3);
    });

    test("N-BK7 at C-line (656.27nm, red) should be lower than d-line", () => {
        const nRed = calculateRefractiveIndex(MATERIAL_PRESETS['N-BK7'], 656.27);
        const nD = calculateRefractiveIndex(MATERIAL_PRESETS['N-BK7'], 587.56);
        // Red bends less → lower IoR
        expect(nRed).toBeLessThan(nD);
        // Catalog: n_C ≈ 1.51432
        expect(nRed).toBeCloseTo(1.5143, 3);
    });

    // ─── Sellmeier Type 1: N-SF6 (Dense Flint) ───────────────────────

    test("N-SF6 at d-line should have high IoR (~1.805)", () => {
        const n = calculateRefractiveIndex(MATERIAL_PRESETS['N-SF6'], 587.56);
        // Catalog: n_d ≈ 1.80518
        expect(n).toBeCloseTo(1.805, 2);
    });

    test("N-SF6 dispersion should be much larger than N-BK7", () => {
        const bk7Blue = calculateRefractiveIndex(MATERIAL_PRESETS['N-BK7'], 486.13);
        const bk7Red = calculateRefractiveIndex(MATERIAL_PRESETS['N-BK7'], 656.27);
        const sf6Blue = calculateRefractiveIndex(MATERIAL_PRESETS['N-SF6'], 486.13);
        const sf6Red = calculateRefractiveIndex(MATERIAL_PRESETS['N-SF6'], 656.27);

        const bk7Spread = bk7Blue - bk7Red;
        const sf6Spread = sf6Blue - sf6Red;

        // SF6 is flint glass — should have ~3x more dispersion
        expect(sf6Spread).toBeGreaterThan(bk7Spread * 2);
    });

    // ─── Constant Material ────────────────────────────────────────────

    test("Constant material should return same IoR at all wavelengths", () => {
        const mat = createConstantMaterial(1.5);
        expect(calculateRefractiveIndex(mat, 400)).toBe(1.5);
        expect(calculateRefractiveIndex(mat, 550)).toBe(1.5);
        expect(calculateRefractiveIndex(mat, 700)).toBe(1.5);
    });

    // ─── Edge Cases ───────────────────────────────────────────────────

    test("Fused Silica at 550nm should be ~1.46", () => {
        const n = calculateRefractiveIndex(MATERIAL_PRESETS['Fused Silica'], 550);
        expect(n).toBeCloseTo(1.46, 1);
    });

    test("CaF2 at 550nm should be ~1.43", () => {
        const n = calculateRefractiveIndex(MATERIAL_PRESETS['CaF2'], 550);
        expect(n).toBeCloseTo(1.43, 1);
    });

    test("getMaterialNames returns all 5 presets", () => {
        const names = getMaterialNames();
        expect(names).toContain('N-BK7');
        expect(names).toContain('N-SF6');
        expect(names).toContain('N-SF11');
        expect(names).toContain('Fused Silica');
        expect(names).toContain('CaF2');
        expect(names.length).toBe(5);
    });

    // ─── Numerical Safety ─────────────────────────────────────────────

    test("Should not produce NaN or < 1.0 for extreme wavelengths", () => {
        const materials = Object.values(MATERIAL_PRESETS);
        for (const mat of materials) {
            // UV edge
            const nUV = calculateRefractiveIndex(mat, 200);
            expect(nUV).toBeGreaterThanOrEqual(1.0);
            expect(isNaN(nUV)).toBe(false);

            // IR edge
            const nIR = calculateRefractiveIndex(mat, 2000);
            expect(nIR).toBeGreaterThanOrEqual(1.0);
            expect(isNaN(nIR)).toBe(false);
        }
    });
});
