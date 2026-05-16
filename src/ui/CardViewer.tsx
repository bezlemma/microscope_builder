import React, { useEffect, useMemo, useRef } from 'react';
import { useAtom } from 'jotai';
import { Card, BeamProfile } from '../physics/components/Card';
import { cardImageTickAtom } from '../state/store';
import type { Ray } from '../physics/types';

// ─── Types ─────────────────────────────────────────────────────────

type DisplayMapping = 'linear' | 'gamma' | 'log';

type DirectCardHit = { localPoint: { x: number; y: number }; ray: Ray };
type DetectorViewport = { extentMm: number; centerU: number; centerV: number };
type DirectHitBounds = {
    minU: number;
    maxU: number;
    minV: number;
    maxV: number;
    centerU: number;
    centerV: number;
    spanU: number;
    spanV: number;
    avgFootprint: number;
};

// ─── Wavelength → Color helpers ─────────────────────────────────────

function wavelengthToCSS(wavelengthMeters: number): string {
    const wl = wavelengthMeters * 1e9;
    let r = 0, g = 0, b = 0;

    if (wl >= 380 && wl < 440) { r = -(wl - 440) / 60; b = 1.0; }
    else if (wl >= 440 && wl < 490) { g = (wl - 440) / 50; b = 1.0; }
    else if (wl >= 490 && wl < 510) { g = 1.0; b = -(wl - 510) / 20; }
    else if (wl >= 510 && wl < 580) { r = (wl - 510) / 70; g = 1.0; }
    else if (wl >= 580 && wl < 645) { r = 1.0; g = -(wl - 645) / 65; }
    else if (wl >= 645 && wl <= 780) { r = 1.0; }
    else { return 'rgb(128,128,128)'; }

    let factor = 1.0;
    if (wl >= 380 && wl < 420) factor = 0.3 + 0.7 * (wl - 380) / 40;
    else if (wl >= 645 && wl <= 780) factor = 0.3 + 0.7 * (780 - wl) / 135;

    const R = Math.round(Math.pow(r * factor, 0.8) * 255);
    const G = Math.round(Math.pow(g * factor, 0.8) * 255);
    const B = Math.round(Math.pow(b * factor, 0.8) * 255);
    return `rgb(${R},${G},${B})`;
}

function wavelengthRGB(wavelengthMeters: number): [number, number, number] {
    const wl = wavelengthMeters * 1e9;
    let cr = 0, cg = 0, cb = 0;

    if (wl >= 380 && wl < 440) { cr = -(wl - 440) / 60; cb = 1.0; }
    else if (wl >= 440 && wl < 490) { cg = (wl - 440) / 50; cb = 1.0; }
    else if (wl >= 490 && wl < 510) { cg = 1.0; cb = -(wl - 510) / 20; }
    else if (wl >= 510 && wl < 580) { cr = (wl - 510) / 70; cg = 1.0; }
    else if (wl >= 580 && wl < 645) { cr = 1.0; cg = -(wl - 645) / 65; }
    else if (wl >= 645 && wl <= 780) { cr = 1.0; }
    else { cr = 0.5; cg = 0.5; cb = 0.5; }

    let factor = 1.0;
    if (wl >= 380 && wl < 420) factor = 0.3 + 0.7 * (wl - 380) / 40;
    else if (wl >= 645 && wl <= 780) factor = 0.3 + 0.7 * (780 - wl) / 135;

    return [
        Math.pow(cr * factor, 0.8) * 255,
        Math.pow(cg * factor, 0.8) * 255,
        Math.pow(cb * factor, 0.8) * 255
    ];
}

// ─── Display mapping ───────────────────────────────────────────────

function mapDisplayValue(normalized: number, mapping: DisplayMapping): number {
    const safe = Math.max(0, Math.min(1, normalized));
    if (mapping === 'linear') return safe;
    if (mapping === 'gamma') return Math.pow(safe, 0.45);
    // log: log10(1 + v*2047) / log10(2048)
    return Math.log10(1 + safe * 2047) / Math.log10(2048);
}

function directCardHits(card: Card): DirectCardHit[] {
    return card.hits.filter(hit =>
        hit.ray.intensity > 0
        && !hit.ray.isBackward
        && !hit.ray.sourceId?.startsWith('solver3_')
    );
}

function beamProfilesFromDirectHits(hits: DirectCardHit[]): BeamProfile[] {
    if (hits.length === 0) return [];

    const byWavelength = new Map<number, DirectCardHit[]>();
    for (const hit of hits) {
        const key = Math.round(hit.ray.wavelength * 1e12);
        const group = byWavelength.get(key);
        if (group) group.push(hit);
        else byWavelength.set(key, [hit]);
    }

    const profiles: BeamProfile[] = [];
    for (const group of byWavelength.values()) {
        let totalPower = 0;
        let meanU = 0;
        let meanV = 0;
        let meanPhase = 0;
        let polXre = 0, polXim = 0, polYre = 0, polYim = 0, polZre = 0, polZim = 0;
        const avgDir = group[0].ray.direction.clone();

        for (let i = 0; i < group.length; i++) {
            const { localPoint, ray } = group[i];
            const weight = Math.max(ray.intensity, 1e-12);
            totalPower += weight;
            meanU += localPoint.x * weight;
            meanV += localPoint.y * weight;
            meanPhase += (ray.opticalPathLength ?? 0) * weight;
            polXre += ray.polarization.x.re * weight;
            polXim += ray.polarization.x.im * weight;
            polYre += ray.polarization.y.re * weight;
            polYim += ray.polarization.y.im * weight;
            polZre += ray.polarization.z.re * weight;
            polZim += ray.polarization.z.im * weight;
            if (i > 0) avgDir.add(ray.direction);
        }

        if (totalPower <= 0) continue;
        meanU /= totalPower;
        meanV /= totalPower;
        meanPhase /= totalPower;

        let varU = 0;
        let varV = 0;
        for (const { localPoint, ray } of group) {
            const weight = Math.max(ray.intensity, 1e-12);
            varU += (localPoint.x - meanU) ** 2 * weight;
            varV += (localPoint.y - meanV) ** 2 * weight;
        }

        avgDir.normalize();
        const footprint = group.reduce((sum, hit) => sum + (hit.ray.footprintRadius ?? 0), 0) / group.length;
        const wx = Math.max(Math.sqrt(varU / totalPower), footprint, 0.05);
        const wy = Math.max(Math.sqrt(varV / totalPower), footprint, 0.05);
        const polMag = Math.sqrt(polXre ** 2 + polXim ** 2 + polYre ** 2 + polYim ** 2 + polZre ** 2 + polZim ** 2) || 1;

        profiles.push({
            wx,
            wy,
            wavelength: group[0].ray.wavelength,
            power: totalPower,
            polarization: {
                x: { re: polXre / polMag, im: polXim / polMag },
                y: { re: polYre / polMag, im: polYim / polMag },
                z: { re: polZre / polMag, im: polZim / polMag },
            },
            phase: meanPhase,
            centerU: meanU,
            centerV: meanV,
            tiltU: avgDir.x,
            tiltV: avgDir.y,
        });
    }

    return profiles;
}

function computeDirectHitBounds(hits: DirectCardHit[]): DirectHitBounds | null {
    if (hits.length === 0) return null;

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    let footprintSum = 0;
    let footprintCount = 0;

    for (const hit of hits) {
        const u = hit.localPoint.x;
        const v = hit.localPoint.y;
        if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);

        const footprint = hit.ray.footprintRadius ?? 0;
        if (Number.isFinite(footprint) && footprint > 0) {
            footprintSum += footprint;
            footprintCount++;
        }
    }

    if (!Number.isFinite(minU) || !Number.isFinite(minV)) return null;
    const spanU = Math.max(0, maxU - minU);
    const spanV = Math.max(0, maxV - minV);

    return {
        minU,
        maxU,
        minV,
        maxV,
        centerU: (minU + maxU) / 2,
        centerV: (minV + maxV) / 2,
        spanU,
        spanV,
        avgFootprint: footprintCount > 0 ? footprintSum / footprintCount : 0,
    };
}

function detectorViewport(card: Card, directHits: DirectCardHit[]): DetectorViewport {
    const fullExtent = Math.max(card.width, card.height);
    const bounds = computeDirectHitBounds(directHits);
    if (!bounds) return { extentMm: fullExtent, centerU: 0, centerV: 0 };

    const span = Math.max(bounds.spanU, bounds.spanV);
    const beamletSupport = Math.max(bounds.avgFootprint * 7, 0.05);
    const extent = Math.max(span + beamletSupport, bounds.avgFootprint * 10, 0.25);
    return {
        extentMm: Math.min(fullExtent, Math.max(0.05, extent)),
        centerU: bounds.centerU,
        centerV: bounds.centerV,
    };
}

function niceScaleLengthMm(extentMm: number): number {
    const target = Math.max(extentMm * 0.28, 1e-6);
    const power = 10 ** Math.floor(Math.log10(target));
    const normalized = target / power;
    const step = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
    return step * power;
}

function formatScaleLength(mm: number): string {
    if (mm >= 1) return `${mm.toFixed(mm >= 10 ? 0 : 1)} mm`;
    return `${Math.round(mm * 1000)} um`;
}

function drawDetectorScaleBar(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    viewExtentMm: number,
) {
    ctx.save();
    const scaleLength = niceScaleLengthMm(viewExtentMm);
    const scalePx = Math.max(24, (scaleLength / viewExtentMm) * width);
    const x1 = width - scalePx - 18;
    const y = height - 18;
    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x1 + scalePx, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(formatScaleLength(scaleLength), width - 18, y - 6);

    ctx.restore();
}

function depositHitsToBuffer(
    rgb: Float32Array,
    width: number,
    height: number,
    hits: DirectCardHit[],
    viewport: DetectorViewport,
) {
    const viewExtentMm = viewport.extentMm;
    const scaleX = viewExtentMm / width;
    const scaleY = viewExtentMm / height;

    const maxDrawnHits = 6000;
    const stride = Math.max(1, Math.ceil(hits.length / maxDrawnHits));
    const pixelSizeMm = Math.min(scaleX, scaleY);
    const deposit = (px: number, py: number, r: number, g: number, b: number, power: number, beamletRadiusMm: number) => {
        const radiusPx = Math.max(1.25, beamletRadiusMm * 3 / pixelSizeMm);
        const radius = Math.ceil(Math.min(96, radiusPx));
        const minX = Math.max(0, Math.floor(px - radius));
        const maxX = Math.min(width - 1, Math.ceil(px + radius));
        const minY = Math.max(0, Math.floor(py - radius));
        const maxY = Math.min(height - 1, Math.ceil(py + radius));
        const radiusMm2 = Math.max(beamletRadiusMm * beamletRadiusMm, pixelSizeMm * pixelSizeMm);
        let weightSum = 0;

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const dxMm = (x + 0.5 - px) * scaleX;
                const dyMm = (y + 0.5 - py) * scaleY;
                const q = (dxMm * dxMm + dyMm * dyMm) / radiusMm2;
                const weight = Math.exp(-2 * q);
                if (weight < 1e-5) continue;
                weightSum += weight;
            }
        }
        if (weightSum <= 0) return;

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const dxMm = (x + 0.5 - px) * scaleX;
                const dyMm = (y + 0.5 - py) * scaleY;
                const q = (dxMm * dxMm + dyMm * dyMm) / radiusMm2;
                const gaussian = Math.exp(-2 * q);
                if (gaussian < 1e-5) continue;
                const weight = power * gaussian / weightSum;
                const idx = (y * width + x) * 3;
                rgb[idx] += r * weight;
                rgb[idx + 1] += g * weight;
                rgb[idx + 2] += b * weight;
            }
        }
    };

    for (let hitIndex = 0; hitIndex < hits.length; hitIndex += stride) {
        const { localPoint, ray } = hits[hitIndex];
        const cx = width / 2 + (localPoint.x - viewport.centerU) / scaleX;
        const cy = height / 2 + (localPoint.y - viewport.centerV) / scaleY;
        if (cx < -1 || cx > width || cy < -1 || cy > height) continue;

        const [r, g, b] = wavelengthRGB(ray.wavelength);
        const power = Math.max(ray.intensity * stride, 0);
        const footprintRadius = Number.isFinite(ray.footprintRadius) ? Math.max(ray.footprintRadius, 0) : 0;
        const beamletRadiusMm = Math.max(footprintRadius, pixelSizeMm * 0.75);
        deposit(cx, cy, r, g, b, power, beamletRadiusMm);
    }
}

function renderBufferToCanvas(
    ctx: CanvasRenderingContext2D,
    rgb: Float32Array,
    width: number,
    height: number,
    mapping: DisplayMapping,
    reusableImageData?: ImageData,
) {
    // Allocate a fresh ImageData only when no reusable one was provided (or
    // its size doesn't match). The phosphor path always provides one because
    // it runs at animation rate and the per-frame Uint8ClampedArray
    // allocation otherwise dominates GC churn.
    const imageData = (reusableImageData && reusableImageData.width === width && reusableImageData.height === height)
        ? reusableImageData
        : ctx.createImageData(width, height);
    const data = imageData.data;
    let maxValue = 0;
    for (let i = 0; i < rgb.length; i++) {
        maxValue = Math.max(maxValue, rgb[i]);
    }
    const norm = maxValue > 0 ? 1 / maxValue : 1;
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
        data[j] = Math.round(mapDisplayValue(rgb[i] * norm, mapping) * 255);
        data[j + 1] = Math.round(mapDisplayValue(rgb[i + 1] * norm, mapping) * 255);
        data[j + 2] = Math.round(mapDisplayValue(rgb[i + 2] * norm, mapping) * 255);
        data[j + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
}

function drawDirectHits(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    hits: DirectCardHit[],
    viewport: DetectorViewport,
    mapping: DisplayMapping,
) {
    const rgb = new Float32Array(width * height * 3);
    depositHitsToBuffer(rgb, width, height, hits, viewport);
    renderBufferToCanvas(ctx, rgb, width, height, mapping);
    drawDetectorScaleBar(ctx, width, height, viewport.extentMm);
}

// ─── Power formatting ──────────────────────────────────────────────

function fmtPower(watts: number): string {
    if (watts >= 1) return `${watts.toFixed(2)} W`;
    if (watts >= 1e-3) return `${(watts * 1e3).toFixed(2)} mW`;
    if (watts >= 1e-6) return `${(watts * 1e6).toFixed(2)} uW`;
    if (watts >= 1e-9) return `${(watts * 1e9).toFixed(2)} nW`;
    if (watts >= 1e-12) return `${(watts * 1e12).toFixed(2)} pW`;
    return `${watts.toExponential(2)} W`;
}

// ─── Beam moment computation from Gaussian profiles ────────────────

interface BeamMomentSummary {
    totalPower: number;
    groupCount: number;
    majorDiameter: number;   // 1/e^2 major (mm)
    minorDiameter: number;   // 1/e^2 minor (mm)
}

interface InterferenceSummary {
    wavelengthNm: number;
    deltaOplMm: number;
    phaseDeg: number;
    visibility: number;
    balance: number;
    overlap: number;
    polarizationOverlap: number;
    coherentPower: number;
    incoherentPower: number;
    state: 'bright' | 'dark' | 'mid';
}

function computeBeamMoments(profiles: BeamProfile[]): BeamMomentSummary | null {
    if (profiles.length === 0) return null;

    // Count wavelength groups
    const groups = new Set<number>();
    let totalPower = 0;
    for (const p of profiles) {
        groups.add(Math.round(p.wavelength * 1e12));
        totalPower += p.power;
    }

    if (profiles.length === 1) {
        const p = profiles[0];
        // For a single Gaussian, the 1/e^2 diameters are 2*wx, 2*wy
        const diam1 = 2 * p.wx;
        const diam2 = 2 * p.wy;
        return {
            totalPower,
            groupCount: groups.size,
            majorDiameter: Math.max(diam1, diam2),
            minorDiameter: Math.min(diam1, diam2),
        };
    }

    // For multiple beams, compute second-moment beam diameters from
    // the composite intensity distribution using the analytical moments
    // of a sum of Gaussians:
    //   I(u,v) = sum_i A_i * exp(-2*((u - cu_i)^2/wx_i^2 + (v - cv_i)^2/wy_i^2))
    // The weighted centroid and covariance can be computed analytically from
    // the beam parameters since the integral of a Gaussian is known.

    // Each beam's contribution weight = power * pi * wx * wy / 2
    // (integral of Gaussian with exp(-2r^2/w^2) over the plane)
    let weightSum = 0;
    let meanU = 0;
    let meanV = 0;
    const weights: number[] = [];

    for (const p of profiles) {
        const w = p.power * p.wx * p.wy; // proportional to integrated power
        weights.push(w);
        weightSum += w;
        meanU += w * (p.centerU ?? 0);
        meanV += w * (p.centerV ?? 0);
    }

    if (weightSum < 1e-30) return null;
    meanU /= weightSum;
    meanV /= weightSum;

    // Second moments: for each Gaussian, <(u - meanU)^2> = sigma_u^2 + (cu - meanU)^2
    // where sigma_u = wx / 2 for 1/e^2 definition
    let covUU = 0;
    let covVV = 0;
    let covUV = 0;
    for (let i = 0; i < profiles.length; i++) {
        const p = profiles[i];
        const w = weights[i];
        const du = (p.centerU ?? 0) - meanU;
        const dv = (p.centerV ?? 0) - meanV;
        // Variance of a single Gaussian: sigma^2 = w^2 / 4
        const sigU2 = (p.wx * p.wx) / 4;
        const sigV2 = (p.wy * p.wy) / 4;
        covUU += w * (sigU2 + du * du);
        covVV += w * (sigV2 + dv * dv);
        covUV += w * du * dv;
    }
    covUU /= weightSum;
    covVV /= weightSum;
    covUV /= weightSum;

    // Eigenvalues of the 2x2 covariance matrix
    const trace = covUU + covVV;
    const detTerm = Math.sqrt(Math.max((covUU - covVV) * (covUU - covVV) + 4 * covUV * covUV, 0));
    const lambdaMajor = Math.max(0.5 * (trace + detTerm), 0);
    const lambdaMinor = Math.max(0.5 * (trace - detTerm), 0);

    // 4-sigma diameters (D4sigma = 4 * sqrt(variance)), the standard second-moment beam width
    return {
        totalPower,
        groupCount: groups.size,
        majorDiameter: 4 * Math.sqrt(lambdaMajor),
        minorDiameter: 4 * Math.sqrt(lambdaMinor),
    };
}

function wrapPi(value: number): number {
    let wrapped = value % (Math.PI * 2);
    if (wrapped > Math.PI) wrapped -= Math.PI * 2;
    if (wrapped < -Math.PI) wrapped += Math.PI * 2;
    return wrapped;
}

function jonesInnerProduct(
    a: BeamProfile['polarization'],
    b: BeamProfile['polarization'],
): { re: number; im: number; amp: number; phase: number } {
    const axRe = a.x.re, axIm = a.x.im;
    const ayRe = a.y.re, ayIm = a.y.im;
    const bxRe = b.x.re, bxIm = b.x.im;
    const byRe = b.y.re, byIm = b.y.im;
    const re = axRe * bxRe + axIm * bxIm + ayRe * byRe + ayIm * byIm;
    const im = axRe * bxIm - axIm * bxRe + ayRe * byIm - ayIm * byRe;
    const aNorm = Math.sqrt(axRe * axRe + axIm * axIm + ayRe * ayRe + ayIm * ayIm);
    const bNorm = Math.sqrt(bxRe * bxRe + bxIm * bxIm + byRe * byRe + byIm * byIm);
    const denom = Math.max(1e-15, aNorm * bNorm);
    return {
        re,
        im,
        amp: Math.min(1, Math.hypot(re, im) / denom),
        phase: Math.atan2(im, re),
    };
}

function computeInterferenceSummary(profiles: BeamProfile[]): InterferenceSummary | null {
    const groups = new Map<number, BeamProfile[]>();
    for (const profile of profiles) {
        if (profile.power <= 1e-12) continue;
        const key = Math.round(profile.wavelength * 1e12);
        const group = groups.get(key);
        if (group) group.push(profile);
        else groups.set(key, [profile]);
    }

    let bestGroup: BeamProfile[] | null = null;
    let bestPower = 0;
    for (const group of groups.values()) {
        if (group.length < 2) continue;
        const power = group.reduce((sum, profile) => sum + profile.power, 0);
        if (power > bestPower) {
            bestPower = power;
            bestGroup = group;
        }
    }
    if (!bestGroup) return null;

    const [a, b] = [...bestGroup].sort((left, right) => right.power - left.power);
    if (!a || !b) return null;

    const incoherentPower = a.power + b.power;
    if (incoherentPower <= 1e-12) return null;

    const meanWx = Math.max(1e-6, (a.wx + b.wx) / 2);
    const meanWy = Math.max(1e-6, (a.wy + b.wy) / 2);
    const du = (a.centerU ?? 0) - (b.centerU ?? 0);
    const dv = (a.centerV ?? 0) - (b.centerV ?? 0);
    const spatialOverlap = Math.exp(-0.5 * ((du * du) / (meanWx * meanWx) + (dv * dv) / (meanWy * meanWy)));
    const dTilt = Math.hypot((a.tiltU ?? 0) - (b.tiltU ?? 0), (a.tiltV ?? 0) - (b.tiltV ?? 0));
    const tiltOverlap = Math.exp(-0.5 * (dTilt / 0.08) ** 2);
    const overlap = Math.max(0, Math.min(1, spatialOverlap * tiltOverlap));
    const pol = jonesInnerProduct(a.polarization, b.polarization);
    const balance = 2 * Math.sqrt(a.power * b.power) / incoherentPower;
    const visibility = Math.max(0, Math.min(1, balance * overlap * pol.amp));
    const wavelengthMm = a.wavelength * 1e3;
    const deltaOplMm = b.phase - a.phase;
    const phaseRad = wrapPi((2 * Math.PI / wavelengthMm) * deltaOplMm + pol.phase);
    const coherentPower = Math.max(0, incoherentPower * (1 + visibility * Math.cos(phaseRad)));
    const phaseDeg = phaseRad * 180 / Math.PI;
    const state: InterferenceSummary['state'] =
        visibility < 0.15
            ? 'mid'
            : Math.cos(phaseRad) > 0.5
                ? 'bright'
                : Math.cos(phaseRad) < -0.5
                    ? 'dark'
                    : 'mid';

    return {
        wavelengthNm: Math.round(a.wavelength * 1e9),
        deltaOplMm,
        phaseDeg,
        visibility,
        balance,
        overlap,
        polarizationOverlap: pol.amp,
        coherentPower,
        incoherentPower,
        state,
    };
}

function fmtLength(deltaMm: number): string {
    const abs = Math.abs(deltaMm);
    if (abs >= 1) return `${deltaMm.toFixed(3)} mm`;
    if (abs >= 1e-3) return `${(deltaMm * 1e3).toFixed(2)} um`;
    return `${(deltaMm * 1e6).toFixed(0)} nm`;
}

// ─── Main CardViewer Component ──────────────────────────────────────

export const CardViewer: React.FC<{ card: Card; compact?: boolean; autoFitNonce?: number }> = ({ card, compact }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const phosphorBufferRef = useRef<Float32Array | null>(null);
    const phosphorKeyRef = useRef<string>('');
    const phosphorImageDataRef = useRef<ImageData | null>(null);
    const [cardImageTick] = useAtom(cardImageTickAtom);
    const directHits = useMemo(() => directCardHits(card), [card, cardImageTick]);
    const fallbackProfiles = useMemo(() => beamProfilesFromDirectHits(directHits), [directHits]);
    const profiles = card.beamProfiles.length > 0 ? card.beamProfiles : fallbackProfiles;
    const hasBeams = profiles.length > 0 || directHits.length > 0;

    const canvasSize = compact ? 96 : 260;
    // Phosphor-trail cards keep the viewport pinned to the full card extent so
    // the persistent accumulator doesn't smear when auto-fit zooms in/out.
    const viewport = useMemo(
        () => {
            if (card.persistTrail) {
                return {
                    extentMm: Math.max(card.width, card.height),
                    centerU: 0,
                    centerV: 0,
                };
            }
            return detectorViewport(card, directHits);
        },
        [card, card.width, card.height, card.persistTrail, directHits],
    );

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (card.persistTrail) {
            // Phosphor mode: fade existing accumulator, deposit current hits,
            // and render. Buffer is keyed on card id + canvas size so a preset
            // switch or resize starts clean.
            const key = `${card.id}:${canvas.width}x${canvas.height}`;
            const len = canvas.width * canvas.height * 3;
            let buf = phosphorBufferRef.current;
            if (!buf || buf.length !== len || phosphorKeyRef.current !== key) {
                buf = new Float32Array(len);
                phosphorBufferRef.current = buf;
                phosphorKeyRef.current = key;
            }
            const fade = 0.93;
            for (let i = 0; i < buf.length; i++) buf[i] *= fade;
            if (hasBeams) {
                depositHitsToBuffer(buf, canvas.width, canvas.height, directHits, viewport);
            }
            // Reuse one ImageData across frames; allocating ~260KB per frame
            // (canvas 260×260×4 bytes) was a meaningful chunk of GC pressure
            // when the animation runs at 60fps.
            let imgData = phosphorImageDataRef.current;
            if (!imgData || imgData.width !== canvas.width || imgData.height !== canvas.height) {
                imgData = ctx.createImageData(canvas.width, canvas.height);
                phosphorImageDataRef.current = imgData;
            }
            renderBufferToCanvas(ctx, buf, canvas.width, canvas.height, 'gamma', imgData);
            drawDetectorScaleBar(ctx, canvas.width, canvas.height, viewport.extentMm);
            return;
        }

        if (!hasBeams) {
            // No beam: dark empty state
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#444';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No beam on card', canvas.width / 2, canvas.height / 2 - 6);
            ctx.fillStyle = '#333';
            ctx.font = '9px sans-serif';
            ctx.fillText('(move detector into beam)', canvas.width / 2, canvas.height / 2 + 10);
            ctx.textAlign = 'start';
            return;
        }

        drawDirectHits(ctx, canvas.width, canvas.height, directHits, viewport, 'linear');
    }, [
        directHits,
        hasBeams,
        card,
        card.width,
        card.height,
        card.persistTrail,
        canvasSize,
        viewport,
        cardImageTick,
    ]);

    const primary = hasBeams ? profiles[0] : null;
    const beamStr = primary
        ? `${(primary.wx * 2).toFixed(2)} x ${(primary.wy * 2).toFixed(2)} mm`
        : '--';

    // Per-wavelength power breakdown
    const wavelengthPowers = new Map<number, number>();
    let totalPower = 0;
    for (const p of profiles) {
        const key = Math.round(p.wavelength * 1e12); // round to avoid float key issues
        wavelengthPowers.set(key, (wavelengthPowers.get(key) ?? 0) + p.power);
        totalPower += p.power;
    }

    // Beam moment summary
    const beamMoments = hasBeams ? computeBeamMoments(profiles) : null;
    const interference = hasBeams ? computeInterferenceSummary(profiles) : null;

    const labelStyle: React.CSSProperties = { color: '#858585', fontSize: '11px' };
    const valueStyle: React.CSSProperties = { color: '#e0e0e0', fontSize: '12px', fontFamily: 'monospace' };
    const interferenceColor = interference?.state === 'bright'
        ? '#7ee081'
        : interference?.state === 'dark'
            ? '#8ab4ff'
            : '#ffd166';

    return (
        <div style={{ marginTop: '4px' }}>
            <div style={{ width: canvasSize }}>
                <canvas
                    ref={canvasRef}
                    width={canvasSize}
                    height={canvasSize}
                    style={{
                        border: '1px solid #333',
                        borderRadius: '4px',
                        display: 'block',
                        backgroundColor: '#000',
                        imageRendering: 'pixelated',
                    }}
                />

                {!compact && (
                    <div style={{
                        color: '#777',
                        fontSize: '10px',
                        fontFamily: 'monospace',
                        marginTop: '6px',
                        textAlign: 'right',
                    }}>
                        {formatScaleLength(viewport.extentMm)} view
                    </div>
                )}
            </div>

            {/* Beam moment summary and readout panel -- hidden in compact mode */}
            {!compact && (
                <div style={{
                    marginTop: '8px',
                    padding: '6px 8px',
                    backgroundColor: '#111',
                    borderRadius: '4px',
                    border: '1px solid #282828'
                }}>
                    {/* Per-wavelength power breakdown */}
                    <div style={labelStyle}>Power at card</div>
                    {hasBeams ? (
                        <div style={{ marginTop: '2px' }}>
                            {Array.from(wavelengthPowers.entries()).map(([key, power]) => {
                                const wlM = key * 1e-12;
                                const wlNm = Math.round(wlM * 1e9);
                                return (
                                    <div key={key} style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: '1px'
                                    }}>
                                        <span style={{
                                            ...valueStyle,
                                            color: wavelengthToCSS(wlM),
                                            fontSize: '11px'
                                        }}>
                                            {'\u25CF'} {wlNm} nm
                                        </span>
                                        <span style={valueStyle}>{fmtPower(power)}</span>
                                    </div>
                                );
                            })}
                            {wavelengthPowers.size > 1 && (
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    borderTop: '1px solid #282828',
                                    marginTop: '2px',
                                    paddingTop: '2px'
                                }}>
                                    <span style={{ ...labelStyle }}>Total</span>
                                    <span style={valueStyle}>{fmtPower(totalPower)}</span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div style={valueStyle}>--</div>
                    )}

                    {/* Coherent interference summary */}
                    {interference && (
                        <div style={{
                            marginTop: '6px',
                            paddingTop: '4px',
                            borderTop: '1px solid #282828'
                        }}>
                            <div style={labelStyle}>Interferometer</div>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr',
                                gap: '2px 12px',
                                marginTop: '2px'
                            }}>
                                <div>
                                    <div style={labelStyle}>State</div>
                                    <div style={{ ...valueStyle, color: interferenceColor, fontWeight: 700 }}>
                                        {interference.state}
                                    </div>
                                </div>
                                <div>
                                    <div style={labelStyle}>Contrast</div>
                                    <div style={valueStyle}>{(interference.visibility * 100).toFixed(0)}%</div>
                                </div>
                                <div>
                                    <div style={labelStyle}>ΔL</div>
                                    <div style={valueStyle}>{fmtLength(interference.deltaOplMm)}</div>
                                </div>
                                <div>
                                    <div style={labelStyle}>Δφ @ {interference.wavelengthNm} nm</div>
                                    <div style={valueStyle}>{interference.phaseDeg.toFixed(0)}°</div>
                                </div>
                                <div>
                                    <div style={labelStyle}>Overlap</div>
                                    <div style={valueStyle}>{(interference.overlap * 100).toFixed(0)}%</div>
                                </div>
                                <div>
                                    <div style={labelStyle}>Balance</div>
                                    <div style={valueStyle}>{(interference.balance * 100).toFixed(0)}%</div>
                                </div>
                                <div>
                                    <div style={labelStyle}>Pol Match</div>
                                    <div style={valueStyle}>{(interference.polarizationOverlap * 100).toFixed(0)}%</div>
                                </div>
                                <div>
                                    <div style={labelStyle}>Coherent I</div>
                                    <div style={valueStyle}>{fmtPower(interference.coherentPower)}</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Beam moment summary */}
                    {beamMoments && (
                        <div style={{
                            marginTop: '6px',
                            paddingTop: '4px',
                            borderTop: '1px solid #282828'
                        }}>
                            <div style={labelStyle}>Beam Moments</div>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr',
                                gap: '2px 12px',
                                marginTop: '2px'
                            }}>
                                <div>
                                    <div style={labelStyle}>Total Power</div>
                                    <div style={valueStyle}>{fmtPower(beamMoments.totalPower)}</div>
                                </div>
                                <div>
                                    <div style={labelStyle}>Beam Groups</div>
                                    <div style={valueStyle}>{beamMoments.groupCount}</div>
                                </div>
                                {profiles.length === 1 && (
                                    <>
                                        <div>
                                            <div style={labelStyle}>1/e{'\u00B2'} Major</div>
                                            <div style={valueStyle}>{beamMoments.majorDiameter.toFixed(3)} mm</div>
                                        </div>
                                        <div>
                                            <div style={labelStyle}>1/e{'\u00B2'} Minor</div>
                                            <div style={valueStyle}>{beamMoments.minorDiameter.toFixed(3)} mm</div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Beam diameter and Jones vector */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '4px 12px',
                        marginTop: '6px',
                        paddingTop: '4px',
                        borderTop: '1px solid #282828'
                    }}>
                        <div>
                            <div style={labelStyle}>Beam {'\u2300'} (1/e{'\u00B2'})</div>
                            <div style={valueStyle}>{beamStr}</div>
                        </div>
                        <div>
                            <div style={labelStyle}>Jones Vector</div>
                            <div style={{ ...valueStyle, fontSize: '9px' }}>
                                {primary ? formatJones(primary.polarization) : '--'}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── Jones vector compact display ───────────────────────────────────

function formatJones(pol: { x: { re: number; im: number }; y: { re: number; im: number } }): string {
    const formatC = (c: { re: number; im: number }) => {
        const amp = Math.sqrt(c.re * c.re + c.im * c.im);
        if (amp < 0.01) return '0';
        const phase = Math.atan2(c.im, c.re) * 180 / Math.PI;
        if (Math.abs(phase) < 1) return amp.toFixed(2);
        return `${amp.toFixed(1)}\u2220${phase.toFixed(0)}\u00B0`;
    };
    return `(${formatC(pol.x)}, ${formatC(pol.y)})`;
}
