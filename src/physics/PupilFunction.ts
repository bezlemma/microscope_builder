/**
 * PupilFunction — data structures for pupil-plane optics.
 *
 * Defines the pupil function P(r,phi) = A(r,phi) exp(i Phi_ab(r,phi))
 * used by objectives.
 *
 * Coordinates: normalized pupil coordinates rho in [0,1], phi in [0,2pi].
 */

// ---- Zernike Aberration Model ----

export interface ZernikeCoefficient {
    index: number;
    coefficient: number;
}

export interface ZernikeAberrationModel {
    coefficients: ZernikeCoefficient[];
    referenceWavelengthNm: number;
}

export function zernikeNollLabel(index: number): string {
    switch (index) {
        case 1: return 'Piston';
        case 2: return 'Tilt X';
        case 3: return 'Tilt Y';
        case 4: return 'Defocus';
        case 5: return 'Astig 45';
        case 6: return 'Astig 0';
        case 7: return 'Coma Y';
        case 8: return 'Coma X';
        case 9: return 'Trefoil Y';
        case 10: return 'Trefoil X';
        case 11: return 'Spherical';
        default: return `Z${index}`;
    }
}

/**
 * Low-order, orthonormal Noll-indexed Zernike modes over the unit disk.
 * The Objective editor currently exposes indices 4, 5, 6, 7, 8, and 11.
 */
export function evaluateZernikeNoll(index: number, rho: number, phi: number): number {
    const r = Math.max(0, Math.min(1, rho));
    switch (index) {
        case 1:
            return 1;
        case 2:
            return 2 * r * Math.cos(phi);
        case 3:
            return 2 * r * Math.sin(phi);
        case 4:
            return Math.sqrt(3) * (2 * r * r - 1);
        case 5:
            return Math.sqrt(6) * r * r * Math.sin(2 * phi);
        case 6:
            return Math.sqrt(6) * r * r * Math.cos(2 * phi);
        case 7:
            return Math.sqrt(8) * (3 * r * r * r - 2 * r) * Math.sin(phi);
        case 8:
            return Math.sqrt(8) * (3 * r * r * r - 2 * r) * Math.cos(phi);
        case 9:
            return Math.sqrt(8) * r * r * r * Math.sin(3 * phi);
        case 10:
            return Math.sqrt(8) * r * r * r * Math.cos(3 * phi);
        case 11:
            return Math.sqrt(5) * (6 * r ** 4 - 6 * r * r + 1);
        default:
            return 0;
    }
}

export function evaluateZernikeAberrationWaves(
    aberrations: ZernikeAberrationModel | null | undefined,
    xNorm: number,
    yNorm: number,
): number {
    if (!aberrations || aberrations.coefficients.length === 0) return 0;
    const rho = Math.hypot(xNorm, yNorm);
    if (rho > 1 + 1e-9) return 0;
    const phi = Math.atan2(yNorm, xNorm);
    let waves = 0;
    for (const { index, coefficient } of aberrations.coefficients) {
        if (!Number.isFinite(coefficient)) continue;
        waves += coefficient * evaluateZernikeNoll(index, rho, phi);
    }
    return waves;
}

// ---- Pupil Function ----

export interface PupilFunction {
    aberrations: ZernikeAberrationModel | null;
    apodization: Float64Array | null;
}
