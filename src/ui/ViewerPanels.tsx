/**
 * ViewerPanels — floating viewer panels that can be toggled on independently
 * of the Inspector selection. These appear at the bottom-left of the viewport.
 * Multiple panels stack horizontally.
 * Each shows only the canvas — no properties, no delete, no readout text.
 *
 * Supports both Card beam profile viewers and Camera Solver 3 image viewers.
 */
import React from 'react';
import { useAtom } from 'jotai';
import { componentsAtom, pinnedViewersAtom, solver3RenderingAtom, solver3RenderTriggerAtom, rayConfigAtom, animatorAtom, scanAccumTriggerAtom } from '../state/store';
import { Card } from '../physics/components/Card';
import { Camera } from '../physics/components/Camera';
import { PMT } from '../physics/components/PMT';
import { CardViewer } from './CardViewer';
import { CameraViewer } from './CameraViewer';
import { OpticalComponent } from '../physics/Component';

export const ViewerPanels: React.FC = () => {
    const [components] = useAtom(componentsAtom);
    const [pinnedIds, setPinnedIds] = useAtom(pinnedViewersAtom);
    const [isRendering] = useAtom(solver3RenderingAtom);
    const [, setSolver3Trigger] = useAtom(solver3RenderTriggerAtom);
    const [rayConfig, setRayConfig] = useAtom(rayConfigAtom);
    const [animator] = useAtom(animatorAtom);
    const [scanAccumConfig, setScanAccumConfig] = useAtom(scanAccumTriggerAtom);

    // Resolve pinned IDs to actual Card or Camera instances (filter stale IDs)
    const pinnedComponents = Array.from(pinnedIds)
        .map(id => components.find(c => c.id === id))
        .filter((c): c is OpticalComponent => c instanceof Card || c instanceof Camera || (c instanceof PMT && (c as PMT).hasValidAxes()));

    if (pinnedComponents.length === 0) return null;

    return (
        <div style={{
            position: 'absolute',
            bottom: '20px',
            left: '320px',
            display: 'flex',
            flexDirection: 'row',
            gap: '8px',
            zIndex: 10,
            pointerEvents: 'none',
        }}>
            {pinnedComponents.map(comp => (
                <div
                    key={comp.id}
                    style={{
                        backgroundColor: '#222',
                        border: '1px solid #444',
                        borderRadius: '8px',
                        padding: '6px',
                        fontFamily: 'sans-serif',
                        pointerEvents: 'auto',
                    }}
                >
                    {/* Header: name + close button */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '4px',
                        paddingLeft: '2px',
                    }}>
                        <span style={{
                            fontSize: '10px',
                            fontWeight: 600,
                            color: '#999',
                        }}>
                            {comp.name}
                        </span>
                        <button
                            onClick={() => {
                                const next = new Set(pinnedIds);
                                next.delete(comp.id);
                                setPinnedIds(next);
                            }}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: '#555',
                                cursor: 'pointer',
                                fontSize: '12px',
                                padding: '0 2px',
                                lineHeight: 1,
                            }}
                            title="Close viewer"
                        >
                            ✕
                        </button>
                    </div>

                    {/* Viewer content */}
                    {comp instanceof Card && (
                        <CardViewer card={comp} compact />
                    )}
                    {comp instanceof Camera && (
                        <CameraViewer
                            camera={comp}
                            isRendering={isRendering}
                            onRefresh={() => {
                                // Auto-enable E&M if not already on
                                if (!rayConfig.solver2Enabled) {
                                    setRayConfig({ ...rayConfig, solver2Enabled: true });
                                }
                                if (animator.channels.length > 0) {
                                    // Animation channels present — auto scan accumulation
                                    setScanAccumConfig({ steps: 16, trigger: scanAccumConfig.trigger + 1 });
                                } else {
                                    setSolver3Trigger(n => n + 1);
                                }
                            }}
                        />
                    )}
                    {comp instanceof PMT && (() => {
                        const pmt = comp as PMT;
                        const hasScanImage = !!pmt.scanImage;
                        return (
                            <div style={{ position: 'relative' }}>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2px' }}>
                                    <button
                                        onClick={() => {
                                            if (!rayConfig.solver2Enabled) {
                                                setRayConfig({ ...rayConfig, solver2Enabled: true });
                                            }
                                            pmt.markScanStale();
                                            pmt.version++;
                                            // Force re-render by bumping components
                                            // (ViewerPanels reads from componentsAtom)
                                        }}
                                        disabled={isRendering}
                                        title="Re-run raster scan"
                                        style={{
                                            background: isRendering ? '#333' : '#1a5a2a',
                                            border: '1px solid #444',
                                            borderRadius: '3px',
                                            color: isRendering ? '#666' : '#8f8',
                                            cursor: isRendering ? 'not-allowed' : 'pointer',
                                            fontSize: '11px',
                                            padding: '1px 5px',
                                            lineHeight: 1.2,
                                        }}
                                    >
                                        🔄
                                    </button>
                                </div>
                                <canvas
                                    ref={el => {
                                        if (!el) return;
                                        const ctx = el.getContext('2d');
                                        if (!ctx) return;
                                        const w = pmt.scanResX;
                                        const h = pmt.scanResY;
                                        if (pmt.scanImage) {
                                            const img = pmt.scanImage;
                                            let maxVal = 0;
                                            for (let i = 0; i < img.length; i++) if (img[i] > maxVal) maxVal = img[i];
                                            if (maxVal < 1e-12) maxVal = 1;
                                            const imageData = ctx.createImageData(w, h);
                                            for (let y = 0; y < h; y++) {
                                                for (let x = 0; x < w; x++) {
                                                    const srcIdx = (h - 1 - y) * w + x;
                                                    const v = Math.pow(Math.max(0, Math.min(1, img[srcIdx] / maxVal)), 0.45);
                                                    const dstIdx = (y * w + x) * 4;
                                                    imageData.data[dstIdx + 0] = Math.round(v * 80);
                                                    imageData.data[dstIdx + 1] = Math.round(v * 255);
                                                    imageData.data[dstIdx + 2] = Math.round(v * 80);
                                                    imageData.data[dstIdx + 3] = 255;
                                                }
                                            }
                                            ctx.putImageData(imageData, 0, 0);
                                        } else {
                                            ctx.fillStyle = '#000';
                                            ctx.fillRect(0, 0, w, h);
                                        }
                                    }}
                                    width={pmt.scanResX}
                                    height={pmt.scanResY}
                                    style={{ width: '160px', height: '160px', imageRendering: 'pixelated', borderRadius: 4, border: '1px solid #333' }}
                                />
                                {!hasScanImage && (
                                    <div style={{
                                        position: 'absolute', top: 24, left: 0, width: '160px', height: '160px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        borderRadius: 4,
                                    }}>
                                        <span style={{ fontSize: '10px', color: '#555', fontStyle: 'italic' }}>
                                            No scan data yet
                                        </span>
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </div>
            ))}
        </div>
    );
};
