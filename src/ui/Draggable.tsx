import React, { useState, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { useAtom } from 'jotai';
import { componentsAtom, selectionAtom } from '../state/store';
import { OpticalComponent } from '../physics/Component';
import { Euler, Vector3 } from 'three';

interface DraggableProps {
    component: OpticalComponent;
    children: React.ReactNode;
}

export const Draggable: React.FC<DraggableProps> = ({ component, children }) => {
    const [components, setComponents] = useAtom(componentsAtom);
    const [, setSelection] = useAtom(selectionAtom);
    const { controls } = useThree();
    const [isDragging, setIsDragging] = useState(false);
    
    // Store offset from center to click point to prevent jumping
    const dragOffset = useRef(new Vector3(0, 0, 0));
    
    // Grid Snapping (25mm)
    const gridSize = 25;

    const getRayIntersection = (e: any) => {
        const ray = e.ray;
        if (Math.abs(ray.direction.y) < 1e-6) return new Vector3(0,0,0);
        const t = -ray.origin.y / ray.direction.y;
        return ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
    };

    const handlePointerDown = (e: any) => {
        e.stopPropagation();
        setSelection(component.id);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setIsDragging(true);
        
        // Calculate offset: Component Center - Click Point
        const hitPoint = getRayIntersection(e);
        // We only care about X and Z offset. Y is fixed at 0 for table components.
        dragOffset.current.set(
            component.position.x - hitPoint.x,
            0,
            component.position.z - hitPoint.z
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
        
        // Apply Offset
        const targetX = hitPoint.x + dragOffset.current.x;
        const targetZ = hitPoint.z + dragOffset.current.z;
        
        let finalX = targetX;
        let finalZ = targetZ;

        // Snapping (Only if ALT key is held)
        if (e.altKey) {
            // Holes are visually at 12.5, 37.5 (Offset by 12.5 from 0, 25)
            const offset = 12.5; 
            finalX = Math.round((targetX - offset) / gridSize) * gridSize + offset;
            finalZ = Math.round((targetZ - offset) / gridSize) * gridSize + offset;
        }
        
        const newComponents = components.map(c => {
            if (c.id === component.id) {
                c.setPosition(finalX, 0, finalZ); 
                return c;
            }
            return c;
        });
        
        setComponents(newComponents);
    };



    return (
        <group
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerMove={handlePointerMove}
        >
            {children}
        </group>
    );
};
