import React, { useMemo } from 'react';
import { Vector3, BufferGeometry, Float32BufferAttribute, DoubleSide, Color } from 'three';
import { GaussianBeamSegment, sampleBeamProfile } from '../physics/Solver2';

import { wavelengthToRGB as wavelengthToRGBnm } from '../physics/spectral';

/**
 * Wavelength (meters) to RGB color for beam envelope.
 */
function wavelengthToRGB(wavelengthMeters: number): { r: number; g: number; b: number } {
    const { r, g, b } = wavelengthToRGBnm(wavelengthMeters * 1e9);
    return { r, g, b };
}

const TUBE_RADIAL_SEGMENTS = 12;

/**
 * Build a tube mesh geometry from beam profile samples.
 * Creates a cylindrical tube with varying radius along the beam axis.
 */
function buildTubeGeometry(
    segment: GaussianBeamSegment,
    samples: { z: number; wx: number; wy: number }[]
): BufferGeometry {
    const geo = new BufferGeometry();
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    const dir = segment.direction.clone().normalize();
    
    // Build a local coordinate frame for the tube cross-section
    const up = new Vector3(0, 0, 1);
    if (Math.abs(dir.dot(up)) > 0.9) up.set(0, 1, 0);
    const right = new Vector3().crossVectors(dir, up).normalize();
    const trueUp = new Vector3().crossVectors(right, dir).normalize();

    const N = TUBE_RADIAL_SEGMENTS;

    for (let si = 0; si < samples.length; si++) {
        const s = samples[si];
        const center = segment.start.clone().add(dir.clone().multiplyScalar(s.z));
        
        for (let ri = 0; ri <= N; ri++) {
            const theta = (ri / N) * Math.PI * 2;
            const cos = Math.cos(theta);
            const sin = Math.sin(theta);
            
            // Elliptical cross-section using wx and wy
            const px = center.x + right.x * cos * s.wx + trueUp.x * sin * s.wy;
            const py = center.y + right.y * cos * s.wx + trueUp.y * sin * s.wy;
            const pz = center.z + right.z * cos * s.wx + trueUp.z * sin * s.wy;
            
            positions.push(px, py, pz);
            
            // Normal points outward from beam axis
            const nx = right.x * cos + trueUp.x * sin;
            const ny = right.y * cos + trueUp.y * sin;
            const nz = right.z * cos + trueUp.z * sin;
            normals.push(nx, ny, nz);
        }
    }

    // Build triangle indices
    for (let si = 0; si < samples.length - 1; si++) {
        for (let ri = 0; ri < N; ri++) {
            const curr = si * (N + 1) + ri;
            const next = (si + 1) * (N + 1) + ri;
            
            indices.push(curr, next, curr + 1);
            indices.push(curr + 1, next, next + 1);
        }
    }

    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);
    
    return geo;
}

interface BeamSegmentMeshProps {
    segment: GaussianBeamSegment;
}

const BeamSegmentMesh: React.FC<BeamSegmentMeshProps> = ({ segment }) => {
    const geometry = useMemo(() => {
        // Sample beam profile along this segment
        const samples = sampleBeamProfile(segment, 30);
        
        // Skip if beam is too small to see or too large (diverged badly)
        const maxW = Math.max(...samples.map(s => Math.max(s.wx, s.wy)));
        if (maxW < 0.01 || maxW > 500) return null;
        
        return buildTubeGeometry(segment, samples);
    }, [segment]);

    // Cleanup geometry on unmount or when it changes
    React.useEffect(() => {
        return () => {
            if (geometry) geometry.dispose();
        };
    }, [geometry]);

    const color = useMemo(() => {
        const rgb = wavelengthToRGB(segment.wavelength);
        return new Color(rgb.r, rgb.g, rgb.b);
    }, [segment.wavelength]);

    if (!geometry) return null;

    return (
        <mesh geometry={geometry}>
            <meshBasicMaterial
                color={color}
                transparent
                opacity={0.15}
                side={DoubleSide}
                depthWrite={false}
                toneMapped={false}
            />
        </mesh>
    );
};

interface BeamEnvelopeVisualizerProps {
    beamSegments: GaussianBeamSegment[][];
}

export const BeamEnvelopeVisualizer: React.FC<BeamEnvelopeVisualizerProps> = ({ beamSegments }) => {
    return (
        <group>
            {beamSegments.map((segments, bi) => 
                segments.map((seg, si) => (
                    <BeamSegmentMesh 
                        key={`beam-${bi}-${si}-${seg.wavelength}`} 
                        segment={seg} 
                    />
                ))
            )}
        </group>
    );
};
