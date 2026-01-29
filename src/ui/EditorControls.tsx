import React, { useEffect, useRef, useState } from 'react';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { OrbitControls } from '@react-three/drei';
import { MOUSE } from 'three';
import { useAtom } from 'jotai';
import { selectionAtom } from '../state/store';

export const EditorControls: React.FC = () => {
    const controlsRef = useRef<OrbitControlsImpl>(null);
    const [enableRotate, setEnableRotate] = useState(false);
    const [selection] = useAtom(selectionAtom);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.shiftKey) setEnableRotate(true);
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
    }, []);

    return (
        <OrbitControls
            ref={controlsRef}
            makeDefault
            enableRotate={enableRotate}
            enableZoom={!selection} // Disable zoom if an item is selected (Scroll rotates item)
            
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
