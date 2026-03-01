/**
 * AxisGuideLines — Visual axis guide lines shown in the 3D viewport
 * when drag axis locking is active and a component is selected.
 *
 * Renders a dashed line through the selected component's position
 * along the locked axis direction. The line extends ±500mm.
 */
import React from 'react';
import { useAtomValue } from 'jotai';
import { componentsAtom, selectionAtom, dragAxisLockAtom } from '../state/store';
import { Line } from '@react-three/drei';

export const AxisGuideLines: React.FC = () => {
    const components = useAtomValue(componentsAtom);
    const selection = useAtomValue(selectionAtom);
    const axisLock = useAtomValue(dragAxisLockAtom);

    if (axisLock === 'free' || selection.length === 0) return null;

    const selected = components.find(c => c.id === selection[0]);
    if (!selected || !selected.position) return null;

    const pos = selected.position;
    const extent = 500;

    const points: [number, number, number][] = axisLock === 'x'
        ? [[pos.x - extent, pos.y, 0], [pos.x + extent, pos.y, 0]]
        : [[pos.x, pos.y - extent, 0], [pos.x, pos.y + extent, 0]];

    const color = axisLock === 'x' ? '#ff4444' : '#44ff44';

    return (
        <Line
            points={points}
            color={color}
            lineWidth={1}
            dashed
            dashSize={3}
            gapSize={2}
            opacity={0.4}
            transparent
        />
    );
};
