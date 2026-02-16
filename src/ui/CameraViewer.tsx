import React, { useEffect, useRef, useState } from 'react';
import { Camera } from '../physics/components/Camera';

// ─── Wavelength → Color for image display ──────────────────────────
function wavelengthToRGB(wavelengthNm: number): [number, number, number] {
    // Simplified visible spectrum mapping
    let r = 0, g = 0, b = 0;
    if (wavelengthNm >= 380 && wavelengthNm < 440) {
        r = -(wavelengthNm - 440) / (440 - 380);
        b = 1;
    } else if (wavelengthNm >= 440 && wavelengthNm < 490) {
        g = (wavelengthNm - 440) / (490 - 440);
        b = 1;
    } else if (wavelengthNm >= 490 && wavelengthNm < 510) {
        g = 1;
        b = -(wavelengthNm - 510) / (510 - 490);
    } else if (wavelengthNm >= 510 && wavelengthNm < 580) {
        r = (wavelengthNm - 510) / (580 - 510);
        g = 1;
    } else if (wavelengthNm >= 580 && wavelengthNm < 645) {
        r = 1;
        g = -(wavelengthNm - 645) / (645 - 580);
    } else if (wavelengthNm >= 645 && wavelengthNm <= 780) {
        r = 1;
    }
    return [r, g, b];
}

// ─── CameraViewer Component ─────────────────────────────────────────

interface CameraViewerProps {
    camera: Camera;
    isRendering: boolean;
}

export const CameraViewer: React.FC<CameraViewerProps> = ({ camera, isRendering }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [hasImage, setHasImage] = useState(false);

    // Display size (upscaled from 64×64)
    const displayWidth = 256;
    const displayHeight = Math.round(displayWidth * (camera.sensorResY / camera.sensorResX));

    // Paint the image whenever solver3Image or forwardImage changes
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const emImg = camera.solver3Image;   // Backward emission (fluorescence)
        const exImg = camera.forwardImage;   // Forward excitation (laser beam)
        const resX = camera.sensorResX;
        const resY = camera.sensorResY;

        const hasEmission = emImg && emImg.length > 0;
        const hasExcitation = exImg && exImg.length > 0;

        if (!hasEmission && !hasExcitation) {
            // Clear to black
            ctx.fillStyle = '#111';
            ctx.fillRect(0, 0, displayWidth, displayHeight);
            ctx.fillStyle = '#555';
            ctx.font = '12px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('No render yet', displayWidth / 2, displayHeight / 2);
            setHasImage(false);
            return;
        }

        // Find global max across both images for normalization
        let maxVal = 0;
        if (hasEmission) for (let i = 0; i < emImg.length; i++) if (emImg[i] > maxVal) maxVal = emImg[i];
        if (hasExcitation) for (let i = 0; i < exImg.length; i++) if (exImg[i] > maxVal) maxVal = exImg[i];
        if (maxVal < 1e-12) maxVal = 1; // prevent division by zero

        // Wavelength → RGB for each channel
        const emNm = 520;  // GFP green emission
        const exNm = 488;  // Excitation laser (blue)
        const [emR, emG, emB] = wavelengthToRGB(emNm);
        const [exR, exG, exB] = wavelengthToRGB(exNm);

        // Create ImageData at display resolution
        const imageData = ctx.createImageData(displayWidth, displayHeight);
        const scaleX = resX / displayWidth;
        const scaleY = resY / displayHeight;

        for (let dy = 0; dy < displayHeight; dy++) {
            for (let dx = 0; dx < displayWidth; dx++) {
                // Nearest-neighbor sampling from the 64×64 images
                const sx = Math.min(Math.floor(dx * scaleX), resX - 1);
                // Flip Y: canvas (0,0) = top-left, image (0,0) = bottom-left
                const sy = Math.min(Math.floor((displayHeight - 1 - dy) * scaleY), resY - 1);
                const pixelIdx = sy * resX + sx;

                // Normalize both signals against the global max
                const emVal = hasEmission ? emImg[pixelIdx] / maxVal : 0;
                const exVal = hasExcitation ? exImg[pixelIdx] / maxVal : 0;

                // Apply gamma for better visible range
                const gamma = 0.45;
                const em = Math.pow(Math.max(0, Math.min(1, emVal)), gamma);
                const ex = Math.pow(Math.max(0, Math.min(1, exVal)), gamma);

                // Combine: wavelength-colored excitation + emission
                const r = Math.min(1, ex * exR + em * emR);
                const g = Math.min(1, ex * exG + em * emG);
                const b = Math.min(1, ex * exB + em * emB);

                const idx = (dy * displayWidth + dx) * 4;
                imageData.data[idx + 0] = Math.round(r * 255);
                imageData.data[idx + 1] = Math.round(g * 255);
                imageData.data[idx + 2] = Math.round(b * 255);
                imageData.data[idx + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        setHasImage(true);
    }, [camera.solver3Image, camera.forwardImage, camera.sensorResX, camera.sensorResY, displayWidth, displayHeight]);

    const isStale = camera.solver3Stale;

    return (
        <div>
            {/* Header */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '4px'
            }}>
                <span style={{ fontSize: '11px', color: '#aaa' }}>
                    🎥 {camera.sensorResX}×{camera.sensorResY}
                </span>
                <span style={{
                    fontSize: '10px',
                    color: isStale ? '#ff8844' : '#44ff88',
                    fontFamily: 'monospace'
                }}>
                    {isRendering ? '⏳' : isStale ? '⚠ Stale' : hasImage ? '✓' : ''}
                </span>
            </div>

            {/* Canvas */}
            <canvas
                ref={canvasRef}
                width={displayWidth}
                height={displayHeight}
                style={{
                    width: '100%',
                    height: 'auto',
                    borderRadius: '4px',
                    border: '1px solid #333',
                    background: '#111',
                    imageRendering: 'pixelated',
                }}
            />
        </div>
    );
};
