import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useAtom } from 'jotai';
import { componentsAtom, pushUndoAtom } from '../state/store';
import { Vector3, Raycaster, Plane, Vector2 } from 'three';
import { applyDefaultPlacementOrientation, createComponentForType } from './componentFactory';

export const DragDropHandler: React.FC = () => {
    const { camera, gl } = useThree();
    const [, setComponents] = useAtom(componentsAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);

    useEffect(() => {
        const handleDragOver = (e: DragEvent) => {
            e.preventDefault();
        };

        const handleDrop = (e: DragEvent) => {
            e.preventDefault();
            const type = e.dataTransfer?.getData('componentType');
            if (!type) return;

            // Calculate drop position via raycasting to Z=0 plane
            const rect = gl.domElement.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            const raycaster = new Raycaster();
            raycaster.setFromCamera(new Vector2(x, y), camera);
            const plane = new Plane(new Vector3(0, 0, 1), 0);
            const target = new Vector3();
            raycaster.ray.intersectPlane(plane, target);
            if (!target) return;

            const newComp = createComponentForType(type);
            if (newComp) {
                pushUndo();  // snapshot before add
                newComp.setPosition(target.x, target.y, 0);
                applyDefaultPlacementOrientation(newComp, type);
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
    }, [camera, gl, setComponents, pushUndo]);

    return null;
};
