/**
 * PupilFunction — data structures for pupil-plane optics.
 *
 * Defines the pupil function P(r,phi) = A(r,phi) exp(i Phi_ab(r,phi))
 * used by objectives and pupil-mask components.
 *
 * Coordinates: normalized pupil coordinates rho in [0,1], phi in [0,2pi].
 */

import type { Complex } from './types';

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

export interface PupilMaskSample {
    transmission: number;
    phase: number;
    jones: [Complex, Complex, Complex, Complex] | null;
}

export interface PupilMask {
    resX: number;
    resY: number;
    samples: PupilMaskSample[];
}

export interface SampledPupilMaskValue {
    transmission: number;
    phase: number;
    jones: [Complex, Complex, Complex, Complex] | null;
}

// ---- Factory helpers ----

export function createUniformPupilMask(res: number = 64): PupilMask {
    const samples: PupilMaskSample[] = new Array(res * res);
    for (let y = 0; y < res; y++) {
        const yNorm = (y + 0.5) / res * 2 - 1;
        for (let x = 0; x < res; x++) {
            const xNorm = (x + 0.5) / res * 2 - 1;
            const rho2 = xNorm * xNorm + yNorm * yNorm;
            samples[y * res + x] = { transmission: rho2 <= 1 ? 1 : 0, phase: 0, jones: null };
        }
    }
    return { resX: res, resY: res, samples };
}

export function createPhaseRingPupilMask(
    innerRadius: number,
    outerRadius: number,
    {
        ringTransmission = 1,
        ringPhase = Math.PI / 2,
        backgroundTransmission = 1,
        backgroundPhase = 0,
        res = 64,
    }: {
        ringTransmission?: number;
        ringPhase?: number;
        backgroundTransmission?: number;
        backgroundPhase?: number;
        res?: number;
    } = {},
): PupilMask {
    const samples: PupilMaskSample[] = new Array(res * res);
    const clampedInner = Math.max(0, Math.min(innerRadius, 1));
    const clampedOuter = Math.max(clampedInner, Math.min(outerRadius, 1));
    for (let y = 0; y < res; y++) {
        const yNorm = (y + 0.5) / res * 2 - 1;
        for (let x = 0; x < res; x++) {
            const xNorm = (x + 0.5) / res * 2 - 1;
            const rho = Math.sqrt(xNorm * xNorm + yNorm * yNorm);
            const insidePupil = rho <= 1;
            const inRing = insidePupil && rho >= clampedInner && rho <= clampedOuter;
            samples[y * res + x] = {
                transmission: insidePupil ? (inRing ? ringTransmission : backgroundTransmission) : 0,
                phase: insidePupil ? (inRing ? ringPhase : backgroundPhase) : 0,
                jones: null,
            };
        }
    }
    return { resX: res, resY: res, samples };
}

function sampleMaskNearest(mask: PupilMask, ix: number, iy: number): PupilMaskSample {
    const x = Math.max(0, Math.min(mask.resX - 1, ix));
    const y = Math.max(0, Math.min(mask.resY - 1, iy));
    return mask.samples[y * mask.resX + x];
}

export function samplePupilMask(
    mask: PupilMask | null,
    xNorm: number,
    yNorm: number,
): SampledPupilMaskValue {
    const rho2 = xNorm * xNorm + yNorm * yNorm;
    if (!mask || rho2 > 1 + 1e-9) {
        return { transmission: rho2 > 1 + 1e-9 ? 0 : 1, phase: 0, jones: null };
    }

    const u = ((xNorm + 1) * 0.5) * mask.resX - 0.5;
    const v = ((yNorm + 1) * 0.5) * mask.resY - 0.5;
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const tx = u - x0;
    const ty = v - y0;

    const s00 = sampleMaskNearest(mask, x0, y0);
    const s10 = sampleMaskNearest(mask, x0 + 1, y0);
    const s01 = sampleMaskNearest(mask, x0, y0 + 1);
    const s11 = sampleMaskNearest(mask, x0 + 1, y0 + 1);

    const blend = (a: number, b: number, c: number, d: number): number => (
        a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty
    );

    // Interpolate phase in phasor (Re/Im) form so that wrap-around near ±π
    // doesn't produce spurious 2π averages (e.g., mixing +π and -π should give
    // ±π, not 0).
    const cos00 = Math.cos(s00.phase), sin00 = Math.sin(s00.phase);
    const cos10 = Math.cos(s10.phase), sin10 = Math.sin(s10.phase);
    const cos01 = Math.cos(s01.phase), sin01 = Math.sin(s01.phase);
    const cos11 = Math.cos(s11.phase), sin11 = Math.sin(s11.phase);
    const cRe = blend(cos00, cos10, cos01, cos11);
    const cIm = blend(sin00, sin10, sin01, sin11);
    const interpolatedPhase = (cRe === 0 && cIm === 0) ? s00.phase : Math.atan2(cIm, cRe);

    return {
        transmission: Math.max(0, blend(s00.transmission, s10.transmission, s01.transmission, s11.transmission)),
        phase: interpolatedPhase,
        jones: s00.jones ?? s10.jones ?? s01.jones ?? s11.jones ?? null,
    };
}
