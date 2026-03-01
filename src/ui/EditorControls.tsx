import React, { useEffect, useRef, useState, useCallback } from 'react';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { OrbitControls } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import { MOUSE, TOUCH, Vector3, Euler, Quaternion, OrthographicCamera, MathUtils } from 'three';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { activePresetAtom, componentsAtom, selectionAtom, undoAtom, pushUndoAtom, rayConfigAtom, solver3RenderTriggerAtom, viewModeAtom } from '../state/store';

/**
 * 2D/3D Camera Snap Behavior:
 *
 *   When the camera polar angle is within SNAP_THRESHOLD of pure top-down (0°),
 *   it smoothly snaps to an exact 2D top-down view and orbit rotation is disabled.
 *   When the user Alt+drags to rotate past the threshold, the camera transitions
 *   to free 3D orbit. Releasing back to near-top-down re-engages the snap.
 *
 *   In "2D" mode: orbit rotation is locked, camera looks straight down +Z.
 *   In "3D" mode: full orbit controls enabled.
 */

const SNAP_THRESHOLD_DEG = 8;  // Polar angle (from top) below which we snap to 2D
const SNAP_LERP_SPEED = 8;     // How fast to animate toward 2D (per second)

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
    const [viewMode, setViewMode] = useAtom(viewModeAtom);
    const { size } = useThree();

    // Track whether user is actively rotating (Alt+drag)
    const isUserRotating = useRef(false);

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

        const padding = 0.35;
        const zoomX = spanX > 0 ? size.width / (spanX * (1 + padding)) : 2;
        const zoomY = spanY > 0 ? size.height / (spanY * (1 + padding)) : 2;
        const newZoom = Math.min(zoomX, zoomY);

        // Reset to top-down 2D when loading a preset
        camera.position.set(centerX, centerY, 500);
        controls.target.set(centerX, centerY, 0);
        camera.zoom = Math.max(0.2, Math.min(newZoom, 10));
        camera.updateProjectionMatrix();
        controls.update();
        setViewMode('2D');

        // URL camera override
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
                const zX = spanX > 0 ? size.width / spanX : cam.zoom;
                const zY = spanY > 0 ? size.height / spanY : cam.zoom;
                cam.zoom = Math.max(0.1, Math.min(zX, zY));
                cam.updateProjectionMatrix();
                ctrl.update();
            }, 200);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePreset]);

    // ─── 2D/3D snap: per-frame polar angle check ───
    useFrame((_, delta) => {
        const controls = controlsRef.current;
        if (!controls) return;

        const camera = controls.object;
        const target = controls.target;

        // Compute polar angle: angle between camera→target vector and +Z axis
        const camToTarget = new Vector3().subVectors(target, camera.position);
        const polarAngle = camToTarget.angleTo(new Vector3(0, 0, -1)); // 0 = looking straight down

        const polarDeg = MathUtils.radToDeg(polarAngle);

        if (!isUserRotating.current && polarDeg < SNAP_THRESHOLD_DEG) {
            // Near top-down: LERP toward exact top-down
            if (viewMode !== '2D') setViewMode('2D');

            // Smoothly snap camera position to be directly above target
            const dx = camera.position.x - target.x;
            const dy = camera.position.y - target.y;
            const dist = camera.position.distanceTo(target);

            // LERP the XY offset toward 0 (pure top-down)
            const t = 1 - Math.exp(-SNAP_LERP_SPEED * delta);
            camera.position.x -= dx * t;
            camera.position.y -= dy * t;
            // Keep Z distance
            camera.position.z = target.z + dist;

            camera.updateProjectionMatrix();
            controls.update();
        } else if (polarDeg >= SNAP_THRESHOLD_DEG) {
            if (viewMode !== '3D') setViewMode('3D');
        }
    });

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

            // Zoom shortcuts
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

            // '2' key: toggle Solver 2
            if (e.key === '2') {
                const target = e.target as HTMLElement;
                if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
                e.preventDefault();
                setRayConfig(prev => ({ ...prev, solver2Enabled: !prev.solver2Enabled }));
            }

            // '3' key: fire Solver 3
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
                        const right = new Vector3();
                        const up = new Vector3();
                        camera.matrixWorld.extractBasis(right, up, new Vector3());

                        const panSpeed = 10;
                        const offset = right.multiplyScalar(dir[0] * panSpeed)
                            .add(up.multiplyScalar(dir[1] * panSpeed));

                        camera.position.add(offset);
                        controls.target.add(offset);
                        controls.update();
                    }
                }
            }

            // Q/E rotation
            if ((e.key === 'q' || e.key === 'Q' || e.key === 'e' || e.key === 'E') && selection.length > 0) {
                const target = e.target as HTMLElement;
                if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

                const rotationStep = 15 * (Math.PI / 180);
                const direction = (e.key === 'q' || e.key === 'Q') ? 1 : -1;

                pushUndo();

                const newComponents = components.map(c => {
                    if (selection.includes(c.id)) {
                        const qStep = new Quaternion().setFromAxisAngle(
                            new Vector3(0, 0, 1),
                            direction * rotationStep
                        );
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

    // Track rotation start/end to distinguish user-initiated rotation from auto-snap
    const onStart = useCallback(() => {
        if (altHeld) {
            isUserRotating.current = true;
        }
    }, [altHeld]);

    const onEnd = useCallback(() => {
        isUserRotating.current = false;
    }, []);

    return (
        <OrbitControls
            ref={controlsRef}
            makeDefault
            enableRotate={true}
            enableZoom={true}
            enablePan={true}

            // Mouse Mappings:
            //   Alt + Left-drag     = Rotate camera (breaks out of 2D snap)
            //   Shift + Left-drag   = Pan
            //   Middle-drag         = Pan
            //   Scroll              = Zoom
            mouseButtons={{
                LEFT: altHeld ? MOUSE.ROTATE : (shiftHeld ? MOUSE.PAN : -1 as any),
                MIDDLE: altHeld ? MOUSE.ROTATE : MOUSE.PAN,
                RIGHT: -1 as any
            }}

            touches={{
                ONE: TOUCH.PAN,
                TWO: TOUCH.DOLLY_ROTATE
            }}

            minDistance={1}
            maxDistance={2000}
            enableDamping={true}
            dampingFactor={0.1}

            onStart={onStart}
            onEnd={onEnd}
        />
    );
};
