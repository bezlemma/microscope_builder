import React from 'react';
import { Line } from '@react-three/drei';
import { Vector3 } from 'three';
import { Ray } from '../physics/types';

interface RayVisualizerProps {
    paths: Ray[][];
}

export const RayVisualizer: React.FC<RayVisualizerProps> = ({ paths }) => {
    return (
        <group>
            {paths.map((path, pathIdx) => {
                // Convert Ray[] to Point[] for Line
                // Problem: Ray has Origin, but where does it END?
                // The Path corresponds to segments:
                // Segment 0: Path[0].origin -> Path[1].origin
                // Last segment: Path[last].origin -> Path[last].origin + direction * length?
                // Solver1 needs to be updated to populate "end points" or we deduce them.
                // Current Solver1 implementation pushes *Child Rays* to the path.
                // So Path[0] is source. Path[1] is result of 1st interaction (starts at hit).
                // So segment is P[0].origin -> P[1].origin.
                
                const points = path.map(r => r.origin);
                
                // Add an "infinite" end to the last ray for visualization
                if (path.length > 0) {
                    const lastRay = path[path.length - 1];
                    const dist = lastRay.interactionDistance ?? 1000;
                    const endPoint = lastRay.origin.clone().add(lastRay.direction.clone().multiplyScalar(dist));
                    points.push(endPoint);
                }

                return (
                    <Line
                        key={pathIdx}
                        points={points}
                        color={pathIdx === 0 ? "white" : "green"} // Color code?
                        lineWidth={1}
                    />
                );
            })}
        </group>
    );
};
