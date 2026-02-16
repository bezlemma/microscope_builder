import React from 'react';
import { GizmoHelper, GizmoViewport } from '@react-three/drei';
import { useIsMobile } from './useIsMobile';

export const AxesWidget: React.FC = () => {
    const isMobile = useIsMobile();
    if (isMobile) return null;

    return (
        <GizmoHelper
            alignment="bottom-right"
            margin={[80, 80]}
            onUpdate={() => {}} // Optional
        >
            <GizmoViewport
                axisColors={['red', '#34D399', 'blue']} // X=Red, Y=Green, Z=Blue (Z=Up per PhysicsPlan)
                labelColor="white"
                hideNegativeAxes={false} 
            />
        </GizmoHelper>
    );
};
