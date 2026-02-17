import React, { useState, useRef, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useAtom } from 'jotai';
import { componentsAtom, selectionAtom, isDraggingAtom, pushUndoAtom } from '../state/store';
import { OpticalComponent } from '../physics/Component';
import { Vector3, DoubleSide } from 'three';
import { SampleChamber } from '../physics/components/SampleChamber';

interface DraggableProps {
    component: OpticalComponent;
    children: React.ReactNode;
}

export const Draggable: React.FC<DraggableProps> = ({ component, children }) => {
    const [components, setComponents] = useAtom(componentsAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);
    const [selection, setSelection] = useAtom(selectionAtom);
    const { controls } = useThree();
    const [isDragging, setIsDragging] = useState(false);
    const [, setGlobalDragging] = useAtom(isDraggingAtom);

    // Store offset from center to click point to prevent jumping
    const dragOffset = useRef(new Vector3(0, 0, 0));

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

    const handlePointerDown = (e: any) => {
        e.stopPropagation();

        // Shift+Click: toggle this component in the multi-selection
        // (Can't use Ctrl/Cmd — OrbitControls intercepts those for panning)
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

        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        pushUndo();  // snapshot before drag
        setIsDragging(true);
        setGlobalDragging(true);

        // Calculate offset: Component Center - Click Point
        const hitPoint = getRayIntersection(e);
        // Z-up world: XY is table surface, Z is fixed at 0
        dragOffset.current.set(
            component.position.x - hitPoint.x,
            component.position.y - hitPoint.y,
            0
        );

        // Disable Orbit Controls
        if (controls) (controls as any).enabled = false;
    };

    const handlePointerUp = (e: any) => {
        e.stopPropagation();
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        setIsDragging(false);
        setGlobalDragging(false);

        // Enable Orbit Controls
        if (controls) (controls as any).enabled = true;
    };

    const handlePointerMove = (e: any) => {
        if (!isDragging) return;
        e.stopPropagation();

        const hitPoint = getRayIntersection(e);

        // Apply Offset in XY plane (Z-up world)
        const targetX = hitPoint.x + dragOffset.current.x;
        const targetY = hitPoint.y + dragOffset.current.y;

        let finalX = targetX;
        let finalY = targetY;


        // Snapping (Only if ALT key is held)
        if (e.altKey) {
            const AXIS_SNAP_THRESHOLD = 15;  // mm — perpendicular distance to trigger snap
            const AXIS_RANGE_LIMIT = 12.5;   // mm — max distance from box face along axis
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
                            // Axis runs along X — snap Y, limit X range
                            const perpDist = Math.abs(targetY - py);
                            // Check axis range: target must be within AXIS_RANGE_LIMIT of the face edge
                            const faceX = c.position.x + port.x; // port.x is ±half
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
                            // Axis runs along Y — snap X, limit Y range
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

            // Fall back to grid snapping if no axis snap was triggered
            if (bestAxisDist >= AXIS_SNAP_THRESHOLD) {
                const offset = 12.5;
                finalX = Math.round((targetX - offset) / gridSize) * gridSize + offset;
                finalY = Math.round((targetY - offset) / gridSize) * gridSize + offset;
            }

            // Compute delta from current dragged component position
            const deltaX = finalX - component.position.x;
            const deltaY = finalY - component.position.y;

            // Get the set of IDs to move (all selected, including this one)
            const idsToMove = new Set(selection.includes(component.id) ? selection : [component.id]);

            const newComponents = components.map(c => {
                if (idsToMove.has(c.id)) {
                    c.setPosition(c.position.x + deltaX, c.position.y + deltaY, 0);
                    // Apply 3D rotation if component was snapped to a port axis
                    if (snappedEuler && idsToMove.size === 1) {
                        c.setRotation(snappedEuler[0], snappedEuler[1], snappedEuler[2]);
                    }
                    return c;
                }
                return c;
            });

            setComponents(newComponents);
            return; // early return — alt path handles its own setComponents
        }

        // Compute delta from current dragged component position
        const deltaX = finalX - component.position.x;
        const deltaY = finalY - component.position.y;

        // Get the set of IDs to move (all selected, including this one)
        const idsToMove = new Set(selection.includes(component.id) ? selection : [component.id]);

        const newComponents = components.map(c => {
            if (idsToMove.has(c.id)) {
                c.setPosition(c.position.x + deltaX, c.position.y + deltaY, 0);
                return c;
            }
            return c;
        });

        setComponents(newComponents);
    };

    // Selection highlight ring radius — proportional to component bounds
    const ringRadius = useMemo(() => {
        const b = component.bounds;
        if (b) {
            const size = b.max.clone().sub(b.min);
            return Math.max(size.x, size.y, 15) * 0.7;
        }
        return 15;
    }, [component.bounds]);

    return (
        <group
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerMove={handlePointerMove}
        >
            {children}

            {/* Selection highlight ring — glowing torus on the table surface */}
            {isSelected && (
                <mesh
                    position={[component.position.x, component.position.y, component.position.z + 0.5]}
                    rotation={[0, 0, 0]}
                >
                    <torusGeometry args={[ringRadius, 0.5, 8, 48]} />
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
