import React from 'react';
import { Line } from '@react-three/drei';
import { Vector3 } from 'three';
import { Ray } from '../physics/types';

// Wavelength (in meters) to visible spectrum color
function wavelengthToColor(wavelengthMeters: number): { color: string; isVisible: boolean } {
    const wavelength = wavelengthMeters * 1e9; // Convert to nm
    let r = 0, g = 0, b = 0;
    
    if (wavelength >= 380 && wavelength < 440) {
        r = -(wavelength - 440) / (440 - 380);
        b = 1.0;
    } else if (wavelength >= 440 && wavelength < 490) {
        g = (wavelength - 440) / (490 - 440);
        b = 1.0;
    } else if (wavelength >= 490 && wavelength < 510) {
        g = 1.0;
        b = -(wavelength - 510) / (510 - 490);
    } else if (wavelength >= 510 && wavelength < 580) {
        r = (wavelength - 510) / (580 - 510);
        g = 1.0;
    } else if (wavelength >= 580 && wavelength < 645) {
        r = 1.0;
        g = -(wavelength - 645) / (645 - 580);
    } else if (wavelength >= 645 && wavelength <= 780) {
        r = 1.0;
    }
    
    // Apply intensity correction for edge wavelengths
    let factor = 1.0;
    if (wavelength >= 380 && wavelength < 420) {
        factor = 0.3 + 0.7 * (wavelength - 380) / (420 - 380);
    } else if (wavelength >= 645 && wavelength <= 780) {
        factor = 0.3 + 0.7 * (780 - wavelength) / (780 - 645);
    } else if (wavelength < 380 || wavelength > 780) {
        // UV or IR - gray color
        return { color: '#888888', isVisible: false };
    }
    
    r = Math.round(255 * Math.pow(r * factor, 0.8));
    g = Math.round(255 * Math.pow(g * factor, 0.8));
    b = Math.round(255 * Math.pow(b * factor, 0.8));
    
    return { color: `rgb(${r}, ${g}, ${b})`, isVisible: true };
}

interface RayVisualizerProps {
    paths: Ray[][];
}


export const RayVisualizer: React.FC<RayVisualizerProps> = ({ paths }) => {
    
    return (
        <group>
            {paths.map((path, pathIdx) => {
                // Build points array, inserting entryPoint before origin when present
                // This ensures visualization draws: prev→entryPoint→origin→next
                const points: Vector3[] = [];
                for (const r of path) {
                    if (r.entryPoint) {
                        points.push(r.entryPoint);
                    }
                    points.push(r.origin);
                }
                
                // Add an "infinite" end to the last ray for visualization
                if (path.length > 0) {
                    const lastRay = path[path.length - 1];
                    const dist = lastRay.interactionDistance ?? 1000;
                    const endPoint = lastRay.origin.clone().add(lastRay.direction.clone().multiplyScalar(dist));
                    points.push(endPoint);
                }

                // Get color from first ray's wavelength
                const wavelength = path.length > 0 ? path[0].wavelength : 532e-9;
                const { color, isVisible } = wavelengthToColor(wavelength);

                return (
                    <Line
                        key={pathIdx}
                        points={points}
                        color={color}
                        lineWidth={2}
                        dashed={!isVisible}
                        dashSize={isVisible ? undefined : 3}
                        gapSize={isVisible ? undefined : 2}
                        depthTest={true}
                    />
                );
            })}
        </group>
    );
};
