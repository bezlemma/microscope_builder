import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Vector2, Vector3, DoubleSide, BufferGeometry, Float32BufferAttribute } from 'three';
import { useAtom } from 'jotai';
import { componentsAtom, rayConfigAtom, selectionAtom } from '../state/store';
import { Ray, Coherence } from '../physics/types';
import { OpticalComponent } from '../physics/Component';
import { Solver1 } from '../physics/Solver1';
import { Mirror } from '../physics/components/Mirror';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Laser } from '../physics/components/Laser';
import { Blocker } from '../physics/components/Blocker';
import { Card } from '../physics/components/Card';
import { Sample } from '../physics/components/Sample';
import { Objective } from '../physics/components/Objective';
import { ObjectiveCasing } from '../physics/components/ObjectiveCasing';
import { IdealLens } from '../physics/components/IdealLens';
import { Camera } from '../physics/components/Camera';
import { PointSource } from '../physics/components/PointSource';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { PrismLens } from '../physics/components/PrismLens';
import { RayVisualizer } from './RayVisualizer';
import { Draggable } from './Draggable';


// Visualization components
export const CasingVisualizer = ({ component }: { component: ObjectiveCasing }) => {
    const [selection, setSelection] = useAtom(selectionAtom);
    const isSelected = selection === component.id;
    return (
        <group 
            position={[component.position.x, component.position.y, component.position.z]} 
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
            {/* Transparent Housing - Glassy */}
             <mesh rotation={[Math.PI / 2, 0, 0]}> 
                <cylinderGeometry args={[8, 8, 20, 32]} />
                 <meshPhysicalMaterial 
                    color="#ffffff" 
                    transmission={0.99} 
                    opacity={0.15} 
                    transparent 
                    depthWrite={false}
                    roughness={0} 
                    metalness={0.05}
                    side={DoubleSide}
                />
            </mesh>
             {/* Grip Ring - Centered or towards rear */}
             <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -5, 0]}>
                 <cylinderGeometry args={[8.2, 8.2, 5, 32]} />
                 <meshStandardMaterial color="#444" metalness={0.5} roughness={0.7} />
             </mesh>
             
            {isSelected && (
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                     <cylinderGeometry args={[8.5, 8.5, 20.5, 32]} />
                     <meshBasicMaterial color="#64ffda" transparent opacity={0.3} wireframe />
                </mesh>
            )}
        </group>
    );
};

// Sample Visualizer (Sample Holder)
export const SampleVisualizer = ({ component }: { component: Sample }) => {
    const [, setSelection] = useAtom(selectionAtom);
    
    // Frame Dimensions
    const outerSize = 40;
    const innerSize = 30;
    const thickness = 2;
    const frameWidth = (outerSize - innerSize) / 2; // 5mm
    
    // Helpers
    const offset = outerSize / 2 - frameWidth / 2; // 17.5
    
    return (
        <group 
            position={[component.position.x, component.position.y, component.position.z]} 
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
            {/* Detailed Hollow Frame */}
            <group>
                {/* Top Bar */}
                <mesh position={[0, offset, 0]}>
                    <boxGeometry args={[outerSize, frameWidth, thickness]} />
                    <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
                </mesh>
                {/* Bottom Bar */}
                <mesh position={[0, -offset, 0]}>
                    <boxGeometry args={[outerSize, frameWidth, thickness]} />
                    <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
                </mesh>
                 {/* Left Bar */}
                <mesh position={[-offset, 0, 0]}>
                    <boxGeometry args={[frameWidth, innerSize, thickness]} />
                    <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
                </mesh>
                {/* Right Bar */}
                 <mesh position={[offset, 0, 0]}>
                    <boxGeometry args={[frameWidth, innerSize, thickness]} />
                    <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
                </mesh>
            </group>

            {/* Glass Pane - Hollow effect */}
            <mesh position={[0, 0, 0]}>
                 <boxGeometry args={[innerSize, innerSize, 0.5]} />
                 <meshPhysicalMaterial 
                    color="#ffffff"
                    transmission={0.99}
                    opacity={0.1}
                    transparent
                    roughness={0}
                    metalness={0.0}
                    depthWrite={false} // Prevent sorting issues with other glass components?
                 />
            </mesh>

            {/* Mickey Mouse Geometry inside the window */}
            <group position={[0, 0, 0]}>
                {/* Head */}
                <mesh position={[0, 0, 0]}>
                    <sphereGeometry args={[0.5, 32, 32]} />
                    <meshStandardMaterial color="#ffccaa" roughness={0.3} />
                </mesh>
                {/* Ears */}
                <mesh position={[-0.5, 0.5, 0]}>
                    <sphereGeometry args={[0.25, 32, 32]} />
                    <meshStandardMaterial color="black" roughness={0.3} />
                </mesh>
                <mesh position={[0.5, 0.5, 0]}>
                    <sphereGeometry args={[0.25, 32, 32]} />
                    <meshStandardMaterial color="black" roughness={0.3} />
                </mesh>
            </group>
        </group>
    );
};

// Dynamic Lens Visualizer - Generating Truth from Physics
// Renders the exact profile defined by SphericalLens properties (R1, R2, Thickness, Aperture)
const DynamicLens = ({ component, noRotation = false }: { component: SphericalLens, noRotation?: boolean }) => {
    // Generate profile points for LatheGeometry — use the same function as LensVisualizer
    const points = useMemo(() => {
        const { r1, r2, thickness, apertureRadius, curvature, ior } = component;
        
        // Determine Radii (Fallback to symmetric if R1/R2 missing)
        let R1 = r1;
        let R2 = r2;
        
        if (R1 === undefined || R2 === undefined) {
             const R = (Math.abs(curvature) > 1e-6) ? (2 * (ior - 1)) / curvature : Infinity;
             R1 = R;
             R2 = -R;
        }

        // Single source of truth: SphericalLens.generateProfile handles
        // surface crossover detection and avoids zero-thickness slivers
        const profile = SphericalLens.generateProfile(
            R1 ?? 1e9, R2 ?? -1e9, apertureRadius, thickness, 32
        );
        
        return profile.length >= 2 ? profile : [
            new Vector2(0, -thickness / 2),
            new Vector2(apertureRadius, -thickness / 2),
            new Vector2(apertureRadius, thickness / 2),
            new Vector2(0, thickness / 2)
        ];
    }, [component]);

    // Color based on material (Crown vs Flint ior?)
    const color = component.ior > 1.6 ? "#aaaaff" : "#ccffff"; // Simple heuristic for visual distinction

    // When used standalone, rotate Lathe (Y-axis symmetry) to Optical Axis (Z).
    // When inside Objective/compound component, noRotation=true since parent handles rotation.
    return (
        <mesh rotation={noRotation ? [0, 0, 0] : [Math.PI/2, 0, 0]}>
            <latheGeometry args={[points, 32]} />
            <meshPhysicalMaterial 
                color={color} 
                transmission={0.99} 
                opacity={0.6} 
                transparent 
                roughness={0} 
                side={2} 
            />
        </mesh>
    );
};

export const ObjectiveVisualizer = ({ component }: { component: Objective }) => {
    const [selection, setSelection] = useAtom(selectionAtom);
    const isSelected = selection === component.id;
    const a = component.apertureRadius;
    const wd = component.workingDistance;

    const mainLine = useMemo(() =>
        new Float32Array([0, -a, 0, 0, a, 0]), [a]);

    return (
        <group 
            position={[component.position.x, component.position.y, component.position.z]} 
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
            {/* Vertical line at principal plane */}
            <line>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[mainLine, 3]} />
                </bufferGeometry>
                <lineBasicMaterial color="#b388ff" linewidth={2} />
            </line>

            {/* Working Distance cylinder */}
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -wd / 2]}>
                <cylinderGeometry args={[a * 0.8, a * 1.2, wd, 16, 1, true]} />
                <meshBasicMaterial color="#b388ff" transparent opacity={isSelected ? 0.25 : 0.08} side={DoubleSide} />
            </mesh>

            {/* Invisible hitbox for selection */}
            <mesh>
                <planeGeometry args={[wd, a * 2]} />
                <meshBasicMaterial transparent opacity={0} side={DoubleSide} />
            </mesh>

            {/* Selection highlight */}
            {isSelected && (
                <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -wd / 2]}>
                     <cylinderGeometry args={[a * 1.3, a * 1.3, wd + 2, 16]} />
                     <meshBasicMaterial color="#b388ff" transparent opacity={0.15} wireframe />
                </mesh>
            )}
        </group>
    );
};

export const CameraVisualizer = ({ component }: { component: Camera }) => {
    const [, setSelection] = useAtom(selectionAtom);
    const width = 25; 
    const height = 25;
    const depth = 50;

    return (
        <group 
            position={[component.position.x, component.position.y, component.position.z]} 
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
             {/* Camera Body (Box) - centered */}
             <mesh position={[0, 0, 0]}> 
                <boxGeometry args={[width, height, depth]} />
                <meshStandardMaterial color="#333" metalness={0.6} roughness={0.4} />
             </mesh>
             
             {/* Sensor Face (Blue) - at front of centered body */}
             <mesh position={[0, 0, depth/2 + 0.1]}>
                 <planeGeometry args={[width * 0.8, height * 0.8]} />
                 <meshStandardMaterial color="#224" metalness={0.9} roughness={0.1} />
             </mesh>
        </group>
    );
};
export const MirrorVisualizer = ({ component }: { component: Mirror }) => {
    const [, setSelection] = useAtom(selectionAtom);
    const radius = component.width / 2; 
    return (
        <group 
            position={[component.position.x, component.position.y, component.position.z]} 
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
            <mesh rotation={[0, 0, Math.PI/2]}>
                <cylinderGeometry args={[radius, radius, 2, 32]} />
                {/* Shiny Metric Material */}
                <meshPhysicalMaterial 
                    color="#ffffff" 
                    metalness={0.95} 
                    roughness={0.05} 
                    clearcoat={1.0}
                    clearcoatRoughness={0.05}
                />
            </mesh>
        </group>
    );
};

export const BlockerVisualizer = ({ component }: { component: Blocker }) => {
    const [, setSelection] = useAtom(selectionAtom);
    const radius = component.width / 2;
    return (
        <group 
            position={[component.position.x, component.position.y, component.position.z]} 
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
            <mesh rotation={[0, 0, Math.PI/2]}>
                <cylinderGeometry args={[radius, radius, component.depth, 32]} />
                <meshStandardMaterial color="#222" roughness={0.8} />
            </mesh>
        </group>
    );
};

export const CardVisualizer = ({ component }: { component: Card }) => {
    const [, setSelection] = useAtom(selectionAtom);
    return (
        <group 
            position={[component.position.x, component.position.y, component.position.z]} 
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
            {/* White Screen */}
            <mesh>
                <boxGeometry args={[component.width, component.height, 1]} /> 
                <meshStandardMaterial color="white" roughness={0.5} emissive="white" emissiveIntensity={0.1} />
            </mesh>
        </group>
    );
};

export const LensVisualizer = ({ component }: { component: SphericalLens }) => {
    const [selection, setSelection] = useAtom(selectionAtom);
    const isSelected = selection === component.id;
    
    // Safety check for malformed components
    if (!component || !component.rotation || !component.position) return null;

    // Safety defaults
    const aperture = component.apertureRadius || 10; 
    const thickness = component.thickness || 2;
    
    // Get Radii (Asymmetric support)
    let R1 = 1e9; // Default flat
    let R2 = -1e9;
    
    try {
        if (typeof component.getRadii === 'function') {
            const r = component.getRadii();
            // Validate Radii - use large number for Infinity to simplify math logic below
            R1 = (!isNaN(r.R1) && Math.abs(r.R1) < 1e12) ? r.R1 : (r.R1 > 0 ? 1e9 : -1e9);
            R2 = (!isNaN(r.R2) && Math.abs(r.R2) < 1e12) ? r.R2 : (r.R2 > 0 ? 1e9 : -1e9);
        } else {
            // Fallback
            const power = component.curvature || 0;
            const ior = component.ior || 1.5;
            const R = Math.abs(power) > 1e-6 ? (2 * (ior - 1)) / power : 1e9;
            R1 = R;
            R2 = -R;
        }
    } catch (e) {
        console.warn("LensVisualizer: Error getting radii", e);
    }

    // Generate profile using the SAME function as the physics mesh — single source of truth
    const profilePoints = useMemo(() => {
        const profile = SphericalLens.generateProfile(R1, R2, aperture, thickness, 32);
        
        // Safety: ensure at least 2 points to avoid Lathe crash
        if (profile.length < 2) {
            const frontApex = -thickness / 2;
            const backApex = thickness / 2;
            return [new Vector2(0, frontApex), new Vector2(aperture, frontApex), new Vector2(aperture, backApex), new Vector2(0, backApex)];
        }
        
        return profile;
    }, [aperture, thickness, R1, R2]);

    return (
        <group 
            position={[component.position.x, component.position.y, component.position.z]} 
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
            {/* Lens body - LatheGeometry for accurate spherical cap profile */}
            {/* Rotate Lathe (Y-axis symmetry) to Optical Axis (Z-axis) */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <latheGeometry args={[profilePoints, 32]} />
                <meshPhysicalMaterial 
                    color={component.ior > 1.55 ? "#88ffee" : "#aaddff"}
                    transmission={isSelected ? 0.85 : 0.95} 
                    opacity={isSelected ? 0.6 : 0.4}
                    transparent
                    roughness={0} 
                    metalness={0}
                    ior={component.ior || 1.5}
                    side={DoubleSide}
                    emissive={isSelected ? "#64ffda" : "#000000"}
                    emissiveIntensity={isSelected ? 0.15 : 0}
                />
            </mesh>
        </group>
    );
};

export const SourceVisualizer = ({ component }: { component: OpticalComponent }) => {
    const [, setSelection] = useAtom(selectionAtom);
    return (
        <group 
            position={[component.position.x, component.position.y, component.position.z]} 
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
             {/* Laser Box Body - centered */}
             <mesh position={[0, 0, 0]}> 
                <boxGeometry args={[50, 25, 25]} />
                <meshStandardMaterial color="#222" metalness={0.5} roughness={0.5} />
             </mesh>
             {/* Aperture Ring - at emission end (+X) */}
             <mesh position={[27, 0, 0]} rotation={[0, 0, Math.PI/2]}>
                 <cylinderGeometry args={[4, 4, 4, 16]} />
                 <meshStandardMaterial color="#666" />
             </mesh>
             {/* Emission Point */}
             <mesh position={[29, 0, 0]}>
                 <sphereGeometry args={[1, 16, 16]} />
                 <meshBasicMaterial color="lime" />
             </mesh>
        </group>
    );
};

// Point Source Visualizer - for demonstrating infinity correction
export const PointSourceVisualizer = ({ component }: { component: PointSource }) => {
    const [selection, setSelection] = useAtom(selectionAtom);
    const isSelected = selection === component.id;
    
    return (
        <group 
            position={[component.position.x, component.position.y, component.position.z]} 
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
            {/* Glowing point source - small sphere */}
            <mesh>
                <sphereGeometry args={[1.5, 32, 32]} />
                <meshBasicMaterial color="#00ff88" />
            </mesh>
            {/* Outer glow ring */}
            <mesh>
                <sphereGeometry args={[2.5, 16, 16]} />
                <meshBasicMaterial color="#00ff88" transparent opacity={0.3} />
            </mesh>
            {/* Selection indicator */}
            {isSelected && (
                <mesh>
                    <sphereGeometry args={[4, 16, 16]} />
                    <meshBasicMaterial color="#64ffda" wireframe transparent opacity={0.5} />
                </mesh>
            )}
        </group>
    );
};

// Ideal Lens Visualizer — textbook thin-lens diagram
// Thin vertical line with arrowheads: inward for converging, outward for diverging
const IdealLensVisualizer = ({ component }: { component: IdealLens }) => {
    const a = component.apertureRadius;
    const converging = component.focalLength > 0;
    const color = converging ? '#64ffda' : '#ff6b9d';

    const mainLine = useMemo(() =>
        new Float32Array([0, -a, 0, 0, a, 0]), [a]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={[component.rotation.x, component.rotation.y, component.rotation.z, component.rotation.w]}
        >
            {/* Main vertical line */}
            <line>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[mainLine, 3]} />
                </bufferGeometry>
                <lineBasicMaterial color={color} linewidth={2} />
            </line>
            {/* Invisible hitbox for selection */}
            <mesh>
                <planeGeometry args={[2, a * 2]} />
                <meshBasicMaterial transparent opacity={0} side={DoubleSide} />
            </mesh>
        </group>
    );
};

// Cylindrical Lens Visualizer — curved in Y, flat in X, matching physics profile
export const CylindricalLensVisualizer = ({ component }: { component: CylindricalLens }) => {
    const [selection, setSelection] = useAtom(selectionAtom);
    const isSelected = selection === component.id;
    if (!component || !component.rotation || !component.position) return null;

    const geometry = useMemo(() => {
        const segsY = 24;
        const segsX = 2;
        const halfW = component.width / 2;
        const R1 = component.r1;
        const R2 = component.r2;
        const thickness = component.thickness;
        const maxY = component.apertureRadius;

        // Sag functions (same as physics)
        const sagFront = (y: number) => {
            const frontApex = -thickness / 2;
            if (Math.abs(R1) > 1e8) return frontApex;
            const val = R1 * R1 - y * y;
            if (val < 0) return frontApex;
            return (frontApex + R1) - (R1 > 0 ? 1 : -1) * Math.sqrt(val);
        };
        const sagBack = (y: number) => {
            const backApex = thickness / 2;
            if (Math.abs(R2) > 1e8) return backApex;
            const val = R2 * R2 - y * y;
            if (val < 0) return backApex;
            return (backApex + R2) - (R2 > 0 ? 1 : -1) * Math.sqrt(val);
        };

        const positions: number[] = [];
        const indices: number[] = [];
        const yCount = segsY + 1;

        // Front face (curved)
        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (component.width * xi) / segsX;
            for (let yi = 0; yi <= segsY; yi++) {
                const y = -maxY + (2 * maxY * yi) / segsY;
                positions.push(x, y, sagFront(Math.abs(y)));
            }
        }
        // Back face (flat or curved)
        const backOff = (segsX + 1) * yCount;
        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (component.width * xi) / segsX;
            for (let yi = 0; yi <= segsY; yi++) {
                const y = -maxY + (2 * maxY * yi) / segsY;
                positions.push(x, y, sagBack(Math.abs(y)));
            }
        }

        // Front face tris
        for (let xi = 0; xi < segsX; xi++) {
            for (let yi = 0; yi < segsY; yi++) {
                const a = xi * yCount + yi;
                const b = (xi + 1) * yCount + yi;
                const c = (xi + 1) * yCount + (yi + 1);
                const d = xi * yCount + (yi + 1);
                indices.push(a, b, c, a, c, d);
            }
        }
        // Back face tris (reversed winding)
        for (let xi = 0; xi < segsX; xi++) {
            for (let yi = 0; yi < segsY; yi++) {
                const a = backOff + xi * yCount + yi;
                const b = backOff + (xi + 1) * yCount + yi;
                const c = backOff + (xi + 1) * yCount + (yi + 1);
                const d = backOff + xi * yCount + (yi + 1);
                indices.push(a, c, b, a, d, c);
            }
        }

        // Side walls: top, bottom, left, right
        // Top wall (y = maxY)
        const topOff = positions.length / 3;
        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (component.width * xi) / segsX;
            positions.push(x, maxY, sagFront(maxY));
            positions.push(x, maxY, sagBack(maxY));
        }
        for (let xi = 0; xi < segsX; xi++) {
            const a = topOff + xi * 2, b = topOff + (xi + 1) * 2;
            const c = topOff + (xi + 1) * 2 + 1, d = topOff + xi * 2 + 1;
            indices.push(a, b, c, a, c, d);
        }
        // Bottom wall (y = -maxY)
        const botOff = positions.length / 3;
        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (component.width * xi) / segsX;
            positions.push(x, -maxY, sagFront(maxY));
            positions.push(x, -maxY, sagBack(maxY));
        }
        for (let xi = 0; xi < segsX; xi++) {
            const a = botOff + xi * 2, b = botOff + (xi + 1) * 2;
            const c = botOff + (xi + 1) * 2 + 1, d = botOff + xi * 2 + 1;
            indices.push(a, c, b, a, d, c);
        }
        // Left wall (x = -halfW)
        const leftOff = positions.length / 3;
        for (let yi = 0; yi <= segsY; yi++) {
            const y = -maxY + (2 * maxY * yi) / segsY;
            positions.push(-halfW, y, sagFront(Math.abs(y)));
            positions.push(-halfW, y, sagBack(Math.abs(y)));
        }
        for (let yi = 0; yi < segsY; yi++) {
            const a = leftOff + yi * 2, b = leftOff + (yi + 1) * 2;
            const c = leftOff + (yi + 1) * 2 + 1, d = leftOff + yi * 2 + 1;
            indices.push(a, c, b, a, d, c);
        }
        // Right wall (x = +halfW)
        const rightOff = positions.length / 3;
        for (let yi = 0; yi <= segsY; yi++) {
            const y = -maxY + (2 * maxY * yi) / segsY;
            positions.push(halfW, y, sagFront(Math.abs(y)));
            positions.push(halfW, y, sagBack(Math.abs(y)));
        }
        for (let yi = 0; yi < segsY; yi++) {
            const a = rightOff + yi * 2, b = rightOff + (yi + 1) * 2;
            const c = rightOff + (yi + 1) * 2 + 1, d = rightOff + yi * 2 + 1;
            indices.push(a, b, c, a, c, d);
        }

        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        return geo;
    }, [component.r1, component.r2, component.apertureRadius, component.width, component.thickness]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
            <mesh geometry={geometry}>
                <meshPhysicalMaterial
                    color="#ccffff"
                    transmission={0.99}
                    opacity={0.6}
                    transparent
                    roughness={0}
                    side={2}
                />
            </mesh>
        </group>
    );
};

// Prism Visualizer — triangular cross-section extruded along X
export const PrismVisualizer = ({ component }: { component: PrismLens }) => {
    const [selection, setSelection] = useAtom(selectionAtom);
    const isSelected = selection === component.id;
    if (!component || !component.rotation || !component.position) return null;

    const halfAngle = component.apexAngle / 2;
    const baseHalfWidth = component.height * Math.tan(halfAngle);
    const centroidY = component.height / 3;
    const halfW = component.width / 2;

    const geometry = useMemo(() => {
        const ay = component.height - centroidY, az = 0;
        const bly = -centroidY, blz = -baseHalfWidth;
        const bry = -centroidY, brz = baseHalfWidth;
        const positions = [
            -halfW,ay,az, -halfW,bly,blz, -halfW,bry,brz,
            halfW,ay,az, halfW,bly,blz, halfW,bry,brz,
            -halfW,ay,az, halfW,ay,az, -halfW,bly,blz, halfW,bly,blz,
            -halfW,ay,az, halfW,ay,az, -halfW,bry,brz, halfW,bry,brz,
            -halfW,bly,blz, halfW,bly,blz, -halfW,bry,brz, halfW,bry,brz,
        ];
        const indices = [0,2,1, 3,4,5, 6,8,7, 7,8,9, 10,11,12, 11,13,12, 14,15,16, 15,17,16];
        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        return geo;
    }, [component.apexAngle, component.height, component.width]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
            <mesh geometry={geometry}>
                <meshPhysicalMaterial
                    color="#ccffff"
                    transmission={0.99}
                    opacity={0.6}
                    transparent
                    roughness={0}
                    side={2}
                />
            </mesh>
        </group>
    );
};

export const OpticalTable: React.FC = () => {
    const [components] = useAtom(componentsAtom);
    const [rayConfig] = useAtom(rayConfigAtom);
    const [rays, setRays] = useState<Ray[][]>([]);

    useEffect(() => {
        if (!components) return;

        const solver = new Solver1(components);
        
        // Find ALL source components (support multiple lasers and point sources)
        const laserComps = components.filter(c => c instanceof Laser) as Laser[];
        const pointSourceComps = components.filter(c => c instanceof PointSource) as PointSource[];
        
        const sourceRays: Ray[] = [];
        
        // Generate rays from every Laser
        for (const laserComp of laserComps) {
            let origin = laserComp.position.clone();
            const direction = new Vector3(1,0,0).applyQuaternion(laserComp.rotation).normalize();
            
            // Offset origin slightly so it starts "outside" the box 
            const offset = direction.clone().multiplyScalar(5);
            origin.add(offset);
            
            const laserWavelength = laserComp.wavelength * 1e-9;
            const beamRadius = laserComp.beamRadius;
            
            // Central Ray
            sourceRays.push({
                origin: origin.clone(),
                direction: direction.clone(),
                wavelength: laserWavelength, intensity: 1, polarization: {x:{re:1,im:0},y:{re:0,im:0}}, opticalPathLength: 0, footprintRadius: 0, coherenceMode: Coherence.Coherent
            });
            
            // Hierarchical ray distribution using binary subdivision:
            //   Ring 0: 24 rays at full beam radius (marginal rays)
            //   Ring 1+: 12 rays each at radii that fill gaps via binary subdivision
            //     Sequence: 1/2, 1/4, 3/4, 1/8, 3/8, 5/8, 7/8, ...
            // Each ring is angularly offset so projected 2D lines don't overlap.
            const totalRays = Math.max(1, rayConfig.rayCount);
            const FIRST_RING_COUNT = Math.min(24, totalRays);
            const INNER_RING_COUNT = 12;
            
            // Build radius fractions via breadth-first binary subdivision:
            // Level 0: [1/2]  Level 1: [1/4, 3/4]  Level 2: [1/8, 3/8, 5/8, 7/8] ...
            const radiusFractions: number[] = [1]; // ring 0 = marginal (full radius)
            let subdivLevel = 1;
            while (radiusFractions.length < 100) { // generate enough levels
                const denom = 1 << subdivLevel; // 2, 4, 8, 16, ...
                for (let k = 1; k < denom; k += 2) { // odd numerators only
                    radiusFractions.push(k / denom);
                }
                subdivLevel++;
            }
            
            // Basis Vectors for the aperture plane
            const up = new Vector3(0, 1, 0); 
            if (Math.abs(direction.dot(up)) > 0.9) {
                 up.set(0, 0, 1); 
            }
            const right = new Vector3().crossVectors(direction, up).normalize();
            const trueUp = new Vector3().crossVectors(right, direction).normalize();
            
            let raysPlaced = 0;
            let ringIndex = 0;
            while (raysPlaced < totalRays && ringIndex < radiusFractions.length) {
                const ringRadius = beamRadius * radiusFractions[ringIndex];
                const raysForThisRing = ringIndex === 0 ? FIRST_RING_COUNT : INNER_RING_COUNT;
                const raysThisRing = Math.min(raysForThisRing, totalRays - raysPlaced);
                
                // Angular offset per ring to avoid 2D line overlap
                const angularOffset = ringIndex * Math.PI / 7; // golden-ish rotation
                
                for (let i = 0; i < raysThisRing; i++) {
                    const phi = angularOffset + (i / raysForThisRing) * Math.PI * 2;

                    const ringOffset = new Vector3()
                        .addScaledVector(trueUp, Math.sin(phi) * ringRadius)
                        .addScaledVector(right, Math.cos(phi) * ringRadius);

                    sourceRays.push({
                        origin: origin.clone().add(ringOffset),
                        direction: direction.clone().normalize(),
                        wavelength: laserWavelength, intensity: 1, polarization: {x:{re:1,im:0},y:{re:0,im:0}}, opticalPathLength: 0, footprintRadius: 0, coherenceMode: Coherence.Coherent
                    });
                    raysPlaced++;
                }
                ringIndex++;
            }
        }
        
        // Generate rays from every PointSource
        for (const pointSourceComp of pointSourceComps) {
            const psRays = pointSourceComp.generateRays();
            for (const r of psRays) {
                sourceRays.push({
                    ...r,
                    polarization: {x:{re:1,im:0},y:{re:0,im:0}},
                    footprintRadius: 0,
                    coherenceMode: Coherence.Coherent
                });
            }
        }

        const calculatedPaths = solver.trace(sourceRays);
        setRays(calculatedPaths);

    }, [components, rayConfig]);

    return (
        <group>
            {components.map(c => {
                let visual = null;
                if (c instanceof Mirror) visual = <MirrorVisualizer component={c} />;
                else if (c instanceof ObjectiveCasing) visual = <CasingVisualizer component={c} />;
                else if (c instanceof Objective) visual = <ObjectiveVisualizer component={c} />; 
                else if (c instanceof IdealLens) visual = <IdealLensVisualizer component={c} />;
                else if (c instanceof SphericalLens) visual = <LensVisualizer component={c} />;
                else if (c instanceof Laser) visual = <SourceVisualizer component={c} />;
                else if (c instanceof Blocker) visual = <BlockerVisualizer component={c} />;
                else if (c instanceof Card) visual = <CardVisualizer component={c} />;
                else if (c instanceof Sample) visual = <SampleVisualizer component={c} />;
                else if (c instanceof Camera) visual = <CameraVisualizer component={c} />;
                else if (c instanceof PointSource) visual = <PointSourceVisualizer component={c} />;
                else if (c instanceof CylindricalLens) visual = <CylindricalLensVisualizer component={c} />;
                else if (c instanceof PrismLens) visual = <PrismVisualizer component={c} />;
                
                if (visual) {
                    return (
                        <group key={c.id}>
                            <Draggable component={c}>
                                {visual}
                            </Draggable>
                        </group>
                    );
                }
                return null;
            })}
            <RayVisualizer paths={rays} />
        </group>
    );
};
