import React, { useEffect, useRef, useState, useCallback } from 'react';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { OrbitControls } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import { MOUSE, TOUCH, Vector3, Euler, Quaternion, OrthographicCamera, PerspectiveCamera } from 'three';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { activePresetAtom, componentsAtom, selectionAtom, undoAtom, pushUndoAtom, resetViewSignalAtom, zoomToComponentAtom, zoomToMeasurementAtom, isOrthoAtom, cameraBlendAtom, mobileCameraModeAtom, isDraggingAtom, uiLockedAtom, pinnedViewersAtom, mobilePanelModeAtom } from '../state/store';
import type { OpticalComponent } from '../physics/Component';
import { Camera } from '../physics/components/Camera';
import { Card } from '../physics/components/Card';
import { PMT } from '../physics/components/PMT';
import { Sample } from '../physics/components/Sample';
import { SampleChamber } from '../physics/components/SampleChamber';
import { TrappedBead } from '../physics/components/TrappedBead';
import { setGizmoOrientCallback } from './AxesWidget';
import { useIsLandscape, useIsMobile } from './useIsMobile';

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
const DISABLED_MOUSE_BUTTON = -1 as MOUSE;
const TOP_DOWN_AZIMUTH_EPSILON = 0.001;
const DEFAULT_FIT_PADDING = 0.35;
const MOBILE_PORTRAIT_MAIN_AXIS_PADDING = 0.08;
const MOBILE_PORTRAIT_CROSS_AXIS_PADDING = 0.04;
const MOBILE_PORTRAIT_SCREEN_END_MARGIN_PX = 12;
const MOBILE_PORTRAIT_SCREEN_END_OVERSCAN_RATIO = 0.08;
const MOBILE_PINNED_VIEWER_GAP_PX = 12;
const MOBILE_RASTER_VIEWER_WIDTH_RATIO = 0.30;
const MOBILE_RASTER_VIEWER_HEIGHT_RATIO = 0.28;
const MOBILE_WIDE_VIEWER_WIDTH_RATIO = 0.52;
const MOBILE_WIDE_VIEWER_HEIGHT_RATIO = 0.38;

export interface ViewportReservation {
    left: number;
    bottom: number;
}

interface ViewBounds {
    minU: number;
    maxU: number;
    minV: number;
    maxV: number;
}

interface ScreenRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

function numberField(component: OpticalComponent, field: string): number | null {
    const value = (component as unknown as Record<string, unknown>)[field];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function fitRadius(component: OpticalComponent): number {
    const diameter = numberField(component, 'diameter');
    const width = numberField(component, 'width');
    const height = numberField(component, 'height');
    const largest = Math.max(diameter ?? 0, width ?? 0, height ?? 0);
    return Math.max(12, Math.min(80, largest > 0 ? largest / 2 + 10 : 25));
}

function topDownAzimuthOffset(rotateForPortrait: boolean): { x: number; y: number } {
    return rotateForPortrait
        ? { x: TOP_DOWN_AZIMUTH_EPSILON, y: 0 }
        : { x: 0, y: -TOP_DOWN_AZIMUTH_EPSILON };
}

function setTopDownCameraPosition(
    camera: OrthographicCamera,
    targetX: number,
    targetY: number,
    z: number,
    rotateForPortrait: boolean,
): void {
    const offset = topDownAzimuthOffset(rotateForPortrait);
    camera.position.set(targetX + offset.x, targetY + offset.y, z);
}

function fitZoom(
    width: number,
    height: number,
    spanX: number,
    spanY: number,
    padding: number,
    rotateForPortrait: boolean,
): number {
    const widthSpan = rotateForPortrait ? spanY : spanX;
    const heightSpan = rotateForPortrait ? spanX : spanY;
    const zoomX = widthSpan > 0 ? width / (widthSpan * (1 + padding)) : 2;
    const zoomY = heightSpan > 0 ? height / (heightSpan * (1 + padding)) : 2;
    return Math.min(zoomX, zoomY);
}

function viewBoundsForScene(
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
    rotateForPortrait: boolean,
): ViewBounds {
    return rotateForPortrait
        ? { minU: bounds.minY, maxU: bounds.maxY, minV: bounds.minX, maxV: bounds.maxX }
        : { minU: bounds.minX, maxU: bounds.maxX, minV: -bounds.maxY, maxV: -bounds.minY };
}

function sceneCenterFromViewCenter(
    centerU: number,
    centerV: number,
    rotateForPortrait: boolean,
): { centerX: number; centerY: number } {
    return rotateForPortrait
        ? { centerX: centerV, centerY: centerU }
        : { centerX: centerU, centerY: -centerV };
}

function fitViewBoundsInRect(
    width: number,
    height: number,
    bounds: ViewBounds,
    rect: ScreenRect,
    paddingU: number,
    paddingV: number,
    alignMaxVToBottom: boolean,
): { centerU: number; centerV: number; zoom: number } {
    const spanU = Math.max(bounds.maxU - bounds.minU, 20);
    const spanV = Math.max(bounds.maxV - bounds.minV, 20);
    const rectWidth = Math.max(1, rect.right - rect.left);
    const rectHeight = Math.max(1, rect.bottom - rect.top);
    const zoom = Math.min(
        rectWidth / (spanU * (1 + paddingU)),
        rectHeight / (spanV * (1 + paddingV)),
    );

    const rectCenterU = (rect.left + rect.right) / 2;
    const rectCenterV = (rect.top + rect.bottom) / 2;
    const sceneCenterU = (bounds.minU + bounds.maxU) / 2;
    const centerU = sceneCenterU - (rectCenterU - width / 2) / zoom;

    if (alignMaxVToBottom) {
        const visibleSpanV = rectHeight / zoom;
        const leadingEdgeV = bounds.maxV + spanV * MOBILE_PORTRAIT_SCREEN_END_OVERSCAN_RATIO;
        const bottomMargin = Math.min(
            Math.max(0, visibleSpanV - spanV),
            MOBILE_PORTRAIT_SCREEN_END_MARGIN_PX / zoom,
        );
        return {
            centerU,
            centerV: leadingEdgeV - (rect.bottom - height / 2 - bottomMargin) / zoom,
            zoom,
        };
    }

    const sceneCenterV = (bounds.minV + bounds.maxV) / 2;
    return {
        centerU,
        centerV: sceneCenterV - (rectCenterV - height / 2) / zoom,
        zoom,
    };
}

export function fitSceneToViewport(
    width: number,
    height: number,
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
    rotateForPortrait: boolean,
    reservation?: ViewportReservation,
): { centerX: number; centerY: number; zoom: number } {
    const viewBounds = viewBoundsForScene(bounds, rotateForPortrait);
    const paddingU = rotateForPortrait ? MOBILE_PORTRAIT_CROSS_AXIS_PADDING : DEFAULT_FIT_PADDING;
    const paddingV = rotateForPortrait ? MOBILE_PORTRAIT_MAIN_AXIS_PADDING : DEFAULT_FIT_PADDING;

    if (reservation && reservation.left > 0 && reservation.bottom > 0) {
        const reservedRight = Math.min(width - 1, reservation.left + MOBILE_PINNED_VIEWER_GAP_PX);
        const reservedTop = Math.max(1, height - reservation.bottom - MOBILE_PINNED_VIEWER_GAP_PX);
        const abovePanel = fitViewBoundsInRect(
            width,
            height,
            viewBounds,
            { left: 0, top: 0, right: width, bottom: reservedTop },
            paddingU,
            paddingV,
            rotateForPortrait,
        );
        const rightOfPanel = fitViewBoundsInRect(
            width,
            height,
            viewBounds,
            { left: reservedRight, top: 0, right: width, bottom: height },
            paddingU,
            paddingV,
            rotateForPortrait,
        );
        const chosen = rightOfPanel.zoom > abovePanel.zoom ? rightOfPanel : abovePanel;
        return {
            ...sceneCenterFromViewCenter(chosen.centerU, chosen.centerV, rotateForPortrait),
            zoom: chosen.zoom,
        };
    }

    const fullFrame = fitViewBoundsInRect(
        width,
        height,
        viewBounds,
        { left: 0, top: 0, right: width, bottom: height },
        paddingU,
        paddingV,
        rotateForPortrait,
    );
    return {
        ...sceneCenterFromViewCenter(fullFrame.centerU, fullFrame.centerV, rotateForPortrait),
        zoom: fullFrame.zoom,
    };
}

function isMobilePinnedViewer(component: OpticalComponent): boolean {
    return component instanceof Camera
        || component instanceof PMT
        || component instanceof Card
        || component instanceof Sample
        || component instanceof SampleChamber;
}

function mobilePinnedViewerReservation(
    width: number,
    height: number,
    components: OpticalComponent[],
    pinnedIds: Set<string>,
): ViewportReservation | undefined {
    const pinnedComponents = components.filter(c => pinnedIds.has(c.id) && isMobilePinnedViewer(c));
    if (pinnedComponents.length === 0) return undefined;

    const hasWideViewer = pinnedComponents.some(c => c instanceof Card || c instanceof Sample || c instanceof SampleChamber);
    const left = hasWideViewer || pinnedComponents.length > 1
        ? Math.min(width * MOBILE_WIDE_VIEWER_WIDTH_RATIO, 280)
        : Math.min(width * MOBILE_RASTER_VIEWER_WIDTH_RATIO, height * 0.22);
    const bottom = hasWideViewer
        ? Math.min(height * MOBILE_WIDE_VIEWER_HEIGHT_RATIO, 300)
        : Math.min(height * MOBILE_RASTER_VIEWER_HEIGHT_RATIO, left + 36);

    return { left, bottom };
}

export const EditorControls: React.FC = () => {
    const controlsRef = useRef<OrbitControlsImpl>(null);
    const { size, set } = useThree();

    // Modifier keys — both drive OrbitControls mouseButtons prop (need re-render)
    const [ctrlHeld, setCtrlHeld] = useState(false);
    const [shiftHeld, setShiftHeld] = useState(false);

    // Track left mouse button held (for scroll-to-rotate-part)
    const leftMouseHeld = useRef(false);
    // Wheel ticks closer together than this are one rotate gesture (one undo).
    const ROTATE_GESTURE_GAP_MS = 600;
    const lastRotateWheelTimeRef = useRef(0);

    const setSelection = useSetAtom(selectionAtom);
    const [components, setComponents] = useAtom(componentsAtom);
    const [selection] = useAtom(selectionAtom);
    const activePreset = useAtomValue(activePresetAtom);
    const uiLocked = useAtomValue(uiLockedAtom);
    const [, undo] = useAtom(undoAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);
    const setIsOrtho = useSetAtom(isOrthoAtom);
    const setCameraBlend = useSetAtom(cameraBlendAtom);
    const lastBlendRef = useRef(0);
    const resetViewSignal = useAtomValue(resetViewSignalAtom);
    const [zoomToComponent, setZoomToComponent] = useAtom(zoomToComponentAtom);
    const [zoomToMeasurement, setZoomToMeasurement] = useAtom(zoomToMeasurementAtom);
    const mobileCameraMode = useAtomValue(mobileCameraModeAtom);
    const isDragging = useAtomValue(isDraggingAtom);
    const pinnedViewerIds = useAtomValue(pinnedViewersAtom);
    const mobilePanelMode = useAtomValue(mobilePanelModeAtom);
    const isMobile = useIsMobile();
    const isLandscape = useIsLandscape();
    const rotateMobilePortraitView = isMobile && !isLandscape;
    const componentsRef = useRef(components);
    componentsRef.current = components;
    const pinnedViewerIdsRef = useRef(pinnedViewerIds);
    pinnedViewerIdsRef.current = pinnedViewerIds;
    const mobilePanelModeRef = useRef(mobilePanelMode);
    mobilePanelModeRef.current = mobilePanelMode;

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
    }, [size.height, size.width]);

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
    }, [size.height, set, setIsOrtho]);

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
        setTopDownCameraPosition(
            ortho,
            controls.target.x,
            controls.target.y,
            controls.target.z + distance,
            rotateMobilePortraitView,
        );
        ortho.up.set(0, 0, 1);
        ortho.zoom = Math.max(0.1, zoom);
        ortho.updateProjectionMatrix();

        set({ camera: ortho });
        controls.object = ortho;
        controls.update();
        isOrtho.current = true;
        setIsOrtho(true);
    }, [rotateMobilePortraitView, size.height, set, setIsOrtho]);

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
            // One undo snapshot per gesture, not per wheel tick — a single
            // scroll burst would otherwise flood the 20-deep undo stack.
            const now = performance.now();
            if (now - lastRotateWheelTimeRef.current > ROTATE_GESTURE_GAP_MS) pushUndo();
            lastRotateWheelTimeRef.current = now;

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
            // Escape inside a text field should just leave the field, not
            // clear the table selection (which unmounts the Inspector panel
            // the user is editing). It's also a no-op while the UI is locked.
            if (e.key === 'Escape' && !isInputFocused() && !uiLocked) setSelection([]);
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
    }, [setSelection, selection, components, setComponents, undo, pushUndo, uiLocked]);

    // ─── Auto-zoom to fit when preset changes or resetViewSignal fires ───
    useEffect(() => {
        // Skip if the canvas hasn't been measured yet — happens on mobile when
        // the orientation/sidebar layout settles after the React effect fires.
        // The size dep below re-runs us once the dimensions arrive.
        if (size.width <= 0 || size.height <= 0) return;

        const controls = controlsRef.current;
        const currentComponents = componentsRef.current;
        if (!controls || currentComponents.length === 0) return;

        if (!isOrtho.current) switchToOrtho();

        const ortho = orthoCamRef.current;
        if (!ortho) return;

        const subjects = currentComponents.map(comp => ({ component: comp, radius: fitRadius(comp) }));

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        for (const { component, radius } of subjects) {
            const p = component.position;
            minX = Math.min(minX, p.x - radius);
            maxX = Math.max(maxX, p.x + radius);
            minY = Math.min(minY, p.y - radius);
            maxY = Math.max(maxY, p.y + radius);
        }

        const { centerX, centerY, zoom } = fitSceneToViewport(
            size.width,
            size.height,
            { minX, maxX, minY, maxY },
            rotateMobilePortraitView,
            isMobile && mobilePanelModeRef.current !== 'properties'
                ? mobilePinnedViewerReservation(size.width, size.height, currentComponents, pinnedViewerIdsRef.current)
                : undefined,
        );

        setTopDownCameraPosition(ortho, centerX, centerY, ortho.position.z, rotateMobilePortraitView);
        controls.target.set(centerX, centerY, 0);
        ortho.zoom = Math.max(0.2, Math.min(zoom, 10));
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

                setTopDownCameraPosition(cam, cx, cy, cam.position.z, rotateMobilePortraitView);
                ctrl.target.set(cx, cy, 0);
                cam.zoom = Math.max(0.1, fitZoom(size.width, size.height, sx, sy, 0, rotateMobilePortraitView));
                cam.updateProjectionMatrix();
                ctrl.update();
            }, 200);
        }
        // size.width/height are in deps so the fit re-runs once the canvas is
        // actually measured — on mobile the first tick can fire with size=0.
    }, [activePreset, isMobile, resetViewSignal, rotateMobilePortraitView, size.width, size.height, switchToOrtho]);

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
        setTopDownCameraPosition(ortho, cx, cy, ortho.position.z, rotateMobilePortraitView);
        controls.target.set(cx, cy, 0);
        ortho.zoom = 5;
        ortho.updateProjectionMatrix();
        controls.update();
    }, [components, rotateMobilePortraitView, setZoomToComponent, switchToOrtho, zoomToComponent]);

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
        const zoom = fitZoom(size.width, size.height, spanX, spanY, padding, rotateMobilePortraitView);

        setTopDownCameraPosition(ortho, centerX, centerY, ortho.position.z, rotateMobilePortraitView);
        controls.target.set(centerX, centerY, 0);
        ortho.zoom = Math.max(0.2, Math.min(zoom, 12));
        ortho.updateProjectionMatrix();
        controls.update();
    }, [rotateMobilePortraitView, setZoomToMeasurement, size.height, size.width, switchToOrtho, zoomToMeasurement]);

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
            //   Shift + left-drag   = Rotate    |  Shift + middle-drag = Rotate
            //   Ctrl + left-drag    = Pan       |  Ctrl + middle-drag  = Pan (default)
            //   Middle-drag (bare)  = Pan
            //   Right-click         = reserved for context menu (-1)
            //   Scroll              = Zoom
            //   Left-hold + scroll  = Rotate selected part (handled separately)
            mouseButtons={{
                LEFT: shiftHeld ? MOUSE.ROTATE : (ctrlHeld ? MOUSE.PAN : DISABLED_MOUSE_BUTTON),
                MIDDLE: shiftHeld ? MOUSE.ROTATE : MOUSE.PAN,
                RIGHT: DISABLED_MOUSE_BUTTON
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
            enableDamping={false}
        />
    );
};
