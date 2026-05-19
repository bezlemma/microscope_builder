import React, { useState, useRef, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useAtom } from 'jotai';
import { componentsAtom, selectionAtom, isDraggingAtom, pushUndoAtom, mobileSnapEnabledAtom, uiLockedAtom, contextMenuAtom } from '../state/store';
import { OpticalComponent } from '../physics/Component';
import { Vector3, DoubleSide } from 'three';
import { SampleChamber } from '../physics/components/SampleChamber';
import { Rail } from '../physics/components/Rail';
import { Objective } from '../physics/components/Objective';
import { useIsMobile } from './useIsMobile';
import { useHaptic } from './useHaptic';

interface DraggableProps {
    component: OpticalComponent;
    children: React.ReactNode;
}

const MIN_INTERACTION_THICKNESS_MM = 10;

export const Draggable: React.FC<DraggableProps> = ({ component, children }) => {
    const [components, setComponents] = useAtom(componentsAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);
    const [selection, setSelection] = useAtom(selectionAtom);
    const [, setContextMenu] = useAtom(contextMenuAtom);
    const { controls, camera } = useThree();
    const [isDragging, setIsDragging] = useState(false);
    const [, setGlobalDragging] = useAtom(isDraggingAtom);
    const [mobileSnap] = useAtom(mobileSnapEnabledAtom);
    const [uiLocked] = useAtom(uiLockedAtom);
    const isMobile = useIsMobile();
    const haptic = useHaptic();

    // Store offset from center to click point to prevent jumping
    const dragOffset = useRef(new Vector3(0, 0, 0));
    // Tracks whether the drag was snapped to an axis/port/rail/ghost on the
    // PREVIOUS pointermove tick.  Edge transitions drive snap/release haptics.
    const wasAxisSnappedRef = useRef(false);

    // Grid Snapping (25mm)
    const gridSize = 25;

    const isSelected = selection.includes(component.id);

    // Intersect ray with Z=0 plane (table surface in Z-up world)
    const getRayIntersection = (e: any) => {
        const ray = e.ray;
        // Z-up: table is XY plane at Z=0
        if (Math.abs(ray.direction.z) < 1e-6) return new Vector3(0, 0, 0);
        const t = -ray.origin.z / ray.direction.z;
        return ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
    };

    // Intersect ray with a vertical plane through the component (for Z dragging).
    // Uses camera forward vector projected onto XY to define the plane normal,
    // so vertical mouse movement maps to Z.
    const getRayIntersectionVertical = (e: any) => {
        const ray = e.ray;
        // Build a vertical plane through the component position.
        // Normal = camera forward projected onto XY (horizontal), so the plane
        // faces the camera and vertical mouse movement -> Z.
        const camFwd = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const planeNormal = new Vector3(camFwd.x, camFwd.y, 0).normalize();
        if (planeNormal.length() < 1e-6) return new Vector3(component.position.x, component.position.y, component.position.z);
        const planeD = planeNormal.dot(component.position);
        const denom = planeNormal.dot(ray.direction);
        if (Math.abs(denom) < 1e-6) return new Vector3(component.position.x, component.position.y, component.position.z);
        const t = (planeD - planeNormal.dot(ray.origin)) / denom;
        return ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
    };

    // Right-click on a component opens the alignment context menu.
    // OrbitControls also grabs right-button for pan, but if the user releases
    // without moving (= a real click) we still get a contextmenu event and pan
    // is a no-op. Pan-drag is unaffected.
    const handleContextMenu = (e: any) => {
        if (uiLocked) return;
        e.stopPropagation();
        e.nativeEvent?.preventDefault?.();
        if (!selection.includes(component.id)) {
            setSelection([component.id]);
        }
        const x = e.nativeEvent?.clientX ?? e.clientX ?? 0;
        const y = e.nativeEvent?.clientY ?? e.clientY ?? 0;
        setContextMenu({ componentId: component.id, x, y });
    };

    // ── Long-press detector (mobile equivalent of right-click) ────────────
    const longPressTimer = useRef<number | null>(null);
    const longPressStart = useRef<{ x: number; y: number; pointerType: string }>({ x: 0, y: 0, pointerType: 'mouse' });
    const cancelLongPress = () => {
        if (longPressTimer.current !== null) {
            window.clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const handlePointerDown = (e: any) => {
        if (uiLocked) return;
        // Right-button pointerdown: let onContextMenu handle it. Don't start a drag.
        if (e.button === 2) return;
        e.stopPropagation();

        // Start the long-press timer for touch input. If the pointer stays
        // within a small radius for ~500 ms, we treat it as a right-click and
        // open the alignment context menu instead of dragging.
        const pointerType = e.nativeEvent?.pointerType ?? e.pointerType ?? 'mouse';
        if (pointerType === 'touch' || pointerType === 'pen') {
            const sx = e.nativeEvent?.clientX ?? e.clientX ?? 0;
            const sy = e.nativeEvent?.clientY ?? e.clientY ?? 0;
            longPressStart.current = { x: sx, y: sy, pointerType };
            cancelLongPress();
            longPressTimer.current = window.setTimeout(() => {
                if (!selection.includes(component.id)) {
                    setSelection([component.id]);
                }
                setContextMenu({ componentId: component.id, x: sx, y: sy });
                // Stop the drag we started — long-press wins.
                setIsDragging(false);
                setGlobalDragging(false);
                if (controls) (controls as any).enabled = true;
                longPressTimer.current = null;
            }, 500);
        }

        // Shift+Click: toggle this component in the multi-selection
        // (Can't use Ctrl/Cmd -- OrbitControls intercepts those for panning)
        if (e.shiftKey) {
            if (selection.includes(component.id)) {
                // Remove from selection
                setSelection(selection.filter(id => id !== component.id));
            } else {
                // Add to selection
                setSelection([...selection, component.id]);
            }
        } else {
            // Normal click: select only this component (unless it's already part of a multi-selection being dragged)
            if (!selection.includes(component.id)) {
                setSelection([component.id]);
            }
        }

        try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* Safari/mobile may not support pointer capture */ }
        pushUndo();  // snapshot before drag
        // Brief pulse confirms the tap landed on a real component — without
        // this, mobile users can't tell their pixel-precise stab worked.
        haptic.tap();
        // Reset snap-edge tracking for this drag session.
        wasAxisSnappedRef.current = false;
        setIsDragging(true);
        setGlobalDragging(true);

        // Calculate offset: Component Center - Click Point
        const hitPoint = getRayIntersection(e);
        const hitPointV = !component.axisLock.z ? getRayIntersectionVertical(e) : null;
        // Z-up world: XY is table surface, Z from vertical plane when unlocked
        dragOffset.current.set(
            component.position.x - hitPoint.x,
            component.position.y - hitPoint.y,
            hitPointV ? component.position.z - hitPointV.z : 0
        );

        // Disable Orbit Controls
        if (controls) (controls as any).enabled = false;
    };

    const handlePointerUp = (e: any) => {
        if (uiLocked) return;
        e.stopPropagation();
        cancelLongPress();
        try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
        setIsDragging(false);
        setGlobalDragging(false);

        // Enable Orbit Controls
        if (controls) (controls as any).enabled = true;
    };

    const handlePointerMove = (e: any) => {
        if (uiLocked) return;
        // Cancel a pending long-press if the touch moves more than a few pixels.
        if (longPressTimer.current !== null) {
            const cx = e.nativeEvent?.clientX ?? e.clientX ?? 0;
            const cy = e.nativeEvent?.clientY ?? e.clientY ?? 0;
            const dx = cx - longPressStart.current.x;
            const dy = cy - longPressStart.current.y;
            if (dx * dx + dy * dy > 64 /* 8 px² */) cancelLongPress();
        }
        if (!isDragging) return;
        e.stopPropagation();

        const hitPoint = getRayIntersection(e);

        // Apply Offset in XY plane (Z-up world)
        const targetX = hitPoint.x + dragOffset.current.x;
        const targetY = hitPoint.y + dragOffset.current.y;

        // Z dragging: intersect vertical plane when Z is unlocked
        let targetZ = component.position.z;
        if (!component.axisLock.z) {
            const hitPointV = getRayIntersectionVertical(e);
            targetZ = hitPointV.z + dragOffset.current.z;
        }

        let finalX = targetX;
        let finalY = targetY;
        let finalZ = targetZ;

        // Axis lock enforcement: prevent movement on locked axes.
        //
        // Z is locked by default. The locked behaviour MUST be "keep the
        // component's current z" — never "snap to the active z level". The
        // active z is only for placing newly-added components (see
        // DragDropHandler) and for filtering the view; using it here meant
        // dragging a component on the y=12.5 microscope row while the user
        // had z=0 selected would yank that component down to z=0 and break
        // the optical path. Z only changes when the user explicitly unlocks
        // it from the Inspector.
        if (component.axisLock.x) finalX = component.position.x;
        if (component.axisLock.y) finalY = component.position.y;
        if (component.axisLock.z) finalZ = component.position.z;


        // Snapping (If ALT key is held OR mobile snap is active)
        if (e.altKey || mobileSnap) {
            const AXIS_SNAP_THRESHOLD = 15;  // mm -- perpendicular distance to trigger snap
            const AXIS_RANGE_LIMIT = 12.5;   // mm -- max distance from box face along axis
            let bestAxisDist = Infinity;
            let snappedEuler: [number, number, number] | null = null;

            // Check SampleChamber snap port axes (higher priority than grid)
            for (const c of components) {
                if (c instanceof SampleChamber && c.id !== component.id) {


                    for (const port of c.snapPorts) {
                        // Port world position (center of the bore opening)
                        const px = c.position.x + port.x;
                        const py = c.position.y + port.y;

                        if (port.axisDir === 'x') {
                            // Axis runs along X -- snap Y, limit X range
                            const perpDist = Math.abs(targetY - py);
                            // Check axis range: target must be within AXIS_RANGE_LIMIT of the face edge
                            const faceX = c.position.x + port.x; // port.x is +/-half
                            const sign = port.x > 0 ? 1 : -1;    // outward direction
                            const axisDistFromFace = (targetX - faceX) * sign;
                            const half = c.cubeSize / 2;
                            if (perpDist < AXIS_SNAP_THRESHOLD && perpDist < bestAxisDist
                                && axisDistFromFace >= -half && axisDistFromFace <= AXIS_RANGE_LIMIT) {
                                bestAxisDist = perpDist;
                                finalX = targetX; // free along X
                                finalY = py;      // snap Y to axis
                                snappedEuler = [port.rx, port.ry, port.rz];
                            }
                        } else {
                            // Axis runs along Y -- snap X, limit Y range
                            const perpDist = Math.abs(targetX - px);
                            const faceY = c.position.y + port.y;
                            const sign = port.y > 0 ? 1 : -1;
                            const axisDistFromFace = (targetY - faceY) * sign;
                            const half = c.cubeSize / 2;
                            if (perpDist < AXIS_SNAP_THRESHOLD && perpDist < bestAxisDist
                                && axisDistFromFace >= -half && axisDistFromFace <= AXIS_RANGE_LIMIT) {
                                bestAxisDist = perpDist;
                                finalX = px;      // snap X to axis
                                finalY = targetY; // free along Y
                                snappedEuler = [port.rx, port.ry, port.rz];
                            }
                        }
                    }
                }
            }

            // Check Rail axes (snap to rail line segment)
            for (const c of components) {
                if (c instanceof Rail && c.id !== component.id) {
                    const a = c.holeA;
                    const b = c.holeB;
                    const ab = new Vector3(b.x - a.x, b.y - a.y, 0);
                    const abLenSq = ab.lengthSq();
                    if (abLenSq < 1e-6) continue;
                    const at = new Vector3(targetX - a.x, targetY - a.y, 0);
                    const t = Math.max(0, Math.min(1, at.dot(ab) / abLenSq));
                    const projX = a.x + t * ab.x;
                    const projY = a.y + t * ab.y;
                    const perpDist = Math.sqrt((targetX - projX) ** 2 + (targetY - projY) ** 2);
                    if (perpDist < AXIS_SNAP_THRESHOLD && perpDist < bestAxisDist) {
                        bestAxisDist = perpDist;
                        finalX = projX;
                        finalY = projY;
                        snappedEuler = null;
                    }
                }
            }

            // Fall back to grid snapping if no axis snap was triggered
            if (bestAxisDist >= AXIS_SNAP_THRESHOLD) {
                // First check if we can snap to a Ghost component
                let snappedToGhost = false;
                for (const c of components) {
                    if (c.isGhost && c.id !== component.id) {
                        const dist = Math.sqrt((targetX - c.position.x) ** 2 + (targetY - c.position.y) ** 2);
                        if (dist < 15) { // Within 15mm of ghost center
                            finalX = c.position.x;
                            finalY = c.position.y;
                            snappedEuler = null; // Just snap position
                            snappedToGhost = true;
                            break;
                        }
                    }
                }

                if (!snappedToGhost) {
                    const offset = 12.5;
                    finalX = Math.round((targetX - offset) / gridSize) * gridSize + offset;
                    finalY = Math.round((targetY - offset) / gridSize) * gridSize + offset;
                }
            }

            // Re-apply axis locks after snapping
            if (component.axisLock.x) finalX = component.position.x;
            if (component.axisLock.y) finalY = component.position.y;

            // Snap edge detection — fire only on transition, not every frame.
            // We treat port/rail/ghost snaps as "real" snaps worth feeling;
            // the grid fallback fires every tick during a fast drag and would
            // turn into noise, so we exclude it.
            const isAxisSnapped = bestAxisDist < AXIS_SNAP_THRESHOLD;
            if (isAxisSnapped && !wasAxisSnappedRef.current) {
                haptic.snap();
            } else if (!isAxisSnapped && wasAxisSnappedRef.current) {
                haptic.release();
            }
            wasAxisSnappedRef.current = isAxisSnapped;

            // Compute delta from current dragged component position
            const deltaX = finalX - component.position.x;
            const deltaY = finalY - component.position.y;
            const deltaZ = finalZ - component.position.z;

            // Get the set of IDs to move (all selected, including this one)
            const idsToMove = new Set(selection.includes(component.id) ? selection : [component.id]);

            const newComponents = components.map(c => {
                if (idsToMove.has(c.id)) {
                    c.setPosition(c.position.x + deltaX, c.position.y + deltaY, c.position.z + deltaZ);
                    // Apply 3D rotation if component was snapped to a port axis
                    if (snappedEuler && idsToMove.size === 1) {
                        c.setRotation(snappedEuler[0], snappedEuler[1], snappedEuler[2]);
                    }
                    return c;
                }
                return c;
            });

            setComponents(newComponents);
            return; // early return -- alt path handles its own setComponents
        }

        // Compute delta from current dragged component position
        const deltaX = finalX - component.position.x;
        const deltaY = finalY - component.position.y;
        const deltaZ = finalZ - component.position.z;

        // Get the set of IDs to move (all selected, including this one)
        const idsToMove = new Set(selection.includes(component.id) ? selection : [component.id]);

        const newComponents = components.map(c => {
            if (idsToMove.has(c.id)) {
                c.setPosition(c.position.x + deltaX, c.position.y + deltaY, c.position.z + deltaZ);
                return c;
            }
            return c;
        });

        setComponents(newComponents);
    };

    const selectionHighlight = useMemo(() => {
        const b = component.bounds;
        if (!b) {
            return {
                center: component.position.clone().add(new Vector3(0, 0, 0.5)),
                radiusX: 15,
                radiusY: 15,
                rotationZ: 0,
            };
        }

        const min = b.min.clone();
        const max = b.max.clone();
        const size = max.clone().sub(min);
        if (component instanceof Objective) {
            const barrelDiameter = Math.max(size.x, size.y);
            const objectiveFootprintLength = Math.max(size.z, barrelDiameter * 2.4);
            max.z = min.z + objectiveFootprintLength;
        }

        const forward = new Vector3(0, 0, 1).applyQuaternion(component.rotation);
        let axisX = forward.x;
        let axisY = forward.y;
        let axisLen = Math.hypot(axisX, axisY);
        if (axisLen < 1e-6) {
            const side = new Vector3(1, 0, 0).applyQuaternion(component.rotation);
            axisX = side.x;
            axisY = side.y;
            axisLen = Math.hypot(axisX, axisY) || 1;
        }
        axisX /= axisLen;
        axisY /= axisLen;
        const perpX = -axisY;
        const perpY = axisX;

        let minU = Infinity;
        let maxU = -Infinity;
        let minV = Infinity;
        let maxV = -Infinity;
        for (const x of [min.x, max.x]) {
            for (const y of [min.y, max.y]) {
                for (const z of [min.z, max.z]) {
                    const world = new Vector3(x, y, z).applyQuaternion(component.rotation).add(component.position);
                    const u = world.x * axisX + world.y * axisY;
                    const v = world.x * perpX + world.y * perpY;
                    minU = Math.min(minU, u);
                    maxU = Math.max(maxU, u);
                    minV = Math.min(minV, v);
                    maxV = Math.max(maxV, v);
                }
            }
        }

        const centerU = (minU + maxU) * 0.5;
        const centerV = (minV + maxV) * 0.5;
        const padding = component instanceof Objective ? 10 : 6;
        return {
            center: new Vector3(
                centerU * axisX + centerV * perpX,
                centerU * axisY + centerV * perpY,
                component.position.z + 0.5,
            ),
            radiusX: Math.max((maxU - minU) * 0.5 + padding, 15),
            radiusY: Math.max((maxV - minV) * 0.5 + padding, 15),
            rotationZ: Math.atan2(axisY, axisX),
        };
    }, [component, component.bounds, component.position, component.rotation, component.version]);

    // Mobile tap-target radius — fingertips are ~10mm wide, and a thin mirror
    // / blocker / lens on the simulator's mm scale is way under that. Without
    // an enlarged invisible hit zone the user has to pinch-zoom in just to
    // tap them. This radius is "the bigger of the component's footprint or
    // 22 mm", which is generous but still prevents two adjacent components
    // from overlapping each other's hit zones at typical preset spacings
    // (~25 mm grid).
    const tapTargetRadius = useMemo(() => {
        const b = component.bounds;
        if (b) {
            const size = b.max.clone().sub(b.min);
            return Math.max(size.x, size.y, 22) * 0.65;
        }
        return 22;
    }, [component.bounds]);

    const interactionHitBox = useMemo(() => {
        const b = component.bounds;
        if (!b) return null;

        const size = b.max.clone().sub(b.min);
        const expandedSize = new Vector3(
            Math.max(size.x, MIN_INTERACTION_THICKNESS_MM),
            Math.max(size.y, MIN_INTERACTION_THICKNESS_MM),
            Math.max(size.z, MIN_INTERACTION_THICKNESS_MM),
        );

        const needsExpansion =
            expandedSize.x > size.x + 1e-6 ||
            expandedSize.y > size.y + 1e-6 ||
            expandedSize.z > size.z + 1e-6;

        if (!needsExpansion) return null;

        return {
            center: b.min.clone().add(b.max).multiplyScalar(0.5),
            size: expandedSize,
        };
    }, [component.bounds, component.version]);

    if (component.isGhost) {
        return <group>{children}</group>;
    }

    return (
        <group
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerMove={handlePointerMove}
            onContextMenu={handleContextMenu}
        >
            {children}

            {interactionHitBox && (
                <group
                    position={[component.position.x, component.position.y, component.position.z]}
                    quaternion={component.rotation.clone()}
                >
                    <mesh position={[interactionHitBox.center.x, interactionHitBox.center.y, interactionHitBox.center.z]}>
                        <boxGeometry args={[interactionHitBox.size.x, interactionHitBox.size.y, interactionHitBox.size.z]} />
                        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
                    </mesh>
                </group>
            )}

            {/* Mobile-only: invisible disc that catches taps near the
             *  component, so thin mirrors/blockers/lenses don't require
             *  pixel-precise stabbing. Sits just above the table surface so
             *  it raycasts against finger taps but doesn't occlude any
             *  component visualization that draws above z=0.05. */}
            {isMobile && (
                <mesh
                    position={[component.position.x, component.position.y, component.position.z + 0.05]}
                    rotation={[0, 0, 0]}
                >
                    <circleGeometry args={[tapTargetRadius, 24]} />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide} />
                </mesh>
            )}

            {/* Selection highlight ring -- glowing torus on the table surface */}
            {isSelected && (
                <mesh
                    position={[selectionHighlight.center.x, selectionHighlight.center.y, selectionHighlight.center.z]}
                    rotation={[0, 0, selectionHighlight.rotationZ]}
                    scale={[selectionHighlight.radiusX, selectionHighlight.radiusY, 1]}
                >
                    <torusGeometry args={[1, 0.035, 8, 96]} />
                    <meshBasicMaterial
                        color="#64ffda"
                        transparent
                        opacity={0.6}
                        side={DoubleSide}
                        depthWrite={false}
                        toneMapped={false}
                    />
                </mesh>
            )}
        </group>
    );
};
