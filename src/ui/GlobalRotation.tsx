import React, { useEffect } from 'react';
import { useAtom } from 'jotai';
import { useThree } from '@react-three/fiber';
import { Vector3, Euler, Quaternion } from 'three';
import { componentsAtom, selectionAtom, isDraggingAtom } from '../state/store';

export const GlobalRotation: React.FC = () => {
    const [components, setComponents] = useAtom(componentsAtom);
    const [selection] = useAtom(selectionAtom);
    const [isDragging] = useAtom(isDraggingAtom);
    const { gl } = useThree();

    useEffect(() => {
        const handleWheel = (e: WheelEvent) => {
            // Rotate selected component when:
            //   - Click-holding on a component + scroll, OR
            //   - Shift+Scroll (original shortcut)
            if (selection.length === 0 || (!e.shiftKey && !isDragging)) return;

            // Prevent OrbitControls from zooming while we're rotating the object
            e.preventDefault();
            e.stopPropagation();

            const delta = Math.sign(e.deltaY);
            const rotationStep = 5 * (Math.PI / 180);

            // Update the selected component
            const newComponents = components.map(c => {
                if (selection.includes(c.id)) {
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
        domElement.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            domElement.removeEventListener('wheel', handleWheel);
        };
    }, [selection, components, setComponents, gl.domElement, isDragging]);

    return null;
};

