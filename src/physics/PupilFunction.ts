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
