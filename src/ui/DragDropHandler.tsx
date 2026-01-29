import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useAtom } from 'jotai';
import { componentsAtom } from '../state/store';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Mirror } from '../physics/components/Mirror';
import { Laser } from '../physics/components/Laser';
import { Blocker } from '../physics/components/Blocker';
import { Card } from '../physics/components/Card';
import { Vector3, Raycaster, Plane } from 'three';

export const DragDropHandler: React.FC = () => {
    const { camera, gl, scene } = useThree();
    const [components, setComponents] = useAtom(componentsAtom);

    useEffect(() => {
        const handleDragOver = (e: DragEvent) => {
            e.preventDefault();
        };

        const handleDrop = (e: DragEvent) => {
            e.preventDefault();
            const type = e.dataTransfer?.getData('componentType');
            if (!type) return;

            // Calculate Mouse Position in NDC (-1 to +1)
            const rect = gl.domElement.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            // Raycasting
            const raycaster = new Raycaster();
            raycaster.setFromCamera({ x, y }, camera);

            // Intersect with Optical Table Plane (Y=0)
            const plane = new Plane(new Vector3(0, 1, 0), 0);
            const target = new Vector3();
            raycaster.ray.intersectPlane(plane, target);
            
            // If we didn't hit the infinite plane (parallel ray?), fallback to 0,0
            // But with Top-Down or Angle, we should usually hit.
            if (!target) return;

            // Snap to Grid (Optional? User asked for "Drop in where I drag it", implied precision or snap?
            // "Drop in to where I drag it". Usually implies exact position. 
            // Draggable has snap logic. Let's start with exact, maybe snap if Alt is held?
            // Let's stick to exact for now as it feels smoother.
            
            console.log(`Dropped ${type} at`, target);

            let newComp;
            if (type === 'lens') {
                newComp = new SphericalLens(1/50, 15, 4, "New Lens");
            } else if (type === 'mirror') {
                newComp = new Mirror(20, 20, "New Mirror");
            } else if (type === 'laser') {
                newComp = new Laser("New Laser");
            } else if (type === 'blocker') {
                newComp = new Blocker(20, 20, 5, "Beam Blocker");
            } else if (type === 'card') {
                newComp = new Card(40, 40, "Viewing Card");
            }

            if (newComp) {
                // Set Position
                newComp.setPosition(target.x, 0, target.z);
                
                // Rotation defaults based on component?
                // Align to Optical Axis (X) by default (Normal along X)
                if (type === 'lens' || type === 'mirror' || type === 'card' || type === 'blocker') {
                     newComp.setRotation(0, Math.PI / 2, 0);
                }

                setComponents(prev => [...prev, newComp]);
            }
        };

        const canvas = gl.domElement;
        canvas.addEventListener('dragover', handleDragOver);
        canvas.addEventListener('drop', handleDrop);

        return () => {
            canvas.removeEventListener('dragover', handleDragOver);
            canvas.removeEventListener('drop', handleDrop);
        };
    }, [camera, gl, setComponents]);

    return null;
};
