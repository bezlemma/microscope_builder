import React, { useState, useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { useAtom } from 'jotai';
import { componentsAtom, pushUndoAtom, railPlacementAtom } from '../state/store';
import { Vector2, Vector3, Plane, Raycaster, DoubleSide } from 'three';
import { Rail } from '../physics/components/Rail';
import { Annotation } from '../physics/components/Annotation';

/** Grid spacing for the optical table holes (mm). */
const GRID_SPACING = 25;
const HOLE_OFFSET = 12.5;
const TABLE_Z = Rail.TABLE_Z;

/** Snap an XY position to the nearest hole on the 25mm grid. */
function snapToHole(x: number, y: number): Vector3 {
    const snappedX = Math.round((x - HOLE_OFFSET) / GRID_SPACING) * GRID_SPACING + HOLE_OFFSET;
    const snappedY = Math.round((y - HOLE_OFFSET) / GRID_SPACING) * GRID_SPACING + HOLE_OFFSET;
    return new Vector3(snappedX, snappedY, TABLE_Z);
}

/**
 * RailPlacementOverlay — renders inside the R3F canvas during rail
 * placement mode. Two-click placement: first click = start hole,
 * second click = end hole.
 */
export const RailPlacementOverlay: React.FC = () => {
    const [placement, setPlacement] = useAtom(railPlacementAtom);
    const [, setComponents] = useAtom(componentsAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);
    const { camera, gl } = useThree();

    const [hoverPos, setHoverPos] = useState<Vector3 | null>(null);

    const raycastToTable = useCallback((clientX: number, clientY: number): Vector3 | null => {
        const rect = gl.domElement.getBoundingClientRect();
        const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
        const raycaster = new Raycaster();
        raycaster.setFromCamera(new Vector2(nx, ny), camera);
        const plane = new Plane(new Vector3(0, 0, 1), -TABLE_Z);
        const target = new Vector3();
        const hit = raycaster.ray.intersectPlane(plane, target);
        return hit ? target : null;
    }, [camera, gl]);

    // Mouse move — update hover indicator
    useEffect(() => {
        if (!placement.active) return;
        const handleMove = (e: PointerEvent) => {
            const worldPos = raycastToTable(e.clientX, e.clientY);
            if (!worldPos) return;
            setHoverPos(snapToHole(worldPos.x, worldPos.y));
        };
        const canvas = gl.domElement;
        canvas.addEventListener('pointermove', handleMove);
        return () => canvas.removeEventListener('pointermove', handleMove);
    }, [placement.active, placement.firstHole, gl, raycastToTable]);

    // Click — place first or second hole
    useEffect(() => {
        if (!placement.active) return;
        const handleClick = (e: PointerEvent) => {
            if (e.button !== 0) return;
            const worldPos = raycastToTable(e.clientX, e.clientY);
            if (!worldPos) return;

            if (!placement.firstHole) {
                const hole = snapToHole(worldPos.x, worldPos.y);
                setPlacement({ active: true, kind: placement.kind, firstHole: hole });
            } else {
                const endHole = snapToHole(worldPos.x, worldPos.y);
                if (endHole.distanceTo(placement.firstHole) < GRID_SPACING * 0.5) return;
                pushUndo();
                if (placement.kind === 'rail') {
                    const rail = new Rail(placement.firstHole, endHole);
                    setComponents(prev => [...prev, rail]);
                } else {
                    // Arrow / curved-arrow annotation: place at midpoint, span
                    // from start → end hole.  Keep on the table surface (z=0)
                    // and rotate so local +X (the arrow axis) points start→end.
                    const dx = endHole.x - placement.firstHole.x;
                    const dy = endHole.y - placement.firstHole.y;
                    const length = Math.hypot(dx, dy);
                    const midX = (placement.firstHole.x + endHole.x) / 2;
                    const midY = (placement.firstHole.y + endHole.y) / 2;
                    const angle = Math.atan2(dy, dx);
                    const kind = placement.kind === 'arrowAnnotation' ? 'arrow' : 'curvedArrow';
                    const ann = new Annotation(
                        kind,
                        kind === 'arrow' ? 'Arrow' : 'Curved Arrow',
                        '',
                        Math.max(5, length),
                    );
                    ann.setPosition(midX, midY, 0);
                    // Lay the annotation flat on the table with its arrow axis
                    // running along world XY at `angle`.  Pure rotation about
                    // world +Z keeps local +Z = world +Z (text upright when
                    // viewed top-down) and rotates local +X (tail→tip) onto
                    // the start→end direction.
                    ann.setRotation(0, 0, angle);
                    setComponents(prev => [...prev, ann]);
                }
                setPlacement({ active: false, kind: placement.kind, firstHole: null });
                setHoverPos(null);
            }
        };
        const canvas = gl.domElement;
        const timer = setTimeout(() => {
            canvas.addEventListener('pointerdown', handleClick);
        }, 100);
        return () => {
            clearTimeout(timer);
            canvas.removeEventListener('pointerdown', handleClick);
        };
    }, [placement.active, placement.firstHole, gl, raycastToTable, pushUndo, setComponents, setPlacement]);

    // Escape to cancel
    useEffect(() => {
        if (!placement.active) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setPlacement({ active: false, kind: placement.kind, firstHole: null });
                setHoverPos(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [placement.active, placement.kind, setPlacement]);

    if (!placement.active) return null;
    const railZ = TABLE_Z + Rail.RAIL_HEIGHT / 2;
    const isAnnotation = placement.kind !== 'rail';
    const previewColor = isAnnotation ? '#007fff' : '#64ffda';

    return (
        <group>
            {hoverPos && (
                <mesh position={[hoverPos.x, hoverPos.y, TABLE_Z + 0.2]}>
                    <ringGeometry args={[5, 8, 32]} />
                    <meshBasicMaterial color={previewColor} transparent opacity={0.8} side={DoubleSide} depthWrite={false} toneMapped={false} />
                </mesh>
            )}
            {placement.firstHole && (
                <mesh position={[placement.firstHole.x, placement.firstHole.y, TABLE_Z + 0.2]}>
                    <circleGeometry args={[6, 32]} />
                    <meshBasicMaterial color={previewColor} transparent opacity={0.9} side={DoubleSide} depthWrite={false} toneMapped={false} />
                </mesh>
            )}
            {placement.firstHole && hoverPos && (() => {
                const a = placement.firstHole;
                const b = hoverPos;
                const mid = a.clone().add(b).multiplyScalar(0.5);
                const previewZ = isAnnotation ? TABLE_Z + 0.5 : railZ;
                mid.z = previewZ;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len < 1) return null;
                const angle = Math.atan2(dy, dx);
                if (isAnnotation) {
                    // Slim arrow body preview lying on the table.
                    return (
                        <mesh position={[mid.x, mid.y, mid.z]} rotation={[0, 0, angle]}>
                            <boxGeometry args={[len, 1.5, 0.4]} />
                            <meshBasicMaterial color={previewColor} transparent opacity={0.6} depthWrite={false} toneMapped={false} />
                        </mesh>
                    );
                }
                return (
                    <mesh position={[mid.x, mid.y, mid.z]} rotation={[0, 0, angle]}>
                        <boxGeometry args={[len, 12, Rail.RAIL_HEIGHT]} />
                        <meshBasicMaterial color={previewColor} transparent opacity={0.3} depthWrite={false} toneMapped={false} />
                    </mesh>
                );
            })()}
        </group>
    );
};
