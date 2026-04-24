import React, { useRef, useEffect } from 'react';
import { SpectralProfile } from '../physics/SpectralProfile';

interface SpectrumChartProps {
    profile: SpectralProfile;
    width?: number;
    height?: number;
}

// Pre-built rainbow gradient color stops (350–850 nm) as [offset, r, g, b]
const SPECTRUM_STOPS: [number, number, number, number][] = [
    [0.00, 26, 0, 32],     // 350 nm — deep UV
    [0.06, 42, 0, 64],     // 380 nm
    [0.14, 68, 0, 170],    // 420 nm
    [0.20, 0, 0, 255],     // 450 nm
    [0.26, 0, 102, 255],   // 480 nm
    [0.30, 0, 204, 204],   // 500 nm
    [0.34, 0, 255, 0],     // 520 nm
    [0.42, 170, 255, 0],   // 560 nm
    [0.46, 255, 255, 0],   // 580 nm
    [0.50, 255, 136, 0],   // 600 nm
    [0.58, 255, 0, 0],     // 640 nm
    [0.70, 170, 0, 0],     // 700 nm
    [0.86, 64, 0, 0],      // 780 nm
    [1.00, 26, 0, 0],      // 850 nm
];

/** Number of sample points across the spectrum — 120 is plenty for a 250px canvas */
const NUM_SAMPLES = 120;

/**
 * Lightweight <canvas>-based spectrum chart.
 * Draws the rainbow background + transmission curve imperatively —
 * no SVG DOM, no React element tree per data point.
 */
export const SpectrumChart: React.FC<SpectrumChartProps> = ({
    profile,
    width = 250,
    height = 100,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        // --- Rainbow gradient background ---
        const grad = ctx.createLinearGradient(0, 0, width, 0);
        for (const [offset, r, g, b] of SPECTRUM_STOPS) {
            grad.addColorStop(offset, `rgb(${r},${g},${b})`);
        }
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1.0;

        // --- Grid lines at 25%, 50%, 75% ---
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 2]);
        for (const frac of [0.25, 0.5, 0.75]) {
            const y = height - frac * height;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // --- Sample the transmission curve ---
        const curve = profile.getSampleCurve(NUM_SAMPLES);

        // --- Filled area under curve ---
        ctx.beginPath();
        for (let i = 0; i < curve.length; i++) {
            const x = (i / (curve.length - 1)) * width;
            const y = height - curve[i].t * height;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fill();

        // --- Transmission curve line ---
        ctx.beginPath();
        for (let i = 0; i < curve.length; i++) {
            const x = (i / (curve.length - 1)) * width;
            const y = height - curve[i].t * height;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // --- Axis labels ---
        ctx.font = '8px system-ui, sans-serif';
        ctx.fillStyle = '#888';
        ctx.textBaseline = 'bottom';
        ctx.fillText('350', 2, height - 2);
        ctx.textAlign = 'right';
        ctx.fillText('850nm', width - 2, height - 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('100%', 2, 2);

    }, [profile, width, height]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                width,
                height,
                display: 'block',
                borderRadius: 6,
                border: '1px solid #333',
            }}
        />
    );
};
