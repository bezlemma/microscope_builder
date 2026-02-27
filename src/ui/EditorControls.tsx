import React, { useEffect, useRef, useState } from 'react';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { MOUSE, TOUCH, Vector3, Euler, Quaternion, OrthographicCamera } from 'three';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { activePresetAtom, componentsAtom, selectionAtom, undoAtom, pushUndoAtom, rayConfigAtom, solver3RenderTriggerAtom } from '../state/store';

export const EditorControls: React.FC = () => {
    const controlsRef = useRef<OrbitControlsImpl>(null);
    const [altHeld, setAltHeld] = useState(false);
    const [shiftHeld, setShiftHeld] = useState(false);
    const setSelection = useSetAtom(selectionAtom);
    const [components, setComponents] = useAtom(componentsAtom);
    const [selection] = useAtom(selectionAtom);
    const activePreset = useAtomValue(activePresetAtom);
    const [, undo] = useAtom(undoAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);
    const [, setRayConfig] = useAtom(rayConfigAtom);
    const [, setSolver3Trigger] = useAtom(solver3RenderTriggerAtom);
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
        const padding = 0.35; // 35% margin — extra buffer for browser testing visibility
        const zoomX = spanX > 0 ? size.width / (spanX * (1 + padding)) : 2;
        const zoomY = spanY > 0 ? size.height / (spanY * (1 + padding)) : 2;
        const newZoom = Math.min(zoomX, zoomY);

        // Set camera position (keep Z the same)
        camera.position.set(centerX, centerY, camera.position.z);
        controls.target.set(centerX, centerY, 0);
        camera.zoom = Math.max(0.2, Math.min(newZoom, 10)); // clamp to reasonable range
        camera.updateProjectionMatrix();
        controls.update();

        // ─── URL camera override: ?xy1=left,top&xy2=right,bottom ───
        // Fits the camera to show the world-coordinate rectangle defined by
        // the upper-left (xy1) and lower-right (xy2) corners.
        // Example: ?preset=lightsheetopenspim&xy1=330,244&xy2=344,230
        const params = new URLSearchParams(window.location.search);
        const xy1 = params.get('xy1');
        const xy2 = params.get('xy2');
        if (xy1 && xy2) {
            setTimeout(() => {
                const ctrl = controlsRef.current;
                if (!ctrl) return;
                const cam = ctrl.object;
                if (!(cam instanceof OrthographicCamera)) return;

                const [x1, y1] = xy1.split(',').map(Number);
                const [x2, y2] = xy2.split(',').map(Number);
                const cx = (x1 + x2) / 2;
                const cy = (y1 + y2) / 2;
                const spanX = Math.abs(x2 - x1);
                const spanY = Math.abs(y2 - y1);

                cam.position.set(cx, cy, cam.position.z);
                ctrl.target.set(cx, cy, 0);

                // Fit zoom so the bounding box fills the viewport
                const zX = spanX > 0 ? size.width / spanX : cam.zoom;
                const zY = spanY > 0 ? size.height / spanY : cam.zoom;
                cam.zoom = Math.max(0.1, Math.min(zX, zY));

                cam.updateProjectionMatrix();
                ctrl.update();
            }, 200);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePreset]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.altKey) setAltHeld(true);
            if (e.shiftKey) setShiftHeld(true);
            if (e.key === 'Escape') setSelection([]);

            // Ctrl+Z: Undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                undo();
                return;
            }

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

            // '2' key: toggle Solver 2 (Gaussian beam E&M)
            if (e.key === '2') {
                const target = e.target as HTMLElement;
                if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
                e.preventDefault();
                setRayConfig(prev => ({ ...prev, solver2Enabled: !prev.solver2Enabled }));
            }

            // '3' key: fire Solver 3 (Calculate Emission and Image)
            if (e.key === '3') {
                const target = e.target as HTMLElement;
                if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
                e.preventDefault();
                setSolver3Trigger(prev => prev + 1);
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

                pushUndo();  // snapshot before rotation

                const newComponents = components.map(c => {
                    if (selection.includes(c.id)) {
                        const qStep = new Quaternion().setFromAxisAngle(
                            new Vector3(0, 0, 1),
                            direction * rotationStep
                        );
                        // Compose rotation without mutating existing quaternion
                        const newQuat = qStep.multiply(c.rotation.clone());
                        const euler = new Euler().setFromQuaternion(newQuat);
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
    }, [setSelection, selection, components, setComponents, undo, pushUndo]);

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
