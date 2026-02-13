import React, { useEffect, useRef } from 'react';
import { Card, BeamProfile } from '../physics/components/Card';

/**
 * Wavelength (meters) to CSS color string.
 */
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

/**
 * Get wavelength RGB components (0-255).
 */
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
 * Draw static Gaussian beam cross-section I(x,y) on canvas.
 * View extent is fixed at viewExtentMm — beam ring will change size as beam width changes.
 */
function drawBeamCrossSection(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    profile: BeamProfile,
    viewExtentMm: number
) {
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;
    const [R, G, B] = wavelengthRGB(profile.wavelength);

    const scaleX = viewExtentMm / width;   // mm per pixel
    const scaleY = viewExtentMm / height;

    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            const x = (px - width / 2) * scaleX;
            const y = (py - height / 2) * scaleY;

            // Gaussian intensity: I = exp(-2(x²/wx² + y²/wy²))
            const gauss = Math.exp(-2 * (x * x / (profile.wx * profile.wx) + y * y / (profile.wy * profile.wy)));

            if (gauss < 0.001) {
                const idx = (py * width + px) * 4;
                data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 255;
                continue;
            }

            const intensity = gauss;
            const idx = (py * width + px) * 4;
            data[idx] = Math.min(255, Math.round(R * intensity));
            data[idx + 1] = Math.min(255, Math.round(G * intensity));
            data[idx + 2] = Math.min(255, Math.round(B * intensity));
            data[idx + 3] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);

    // Draw 1/e² beam width ring
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    const rxPx = profile.wx / scaleX;
    const ryPx = profile.wy / scaleY;
    ctx.ellipse(width / 2, height / 2, rxPx, ryPx, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label beam width
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${(profile.wx * 2).toFixed(2)} mm`, width / 2 + rxPx + 3, height / 2 + 3);
    if (Math.abs(profile.wx - profile.wy) > 0.001 * profile.wx) {
        ctx.textAlign = 'center';
        ctx.fillText(`${(profile.wy * 2).toFixed(2)} mm`, width / 2, height / 2 - ryPx - 4);
    }
    ctx.textAlign = 'start';

    // Subtle crosshair
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height);
    ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2);
    ctx.stroke();
}

/**
 * Draw animated polarization ellipse from Jones vector.
 */
function drawPolarizationEllipse(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    profile: BeamProfile,
    time: number
) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const scale = width * 0.35;
    const color = wavelengthToCSS(profile.wavelength);

    const Jx = profile.polarization.x;
    const Jy = profile.polarization.y;
    const ampX = Math.sqrt(Jx.re * Jx.re + Jx.im * Jx.im);
    const ampY = Math.sqrt(Jy.re * Jy.re + Jy.im * Jy.im);
    const phiX = Math.atan2(Jx.im, Jx.re);
    const phiY = Math.atan2(Jy.im, Jy.re);

    // Draw the ellipse trace (full cycle)
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
        const t = (i / 100) * Math.PI * 2;
        const ex = ampX * Math.cos(t + phiX) * scale;
        const ey = ampY * Math.cos(t + phiY) * scale;
        if (i === 0) ctx.moveTo(cx + ex, cy - ey);
        else ctx.lineTo(cx + ex, cy - ey);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    // Draw animated E-field vector
    const omega = time * 3;
    const ex = ampX * Math.cos(omega + phiX) * scale;
    const ey = ampY * Math.cos(omega + phiY) * scale;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + ex, cy - ey);
    ctx.stroke();

    // Tip dot
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx + ex, cy - ey, 3, 0, Math.PI * 2);
    ctx.fill();

    // Trailing glow — last 20 positions
    ctx.globalAlpha = 0.15;
    for (let k = 1; k <= 20; k++) {
        const tt = omega - k * 0.15;
        const tx = ampX * Math.cos(tt + phiX) * scale;
        const ty = ampY * Math.cos(tt + phiY) * scale;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx + tx, cy - ty, 2 - k * 0.08, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // Axes
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(width, cy);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, height);
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#555';
    ctx.font = '9px sans-serif';
    ctx.fillText('u', width - 12, cy - 4);
    ctx.fillText('v', cx + 4, 12);

    // Polarization type label
    const delta = phiY - phiX;
    let polLabel = 'Linear';
    if (ampX > 0.01 && ampY > 0.01) {
        const deltaNorm = ((delta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        if (Math.abs(deltaNorm - Math.PI / 2) < 0.15 || Math.abs(deltaNorm - 3 * Math.PI / 2) < 0.15) {
            if (Math.abs(ampX - ampY) < 0.1 * Math.max(ampX, ampY)) {
                polLabel = 'Circular';
            } else {
                polLabel = 'Elliptical';
            }
        } else if (Math.abs(deltaNorm) < 0.15 || Math.abs(deltaNorm - Math.PI) < 0.15) {
            polLabel = 'Linear';
        } else {
            polLabel = 'Elliptical';
        }
    }

    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(polLabel, cx, height - 4);
    ctx.textAlign = 'start';
}

export const CardViewer: React.FC<{ card: Card }> = ({ card }) => {
    const crossSectionRef = useRef<HTMLCanvasElement>(null);
    const polRef = useRef<HTMLCanvasElement>(null);
    const animFrameRef = useRef<number>(0);
    const profile = card.beamProfile;

    // Draw beam cross-section (static, redraws when profile changes)
    useEffect(() => {
        const canvas = crossSectionRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (profile) {
            // Fixed view extent = 4× max beam radius
            const viewExtent = Math.max(profile.wx, profile.wy) * 4;
            drawBeamCrossSection(ctx, canvas.width, canvas.height, profile, viewExtent);
        } else {
            ctx.fillStyle = '#555';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No E&M data', canvas.width / 2, canvas.height / 2);
            ctx.fillText('(enable E&M solver)', canvas.width / 2, canvas.height / 2 + 14);
            ctx.textAlign = 'start';
        }
    }, [profile]);

    // Animate polarization ellipse
    useEffect(() => {
        const canvas = polRef.current;
        if (!canvas || !profile) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let running = true;
        const animate = () => {
            if (!running) return;
            const t = performance.now() / 1000;
            drawPolarizationEllipse(ctx, canvas.width, canvas.height, profile, t);
            animFrameRef.current = requestAnimationFrame(animate);
        };
        animate();

        return () => {
            running = false;
            cancelAnimationFrame(animFrameRef.current);
        };
    }, [profile]);

    const wavelengthNm = profile ? (profile.wavelength * 1e9).toFixed(0) : '—';
    const powerMw = profile ? (profile.power * 1000).toFixed(1) : '—';
    const phaseStr = profile
        ? ((profile.phase % (profile.wavelength * 1e3)) / (profile.wavelength * 1e3) * 360).toFixed(1) + '°'
        : '—';

    const labelStyle: React.CSSProperties = { color: '#777', fontSize: '10px' };
    const valueStyle: React.CSSProperties = { color: '#ddd', fontSize: '11px', fontFamily: 'monospace' };

    return (
        <div style={{ marginTop: '10px' }}>
            {/* Beam cross-section */}
            <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '5px' }}>
                Beam Cross-Section
            </div>
            <canvas
                ref={crossSectionRef}
                width={200}
                height={200}
                style={{ border: '1px solid #444', borderRadius: '4px', display: 'block' }}
            />

            {/* Readout panel */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '4px 12px',
                marginTop: '8px',
                padding: '6px 8px',
                backgroundColor: '#1a1a1a',
                borderRadius: '4px',
                border: '1px solid #333'
            }}>
                <div>
                    <div style={labelStyle}>Wavelength</div>
                    <div style={{ ...valueStyle, color: profile ? wavelengthToCSS(profile.wavelength) : '#ddd' }}>
                        {wavelengthNm} nm
                    </div>
                </div>
                <div>
                    <div style={labelStyle}>Power</div>
                    <div style={valueStyle}>{powerMw} mW</div>
                </div>
                <div>
                    <div style={labelStyle}>Beam (1/e²)</div>
                    <div style={valueStyle}>
                        {profile ? `${profile.wx.toFixed(3)} × ${profile.wy.toFixed(3)} mm` : '—'}
                    </div>
                </div>
                <div>
                    <div style={labelStyle}>Phase</div>
                    <div style={valueStyle}>{phaseStr}</div>
                </div>
            </div>

            {/* Polarization widget */}
            {profile && (
                <div style={{ marginTop: '8px' }}>
                    <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '4px' }}>
                        Polarization
                    </div>
                    <canvas
                        ref={polRef}
                        width={120}
                        height={120}
                        style={{ border: '1px solid #444', borderRadius: '4px', display: 'block' }}
                    />
                </div>
            )}
        </div>
    );
};
