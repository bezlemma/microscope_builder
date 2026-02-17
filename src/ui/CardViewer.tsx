import React, { useEffect, useRef } from 'react';
import { Card, BeamProfile } from '../physics/components/Card';

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

// ─── Multi-beam drawing with coherent interference ──────────────────

/**
 * Draw multiple beam profiles with coherent interference.
 * Same-wavelength beams interfere (fringes), different-λ beams add incoherently.
 * Tilt-based spatial fringes: beams at different angles create spatially varying
 * interference patterns across the card.
 */
function drawMultiBeam(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    profiles: BeamProfile[],
    viewExtentMm: number,
    time: number
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

    // Detect broadband white light: 3+ distinct wavelength groups → render as white
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
                    // Single beam — no interference, just Gaussian
                    const p = group[0];
                    const dx = x - (p.centerU ?? 0);
                    const dy = y - (p.centerV ?? 0);
                    const gauss = Math.exp(-2 * (dx * dx / (p.wx * p.wx) + dy * dy / (p.wy * p.wy)));
                    if (gauss < 0.001) continue;
                    const intensity = Math.sqrt(gauss) * p.power * powerScale;
                    totalR += R * intensity;
                    totalG += G * intensity;
                    totalB += B * intensity;
                } else {
                    // Multiple coherent beams — sum E-fields then compute intensity
                    // Use REAL wavenumber k = 2π/λ for physically correct interference
                    // ω cancels in |E|² = |ΣEᵢ|², so we omit it from pixel shading
                    const wavelengthMm = group[0].wavelength * 1e3; // SI meters → mm
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
                    const bright = Math.sqrt(intensity);
                    totalR += R * bright;
                    totalG += G * bright;
                    totalB += B * bright;
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

    // === Overlays: draw per-beam 1/e² rings and polarization for primary beam ===
    const primary = profiles[0];
    const beamCxPx = width / 2 + (primary.centerU ?? 0) / scaleX;
    const beamCyPx = height / 2 + (primary.centerV ?? 0) / scaleY;

    // Draw 1/e² rings for each beam
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
        ctx.fillText('Eₓ', pCx + arrowScale + 10, pCy + 3);
        ctx.fillStyle = 'rgba(255, 130, 100, 0.5)';
        ctx.fillText('Eᵧ', pCx + 5, pCy - arrowScale - 5);
        ctx.textAlign = 'start';
    }

    // === Interference metrics overlay (when 2+ beams present) ===
    if (profiles.length > 1) {
        // Compute interference info for same-wavelength groups
        for (const [, group] of wavelengthGroups) {
            if (group.length < 2) continue;

            // Real wavenumber for this wavelength group
            const wavelengthMm = group[0].wavelength * 1e3; // SI meters → mm
            const k_real = (2 * Math.PI) / wavelengthMm;

            // OPL difference between first two beams
            const oplDiff = Math.abs(group[1].phase - group[0].phase);
            const phaseDiffRad = (k_real * (group[1].phase - group[0].phase)) % (2 * Math.PI);
            const phaseDiffNorm = ((phaseDiffRad % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

            // Fringe visibility: V = 2√(I1·I2) / (I1 + I2)
            const I1 = group[0].power, I2 = group[1].power;
            const visibility = (I1 + I2 > 0) ? (2 * Math.sqrt(I1 * I2)) / (I1 + I2) : 0;

            // Constructive/destructive indicator
            const cos_dphi = Math.cos(phaseDiffNorm);
            const interferenceType = cos_dphi > 0.5 ? 'constructive'
                : cos_dphi < -0.5 ? 'destructive' : 'partial';
            const typeColor = interferenceType === 'constructive' ? '#64ffda'
                : interferenceType === 'destructive' ? '#ff6b6b' : '#ffd93d';

            // Tilt difference → fringe spacing
            const dtiltU = (group[1].tiltU ?? 0) - (group[0].tiltU ?? 0);
            const dtiltV = (group[1].tiltV ?? 0) - (group[0].tiltV ?? 0);
            const tiltMag = Math.sqrt(dtiltU * dtiltU + dtiltV * dtiltV);
            const fringeSpacing = tiltMag > 1e-6 ? wavelengthMm / tiltMag : Infinity;

            // Draw metrics panel
            const panelY = 4;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.fillRect(2, panelY, 150, tiltMag > 1e-6 ? 66 : 56);
            ctx.strokeStyle = 'rgba(100, 255, 218, 0.3)';
            ctx.strokeRect(2, panelY, 150, tiltMag > 1e-6 ? 66 : 56);

            ctx.font = '8px monospace';
            ctx.fillStyle = '#999';
            ctx.textAlign = 'left';
            ctx.fillText(`${group.length} beams  λ=${(group[0].wavelength * 1e9).toFixed(0)}nm`, 6, panelY + 10);

            // ΔOPL in µm (more useful for optical wavelengths)
            const oplDiffUm = oplDiff * 1000; // mm → µm
            const numWavelengths = oplDiff / wavelengthMm;
            ctx.fillStyle = '#bbb';
            ctx.fillText(`ΔOPL: ${oplDiffUm.toFixed(2)} µm  (${numWavelengths.toFixed(1)}λ)`, 6, panelY + 20);

            ctx.fillStyle = typeColor;
            ctx.fillText(`Δφ: ${(phaseDiffNorm * 180 / Math.PI).toFixed(1)}°  ${interferenceType}`, 6, panelY + 30);

            // Intensity bar: shows how bright the combined output is
            const normIntensity = (1 + cos_dphi) / 2; // 0 = destructive, 1 = constructive
            const barWidth = 80;
            const barY = panelY + 34;
            ctx.fillStyle = '#222';
            ctx.fillRect(6, barY, barWidth, 6);
            ctx.fillStyle = typeColor;
            ctx.fillRect(6, barY, barWidth * normIntensity, 6);
            ctx.strokeStyle = '#555';
            ctx.strokeRect(6, barY, barWidth, 6);

            ctx.fillStyle = '#888';
            ctx.fillText(`visibility: ${(visibility * 100).toFixed(0)}%`, 6, panelY + 50);

            if (tiltMag > 1e-6) {
                ctx.fillText(`fringes: ${fringeSpacing.toFixed(2)} mm`, 6, panelY + 60);
            }
        }

        // Multi-beam count indicator (bottom-right)
        ctx.fillStyle = 'rgba(100, 255, 218, 0.6)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${profiles.length} beams`, width - 4, height - 4);
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

// ─── Main CardViewer Component ──────────────────────────────────────

export const CardViewer: React.FC<{ card: Card; compact?: boolean }> = ({ card, compact }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animFrameRef = useRef<number>(0);
    const profiles = card.beamProfiles;
    const hasBeams = profiles.length > 0;

    const canvasSize = compact ? 160 : 220;

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

        const viewExtent = Math.max(card.width, card.height);
        let running = true;

        const animate = () => {
            if (!running) return;
            const t = performance.now() / 1000;
            drawMultiBeam(ctx, canvas.width, canvas.height, profiles, viewExtent, t);
            animFrameRef.current = requestAnimationFrame(animate);
        };
        animate();

        return () => {
            running = false;
            cancelAnimationFrame(animFrameRef.current);
        };
    }, [profiles, hasBeams, card.width, card.height, canvasSize]);

    const primary = hasBeams ? profiles[0] : null;
    const beamStr = primary
        ? `${(primary.wx * 2).toFixed(2)} × ${(primary.wy * 2).toFixed(2)} mm`
        : '—';

    // Per-wavelength power breakdown
    const wavelengthPowers = new Map<number, number>();
    let totalPower = 0;
    for (const p of profiles) {
        const key = Math.round(p.wavelength * 1e12); // round to avoid float key issues
        wavelengthPowers.set(key, (wavelengthPowers.get(key) ?? 0) + p.power);
        totalPower += p.power;
    }

    const labelStyle: React.CSSProperties = { color: '#777', fontSize: '10px' };
    const valueStyle: React.CSSProperties = { color: '#ddd', fontSize: '11px', fontFamily: 'monospace' };

    // Format power with appropriate unit
    const fmtPower = (w: number) => {
        if (w >= 1e-3) return `${(w * 1e3).toFixed(2)} mW`;
        if (w >= 1e-6) return `${(w * 1e6).toFixed(2)} µW`;
        if (w >= 1e-9) return `${(w * 1e9).toFixed(2)} nW`;
        return `${w.toExponential(2)} W`;
    };

    return (
        <div style={{ marginTop: '4px' }}>

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

            {/* Readout panel — hidden in compact mode */}
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
                                            ● {wlNm} nm
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
                        <div style={valueStyle}>—</div>
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
                            <div style={labelStyle}>Beam ⌀ (1/e²)</div>
                            <div style={valueStyle}>{beamStr}</div>
                        </div>
                        <div>
                            <div style={labelStyle}>Jones Vector</div>
                            <div style={{ ...valueStyle, fontSize: '9px' }}>
                                {primary ? formatJones(primary.polarization) : '—'}
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
        return `${amp.toFixed(1)}∠${phase.toFixed(0)}°`;
    };
    return `(${formatC(pol.x)}, ${formatC(pol.y)})`;
}
