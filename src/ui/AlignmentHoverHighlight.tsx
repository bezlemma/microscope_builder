// A glowing wireframe box around whatever component the alignment context
// menu's submenu is currently hovering. Mounts inside the Canvas so it can
// transform with the scene and stays decoupled from each visualizer.

import React from 'react';
import { useAtom } from 'jotai';
import { Box3, Vector3 } from 'three';
import { componentsAtom, hoveredAlignmentTargetAtom } from '../state/store';

export const AlignmentHoverHighlight: React.FC = () => {
    const [components] = useAtom(componentsAtom);
    const [hoveredId] = useAtom(hoveredAlignmentTargetAtom);
    if (!hoveredId) return null;
    const c = components.find(comp => comp.id === hoveredId);
    if (!c) return null;

    // Use the component's local AABB transformed by its world position+rotation.
    // We render a slightly inflated box so the outline doesn't z-fight the mesh.
    const bounds: Box3 = c.bounds;
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const pad = 4; // mm — visual breathing room
    const sx = Math.max(1, size.x + pad);
    const sy = Math.max(1, size.y + pad);
    const sz = Math.max(1, size.z + pad);

    return (
        <group position={[c.position.x, c.position.y, c.position.z]} quaternion={c.rotation.clone()}>
            <group position={[center.x, center.y, center.z]}>
                {/* Wireframe outline */}
                <mesh>
                    <boxGeometry args={[sx, sy, sz]} />
                    <meshBasicMaterial color="#64ffda" wireframe transparent opacity={0.9} depthTest={false} />
                </mesh>
                {/* Soft solid glow */}
                <mesh>
                    <boxGeometry args={[sx, sy, sz]} />
                    <meshBasicMaterial color="#64ffda" transparent opacity={0.12} depthWrite={false} />
                </mesh>
            </group>
        </group>
    );
};
