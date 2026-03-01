import React, { useEffect, useRef, useState } from 'react';
import { Camera } from '../physics/components/Camera';


/**
 * Paint camera sensor image onto a canvas.
 *
 * The camera measures total photon intensity at each pixel — it doesn't
 * know or care where the light came from. All channels are summed and
 * displayed as greyscale.
 */
function paintImage(
    ctx: CanvasRenderingContext2D,
    emImg: Float32Array | null,
    exImg: Float32Array | null,
    resX: number,
    resY: number,
    displayWidth: number,
    displayHeight: number
): boolean {
    const hasEmission = emImg && emImg.length > 0;
    const hasExcitation = exImg && exImg.length > 0;

    if (!hasEmission && !hasExcitation) {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, displayWidth, displayHeight);
        ctx.fillStyle = '#555';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('No render yet', displayWidth / 2, displayHeight / 2);
        return false;
    }

    // Find max total intensity for normalization
    const nPixels = resX * resY;
    let maxVal = 0;
    for (let i = 0; i < nPixels; i++) {
        const total = (hasEmission ? emImg[i] : 0) + (hasExcitation ? exImg[i] : 0);
        if (total > maxVal) maxVal = total;
    }
    if (maxVal < 1e-12) maxVal = 1;

    const imageData = ctx.createImageData(displayWidth, displayHeight);
    const scaleX = resX / displayWidth;
    const scaleY = resY / displayHeight;
    const gamma = 0.45;

    for (let dy = 0; dy < displayHeight; dy++) {
        for (let dx = 0; dx < displayWidth; dx++) {
            const sx = Math.min(Math.floor(dx * scaleX), resX - 1);
            const sy = Math.min(Math.floor((displayHeight - 1 - dy) * scaleY), resY - 1);
            const pixelIdx = sy * resX + sx;

            const total = (hasEmission ? emImg[pixelIdx] : 0) + (hasExcitation ? exImg[pixelIdx] : 0);
            const intensity = Math.pow(Math.max(0, Math.min(1, total / maxVal)), gamma);

            const idx = (dy * displayWidth + dx) * 4;
            const v = Math.round(intensity * 255);
            imageData.data[idx + 0] = v;
            imageData.data[idx + 1] = v;
            imageData.data[idx + 2] = v;
            imageData.data[idx + 3] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);
    return true;
}

// ─── CameraViewer Component ─────────────────────────────────────────

interface CameraViewerProps {
    camera: Camera;
    isRendering: boolean;
    onRefresh?: () => void;
}

export const CameraViewer: React.FC<CameraViewerProps> = ({ camera, isRendering, onRefresh }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [hasImage, setHasImage] = useState(false);
    
    // Scan projection mode
    const [projection, setProjection] = useState<'avg' | 'max' | 'none'>('avg');
    // Frame scrubbing: 0..N-1
    const [frameIndex, setFrameIndex] = useState(0);

    // Display size (upscaled from 64×64)
    const displayWidth = 256;
    const displayHeight = Math.round(displayWidth * (camera.sensorResY / camera.sensorResX));

    const hasScanFrames = camera.scanFrames && camera.scanFrameCount > 0;

    // Paint the image whenever the source data or selected frame changes
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let emImg: Float32Array | null = null;
        let exImg: Float32Array | null = null;

        if (hasScanFrames) {
            if (projection === 'avg') {
                emImg = camera.solver3Image; // already averaged by ScanAccum
                exImg = camera.forwardImage;
            } else if (projection === 'max') {
                // Compute Maximum Intensity Projection (MIP)
                const n = camera.sensorResX * camera.sensorResY;
                const mipEm = new Float32Array(n);
                const mipEx = new Float32Array(n);
                for (let f = 0; f < camera.scanFrameCount; f++) {
                    const fem = camera.scanFrames![f];
                    const fex = camera.scanExFrames?.[f];
                    for (let i = 0; i < n; i++) {
                        if (fem[i] > mipEm[i]) mipEm[i] = fem[i];
                        if (fex && fex[i] > mipEx[i]) mipEx[i] = fex[i];
                    }
                }
                emImg = mipEm;
                exImg = mipEx;
            } else {
                // Show specific frame
                const idx = Math.min(frameIndex, camera.scanFrameCount - 1);
                emImg = camera.scanFrames![idx];
                exImg = camera.scanExFrames?.[idx] ?? null;
            }
        } else {
            // Single-shot image
            emImg = camera.solver3Image;
            exImg = camera.forwardImage;
        }

        const painted = paintImage(ctx, emImg, exImg, camera.sensorResX, camera.sensorResY, displayWidth, displayHeight);
        setHasImage(painted);
    }, [camera.solver3Image, camera.forwardImage, camera.sensorResX, camera.sensorResY,
        displayWidth, displayHeight, frameIndex, projection, hasScanFrames, camera.scanFrameCount,
        camera.scanFrames, camera.scanExFrames]);

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
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {hasScanFrames && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: '4px' }}>
                            <label style={{ fontSize: '9px', color: '#888', display: 'flex', alignItems: 'center', gap: '2px', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={projection === 'avg'}
                                    onChange={() => setProjection(projection === 'avg' ? 'none' : 'avg')}
                                    style={{ margin: 0, cursor: 'pointer' }}
                                />
                                AVG
                            </label>
                            <label style={{ fontSize: '9px', color: '#888', display: 'flex', alignItems: 'center', gap: '2px', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={projection === 'max'}
                                    onChange={() => setProjection(projection === 'max' ? 'none' : 'max')}
                                    style={{ margin: 0, cursor: 'pointer' }}
                                />
                                MAX
                            </label>
                        </div>
                    )}
                    {isRendering ? (
                        <span style={{ fontSize: '10px', color: '#ff8844', fontFamily: 'monospace' }}>⏳</span>
                    ) : isStale && onRefresh ? (
                        <button
                            onClick={onRefresh}
                            title="Re-render camera image"
                            style={{
                                background: 'none',
                                border: '1px solid #664422',
                                borderRadius: '3px',
                                color: '#ff8844',
                                cursor: 'pointer',
                                fontSize: '10px',
                                fontFamily: 'monospace',
                                padding: '1px 6px',
                                lineHeight: 1.4,
                            }}
                        >
                            🔄 Refresh
                        </button>
                    ) : (
                        <span style={{
                            fontSize: '10px',
                            color: isStale ? '#ff8844' : '#44ff88',
                            fontFamily: 'monospace'
                        }}>
                            {isStale ? '⚠ Stale' : hasImage ? '✓' : ''}
                        </span>
                    )}
                </div>
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

            {/* Frame scrubbing slider */}
            {hasScanFrames && (
                <div style={{
                    marginTop: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    opacity: projection === 'none' ? 1 : 0.4,
                    pointerEvents: projection === 'none' ? 'auto' : 'none',
                    transition: 'opacity 0.2s'
                }}>
                    <span style={{
                        fontSize: '9px',
                        color: '#888',
                        fontFamily: 'monospace',
                        minWidth: '28px',
                    }}>
                        {frameIndex + 1}/{camera.scanFrameCount}
                    </span>
                    <input
                        type="range"
                        min={0}
                        max={camera.scanFrameCount - 1}
                        value={frameIndex}
                        onChange={e => {
                            setFrameIndex(parseInt(e.target.value));
                            setProjection('none');
                        }}
                        style={{
                            flex: 1,
                            height: '12px',
                            accentColor: '#4af088',
                            cursor: 'pointer',
                        }}
                    />
                </div>
            )}
        </div>
    );
};
