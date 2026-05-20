import React from 'react';
import { PMT } from '../physics/components/PMT';
import { Camera } from '../physics/components/Camera';
import { CameraViewer } from './CameraViewer';

interface PMTViewerProps {
    pmt: PMT;
    isRendering: boolean;
    onRefresh?: () => void;
    isMobile?: boolean;
    /** Accepted for API compatibility with the previous PMTViewer; the unified
     *  viewer auto-sizes to its parent. */
    compact?: boolean;
}

/**
 * PMTViewer — thin adapter that maps a PMT's raster-scan fields onto the
 * Camera-shaped interface CameraViewer reads. Both detectors render with the
 * same UI (channel toggle, AUTO/FULL, LIN/GAM/LOG, black/white sliders,
 * stats panel) so users don't have to learn two different viewers.
 *
 * The adapter uses live getters because PMT raster images are mutated in
 * place by OpticalTable. CameraViewer repaints on cameraImageTick, so copied
 * fields here would leave it looking at the old null image forever.
 */
export const PMTViewer: React.FC<PMTViewerProps> = ({ pmt, isRendering, onRefresh, isMobile }) => {
    const adapter = React.useMemo(() => ({
        get id() { return pmt.id; },
        get name() { return pmt.name; },
        get reverseTraceImage() { return pmt.scanImage; },
        get forwardImage() { return pmt.scanExcitationImage; },
        get sensorResX() { return pmt.scanResX; },
        get sensorResY() { return pmt.scanResY; },
        get scanFrames() { return null; },
        get scanExFrames() { return null; },
        get scanFrameCount() { return 0; },
        get reverseTraceStale() { return pmt.scanStale; },
        get version() { return pmt.version; },
    }) as unknown as Camera, [pmt]);

    return (
        <CameraViewer
            camera={adapter}
            isRendering={isRendering}
            onRefresh={onRefresh}
            isMobile={isMobile}
        />
    );
};
