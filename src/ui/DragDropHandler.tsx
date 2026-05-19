import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useAtom } from 'jotai';
import { componentsAtom, pushUndoAtom, activeZLevelAtom, railPlacementAtom, pinnedViewersAtom, pendingCatalogPlacementAtom } from '../state/store';
import { Vector3, Raycaster, Plane, Vector2 } from 'three';
import { applyDefaultPlacementOrientation, createCatalogComponentForTypeAsync, createComponentForType } from './componentFactory';
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
    const [pendingCatalogPlacement, setPendingCatalogPlacement] = useAtom(pendingCatalogPlacementAtom);
    const haptic = useHaptic();

    useEffect(() => {
        const placeComponent = async (type: string, target: Vector3, catalogPartId?: string | null) => {
            const newComp = catalogPartId
                ? await createCatalogComponentForTypeAsync(type, catalogPartId)
                : createComponentForType(type);
            if (!newComp) return;

            pushUndo();
            newComp.setPosition(target.x, target.y, activeZ);
            applyDefaultPlacementOrientation(newComp, type);
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
        };
        const placeComponentSafely = (type: string, target: Vector3, catalogPartId?: string | null) => {
            void placeComponent(type, target, catalogPartId).catch(error => {
                console.error('Component placement failed:', error);
            });
        };

        const tablePointFromClient = (clientX: number, clientY: number): Vector3 | null => {
            const rect = gl.domElement.getBoundingClientRect();
            const x = ((clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((clientY - rect.top) / rect.height) * 2 + 1;

            const raycaster = new Raycaster();
            raycaster.setFromCamera(new Vector2(x, y), camera);
            const plane = new Plane(new Vector3(0, 0, 1), -activeZ);
            const target = new Vector3();
            return raycaster.ray.intersectPlane(plane, target) ? target : null;
        };

        const handleDragOver = (e: DragEvent) => {
            e.preventDefault();
        };

        const handleDrop = (e: DragEvent) => {
            e.preventDefault();
            const type = e.dataTransfer?.getData('componentType');
            if (!type) return;
            const catalogPartId = e.dataTransfer?.getData('catalogPartId') || null;

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

            const target = tablePointFromClient(e.clientX, e.clientY);
            if (!target) return;
            placeComponentSafely(type, target, catalogPartId);
            if (catalogPartId) setPendingCatalogPlacement(null);
        };

        const handleClick = (e: MouseEvent) => {
            if (!pendingCatalogPlacement) return;
            e.preventDefault();
            e.stopPropagation();
            const target = tablePointFromClient(e.clientX, e.clientY);
            if (!target) return;
            haptic.tap();
            placeComponentSafely(pendingCatalogPlacement.componentType, target, pendingCatalogPlacement.catalogPartId);
            setPendingCatalogPlacement(null);
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setPendingCatalogPlacement(null);
        };

        const targetEl = gl.domElement.parentElement || gl.domElement;
        targetEl.addEventListener('dragover', handleDragOver);
        targetEl.addEventListener('drop', handleDrop);
        targetEl.addEventListener('click', handleClick, true);
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            targetEl.removeEventListener('dragover', handleDragOver);
            targetEl.removeEventListener('drop', handleDrop);
            targetEl.removeEventListener('click', handleClick, true);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [camera, gl, setComponents, pushUndo, activeZ, setRailPlacement, setPinnedViewers, haptic, pendingCatalogPlacement, setPendingCatalogPlacement]);

    return null;
};
