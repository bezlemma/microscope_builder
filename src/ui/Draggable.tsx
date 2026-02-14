import React, { useState, useRef, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useAtom } from 'jotai';
import { componentsAtom, selectionAtom } from '../state/store';
import { OpticalComponent } from '../physics/Component';
import { Vector3, DoubleSide } from 'three';

interface DraggableProps {
    component: OpticalComponent;
    children: React.ReactNode;
}

export const Draggable: React.FC<DraggableProps> = ({ component, children }) => {
    const [components, setComponents] = useAtom(componentsAtom);
    const [selection, setSelection] = useAtom(selectionAtom);
    const { controls } = useThree();
    const [isDragging, setIsDragging] = useState(false);

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
        setIsDragging(true);

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
            // Holes are visually at 12.5, 37.5 (Offset by 12.5 from 0, 25)
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
