/**
 * Dispersion.ts — Wavelength-dependent refractive index calculation.
 *
 * Ported from OliveSrc/core/Physics.js with enhancements:
 *   - TypeScript types and enums
 *   - Material presets for common optical glasses
 *   - Compatible with existing SphericalLens/CylindricalLens/PrismLens
 *
 * Usage:
 *   const n = calculateRefractiveIndex(MATERIAL_PRESETS['N-BK7'], 550);
 *   // → ~1.5187
 *
 * Convention: wavelength is in NANOMETERS for the public API.
 * Internally converts to micrometers for the Sellmeier/Schott formulas.
 */

// ─── Dispersion Formula Types ─────────────────────────────────────────

export enum DispersionFormula {
    /** Constant refractive index (no dispersion). Uses `n` field. */
    NONE = 0,
    /** Sellmeier Type 1:  n² = 1 + B₁λ²/(λ²−C₁²) + B₂λ²/(λ²−C₂²) + B₃λ²/(λ²−C₃²) */
    SELLMEIER_1 = 1,
    /** Sellmeier Type 2:  n² = 1 + B₁λ²/(λ²−C₁) + B₂λ²/(λ²−C₂) + B₃λ²/(λ²−C₃)    */
    SELLMEIER_2 = 2,
    /** Power Series:  n² = C₀ + C₁λ² + C₂/λ² + C₃/λ⁴ + C₄/λ⁶ + C₅/λ⁸             */
    POWER_SERIES = 3,
    /** Schott/Zemax:  n² = A₀ + A₁λ² + A₂/λ² + A₃/λ⁴ + A₄/λ⁶ + A₅/λ⁸             */
    SCHOTT = 4,
}

// ─── Material Coefficient Types ───────────────────────────────────────

/** Sellmeier coefficients (Type 1 or Type 2). */
export interface SellmeierCoeffs {
    B1: number; C1: number;
    B2: number; C2: number;
    B3: number; C3: number;
}

/** Power Series or Schott coefficients. */
export interface PolynomialCoeffs {
    C0: number; C1: number; C2: number;
    C3: number; C4: number; C5: number;
}

/**
 * A complete material definition.
 * - `formula`: which dispersion model to use
 * - `coeffs`: the model coefficients
 * - `n`: fallback constant IoR (used when formula === NONE)
 * - `name`: human-readable name for the UI
 * - `abbeNumber`: Abbe number Vd (informational)
 */
export interface MaterialDef {
    name: string;
    formula: DispersionFormula;
    coeffs: SellmeierCoeffs | PolynomialCoeffs;
    n: number;          // constant IoR fallback / reference IoR at 550nm
    abbeNumber: number; // Vd — informational only
}

// ─── Core Calculation ─────────────────────────────────────────────────

/**
 * Calculate the refractive index for a material at a given wavelength.
 *
 * @param material  Material definition (from MATERIAL_PRESETS or custom)
 * @param wavelengthNm  Wavelength in nanometers (e.g., 550)
 * @returns Refractive index n(λ)
 */
export function calculateRefractiveIndex(material: MaterialDef, wavelengthNm: number): number {
    if (material.formula === DispersionFormula.NONE) {
        return material.n;
    }

    // Convert nm → μm for the standard formulas
    const lambda = wavelengthNm / 1000.0;
    const l2 = lambda * lambda;

    switch (material.formula) {
        case DispersionFormula.SELLMEIER_1: {
            const c = material.coeffs as SellmeierCoeffs;
            let sum = 1.0;
            if (c.B1) sum += (c.B1 * l2) / (l2 - c.C1 * c.C1);
            if (c.B2) sum += (c.B2 * l2) / (l2 - c.C2 * c.C2);
            if (c.B3) sum += (c.B3 * l2) / (l2 - c.C3 * c.C3);
            return Math.sqrt(Math.max(sum, 1.0));
        }

        case DispersionFormula.SELLMEIER_2: {
            const c = material.coeffs as SellmeierCoeffs;
            let sum = 1.0;
            if (c.B1) sum += (c.B1 * l2) / (l2 - c.C1);
            if (c.B2) sum += (c.B2 * l2) / (l2 - c.C2);
            if (c.B3) sum += (c.B3 * l2) / (l2 - c.C3);
            return Math.sqrt(Math.max(sum, 1.0));
        }

        case DispersionFormula.POWER_SERIES: {
            const c = material.coeffs as PolynomialCoeffs;
            const il2 = 1.0 / l2;
            const il4 = il2 * il2;
            const n2 = c.C0 + c.C1 * l2 + c.C2 * il2 + c.C3 * il4 + c.C4 * (il4 * il2) + c.C5 * (il4 * il4);
            return Math.sqrt(Math.max(n2, 1.0));
        }

        case DispersionFormula.SCHOTT: {
            const c = material.coeffs as PolynomialCoeffs;
            const il2 = 1.0 / l2;
            const il4 = il2 * il2;
            const n2 = c.C0 + c.C1 * l2 + c.C2 * il2 + c.C3 * il4 + c.C4 * (il4 * il2) + c.C5 * (il4 * il4);
            return Math.sqrt(Math.max(n2, 1.0));
        }

        default:
            return material.n;
    }
}

// ─── Material Presets ─────────────────────────────────────────────────

/**
 * Common optical glass presets with Sellmeier Type 1 coefficients.
 * Data from Schott glass catalog.
 *
 * Key for achromatic doublets:
 *   Crown glass (low dispersion, high Abbe#): N-BK7, Fused Silica, CaF₂
 *   Flint glass (high dispersion, low Abbe#): N-SF6, N-SF11
 */
export const MATERIAL_PRESETS: Record<string, MaterialDef> = {
    'N-BK7': {
        name: 'N-BK7 (Borosilicate Crown)',
        formula: DispersionFormula.SELLMEIER_2,
        coeffs: {
            B1: 1.03961212, C1: 0.00600069867,
            B2: 0.231792344, C2: 0.0200179144,
            B3: 1.01046945, C3: 103.560653,
        } as SellmeierCoeffs,
        n: 1.5168,
        abbeNumber: 64.17,
    },

    'N-SF6': {
        name: 'N-SF6 (Dense Flint)',
        formula: DispersionFormula.SELLMEIER_2,
        coeffs: {
            B1: 1.77931763, C1: 0.0133714182,
            B2: 0.338149866, C2: 0.0617533621,
            B3: 2.08734474, C3: 174.01759,
        } as SellmeierCoeffs,
        n: 1.8052,
        abbeNumber: 25.43,
    },

    'N-SF11': {
        name: 'N-SF11 (Dense Flint)',
        formula: DispersionFormula.SELLMEIER_2,
        coeffs: {
            B1: 1.73759695, C1: 0.01318871,
            B2: 0.313747346, C2: 0.0623068142,
            B3: 1.89878101, C3: 155.23629,
        } as SellmeierCoeffs,
        n: 1.7847,
        abbeNumber: 25.76,
    },

    'Fused Silica': {
        name: 'Fused Silica (SiO₂)',
        formula: DispersionFormula.SELLMEIER_2,
        coeffs: {
            B1: 0.6961663, C1: 0.0046791,
            B2: 0.4079426, C2: 0.0135121,
            B3: 0.8974794, C3: 97.934003,
        } as SellmeierCoeffs,
        n: 1.4585,
        abbeNumber: 67.82,
    },

    'CaF2': {
        name: 'CaF₂ (Calcium Fluoride)',
        formula: DispersionFormula.SELLMEIER_2,
        coeffs: {
            B1: 0.5675888, C1: 0.00252643,
            B2: 0.4710914, C2: 0.01007833,
            B3: 3.8484723, C3: 1200.556,
        } as SellmeierCoeffs,
        n: 1.4339,
        abbeNumber: 95.1,
    },
};

/**
 * Create a "Custom" (constant IoR) material definition.
 * Used when dispersion is disabled — keeps the API uniform.
 */
export function createConstantMaterial(ior: number): MaterialDef {
    return {
        name: 'Custom',
        formula: DispersionFormula.NONE,
        coeffs: { B1: 0, C1: 0, B2: 0, C2: 0, B3: 0, C3: 0 } as SellmeierCoeffs,
        n: ior,
        abbeNumber: 0,
    };
}

/**
 * Get the list of available material preset names (for UI dropdowns).
 */
export function getMaterialNames(): string[] {
    return Object.keys(MATERIAL_PRESETS);
}
