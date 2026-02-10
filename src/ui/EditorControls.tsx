import React, { useEffect, useRef, useState } from 'react';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { OrbitControls } from '@react-three/drei';
import { MOUSE } from 'three';
import { useSetAtom } from 'jotai';
import { selectionAtom } from '../state/store';

export const EditorControls: React.FC = () => {
    const controlsRef = useRef<OrbitControlsImpl>(null);
    const [enableRotate, setEnableRotate] = useState(false);
    const setSelection = useSetAtom(selectionAtom);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.shiftKey) setEnableRotate(true);
            if (e.key === 'Escape') setSelection(null);
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (!e.shiftKey) setEnableRotate(false);
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [setSelection]);

    return (
        <OrbitControls
            ref={controlsRef}
            makeDefault
            enableRotate={enableRotate}
            enableZoom={true}
            
            // Mouse Mappings
            mouseButtons={{
                LEFT: MOUSE.ROTATE, // Shift+Click to Rotate. Regular Click = Nothing (if enableRotate=false)
                MIDDLE: MOUSE.PAN,
                RIGHT: MOUSE.PAN
            }}
            
            // Standard constraints
            minDistance={1}
            maxDistance={2000}
            enableDamping={true}
            dampingFactor={0.1}
            
            // Initial View defaults (Target handling is usually external, but we keep it neutral here)
        />
    );
};
