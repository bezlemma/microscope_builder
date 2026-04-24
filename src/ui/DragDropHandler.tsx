import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useAtom } from 'jotai';
import { componentsAtom, pushUndoAtom, activeZLevelAtom, railPlacementAtom } from '../state/store';
import { Vector3, Raycaster, Plane, Vector2 } from 'three';
import { applyDefaultPlacementOrientation, createComponentForType } from './componentFactory';
import { DualGalvoScanHead } from '../physics/components/DualGalvoScanHead';

export const DragDropHandler: React.FC = () => {
    const { camera, gl } = useThree();
    const [, setComponents] = useAtom(componentsAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);
    const [activeZ] = useAtom(activeZLevelAtom);
    const [, setRailPlacement] = useAtom(railPlacementAtom);

    useEffect(() => {
        const handleDragOver = (e: DragEvent) => {
            e.preventDefault();
        };

        const handleDrop = (e: DragEvent) => {
            e.preventDefault();
            const type = e.dataTransfer?.getData('componentType');
            if (!type) return;

            if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
                window.navigator.vibrate(50);
            }

            // Rail uses two-click placement mode instead of drop
            if (type === 'rail') {
                setRailPlacement({ active: true, firstHole: null });
                return;
            }

            // Calculate drop position via raycasting
            const rect = gl.domElement.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            const raycaster = new Raycaster();
            raycaster.setFromCamera(new Vector2(x, y), camera);
            const plane = new Plane(new Vector3(0, 0, 1), -activeZ);
            const target = new Vector3();
            raycaster.ray.intersectPlane(plane, target);
            if (!target) return;

            const newComp = createComponentForType(type);
            if (newComp) {
                pushUndo();  // snapshot before add
                newComp.setPosition(target.x, target.y, activeZ);
                applyDefaultPlacementOrientation(newComp, type);
                // DualGalvoScanHead manages child mirrors that also need to be in the scene
                const inserted = newComp instanceof DualGalvoScanHead
                    ? [newComp, ...newComp.getManagedSubcomponents()]
                    : [newComp];
                setComponents(prev => [...prev, ...inserted]);
            }
        };

        const targetEl = gl.domElement.parentElement || gl.domElement;
        targetEl.addEventListener('dragover', handleDragOver);
        targetEl.addEventListener('drop', handleDrop);

        return () => {
            targetEl.removeEventListener('dragover', handleDragOver);
            targetEl.removeEventListener('drop', handleDrop);
        };
    }, [camera, gl, setComponents, pushUndo, activeZ, setRailPlacement]);

    return null;
};
