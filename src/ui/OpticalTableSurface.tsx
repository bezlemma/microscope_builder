import React, { useMemo } from 'react';
import { Instance, Instances } from '@react-three/drei';
import { DoubleSide } from 'three';

export const OpticalTableSurface: React.FC = () => {
    // Grid Setup
    const gridSize = 1000; // 1 meter table
    const spacing = 25; // 25mm grid
    const holeRadius = 4.0; // Larger for visibility
    const offset = -25; // Table surface Z position

    const instances = useMemo(() => {
        const temp = [];
        const count = Math.floor(gridSize / spacing);
        const start = -(count * spacing) / 2;

        for (let x = 0; x <= count; x++) {
            for (let y = 0; y <= count; y++) {
                temp.push({
                    position: [start + x * spacing, start + y * spacing, offset],
                    rotation: [0, 0, 0]
                });
            }
        }
        return temp;
    }, []);

    return (
        <group>
            {/* The Main Table Top */}
            <mesh position={[0, 0, offset - 5]} receiveShadow>
                <boxGeometry args={[gridSize + 50, gridSize + 50, 10]} />
                <meshBasicMaterial color="#333" />
            </mesh>
            
            {/* The Holes (Visual Only) - Using Basic Material to ensure visibility */}
            <Instances range={instances.length} position={[0,0,0.1]}>
                <circleGeometry args={[holeRadius, 32]} />
                <meshBasicMaterial color="#000" side={DoubleSide} />
                {instances.map((data, i) => (
                    <Instance key={i} position={[data.position[0], data.position[1], data.position[2]]} />
                ))}
            </Instances>
        </group>
    );
};
