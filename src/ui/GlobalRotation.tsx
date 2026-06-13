import React, { useEffect, useRef } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { useThree } from '@react-three/fiber';
import { Vector3, Euler, Quaternion } from 'three';
import { componentsAtom, selectionAtom, isDraggingAtom, pushUndoAtom } from '../state/store';

export const GlobalRotation: React.FC = () => {
    const [components, setComponents] = useAtom(componentsAtom);
    const [selection] = useAtom(selectionAtom);
    const [isDragging] = useAtom(isDraggingAtom);
    const pushUndo = useSetAtom(pushUndoAtom);
    const { gl } = useThree();
    // Wheel ticks closer together than this are one rotate gesture (one undo).
    const ROTATE_GESTURE_GAP_MS = 600;
    const lastWheelTimeRef = useRef(0);

    useEffect(() => {
        const handleWheel = (e: WheelEvent) => {
            // Rotate selected component when:
            //   - Click-holding on a component + scroll, OR
            //   - Shift+Scroll (original shortcut)
            if (selection.length === 0 || (!e.shiftKey && !isDragging)) return;

            // Prevent OrbitControls from zooming while we're rotating the object
            e.preventDefault();
            e.stopPropagation();

            // Same direction convention as the left-hold + scroll rotation in
            // EditorControls (scroll down = clockwise looking down the Z axis),
            // and the same undo behavior.
            const delta = e.deltaY > 0 ? -1 : 1;
            const rotationStep = 5 * (Math.PI / 180);
            // One undo snapshot per gesture, not per wheel tick.
            const now = performance.now();
            if (now - lastWheelTimeRef.current > ROTATE_GESTURE_GAP_MS) pushUndo();
            lastWheelTimeRef.current = now;

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
    }, [selection, components, setComponents, gl.domElement, isDragging, pushUndo]);

    return null;
};

