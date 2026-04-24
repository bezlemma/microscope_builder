import React, { useEffect, useRef, useState } from 'react';
import { Card, BeamProfile } from '../physics/components/Card';

// ─── Types ─────────────────────────────────────────────────────────

type DisplayMapping = 'linear' | 'gamma' | 'log';

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

/**
 * Complementary color of the wavelength, for max contrast against Gaussian glow.
 */
function complementaryCSS(wavelengthMeters: number): string {
    const [r, g, b] = wavelengthRGB(wavelengthMeters);
    const cr = 255 - r;
    const cg = 255 - g;
    const cb = 255 - b;
    const maxC = Math.max(cr, cg, cb, 1);
    const boost = Math.max(1, 180 / maxC);
    return `rgb(${Math.min(255, Math.round(cr * boost))},${Math.min(255, Math.round(cg * boost))},${Math.min(255, Math.round(cb * boost))})`;
}

// ─── Display mapping ───────────────────────────────────────────────

function mapDisplayValue(normalized: number, mapping: DisplayMapping): number {
    const safe = Math.max(0, Math.min(1, normalized));
    if (mapping === 'linear') return safe;
    if (mapping === 'gamma') return Math.pow(safe, 0.45);
    // log: log10(1 + v*2047) / log10(2048)
    return Math.log10(1 + safe * 2047) / Math.log10(2048);
}

function nextDisplayMapping(current: DisplayMapping): DisplayMapping {
    if (current === 'linear') return 'gamma';
    if (current === 'gamma') return 'log';
    return 'linear';
}

function displayMappingLabel(mapping: DisplayMapping): string {
    if (mapping === 'linear') return 'LIN';
    if (mapping === 'gamma') return 'GAM';
    return 'LOG';
}

function displayMappingTitle(mapping: DisplayMapping): string {
    if (mapping === 'linear') return 'Switch to gamma intensity view';
    if (mapping === 'gamma') return 'Switch to log intensity view';
    return 'Switch to linear intensity view';
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

// ─── Multi-beam drawing with coherent interference ──────────────────

/**
 * Draw multiple beam profiles with coherent interference.
 * Same-wavelength beams interfere (fringes), different-wavelength beams add incoherently.
 * Tilt-based spatial fringes: beams at different angles create spatially varying
 * interference patterns across the card.
 *
 * The display mapping is applied after normalizing intensities to [0,1].
 */
function drawMultiBeam(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    profiles: BeamProfile[],
    viewExtentMm: number,
    time: number,
    mapping: DisplayMapping
) {
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;
    const scaleX = viewExtentMm / width;
    const scaleY = viewExtentMm / height;

    // Group profiles by wavelength for coherent interference
    const wavelengthGroups = new Map<number, BeamProfile[]>();
    for (const p of profiles) {
        // Round wavelength to avoid floating-point key mismatches
        const key = Math.round(p.wavelength * 1e12);
        if (!wavelengthGroups.has(key)) wavelengthGroups.set(key, []);
        wavelengthGroups.get(key)!.push(p);
    }

    // Animation phase (for polarization ellipse overlay only, NOT for interference)
    const omega = time * 3.5;

    // Detect broadband white light: 3+ distinct wavelength groups -> render as white
    const isBroadband = wavelengthGroups.size >= 3;

    // Normalize brightness: scale so the brightest beam's peak reaches full RGB
    let maxPower = 0;
    for (const p of profiles) maxPower = Math.max(maxPower, p.power);
    const powerScale = maxPower > 0 ? 1.0 / maxPower : 1.0;

    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            const x = (px - width / 2) * scaleX;
            const y = (py - height / 2) * scaleY;

            let totalR = 0, totalG = 0, totalB = 0;

            for (const [, group] of wavelengthGroups) {
                const [R, G, B] = isBroadband ? [255, 255, 255] : wavelengthRGB(group[0].wavelength);

                if (group.length === 1) {
                    // Single beam -- no interference, just Gaussian
                    const p = group[0];
                    const dx = x - (p.centerU ?? 0);
                    const dy = y - (p.centerV ?? 0);
                    const gauss = Math.exp(-2 * (dx * dx / (p.wx * p.wx) + dy * dy / (p.wy * p.wy)));
                    if (gauss < 0.001) continue;
                    const rawIntensity = Math.sqrt(gauss) * p.power * powerScale;
                    const mapped = mapDisplayValue(rawIntensity, mapping);
                    totalR += R * mapped;
                    totalG += G * mapped;
                    totalB += B * mapped;
                } else {
                    // Multiple coherent beams -- sum E-fields then compute intensity
                    // Use REAL wavenumber k = 2pi/lambda for physically correct interference
                    // omega cancels in |E|^2 = |sum Ei|^2, so we omit it from pixel shading
                    const wavelengthMm = group[0].wavelength * 1e3; // SI meters -> mm
                    const k_real = (2 * Math.PI) / wavelengthMm;

                    let exRe = 0, exIm = 0, eyRe = 0, eyIm = 0;

                    for (const p of group) {
                        const dx = x - (p.centerU ?? 0);
                        const dy = y - (p.centerV ?? 0);
                        const gauss = Math.exp(-2 * (dx * dx / (p.wx * p.wx) + dy * dy / (p.wy * p.wy)));
                        if (gauss < 0.0001) continue;
                        const amp = Math.sqrt(Math.sqrt(gauss) * p.power * powerScale);

                        // Phase: real OPL-based phase + spatial tilt phase
                        // tiltU/V create spatial fringes when beams arrive at different angles
                        const tiltPhase = k_real * ((p.tiltU ?? 0) * x + (p.tiltV ?? 0) * y);
                        const phi = k_real * p.phase + tiltPhase;

                        // Jones vector contribution
                        const Jx = p.polarization.x;
                        const Jy = p.polarization.y;
                        const cosPhi = Math.cos(phi);
                        const sinPhi = Math.sin(phi);

                        exRe += amp * (Jx.re * cosPhi - Jx.im * sinPhi);
                        exIm += amp * (Jx.re * sinPhi + Jx.im * cosPhi);
                        eyRe += amp * (Jy.re * cosPhi - Jy.im * sinPhi);
                        eyIm += amp * (Jy.re * sinPhi + Jy.im * cosPhi);
                    }

                    const intensity = exRe * exRe + exIm * exIm + eyRe * eyRe + eyIm * eyIm;
                    if (intensity < 0.001) continue;
                    const rawBright = Math.sqrt(intensity);
                    const mapped = mapDisplayValue(rawBright, mapping);
                    totalR += R * mapped;
                    totalG += G * mapped;
                    totalB += B * mapped;
                }
            }

            const idx = (py * width + px) * 4;
            data[idx] = Math.min(255, Math.round(totalR));
            data[idx + 1] = Math.min(255, Math.round(totalG));
            data[idx + 2] = Math.min(255, Math.round(totalB));
            data[idx + 3] = 255;
        }
    }
    ctx.putImageData(imageData, 0, 0);

    // === Overlays: draw per-beam 1/e^2 rings and polarization for primary beam ===
    const primary = profiles[0];
    const beamCxPx = width / 2 + (primary.centerU ?? 0) / scaleX;
    const beamCyPx = height / 2 + (primary.centerV ?? 0) / scaleY;

    // Draw 1/e^2 rings for each beam
    for (const p of profiles) {
        const cx = width / 2 + (p.centerU ?? 0) / scaleX;
        const cy = height / 2 + (p.centerV ?? 0) / scaleY;
        const rxPx = p.wx / scaleX;
        const ryPx = p.wy / scaleY;

        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rxPx, ryPx, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Beam width labels for primary
    const rxPx = primary.wx / scaleX;
    const ryPx = primary.wy / scaleY;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${(primary.wx * 2).toFixed(2)} mm`, beamCxPx + rxPx + 3, beamCyPx + 3);
    if (Math.abs(primary.wx - primary.wy) > 0.001 * primary.wx) {
        ctx.textAlign = 'center';
        ctx.fillText(`${(primary.wy * 2).toFixed(2)} mm`, beamCxPx, beamCyPx - ryPx - 4);
    }
    ctx.textAlign = 'start';

    // Subtle crosshair at card center
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height);
    ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2);
    ctx.stroke();

    // === Polarization overlay for EACH beam ===
    for (const prof of profiles) {
        const pCx = width / 2 + (prof.centerU ?? 0) / scaleX;
        const pCy = height / 2 + (prof.centerV ?? 0) / scaleY;
        const pRxPx = prof.wx / scaleX;
        const pRyPx = prof.wy / scaleY;

        const Jx = prof.polarization.x;
        const Jy = prof.polarization.y;
        const ampX = Math.sqrt(Jx.re * Jx.re + Jx.im * Jx.im);
        const ampY = Math.sqrt(Jy.re * Jy.re + Jy.im * Jy.im);
        const phiX = Math.atan2(Jx.im, Jx.re);
        const phiY = Math.atan2(Jy.im, Jy.re);

        const maxAmp = Math.max(ampX, ampY, 0.001);
        const arrowScale = Math.min(pRxPx, pRyPx) * 1.0;

        const exNow = (ampX / maxAmp) * Math.cos(omega + phiX);
        const eyNow = (ampY / maxAmp) * Math.cos(omega + phiY);

        const compColor = complementaryCSS(prof.wavelength);

        // Polarization ellipse trace
        ctx.strokeStyle = compColor;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i <= 120; i++) {
            const t = (i / 120) * Math.PI * 2;
            const ex = (ampX / maxAmp) * Math.cos(t + phiX) * arrowScale;
            const ey = (ampY / maxAmp) * Math.cos(t + phiY) * arrowScale;
            const ppx = pCx + ex;
            const ppy = pCy - ey;
            if (i === 0) ctx.moveTo(ppx, ppy);
            else ctx.lineTo(ppx, ppy);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha = 1.0;

        // Ex arrow
        const exLen = exNow * arrowScale;
        drawArrow(ctx, pCx, pCy, pCx + exLen, pCy,
            'rgba(100, 180, 255, 0.7)', 1.5);

        // Ey arrow
        const eyLen = eyNow * arrowScale;
        drawArrow(ctx, pCx, pCy, pCx, pCy - eyLen,
            'rgba(255, 130, 100, 0.7)', 1.5);

        // Resultant E-field vector
        const resTipX = pCx + exNow * arrowScale;
        const resTipY = pCy - eyNow * arrowScale;
        drawArrow(ctx, pCx, pCy, resTipX, resTipY, compColor, 2.5);

        // Bright dot at resultant tip
        ctx.fillStyle = compColor;
        ctx.shadowColor = compColor;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(resTipX, resTipY, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Trailing glow
        ctx.globalAlpha = 0.15;
        for (let k = 1; k <= 30; k++) {
            const tt = omega - k * 0.12;
            const tx = (ampX / maxAmp) * Math.cos(tt + phiX) * arrowScale;
            const ty = (ampY / maxAmp) * Math.cos(tt + phiY) * arrowScale;
            ctx.fillStyle = compColor;
            ctx.beginPath();
            ctx.arc(pCx + tx, pCy - ty, Math.max(0.5, 2.5 - k * 0.06), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;

        // Component labels
        ctx.font = '8px sans-serif';
        ctx.fillStyle = 'rgba(100, 180, 255, 0.5)';
        ctx.textAlign = 'center';
        ctx.fillText('Ex', pCx + arrowScale + 10, pCy + 3);
        ctx.fillStyle = 'rgba(255, 130, 100, 0.5)';
        ctx.fillText('Ey', pCx + 5, pCy - arrowScale - 5);
        ctx.textAlign = 'start';
    }
}

// ─── Arrow drawing utility ──────────────────────────────────────────

function drawArrow(
    ctx: CanvasRenderingContext2D,
    x1: number, y1: number,
    x2: number, y2: number,
    color: string,
    lineWidth: number
) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const headLen = Math.min(6, len * 0.3);
    const angle = Math.atan2(dy, dx);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
        x2 - headLen * Math.cos(angle - Math.PI / 6),
        y2 - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
        x2 - headLen * Math.cos(angle + Math.PI / 6),
        y2 - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
}

// ─── Beam moment computation from Gaussian profiles ────────────────

interface BeamMomentSummary {
    totalPower: number;
    groupCount: number;
    majorDiameter: number;   // 1/e^2 major (mm)
    minorDiameter: number;   // 1/e^2 minor (mm)
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

// ─── Control button style ──────────────────────────────────────────

const controlButtonStyle: React.CSSProperties = {
    background: '#171717',
    border: '1px solid #333',
    borderRadius: '4px',
    color: '#ddd',
    cursor: 'pointer',
    fontSize: '10px',
    fontFamily: 'monospace',
    lineHeight: 1,
    padding: '3px 5px',
};

// ─── Main CardViewer Component ──────────────────────────────────────

export const CardViewer: React.FC<{ card: Card; compact?: boolean; autoFitNonce?: number }> = ({ card, compact, autoFitNonce }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animFrameRef = useRef<number>(0);
    const profiles = card.beamProfiles;
    const hasBeams = profiles.length > 0;

    const canvasSize = compact ? 80 : 220;

    // Display mapping state
    const [mapping, setMapping] = useState<DisplayMapping>('linear');

    // View extent (mm): auto-sized to card by default; the user can click the
    // "Fit" button in the parent wrapper to recompute from current beam data
    // (bumps `autoFitNonce`).
    const [viewExtentMm, setViewExtentMm] = useState<number>(() => Math.max(card.width, card.height));
    useEffect(() => {
        if (autoFitNonce === undefined) return;
        if (!hasBeams) {
            setViewExtentMm(Math.max(card.width, card.height));
            return;
        }
        let maxExtent = 0;
        for (const p of profiles) {
            const cu = Math.abs(p.centerU) + 3 * Math.max(p.wx, 1e-6);
            const cv = Math.abs(p.centerV) + 3 * Math.max(p.wy, 1e-6);
            const e = 2 * Math.max(cu, cv);
            if (e > maxExtent) maxExtent = e;
        }
        if (maxExtent > 0) setViewExtentMm(Math.max(maxExtent, 0.05));
    }, [autoFitNonce, hasBeams, profiles, card.width, card.height]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (!hasBeams) {
            // No beam: dark empty state
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#444';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No E&M data', canvas.width / 2, canvas.height / 2 - 6);
            ctx.fillStyle = '#333';
            ctx.font = '9px sans-serif';
            ctx.fillText('(enable E&M solver)', canvas.width / 2, canvas.height / 2 + 10);
            ctx.textAlign = 'start';
            return;
        }

        const viewExtent = viewExtentMm;
        let running = true;

        const animate = () => {
            if (!running) return;
            const t = performance.now() / 1000;
            drawMultiBeam(ctx, canvas.width, canvas.height, profiles, viewExtent, t, mapping);
            animFrameRef.current = requestAnimationFrame(animate);
        };
        animate();

        return () => {
            running = false;
            cancelAnimationFrame(animFrameRef.current);
        };
    }, [profiles, hasBeams, card.width, card.height, canvasSize, mapping, viewExtentMm]);

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

    const labelStyle: React.CSSProperties = { color: '#777', fontSize: '10px' };
    const valueStyle: React.CSSProperties = { color: '#ddd', fontSize: '11px', fontFamily: 'monospace' };

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
                    }}
                />

                {/* Control buttons row -- hidden in compact mode */}
                {!compact && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        marginTop: '6px',
                        padding: '4px 0 0 0',
                        flexWrap: 'wrap',
                    }}>
                        <button
                            onClick={() => setMapping(m => nextDisplayMapping(m))}
                            title={displayMappingTitle(mapping)}
                            style={controlButtonStyle}
                        >
                            {displayMappingLabel(mapping)}
                        </button>
                        <button
                            onClick={() => {
                                // Fit: reset mapping to linear (the "full card" default view).
                                // The view extent is always card.width/height, so this just
                                // resets the display mapping to show the full dynamic range.
                                setMapping('linear');
                            }}
                            title="Reset view to show all beams (linear mapping)"
                            style={controlButtonStyle}
                        >
                            Fit
                        </button>
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
                                            fontSize: '10px'
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
