import React, { useEffect } from 'react';
import { useAtom } from 'jotai';
import { useThree } from '@react-three/fiber';
import { Vector3, Euler, Quaternion } from 'three';
import { componentsAtom, selectionAtom } from '../state/store';

export const GlobalRotation: React.FC = () => {
    const [components, setComponents] = useAtom(componentsAtom);
    const [selection] = useAtom(selectionAtom);
    const { gl } = useThree();

    const isMouseDown = React.useRef(false);

    useEffect(() => {
        const handleMouseDown = (e: MouseEvent) => {
            if (e.button === 0) isMouseDown.current = true;
        };
        const handleMouseUp = () => {
            isMouseDown.current = false;
        };

        const handleWheel = (e: WheelEvent) => {
            if (!selection || !isMouseDown.current) return;

            // Stop propagation to prevent OrbitControls zoom if it leaks (though enableZoom={false} should handle it)
            // e.stopPropagation(); 
            // e.preventDefault(); // Might be aggressive if we want to scroll the page, but in a Canvas app, this is usually desired.
            
            const delta = Math.sign(e.deltaY);
            const rotationStep = 5 * (Math.PI / 180);

            // Update the selected component
            const newComponents = components.map(c => {
                if (c.id === selection) {
                    // Z-up world: rotate around Z-axis (perpendicular to XY table)
                    // Use premultiply to apply rotation in WORLD space, not local space
                    const qStep = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), delta * rotationStep);
                    c.rotation.premultiply(qStep);
                    
                    const euler = new Euler().setFromQuaternion(c.rotation);
                    c.setRotation(euler.x, euler.y, euler.z);
                    return c;
                }
                return c;
            });
            
            setComponents(newComponents);
        };

        // Attach to DOM element
        const domElement = gl.domElement;
        
        // Listeners for mouse state
        domElement.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mouseup', handleMouseUp); // Window ensures we catch release outside canvas
        domElement.addEventListener('wheel', handleWheel, { passive: false }); 

        return () => {
            domElement.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mouseup', handleMouseUp);
            domElement.removeEventListener('wheel', handleWheel);
        };
    }, [selection, components, setComponents, gl.domElement]);

    return null;
};
