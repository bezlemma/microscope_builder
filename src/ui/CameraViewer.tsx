import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { Camera } from '../physics/components/Camera';
import { scanAccumProgressAtom, cameraImageTickAtom } from '../state/store';

// ─── Display Types ──────────────────────────────────────────────────

type DisplayMapping = 'linear' | 'gamma' | 'log';
type NormalizeMode = 'auto' | 'full';
type ImageChannel = 'emission' | 'excitation' | 'combined';

// ─── Helper Functions ───────────────────────────────────────────────

function imageChannelLabel(channel: ImageChannel): string {
    if (channel === 'emission') return 'EM';
    if (channel === 'excitation') return 'S-EX';
    return 'BOTH';
}

interface DisplayStats {
    min: number;
    max: number;
    autoMin: number;
    autoMax: number;
    pixels: Float32Array | null;
}

function nextDisplayMapping(mapping: DisplayMapping): DisplayMapping {
    if (mapping === 'linear') return 'gamma';
    if (mapping === 'gamma') return 'log';
    return 'linear';
}

function displayMappingLabel(mapping: DisplayMapping): string {
    if (mapping === 'linear') return 'LIN';
    if (mapping === 'gamma') return 'GAM';
    return 'LOG';
}

function displayMappingTitle(mapping: DisplayMapping): string {
    if (mapping === 'linear') return 'Switch to gamma display';
    if (mapping === 'gamma') return 'Switch to log display';
    return 'Switch to linear display';
}

/**
 * Apply the selected display mapping to a [0,1]-normalized value.
 */
function mapDisplayValue(normalized: number, mapping: DisplayMapping): number {
    const safe = Math.max(0, Math.min(1, normalized));
    if (mapping === 'linear') return safe;
    if (mapping === 'log') return Math.log10(1 + safe * 2047) / Math.log10(2048);
    return Math.pow(safe, 0.45); // gamma
}

/**
 * Build a single-channel pixel buffer from emission / excitation images,
 * and compute full-range and auto (percentile) statistics for normalization.
 */
function buildDisplayPixels(
    emImg: Float32Array | null,
    exImg: Float32Array | null,
    nPixels: number,
    channel: ImageChannel,
): DisplayStats {
    const hasEmission = !!emImg && emImg.length >= nPixels;
    const hasExcitation = !!exImg && exImg.length >= nPixels;
    if (!hasEmission && !hasExcitation) {
        return { min: 0, max: 1, autoMin: 0, autoMax: 1, pixels: null };
    }

    const pixels = new Float32Array(nPixels);
    let min = Infinity;
    let max = 0;
    for (let i = 0; i < nPixels; i++) {
        const total = channel === 'emission'
            ? (hasEmission ? emImg![i] : 0)
            : channel === 'excitation'
                ? (hasExcitation ? exImg![i] : 0)
                : (hasEmission ? emImg![i] : 0) + (hasExcitation ? exImg![i] : 0);
        pixels[i] = total;
        if (Number.isFinite(total)) {
            if (total < min) min = total;
            if (total > max) max = total;
        }
    }

    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max) || max <= min) {
        max = Math.max(min + 1, 1);
    }

    // Percentile-based auto windowing (1% -- 99.5%)
    const sorted = Array.from(pixels).filter(v => Number.isFinite(v)).sort((a, b) => a - b);
    if (sorted.length === 0) {
        return { min, max, autoMin: min, autoMax: max, pixels };
    }

    const pick = (t: number) => {
        const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(t * (sorted.length - 1))));
        return sorted[idx];
    };

    const autoMin = pick(0.01);
    const autoMax = Math.max(pick(0.995), autoMin + Math.max((max - min) * 1e-6, 1e-12));

    return { min, max, autoMin, autoMax, pixels };
}

/**
 * Paint camera sensor image onto a canvas.
 *
 * Renders the pre-built pixel buffer using black/white level normalization
 * and the selected display mapping. The image is rendered at native sensor
 * resolution then scaled to the display canvas for crisp pixelated output.
 */
function paintImage(
    ctx: CanvasRenderingContext2D,
    pixels: Float32Array | null,
    resX: number,
    resY: number,
    displayWidth: number,
    displayHeight: number,
    blackPoint: number,
    whitePoint: number,
    mapping: DisplayMapping,
): boolean {
    if (!pixels || pixels.length === 0) {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, displayWidth, displayHeight);
        ctx.fillStyle = '#555';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('No render yet', displayWidth / 2, displayHeight / 2);
        return false;
    }

    // Render at native resolution, then upscale with nearest-neighbor
    const imageData = ctx.createImageData(resX, resY);
    const denom = Math.max(whitePoint - blackPoint, 1e-12);

    for (let py = 0; py < resY; py++) {
        const srcRow = resY - 1 - py; // flip Y
        for (let px = 0; px < resX; px++) {
            const raw = pixels[srcRow * resX + px];
            const normalized = (raw - blackPoint) / denom;
            const mapped = mapDisplayValue(normalized, mapping);

            const idx = (py * resX + px) * 4;
            const value = Math.round(mapped * 255);
            imageData.data[idx + 0] = value;
            imageData.data[idx + 1] = value;
            imageData.data[idx + 2] = value;
            imageData.data[idx + 3] = 255;
        }
    }

    // Draw to an offscreen canvas at native res, then scale up
    ctx.clearRect(0, 0, displayWidth, displayHeight);
    const bitmapCanvas = document.createElement('canvas');
    bitmapCanvas.width = resX;
    bitmapCanvas.height = resY;
    const bitmapCtx = bitmapCanvas.getContext('2d');
    if (!bitmapCtx) return false;
    bitmapCtx.putImageData(imageData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmapCanvas, 0, 0, displayWidth, displayHeight);
    return true;
}

// ─── Styles ─────────────────────────────────────────────────────────

const overlayButtonStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '4px',
    color: '#ddd',
    cursor: 'pointer',
    fontSize: '10px',
    fontFamily: 'monospace',
    lineHeight: 1,
    padding: '3px 6px',
};

const sliderStyle: React.CSSProperties = {
    width: '100%',
    height: '14px',
    accentColor: '#bdbdbd',
    cursor: 'pointer',
};

// ─── Loading Overlay ─────────────────────────────────────────────────

const LoadingOverlay: React.FC<{ percent: number }> = ({ percent }) => {
    const clamped = Math.max(0, Math.min(100, percent));
    return (
        <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            background: 'rgba(0,0,0,0.28)',
        }}>
            <div style={{
                width: 112,
                padding: '10px 12px',
                borderRadius: 6,
                background: 'rgba(18,18,18,0.92)',
                border: '1px solid rgba(255,255,255,0.14)',
                boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
            }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 7,
                    fontFamily: 'monospace',
                    color: '#ddd',
                }}>
                    <span style={{ fontSize: 10 }}>Tracing</span>
                    <span style={{ fontSize: 11, color: '#9fd0ff' }}>{clamped}%</span>
                </div>
                <div style={{
                    height: 4,
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.12)',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        width: `${clamped}%`,
                        height: '100%',
                        borderRadius: 999,
                        background: '#9fd0ff',
                    }} />
                </div>
            </div>
        </div>
    );
};

// ─── CameraViewer Component ─────────────────────────────────────────

interface CameraViewerProps {
    camera: Camera;
    isRendering: boolean;
    onRefresh?: () => void;
    isMobile?: boolean;
}

export const CameraViewer: React.FC<CameraViewerProps> = ({ camera, isRendering, onRefresh: _onRefresh, isMobile }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [hasImage, setHasImage] = useState(false);
    const [scanProgress] = useAtom(scanAccumProgressAtom);
    // Subscribe so the viewer repaints each time a progressive round writes
    // a new image into `camera.solver3Image` (the Camera instance itself is
    // mutated — React can't observe that directly).
    const [cameraImageTick] = useAtom(cameraImageTickAtom);

    // Scan projection mode
    const [projection, setProjection] = useState<'avg' | 'max' | 'none'>('none');
    // Frame scrubbing: 0..N-1
    const [frameIndex, setFrameIndex] = useState(0);

    // Display controls
    const [mapping, setMapping] = useState<DisplayMapping>('gamma');
    const [normalizeMode, setNormalizeMode] = useState<NormalizeMode>('auto');
    const [channel, setChannel] = useState<ImageChannel>('emission');
    const [blackLevel, setBlackLevel] = useState(0);
    const [whiteLevel, setWhiteLevel] = useState(1);

    // Display size (upscaled from sensor resolution)
    const displayWidth = 256;
    const displayHeight = Math.round(displayWidth * (camera.sensorResY / camera.sensorResX));

    const hasScanFrames = camera.scanFrames && camera.scanFrameCount > 0;

    // ── Resolve which raw images to use (scan projection or single-shot) ──

    const currentImages = useMemo(() => {
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

        return { emImg, exImg };
    }, [
        camera.solver3Image, camera.forwardImage,
        camera.sensorResX, camera.sensorResY,
        camera.scanFrames, camera.scanExFrames, camera.scanFrameCount,
        frameIndex, hasScanFrames, projection,
        cameraImageTick,
    ]);

    // ── Build display pixel buffer with channel selection and stats ──

    const stats = useMemo(
        () => buildDisplayPixels(
            currentImages.emImg, currentImages.exImg,
            camera.sensorResX * camera.sensorResY, channel,
        ),
        [channel, currentImages, camera.sensorResX, camera.sensorResY],
    );

    // ── Sync black/white levels when normalize mode or stats change ──

    useEffect(() => {
        const min = normalizeMode === 'auto' ? stats.autoMin : stats.min;
        const max = normalizeMode === 'auto' ? stats.autoMax : stats.max;
        setBlackLevel(min);
        setWhiteLevel(max);
    }, [normalizeMode, stats.autoMax, stats.autoMin, stats.max, stats.min]);

    // ── Paint the image whenever display parameters change ──

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const painted = paintImage(
            ctx,
            stats.pixels,
            camera.sensorResX,
            camera.sensorResY,
            displayWidth,
            displayHeight,
            Math.min(blackLevel, whiteLevel - 1e-12),
            Math.max(whiteLevel, blackLevel + 1e-12),
            mapping,
        );
        setHasImage(painted);
    }, [
        blackLevel, whiteLevel, mapping, stats,
        camera.sensorResX, camera.sensorResY,
        displayWidth, displayHeight,
    ]);

    const isStale = camera.solver3Stale;
    const minBound = normalizeMode === 'auto' ? stats.autoMin : stats.min;
    const maxBound = normalizeMode === 'auto' ? stats.autoMax : stats.max;

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
                    {camera.sensorResX}x{camera.sensorResY}
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
                    <span style={{
                        fontSize: '10px',
                        color: isRendering ? '#007fff' : isStale ? '#ff8844' : '#44ff88',
                        fontFamily: 'monospace',
                    }}>
                        {isRendering ? 'Tracing…' : isStale ? 'Updating…' : hasImage ? 'OK' : ''}
                    </span>
                </div>
            </div>

            {/* Canvas with overlay buttons */}
            <div style={{ position: 'relative' }}>
                <canvas
                    ref={canvasRef}
                    width={displayWidth}
                    height={displayHeight}
                    style={{
                        width: '100%',
                        height: isMobile ? '100%' : 'auto',
                        maxHeight: '100%',
                        objectFit: 'contain',
                        borderRadius: '4px',
                        border: '1px solid #333',
                        background: '#111',
                        imageRendering: 'pixelated',
                        display: 'block',
                    }}
                />
                {isRendering && !hasImage && (
                    <LoadingOverlay percent={Math.round(scanProgress * 100)} />
                )}

                {/* Overlay: channel / normalize / mapping toggle buttons */}
                {!isMobile && (
                    <div style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: 'rgba(0,0,0,0.5)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '5px',
                        padding: '3px 4px',
                    }}>
                        <button
                            onClick={() => setChannel(ch =>
                                ch === 'emission' ? 'excitation'
                                : ch === 'excitation' ? 'combined'
                                : 'emission'
                            )}
                            title={
                                channel === 'emission'
                                    ? 'Show excitation channel'
                                    : channel === 'excitation'
                                        ? 'Show combined emission + excitation'
                                        : 'Show emission channel'
                            }
                            style={overlayButtonStyle}
                        >
                            {imageChannelLabel(channel)}
                        </button>
                        <button
                            onClick={() => setNormalizeMode(m => m === 'auto' ? 'full' : 'auto')}
                            title={normalizeMode === 'auto'
                                ? 'Use full display range (min/max)'
                                : 'Auto-window to 1%-99.5% percentile'}
                            style={overlayButtonStyle}
                        >
                            {normalizeMode === 'auto' ? 'AUTO' : 'FULL'}
                        </button>
                        <button
                            onClick={() => setMapping(m => nextDisplayMapping(m))}
                            title={displayMappingTitle(mapping)}
                            style={overlayButtonStyle}
                        >
                            {displayMappingLabel(mapping)}
                        </button>
                    </div>
                )}
            </div>

            {/* Black / White level sliders and stats panel */}
            {!isMobile && (
                <div style={{
                marginTop: '6px',
                padding: '6px 8px',
                backgroundColor: '#111',
                borderRadius: '4px',
                border: '1px solid #282828',
            }}>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '44px 1fr 50px',
                    gap: '4px 8px',
                    alignItems: 'center',
                }}>
                    <div style={{ color: '#777', fontSize: '10px' }}>Black</div>
                    <input
                        type="range"
                        min={minBound}
                        max={maxBound}
                        step={Math.max((maxBound - minBound) / 1000, 1e-12)}
                        value={Math.min(blackLevel, whiteLevel)}
                        onChange={e => setBlackLevel(Math.min(Number(e.target.value), whiteLevel))}
                        style={sliderStyle}
                    />
                    <div style={{ color: '#ddd', fontSize: '10px', fontFamily: 'monospace', textAlign: 'right' }}>
                        {blackLevel.toExponential(2)}
                    </div>

                    <div style={{ color: '#777', fontSize: '10px' }}>White</div>
                    <input
                        type="range"
                        min={minBound}
                        max={maxBound}
                        step={Math.max((maxBound - minBound) / 1000, 1e-12)}
                        value={Math.max(whiteLevel, blackLevel)}
                        onChange={e => setWhiteLevel(Math.max(Number(e.target.value), blackLevel))}
                        style={sliderStyle}
                    />
                    <div style={{ color: '#ddd', fontSize: '10px', fontFamily: 'monospace', textAlign: 'right' }}>
                        {whiteLevel.toExponential(2)}
                    </div>
                </div>

                {/* Display stats */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '4px 12px',
                    marginTop: '6px',
                    paddingTop: '4px',
                    borderTop: '1px solid #282828',
                }}>
                    <div>
                        <div style={{ color: '#777', fontSize: '10px' }}>Channel</div>
                        <div style={{ color: '#ddd', fontSize: '11px', fontFamily: 'monospace' }}>
                            {imageChannelLabel(channel)}
                        </div>
                    </div>
                    <div>
                        <div style={{ color: '#777', fontSize: '10px' }}>Display</div>
                        <div style={{ color: '#ddd', fontSize: '11px', fontFamily: 'monospace' }}>
                            {displayMappingLabel(mapping)} / {normalizeMode}
                        </div>
                    </div>
                    <div style={{ gridColumn: '1 / span 2' }}>
                        <div style={{ color: '#777', fontSize: '10px' }}>Raw Range</div>
                        <div style={{ color: '#ddd', fontSize: '11px', fontFamily: 'monospace' }}>
                            {stats.min.toExponential(2)}..{stats.max.toExponential(2)}
                        </div>
                    </div>
                </div>
            </div>
            )}

            {/* Frame scrubbing slider */}
            {!isMobile && hasScanFrames && (
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
