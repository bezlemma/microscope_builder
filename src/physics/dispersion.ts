const REFERENCE_WAVELENGTH_NM = 550;
const FRAUNHOFER_F_NM = 486.1;
const FRAUNHOFER_C_NM = 656.3;
const FRAUNHOFER_DELTA_INV_SQ = (1 / (FRAUNHOFER_F_NM * FRAUNHOFER_F_NM))
    - (1 / (FRAUNHOFER_C_NM * FRAUNHOFER_C_NM));

type DispersionFamily = 'glass' | 'liquid';

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function smoothstep01(value: number): number {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
}

function estimateAbbeNumber(referenceIor: number, family: DispersionFamily = 'glass'): number {
    if (!Number.isFinite(referenceIor) || referenceIor <= 1.000001) return Number.POSITIVE_INFINITY;

    if (family === 'liquid') {
        const t = smoothstep01((referenceIor - 1.333) / 0.19);
        return 55 + (34 - 55) * t;
    }

    // Glass Abbe estimator:
    // Interpolate between typical crown (n=1.5168, V≈64) and typical flint (n≈1.75, V≈30)
    // within their canonical range, then EXTRAPOLATE linearly beyond to keep the
    // monotonic n-vs-V relation (higher index → lower Abbe). Without extrapolation,
    // all n ≥ 1.75 would incorrectly collapse to V=30 and defeat doublet correction.
    const lo = 1.5168;
    const hi = 1.75;
    const vLo = 64;
    const vHi = 30;
    if (referenceIor >= lo && referenceIor <= hi) {
        const t = smoothstep01((referenceIor - lo) / (hi - lo));
        return vLo + (vHi - vLo) * t;
    }
    // Linear extrapolation using the same slope, clamped to a physical floor.
    const slope = (vHi - vLo) / (hi - lo);
    const v = vLo + slope * (referenceIor - lo);
    return Math.max(v, 10);
}

function cauchyBCoefficientFromReferenceIor(
    referenceIor: number,
    abbeNumber: number,
): number {
    if (!Number.isFinite(referenceIor) || referenceIor <= 1.000001) return 0;
    if (!Number.isFinite(abbeNumber) || abbeNumber <= 1e-9) return 0;
    return (referenceIor - 1) / (abbeNumber * FRAUNHOFER_DELTA_INV_SQ);
}

export function cauchyIorFromReference(
    referenceIor: number,
    wavelengthMeters: number,
    options: {
        abbeNumber?: number;
        family?: DispersionFamily;
    } = {},
): number {
    if (!Number.isFinite(referenceIor) || referenceIor <= 1.000001) {
        return Math.max(referenceIor || 1, 1);
    }

    const wavelengthNm = Math.max(wavelengthMeters * 1e9, 1);
    const abbeNumber = options.abbeNumber
        ?? estimateAbbeNumber(referenceIor, options.family ?? 'glass');
    const b = cauchyBCoefficientFromReferenceIor(referenceIor, abbeNumber);
    if (b <= 0) return referenceIor;

    const a = referenceIor - b / (REFERENCE_WAVELENGTH_NM * REFERENCE_WAVELENGTH_NM);
    return a + b / (wavelengthNm * wavelengthNm);
}
