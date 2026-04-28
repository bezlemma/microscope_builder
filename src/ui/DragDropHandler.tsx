import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useAtom } from 'jotai';
import { componentsAtom, pushUndoAtom, activeZLevelAtom, railPlacementAtom, pinnedViewersAtom } from '../state/store';
import { Vector3, Raycaster, Plane, Vector2 } from 'three';
import { applyDefaultPlacementOrientation, createComponentForType } from './componentFactory';
import { DualGalvoScanHead } from '../physics/components/DualGalvoScanHead';
import { QPD } from '../physics/components/QPD';
import { useHaptic } from './useHaptic';

export const DragDropHandler: React.FC = () => {
    const { camera, gl } = useThree();
    const [, setComponents] = useAtom(componentsAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);
    const [activeZ] = useAtom(activeZLevelAtom);
    const [, setRailPlacement] = useAtom(railPlacementAtom);
    const [, setPinnedViewers] = useAtom(pinnedViewersAtom);
    const haptic = useHaptic();

    useEffect(() => {
        const handleDragOver = (e: DragEvent) => {
            e.preventDefault();
        };

        const handleDrop = (e: DragEvent) => {
            e.preventDefault();
            const type = e.dataTransfer?.getData('componentType');
            if (!type) return;

            haptic.tap();

            // Rails and arrow annotations use two-click placement: first
            // click = start hole, second click = end hole, then the actual
            // component lands stretched between them.
            if (type === 'rail') {
                setRailPlacement({ active: true, kind: 'rail', firstHole: null });
                return;
            }
            if (type === 'arrowAnnotation' || type === 'curvedArrowAnnotation') {
                setRailPlacement({ active: true, kind: type, firstHole: null });
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
            if (!raycaster.ray.intersectPlane(plane, target)) return;

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
                if (newComp instanceof QPD) {
                    setPinnedViewers(prev => {
                        const next = new Set(prev);
                        next.add(newComp.id);
                        return next;
                    });
                }
            }
        };

        const targetEl = gl.domElement.parentElement || gl.domElement;
        targetEl.addEventListener('dragover', handleDragOver);
        targetEl.addEventListener('drop', handleDrop);

        return () => {
            targetEl.removeEventListener('dragover', handleDragOver);
            targetEl.removeEventListener('drop', handleDrop);
        };
    }, [camera, gl, setComponents, pushUndo, activeZ, setRailPlacement, setPinnedViewers, haptic]);

    return null;
};
