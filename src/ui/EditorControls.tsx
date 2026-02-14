import React, { useEffect, useRef, useState } from 'react';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { OrbitControls } from '@react-three/drei';
import { MOUSE, TOUCH, Vector3, Euler, Quaternion } from 'three';
import { useAtom, useSetAtom } from 'jotai';
import { componentsAtom, selectionAtom } from '../state/store';

export const EditorControls: React.FC = () => {
    const controlsRef = useRef<OrbitControlsImpl>(null);
    const [enableRotate, setEnableRotate] = useState(false);
    const [shiftHeld, setShiftHeld] = useState(false);
    const setSelection = useSetAtom(selectionAtom);
    const [components, setComponents] = useAtom(componentsAtom);
    const [selection] = useAtom(selectionAtom);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.altKey) setEnableRotate(true);
            if (e.shiftKey) setShiftHeld(true);
            if (e.key === 'Escape') setSelection([]);

            // Zoom shortcuts: [ = zoom out 2x, ] = zoom in 2x
            if (e.key === '[' || e.key === ']') {
                const controls = controlsRef.current;
                if (controls) {
                    const camera = controls.object;
                    const target = controls.target;
                    const direction = camera.position.clone().sub(target);
                    const factor = e.key === ']' ? 0.5 : 2.0;
                    direction.multiplyScalar(factor);
                    camera.position.copy(target.clone().add(direction));
                    controls.update();
                }
            }

            // WASD / Arrow keys: pan camera when nothing is selected
            if (selection.length === 0) {
                const panKeys: Record<string, [number, number]> = {
                    'w': [0, 1], 'W': [0, 1], 'ArrowUp': [0, 1],
                    's': [0, -1], 'S': [0, -1], 'ArrowDown': [0, -1],
                    'a': [-1, 0], 'A': [-1, 0], 'ArrowLeft': [-1, 0],
                    'd': [1, 0], 'D': [1, 0], 'ArrowRight': [1, 0],
                };
                const dir = panKeys[e.key];
                if (dir) {
                    const target = e.target as HTMLElement;
                    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
                    e.preventDefault();

                    const controls = controlsRef.current;
                    if (controls) {
                        const camera = controls.object;
                        // Get camera-local right and up vectors for natural panning
                        const right = new Vector3();
                        const up = new Vector3();
                        camera.matrixWorld.extractBasis(right, up, new Vector3());

                        const panSpeed = 10; // mm per keypress
                        const offset = right.multiplyScalar(dir[0] * panSpeed)
                            .add(up.multiplyScalar(dir[1] * panSpeed));

                        camera.position.add(offset);
                        controls.target.add(offset);
                        controls.update();
                    }
                }
            }

            // Q/E rotation: rotate selected component ±15° around world Z axis
            if ((e.key === 'q' || e.key === 'Q' || e.key === 'e' || e.key === 'E') && selection.length > 0) {
                // Don't trigger if user is typing in an input field
                const target = e.target as HTMLElement;
                if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

                const rotationStep = 15 * (Math.PI / 180); // 15 degrees
                const direction = (e.key === 'q' || e.key === 'Q') ? 1 : -1;

                const newComponents = components.map(c => {
                    if (selection.includes(c.id)) {
                        const qStep = new Quaternion().setFromAxisAngle(
                            new Vector3(0, 0, 1),
                            direction * rotationStep
                        );
                        c.rotation.premultiply(qStep);
                        const euler = new Euler().setFromQuaternion(c.rotation);
                        c.setRotation(euler.x, euler.y, euler.z);
                        return c;
                    }
                    return c;
                });
                setComponents(newComponents);
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (!e.altKey) setEnableRotate(false);
            if (!e.shiftKey) setShiftHeld(false);
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [setSelection, selection, components, setComponents]);

    return (
        <OrbitControls
            ref={controlsRef}
            makeDefault
            enableRotate={enableRotate}
            enableZoom={true}
            enablePan={!shiftHeld}

            // Mouse Mappings
            mouseButtons={{
                LEFT: MOUSE.ROTATE, // Shift+Click to Rotate. Regular Click = Nothing (if enableRotate=false)
                MIDDLE: MOUSE.PAN,
                RIGHT: MOUSE.PAN
            }}

            // Touch Mappings (for Mac trackpad & mobile)
            touches={{
                ONE: TOUCH.PAN,
                TWO: TOUCH.DOLLY_ROTATE
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
