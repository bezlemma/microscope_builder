import React from 'react';
import { PMT } from '../physics/components/PMT';
import { CameraViewer } from './CameraViewer';
import type { CameraRasterSource } from './CameraViewer';

interface PMTViewerProps {
    pmt: PMT;
    isRendering: boolean;
    onRefresh?: () => void;
    isMobile?: boolean;
}

export const PMTViewer: React.FC<PMTViewerProps> = ({ pmt, isRendering, onRefresh, isMobile }) => {
    const adapter = React.useMemo<CameraRasterSource>(() => ({
        get id() { return pmt.id; },
        get reverseTraceImage() { return pmt.scanImage; },
        get forwardImage() { return pmt.scanExcitationImage; },
        get sensorResX() { return pmt.scanResX; },
        get sensorResY() { return pmt.scanResY; },
        get scanFrames() { return null; },
        get scanExFrames() { return null; },
        get scanFrameTimesMs() { return null; },
        get scanFrameCount() { return 0; },
        get scanCycleMs() { return 0; },
    }), [pmt]);

    return (
        <CameraViewer
            camera={adapter}
            isRendering={isRendering}
            onRefresh={onRefresh}
            isMobile={isMobile}
        />
    );
};
