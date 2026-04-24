import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PMT } from '../physics/components/PMT';

type DisplayMapping = 'linear' | 'gamma' | 'log';
type NormalizeMode = 'auto' | 'full';
type ImageChannel = 'emission' | 'excitation' | 'combined';

function imageChannelLabel(channel: ImageChannel): string {
    if (channel === 'emission') return 'EM';
    if (channel === 'excitation') return 'S-EX';
    return 'BOTH';
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

function mapDisplayValue(normalized: number, mapping: DisplayMapping): number {
    const safe = Math.max(0, Math.min(1, normalized));
    if (mapping === 'linear') return safe;
    if (mapping === 'log') return Math.log10(1 + safe * 2047) / Math.log10(2048);
    return Math.pow(safe, 0.45);
}

interface DisplayStats {
    min: number;
    max: number;
    autoMin: number;
    autoMax: number;
    pixels: Float32Array | null;
}

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
    if (!Number.isFinite(max) || max <= min) max = Math.max(min + 1, 1);

    const sorted = Array.from(pixels).filter(value => Number.isFinite(value)).sort((a, b) => a - b);
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

    const imageData = ctx.createImageData(resX, resY);
    const denom = Math.max(whitePoint - blackPoint, 1e-12);
    for (let py = 0; py < resY; py++) {
        const srcRow = resY - 1 - py;
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

interface PMTViewerProps {
    pmt: PMT;
    isRendering: boolean;
    onRefresh?: () => void;
    compact?: boolean;
}

export const PMTViewer: React.FC<PMTViewerProps> = ({ pmt, isRendering, onRefresh, compact = false }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [hasImage, setHasImage] = useState(false);
    const [mapping, setMapping] = useState<DisplayMapping>('gamma');
    const [normalizeMode, setNormalizeMode] = useState<NormalizeMode>('auto');
    const [channel, setChannel] = useState<ImageChannel>('emission');
    const [blackLevel, setBlackLevel] = useState(0);
    const [whiteLevel, setWhiteLevel] = useState(1);

    const displayWidth = compact ? 160 : 256;
    const displayHeight = Math.round(displayWidth * (pmt.scanResY / Math.max(pmt.scanResX, 1)));
    const stats = useMemo(
        () => buildDisplayPixels(
            pmt.scanImage,
            pmt.scanExcitationImage,
            pmt.scanResX * pmt.scanResY,
            channel,
        ),
        [channel, pmt.scanExcitationImage, pmt.scanImage, pmt.scanResX, pmt.scanResY],
    );

    useEffect(() => {
        const min = normalizeMode === 'auto' ? stats.autoMin : stats.min;
        const max = normalizeMode === 'auto' ? stats.autoMax : stats.max;
        setBlackLevel(min);
        setWhiteLevel(max);
    }, [normalizeMode, stats.autoMax, stats.autoMin, stats.max, stats.min]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const painted = paintImage(
            ctx,
            stats.pixels,
            pmt.scanResX,
            pmt.scanResY,
            displayWidth,
            displayHeight,
            Math.min(blackLevel, whiteLevel - 1e-12),
            Math.max(whiteLevel, blackLevel + 1e-12),
            mapping,
        );
        setHasImage(painted);
    }, [blackLevel, whiteLevel, displayHeight, displayWidth, mapping, pmt.scanResX, pmt.scanResY, stats]);

    const hasExcitation = !!pmt.scanExcitationImage && pmt.scanExcitationImage.length === pmt.scanResX * pmt.scanResY;
    const minBound = normalizeMode === 'auto' ? stats.autoMin : stats.min;
    const maxBound = normalizeMode === 'auto' ? stats.autoMax : stats.max;

    return (
        <div>
            {!compact && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#aaa' }}>
                        {pmt.scanResX}x{pmt.scanResY}
                    </span>
                    {isRendering ? (
                        <span style={{ fontSize: '10px', color: '#ff8844', fontFamily: 'monospace' }}>...</span>
                    ) : onRefresh ? (
                        <button onClick={onRefresh} title="Re-run PMT scan" style={{
                            background: 'none', border: '1px solid #664422', borderRadius: '3px',
                            color: '#ff8844', cursor: 'pointer', fontSize: '10px', fontFamily: 'monospace',
                            padding: '1px 6px', lineHeight: 1.4,
                        }}>
                            Refresh
                        </button>
                    ) : (
                        <span style={{ fontSize: '10px', color: hasImage ? '#44ff88' : '#888', fontFamily: 'monospace' }}>
                            {hasImage ? 'OK' : ''}
                        </span>
                    )}
                </div>
            )}
            <div style={{ position: 'relative' }}>
                <canvas
                    ref={canvasRef}
                    width={displayWidth}
                    height={displayHeight}
                    style={{
                        width: `${displayWidth}px`, height: `${displayHeight}px`,
                        background: '#000', borderRadius: 6, border: '1px solid #333', display: 'block',
                    }}
                />
                <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {(['emission', 'excitation', 'combined'] as const).map(nextChannel => (
                        <button key={nextChannel} onClick={() => setChannel(nextChannel)} title={imageChannelLabel(nextChannel)}
                            disabled={nextChannel !== 'emission' && !hasExcitation}
                            style={{ ...overlayButtonStyle, opacity: nextChannel !== 'emission' && !hasExcitation ? 0.35 : 1, color: channel === nextChannel ? '#fff' : '#aaa' }}
                        >
                            {imageChannelLabel(nextChannel)}
                        </button>
                    ))}
                    <button onClick={() => setNormalizeMode(mode => mode === 'auto' ? 'full' : 'auto')} style={overlayButtonStyle}>
                        {normalizeMode === 'auto' ? 'AUTO' : 'FULL'}
                    </button>
                    <button onClick={() => setMapping(nextDisplayMapping(mapping))} style={overlayButtonStyle}>
                        {displayMappingLabel(mapping)}
                    </button>
                </div>
            </div>
            {!compact && (
                <>
                    <div style={{ marginTop: 10 }}>
                        <label style={{ display: 'block', fontSize: '10px', color: '#888', marginBottom: 2 }}>Black</label>
                        <input type="range" min={minBound} max={maxBound}
                            step={Math.max((maxBound - minBound) / 2048, 1e-12)}
                            value={blackLevel}
                            onChange={event => setBlackLevel(Math.min(Number(event.target.value), whiteLevel - 1e-12))}
                            style={sliderStyle}
                        />
                    </div>
                    <div style={{ marginTop: 6 }}>
                        <label style={{ display: 'block', fontSize: '10px', color: '#888', marginBottom: 2 }}>White</label>
                        <input type="range" min={minBound} max={maxBound}
                            step={Math.max((maxBound - minBound) / 2048, 1e-12)}
                            value={whiteLevel}
                            onChange={event => setWhiteLevel(Math.max(Number(event.target.value), blackLevel + 1e-12))}
                            style={sliderStyle}
                        />
                    </div>
                    <div style={{ marginTop: 6, fontSize: '10px', color: '#777' }}>
                        {pmt.scanResX}x{pmt.scanResY} raster scan
                    </div>
                </>
            )}
        </div>
    );
};
