import React, { useEffect, useRef } from 'react';
import { Card } from '../physics/components/Card';

export const CardViewer: React.FC<{ card: Card }> = ({ card }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw Crosshair
        ctx.strokeStyle = '#333';
        ctx.beginPath();
        ctx.moveTo(canvas.width/2, 0); ctx.lineTo(canvas.width/2, canvas.height);
        ctx.moveTo(0, canvas.height/2); ctx.lineTo(canvas.width, canvas.height/2);
        ctx.stroke();

        // Scale: Map Card Width/Height (mm) to Canvas Pixels
        const scaleX = canvas.width / card.width;
        const scaleY = canvas.height / card.height;

        // Draw Hits
        card.hits.forEach(hit => {
            const x = canvas.width/2 + hit.localPoint.x * scaleX;
            const y = canvas.height/2 - hit.localPoint.y * scaleY; // Flip Y for canvas

            // Draw Spot
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            
            // Color based on Wavelength (Approx for 532nm Green)
            ctx.fillStyle = hit.ray.wavelength === 532e-9 ? '#0f0' : '#fff';
            ctx.globalAlpha = hit.ray.intensity;
            ctx.fill();
            ctx.globalAlpha = 1.0;
        });

    }, [card, card.hits]); // Updates when card state changes (actually needs forceUpdate or re-render trigger)
    // Note: React might not detect deep changes in 'card' object. 
    // We are relying on parent Inspector re-rendering or using a tick?
    // Since Solver runs via 'components' change, this might need layout effect or explicit redraw interval if animating.
    // For now, assume re-render on selection or prop update.

    return (
        <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '5px' }}>card_view (Active)</div>
            <canvas 
                ref={canvasRef} 
                width={200} 
                height={200} 
                style={{ border: '1px solid #444', borderRadius: '4px' }} 
            />
        </div>
    );
};
