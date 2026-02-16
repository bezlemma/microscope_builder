import React, { useEffect, useRef, useState } from 'react';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { MOUSE, TOUCH, Vector3, Euler, Quaternion, OrthographicCamera } from 'three';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { activePresetAtom, componentsAtom, selectionAtom } from '../state/store';

export const EditorControls: React.FC = () => {
    const controlsRef = useRef<OrbitControlsImpl>(null);
    const [altHeld, setAltHeld] = useState(false);
    const [shiftHeld, setShiftHeld] = useState(false);
    const setSelection = useSetAtom(selectionAtom);
    const [components, setComponents] = useAtom(componentsAtom);
    const [selection] = useAtom(selectionAtom);
    const activePreset = useAtomValue(activePresetAtom);
    const { size } = useThree();

    // ─── Auto-zoom to fit when preset changes ───
    useEffect(() => {
        const controls = controlsRef.current;
        if (!controls || components.length === 0) return;

        const camera = controls.object;
        if (!(camera instanceof OrthographicCamera)) return;

        // Compute bounding box of all component positions
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        for (const comp of components) {
            const p = comp.position;
            // Use a fixed half-size estimate for component extent (most are ~25mm)
            const half = 25;
            minX = Math.min(minX, p.x - half);
            maxX = Math.max(maxX, p.x + half);
            minY = Math.min(minY, p.y - half);
            maxY = Math.max(maxY, p.y + half);
        }

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const spanX = maxX - minX;
        const spanY = maxY - minY;

        // Orthographic camera: visible width = canvasWidth / zoom
        // We want: spanX * (1 + padding) ≤ canvasWidth / zoom
        //          spanY * (1 + padding) ≤ canvasHeight / zoom
        const padding = 0.25; // 25% margin
        const zoomX = spanX > 0 ? size.width / (spanX * (1 + padding)) : 2;
        const zoomY = spanY > 0 ? size.height / (spanY * (1 + padding)) : 2;
        const newZoom = Math.min(zoomX, zoomY);

        // Set camera position (keep Z the same)
        camera.position.set(centerX, centerY, camera.position.z);
        controls.target.set(centerX, centerY, 0);
        camera.zoom = Math.max(0.2, Math.min(newZoom, 10)); // clamp to reasonable range
        camera.updateProjectionMatrix();
        controls.update();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePreset]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.altKey) setAltHeld(true);
            if (e.shiftKey) setShiftHeld(true);
            if (e.key === 'Escape') setSelection([]);

            // Zoom shortcuts: [ = zoom out, ] = zoom in (orthographic camera)
            if (e.key === '[' || e.key === ']') {
                const controls = controlsRef.current;
                if (controls) {
                    const camera = controls.object;
                    if (camera instanceof OrthographicCamera) {
                        const factor = e.key === ']' ? 1.5 : (1 / 1.5);
                        camera.zoom *= factor;
                        camera.updateProjectionMatrix();
                    }
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
            if (!e.altKey) setAltHeld(false);
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
            enableRotate={true}
            enableZoom={true}
            enablePan={true}

            // Mouse Mappings (same on Mac + Windows):
            //
            //   Left-click             = Select / drag component (not OrbitControls)
            //   Shift + Left-drag      = Pan
            //   Middle-drag            = Pan
            //   Alt + Left-drag        = Rotate camera
            //   Alt + Middle-drag      = Rotate camera
            //   Right-click           = (reserved)
            //   Scroll                 = Zoom
            //   Ctrl                   = (nothing)
            mouseButtons={{
                LEFT: altHeld ? MOUSE.ROTATE : (shiftHeld ? MOUSE.PAN : -1 as any),
                MIDDLE: altHeld ? MOUSE.ROTATE : MOUSE.PAN,
                RIGHT: -1 as any
            }}

            // Touch Mappings (touchscreens / tablets)
            touches={{
                ONE: TOUCH.PAN,
                TWO: TOUCH.DOLLY_ROTATE
            }}

            // Standard constraints
            minDistance={1}
            maxDistance={2000}
            enableDamping={true}
            dampingFactor={0.1}
        />
    );
};
