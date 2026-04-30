import React, { useEffect, useRef, useState, useCallback } from 'react';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { OrbitControls } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import { MOUSE, TOUCH, Vector3, Euler, Quaternion, OrthographicCamera, PerspectiveCamera } from 'three';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { activePresetAtom, componentsAtom, selectionAtom, undoAtom, pushUndoAtom, rayConfigAtom, setBundleDataEnabledAtom, solver3RenderTriggerAtom, resetViewSignalAtom, zoomToComponentAtom, zoomToMeasurementAtom, isOrthoAtom, cameraBlendAtom, mobileCameraModeAtom, isDraggingAtom, uiLockedAtom } from '../state/store';
import { TrappedBead } from '../physics/components/TrappedBead';
import { setGizmoOrientCallback } from './AxesWidget';

const PERSP_FOV = 50;
const WASD_ACCEL = 0.4;
const WASD_MAX_SPEED = 4;
const WASD_DAMPING = 0.72;

// OrbitControls polar angle limits (with camera.up=[0,0,1], phi=0 is top-down along +Z)
const MIN_POLAR = 0.01;                    // ~0.57° from top-down, avoids gimbal lock
const MAX_POLAR = Math.PI / 2 - 0.01;     // ~89.4° — can't go under the table

// Tilt threshold for ortho↔perspective camera swap.
// 3° safeguard zone keeps ortho solid while looking straight down.
const TRANSITION_POLAR = 0.052;            // ~3°

// Visual blend zone for materials/outlines (no projection matrix hacking).
// Starts at the camera swap point, reaches full perspective look ~10° later.
const BLEND_START = TRANSITION_POLAR;      // blend=0 when camera swaps
const BLEND_END = TRANSITION_POLAR + 0.1745; // blend=1 at ~13°

export const EditorControls: React.FC = () => {
    const controlsRef = useRef<OrbitControlsImpl>(null);
    const { size, set } = useThree();

    // Modifier keys — both drive OrbitControls mouseButtons prop (need re-render)
    const [ctrlHeld, setCtrlHeld] = useState(false);
    const [shiftHeld, setShiftHeld] = useState(false);

    // Track left mouse button held (for scroll-to-rotate-part)
    const leftMouseHeld = useRef(false);

    const setSelection = useSetAtom(selectionAtom);
    const [components, setComponents] = useAtom(componentsAtom);
    const [selection] = useAtom(selectionAtom);
    const activePreset = useAtomValue(activePresetAtom);
    const uiLocked = useAtomValue(uiLockedAtom);
    const [, undo] = useAtom(undoAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);
    const [rayConfig] = useAtom(rayConfigAtom);
    const [, setBundleDataEnabled] = useAtom(setBundleDataEnabledAtom);
    const [, setSolver3Trigger] = useAtom(solver3RenderTriggerAtom);
    const setIsOrtho = useSetAtom(isOrthoAtom);
    const setCameraBlend = useSetAtom(cameraBlendAtom);
    const lastBlendRef = useRef(0);
    const resetViewSignal = useAtomValue(resetViewSignalAtom);
    const [zoomToComponent, setZoomToComponent] = useAtom(zoomToComponentAtom);
    const [zoomToMeasurement, setZoomToMeasurement] = useAtom(zoomToMeasurementAtom);
    const mobileCameraMode = useAtomValue(mobileCameraModeAtom);
    const isDragging = useAtomValue(isDraggingAtom);

    // ─── Dual camera refs ───
    const isOrtho = useRef(true);
    const orthoCamRef = useRef<OrthographicCamera | null>(null);
    const perspCamRef = useRef<PerspectiveCamera | null>(null);

    // ─── Continuous WASD+RF with smooth velocity ───
    const pressedKeys = useRef(new Set<string>());
    const wasdVelocity = useRef({ x: 0, y: 0, z: 0 });

    // Initialize cameras once — BOTH use up=[0,0,1] so OrbitControls' polar angle
    // maps directly to tilt from +Z (top-down).
    if (!orthoCamRef.current) {
        const hw = size.width / 2;
        const hh = size.height / 2;
        const ortho = new OrthographicCamera(-hw, hw, hh, -hh, 0.1, 10000);
        ortho.position.set(0, -0.001, 600);
        ortho.up.set(0, 0, 1);
        ortho.zoom = 2;
        ortho.updateProjectionMatrix();
        orthoCamRef.current = ortho;
    }
    if (!perspCamRef.current) {
        const persp = new PerspectiveCamera(PERSP_FOV, size.width / size.height, 0.1, 10000);
        persp.position.set(0, -0.001, 600);
        persp.up.set(0, 0, 1);
        persp.updateProjectionMatrix();
        perspCamRef.current = persp;
    }

    // Set ortho camera on mount
    const mountedRef = useRef(false);
    useEffect(() => {
        if (!mountedRef.current && orthoCamRef.current) {
            set({ camera: orthoCamRef.current });
            mountedRef.current = true;
        }
    }, [set]);

    // ─── Resize: keep both cameras in sync ───
    useEffect(() => {
        const ortho = orthoCamRef.current;
        const persp = perspCamRef.current;
        if (ortho) {
            ortho.left = -size.width / 2;
            ortho.right = size.width / 2;
            ortho.top = size.height / 2;
            ortho.bottom = -size.height / 2;
            ortho.updateProjectionMatrix();
        }
        if (persp) {
            persp.aspect = size.width / size.height;
            persp.updateProjectionMatrix();
        }
    }, [size]);

    // ─── Camera switching ───
    const switchToPerspective = useCallback(() => {
        const controls = controlsRef.current;
        const ortho = orthoCamRef.current;
        const persp = perspCamRef.current;
        if (!controls || !ortho || !persp || !isOrtho.current) return;

        // Match visible area: ortho viewHeight → perspective distance
        const viewHeight = size.height / ortho.zoom;
        const distance = (viewHeight / 2) / Math.tan((PERSP_FOV * Math.PI / 180) / 2);

        // Copy position/orientation from current camera state
        const viewDir = new Vector3().subVectors(ortho.position, controls.target).normalize();
        persp.position.copy(controls.target).addScaledVector(viewDir, distance);
        persp.up.set(0, 0, 1);
        persp.lookAt(controls.target);
        persp.updateProjectionMatrix();

        set({ camera: persp });
        controls.object = persp;
        controls.update();
        isOrtho.current = false;
        setIsOrtho(false);
    }, [size, set, setIsOrtho]);

    const switchToOrtho = useCallback(() => {
        const controls = controlsRef.current;
        const ortho = orthoCamRef.current;
        const persp = perspCamRef.current;
        if (!controls || !ortho || !persp || isOrtho.current) return;

        // Compute ortho zoom from perspective distance
        const distance = persp.position.distanceTo(controls.target);
        const viewHeight = 2 * distance * Math.tan((PERSP_FOV * Math.PI / 180) / 2);
        const zoom = size.height / viewHeight;

        // Snap to near-exact top-down (tiny Y offset avoids gimbal lock)
        ortho.position.set(controls.target.x, controls.target.y - 0.001, controls.target.z + distance);
        ortho.up.set(0, 0, 1);
        ortho.zoom = Math.max(0.1, zoom);
        ortho.updateProjectionMatrix();

        set({ camera: ortho });
        controls.object = ortho;
        controls.update();
        isOrtho.current = true;
        setIsOrtho(true);
    }, [size, set, setIsOrtho]);

    // ─── Bottom-right compass: axis click -> real scene camera orientation ───
    useEffect(() => {
        const alignToGizmoDirection = (rawDirection: Vector3) => {
            const controls = controlsRef.current;
            const ortho = orthoCamRef.current;
            const persp = perspCamRef.current;
            if (!controls || !ortho || !persp) return;

            const target = controls.target.clone();
            const currentCamera = controls.object;
            const currentDistance = currentCamera.position.distanceTo(target);
            const fallbackDistance = 600;
            const distance = Number.isFinite(currentDistance) && currentDistance > 1
                ? currentDistance
                : fallbackDistance;

            const direction = rawDirection.clone();
            if (direction.lengthSq() < 1e-8) return;
            direction.normalize();

            // OrbitControls is intentionally constrained to stay above the
            // table. Keep side views just inside that allowed half-space so
            // controls.update() does not immediately clamp them somewhere else.
            const minElevation = Math.sin(MIN_POLAR);
            if (Math.hypot(direction.x, direction.y) < 1e-6) {
                direction.set(0, -minElevation, Math.cos(MIN_POLAR));
            } else {
                direction.z = Math.max(direction.z, minElevation);
                direction.normalize();
            }

            const topDown = direction.z > Math.cos(TRANSITION_POLAR);
            if (topDown) {
                if (!isOrtho.current) switchToOrtho();
                const cam = orthoCamRef.current!;
                cam.position.copy(target).addScaledVector(direction, distance);
                cam.up.set(0, 0, 1);
                cam.lookAt(target);
                cam.updateProjectionMatrix();
                controls.object = cam;
                controls.update();
                isOrtho.current = true;
                setIsOrtho(true);
                setCameraBlend(0);
            } else {
                if (isOrtho.current) switchToPerspective();
                const cam = perspCamRef.current!;
                cam.position.copy(target).addScaledVector(direction, distance);
                cam.up.set(0, 0, 1);
                cam.lookAt(target);
                cam.updateProjectionMatrix();
                controls.object = cam;
                controls.update();
                isOrtho.current = false;
                setIsOrtho(false);
                setCameraBlend(1);
            }
        };

        setGizmoOrientCallback(alignToGizmoDirection);
        return () => setGizmoOrientCallback(null);
    }, [switchToOrtho, switchToPerspective, setCameraBlend, setIsOrtho]);

    // ─── Per-frame: detect tilt for ortho↔perspective switching + WASD ───
    useFrame(() => {
        const controls = controlsRef.current;
        if (!controls) return;

        // OrbitControls exposes getPolarAngle() which gives the current phi.
        // With camera.up=[0,0,1]: phi=0 = top-down, phi=PI/2 = horizontal.
        const polar = controls.getPolarAngle();

        if (isOrtho.current && polar > TRANSITION_POLAR) {
            switchToPerspective();
        } else if (!isOrtho.current && polar < TRANSITION_POLAR) {
            switchToOrtho();
        }

        // Visual blend factor: 0 at top-down, 1 when tilted past blend zone
        const rawBlend = Math.min(1, Math.max(0, (polar - BLEND_START) / (BLEND_END - BLEND_START)));
        // Only write atom when value changes meaningfully (avoid re-renders every frame)
        if (Math.abs(rawBlend - lastBlendRef.current) > 0.01) {
            lastBlendRef.current = rawBlend;
            setCameraBlend(rawBlend);
        }

        // Smooth WASD+RF — FPS-style: W/S = forward/back (look direction),
        // A/D = strafe, R/F = up/down (world Z).
        // In top-down ortho, W/S acts as zoom in/out since "forward" is toward the table.
        const keys = pressedKeys.current;
        const vel = wasdVelocity.current;
        let inputFwd = 0, inputStrafe = 0, inputVert = 0;
        if (keys.has('w') || keys.has('W') || keys.has('ArrowUp')) inputFwd = 1;
        if (keys.has('s') || keys.has('S') || keys.has('ArrowDown')) inputFwd = -1;
        if (keys.has('a') || keys.has('A') || keys.has('ArrowLeft')) inputStrafe = -1;
        if (keys.has('d') || keys.has('D') || keys.has('ArrowRight')) inputStrafe = 1;
        if (keys.has('r') || keys.has('R')) inputVert = 1;
        if (keys.has('f') || keys.has('F')) inputVert = -1;

        // Accelerate toward input direction, dampen when no input
        if (inputFwd !== 0 || inputStrafe !== 0 || inputVert !== 0) {
            vel.x = Math.max(-WASD_MAX_SPEED, Math.min(WASD_MAX_SPEED, vel.x + inputStrafe * WASD_ACCEL));
            vel.y = Math.max(-WASD_MAX_SPEED, Math.min(WASD_MAX_SPEED, vel.y + inputFwd * WASD_ACCEL));
            vel.z = Math.max(-WASD_MAX_SPEED, Math.min(WASD_MAX_SPEED, vel.z + inputVert * WASD_ACCEL));
        } else {
            vel.x *= WASD_DAMPING;
            vel.y *= WASD_DAMPING;
            vel.z *= WASD_DAMPING;
        }

        if (Math.abs(vel.x) > 0.01 || Math.abs(vel.y) > 0.01 || Math.abs(vel.z) > 0.01) {
            const camera = controls.object;

            // Forward = camera look direction (camera → target)
            const forward = new Vector3().subVectors(controls.target, camera.position).normalize();
            // Right = forward × camera.up (strafe direction)
            const right = new Vector3().crossVectors(forward, camera.up).normalize();

            // W/S: move along forward (in perspective: walk toward target; in ortho: zoom)
            if (isOrtho.current && Math.abs(vel.y) > 0.01) {
                // In ortho, "forward" = zoom (no position change makes sense)
                const ortho = orthoCamRef.current;
                if (ortho) {
                    ortho.zoom *= (1 + vel.y * 0.02);
                    ortho.zoom = Math.max(0.1, Math.min(ortho.zoom, 50));
                    ortho.updateProjectionMatrix();
                }
            } else {
                // Perspective: actually move camera + target along forward
                const fwdMove = forward.clone().multiplyScalar(vel.y);
                camera.position.add(fwdMove);
                controls.target.add(fwdMove);
            }

            // A/D: strafe along right vector
            if (Math.abs(vel.x) > 0.01) {
                const strafeMove = right.multiplyScalar(vel.x);
                camera.position.add(strafeMove);
                controls.target.add(strafeMove);
            }

            // R/F: vertical (world Z)
            if (Math.abs(vel.z) > 0.01) {
                const vertMove = new Vector3(0, 0, vel.z);
                camera.position.add(vertMove);
                controls.target.add(vertMove);
            }

            controls.update();
        }
    });

    // ─── Left-click + scroll = rotate selected part around Z by 5 degrees per tick ───
    useEffect(() => {
        const onMouseDown = (e: MouseEvent) => {
            if (e.button === 0) leftMouseHeld.current = true;
        };
        const onMouseUp = (e: MouseEvent) => {
            if (e.button === 0) leftMouseHeld.current = false;
        };
        const onWheel = (e: WheelEvent) => {
            if (uiLocked) return;
            if (!leftMouseHeld.current || selection.length === 0 || isDragging || e.shiftKey) return;
            e.preventDefault();
            e.stopPropagation();

            const rotStep = 5 * (Math.PI / 180); // 5 degrees per scroll tick
            const direction = e.deltaY > 0 ? -1 : 1;
            pushUndo();

            const newComponents = components.map(c => {
                if (selection.includes(c.id)) {
                    const qStep = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), direction * rotStep);
                    const newQuat = qStep.multiply(c.rotation.clone());
                    const euler = new Euler().setFromQuaternion(newQuat);
                    c.setRotation(euler.x, euler.y, euler.z);
                    return c;
                }
                return c;
            });
            setComponents(newComponents);
        };

        window.addEventListener('mousedown', onMouseDown, true);
        window.addEventListener('mouseup', onMouseUp, true);
        window.addEventListener('wheel', onWheel, { capture: true, passive: false });

        return () => {
            window.removeEventListener('mousedown', onMouseDown, true);
            window.removeEventListener('mouseup', onMouseUp, true);
            window.removeEventListener('wheel', onWheel, true);
        };
    }, [selection, components, setComponents, pushUndo, isDragging, uiLocked]);

    // ─── Keyboard shortcuts ───
    useEffect(() => {
        const isInputFocused = () => {
            const el = document.activeElement;
            if (!el) return false;
            const tag = (el as HTMLElement).tagName;
            return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
        };
        const wasdKeys = ['w', 'W', 's', 'S', 'a', 'A', 'd', 'D', 'r', 'R', 'f', 'F', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        const navigationKeys = [...wasdKeys, '[', ']'];

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) setCtrlHeld(true);
            if (e.shiftKey) setShiftHeld(true);
            if (e.key === 'Escape') setSelection([]);
            if (uiLocked && !navigationKeys.includes(e.key)) return;

            // Ctrl+Z: Undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                if (isInputFocused()) return;
                e.preventDefault();
                undo();
                return;
            }

            // Delete / Backspace: remove selected components
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (isInputFocused()) return;
                if (selection.length === 0) return;
                e.preventDefault();
                pushUndo();
                const idsToRemove = new Set(selection);
                for (const component of components) {
                    if (component instanceof TrappedBead && component.parentSampleId && idsToRemove.has(component.parentSampleId)) {
                        idsToRemove.add(component.id);
                    }
                }
                setComponents(components.filter(c => !idsToRemove.has(c.id)));
                setSelection([]);
                return;
            }

            // Zoom: [ / ] — ortho: adjust zoom; perspective: dolly
            if (e.key === '[' || e.key === ']') {
                if (isInputFocused()) return;
                const controls = controlsRef.current;
                if (controls) {
                    const camera = controls.object;
                    if (camera instanceof OrthographicCamera) {
                        const factor = e.key === ']' ? 1.5 : (1 / 1.5);
                        camera.zoom *= factor;
                        camera.updateProjectionMatrix();
                    } else {
                        const factor = e.key === ']' ? 0.9 : 1.1;
                        const dir = new Vector3().subVectors(camera.position, controls.target);
                        dir.multiplyScalar(factor);
                        camera.position.copy(controls.target).add(dir);
                    }
                    controls.update();
                }
            }

            // '2' key: toggle forward bundle data
            if (e.key === '2') {
                if (isInputFocused()) return;
                e.preventDefault();
                setBundleDataEnabled(!rayConfig.solver2Enabled);
            }

            // '3' key: fire Solver 3 (Calculate Emission and Image)
            if (e.key === '3') {
                if (isInputFocused()) return;
                e.preventDefault();
                setSolver3Trigger(prev => prev + 1);
            }

            // WASD / RF / Arrows: add to pressed set for continuous movement
            if (wasdKeys.includes(e.key)) {
                if (isInputFocused()) return;
                if (selection.length > 0) return;
                e.preventDefault();
                pressedKeys.current.add(e.key);
            }

            // Q/E rotation: rotate selected component +/-15 degrees around world Z axis
            if ((e.key === 'q' || e.key === 'Q' || e.key === 'e' || e.key === 'E') && selection.length > 0) {
                if (isInputFocused()) return;

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
            if (!e.ctrlKey && !e.metaKey) setCtrlHeld(false);
            if (!e.shiftKey) setShiftHeld(false);
            pressedKeys.current.delete(e.key);
            pressedKeys.current.delete(e.key.toLowerCase());
            pressedKeys.current.delete(e.key.toUpperCase());
        };

        const handleBlur = () => {
            pressedKeys.current.clear();
            setCtrlHeld(false);
            setShiftHeld(false);
            leftMouseHeld.current = false;
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleBlur);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
        };
    }, [setSelection, selection, components, setComponents, undo, pushUndo, rayConfig, setBundleDataEnabled, setSolver3Trigger, uiLocked]);

    // ─── Auto-zoom to fit when preset changes or resetViewSignal fires ───
    useEffect(() => {
        // Skip if the canvas hasn't been measured yet — happens on mobile when
        // the orientation/sidebar layout settles after the React effect fires.
        // The size dep below re-runs us once the dimensions arrive.
        if (size.width <= 0 || size.height <= 0) return;

        const controls = controlsRef.current;
        if (!controls || components.length === 0) return;

        if (!isOrtho.current) switchToOrtho();

        const ortho = orthoCamRef.current;
        if (!ortho) return;

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

        ortho.position.set(centerX, centerY - 0.001, ortho.position.z);
        controls.target.set(centerX, centerY, 0);
        ortho.zoom = Math.max(0.2, Math.min(newZoom, 10));
        ortho.updateProjectionMatrix();
        controls.update();

        // ─── URL camera override: ?xy1=left,top&xy2=right,bottom ───
        const params = new URLSearchParams(window.location.search);
        const xy1 = params.get('xy1');
        const xy2 = params.get('xy2');
        if (xy1 && xy2) {
            setTimeout(() => {
                const ctrl = controlsRef.current;
                const cam = orthoCamRef.current;
                if (!ctrl || !cam) return;

                const [x1, y1] = xy1.split(',').map(Number);
                const [x2, y2] = xy2.split(',').map(Number);
                const cx = (x1 + x2) / 2;
                const cy = (y1 + y2) / 2;
                const sx = Math.abs(x2 - x1);
                const sy = Math.abs(y2 - y1);

                cam.position.set(cx, cy - 0.001, cam.position.z);
                ctrl.target.set(cx, cy, 0);
                const zX = sx > 0 ? size.width / sx : cam.zoom;
                const zY = sy > 0 ? size.height / sy : cam.zoom;
                cam.zoom = Math.max(0.1, Math.min(zX, zY));
                cam.updateProjectionMatrix();
                ctrl.update();
            }, 200);
        }
        // size.width/height are in deps so the fit re-runs once the canvas is
        // actually measured — on mobile the first tick can fire with size=0.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePreset, resetViewSignal, size.width, size.height]);

    // ─── Zoom-to-component: center view on a single component ───
    useEffect(() => {
        if (!zoomToComponent) return;
        const controls = controlsRef.current;
        const ortho = orthoCamRef.current;
        if (!controls || !ortho) return;

        const comp = components.find(c => c.id === zoomToComponent);
        setZoomToComponent(null); // clear signal
        if (!comp) return;

        if (!isOrtho.current) switchToOrtho();

        const cx = comp.position.x;
        const cy = comp.position.y;
        ortho.position.set(cx, cy - 0.001, ortho.position.z);
        controls.target.set(cx, cy, 0);
        ortho.zoom = 5;
        ortho.updateProjectionMatrix();
        controls.update();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [zoomToComponent]);

    // ─── Zoom-to-measurement: center view on one measurement's points ───
    useEffect(() => {
        if (!zoomToMeasurement) return;
        const controls = controlsRef.current;
        const ortho = orthoCamRef.current;
        setZoomToMeasurement(null); // clear signal
        if (!controls || !ortho || zoomToMeasurement.points.length === 0) return;

        if (!isOrtho.current) switchToOrtho();

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        for (const point of zoomToMeasurement.points) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const spanX = Math.max(maxX - minX, 20);
        const spanY = Math.max(maxY - minY, 20);
        const padding = 0.8;
        const zoomX = size.width / (spanX * (1 + padding));
        const zoomY = size.height / (spanY * (1 + padding));

        ortho.position.set(centerX, centerY - 0.001, ortho.position.z);
        controls.target.set(centerX, centerY, 0);
        ortho.zoom = Math.max(0.2, Math.min(Math.min(zoomX, zoomY), 12));
        ortho.updateProjectionMatrix();
        controls.update();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [zoomToMeasurement]);

    return (
        <OrbitControls
            ref={controlsRef}
            camera={orthoCamRef.current!}
            makeDefault
            enableRotate={true}
            enableZoom={true}
            enablePan={true}

            // Mouse mappings:
            //   Bare left-click     = reserved for object interaction (-1)
            //   Ctrl + left-drag    = Rotate     |  Ctrl + middle-drag  = Rotate
            //   Shift + left-drag   = Pan        |  Shift + middle-drag = Pan
            //   Middle-drag (bare)  = Pan
            //   Right-click         = reserved for context menu (-1)
            //   Scroll              = Zoom
            //   Left-hold + scroll  = Rotate selected part (handled separately)
            mouseButtons={{
                LEFT: ctrlHeld ? MOUSE.ROTATE : (shiftHeld ? MOUSE.PAN : -1 as any),
                MIDDLE: ctrlHeld ? MOUSE.ROTATE : MOUSE.PAN,
                RIGHT: -1 as any
            }}

            touches={{
                ONE: mobileCameraMode === 'rotate' ? TOUCH.ROTATE : TOUCH.PAN,
                TWO: TOUCH.DOLLY_PAN
            }}

            // Polar angle clamping — this is the whole trick.
            // With camera.up=[0,0,1], OrbitControls maps phi=0 to +Z (top-down).
            // Clamping prevents gimbal lock at top and going under table at bottom.
            minPolarAngle={MIN_POLAR}
            maxPolarAngle={MAX_POLAR}

            minDistance={10}
            maxDistance={10000}
            enableDamping={true}
            dampingFactor={0.25}
        />
    );
};
