import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Vector2, Vector3, DoubleSide } from 'three';
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
    // Generate profile points for LatheGeometry
    const points = useMemo(() => {
        const pts: Vector2[] = [];
        const { r1, r2, thickness, apertureRadius, curvature, ior } = component;
        
        // Determine Radii (Fallback to symmetric if R1/R2 missing)
        let R1 = r1;
        let R2 = r2;
        
        if (R1 === undefined || R2 === undefined) {
             const R = (Math.abs(curvature) > 1e-6) ? (2 * (ior - 1)) / curvature : Infinity;
             R1 = R;
             R2 = -R;
        }

        const segments = 32;
        const frontApex = -thickness / 2;
        const backApex = thickness / 2;

        // --- Front Surface Points (Bottom to Top) ---
        for (let i = 0; i <= segments; i++) {
            const y = (i / segments) * apertureRadius; // 0 to Aperture
            let z = frontApex;

            if (Math.abs(R1) < Infinity) {
                const C1 = frontApex + R1; // Center of Front Sphere
                // Sphere Eq: (z - C)^2 + y^2 = R^2
                // z = C +/- sqrt(R^2 - y^2)
                // If R1 > 0 (Convex), C1 is right, surface is left: z = C1 - sqrt
                // If R1 < 0 (Concave), C1 is left, surface is right: z = C1 + sqrt
                // Combined: z = C1 - sign(R1) * sqrt(...)
                const val = R1 * R1 - y * y;
                if (val >= 0) {
                    const sign = R1 > 0 ? 1 : -1;
                    z = C1 - sign * Math.sqrt(val);
                }
            }
            pts.push(new Vector2(y, z)); // radial -> x, axial -> y for lathe
            // LatheGeometry: points are (x, y). Rotates around Y axis.
            // We want Optical Axis (Z) is traverse.
            // Lathe creates cylinder along Y.
            // We will rotate the mesh 90 deg.
            // Let's map Optical Z -> Lathe Y. Optical Y (Radial) -> Lathe X.
            // So Point(y_optical, z_optical).
        }

        // --- Back Surface Points (Top to Bottom) ---
        for (let i = segments; i >= 0; i--) {
            const y = (i / segments) * apertureRadius;
            let z = backApex;

            if (Math.abs(R2) < Infinity) {
                const C2 = backApex + R2; // Center of Back Sphere
                // If R2 > 0 (Concave/Meniscus), C2 is right, surface is left: z = C2 - sqrt
                // If R2 < 0 (Convex), C2 is left, surface is right: z = C2 + sqrt
                // Combined: z = C2 - sign(R2) * sqrt(...)
                 const val = R2 * R2 - y * y;
                 if (val >= 0) {
                     const sign = R2 > 0 ? 1 : -1;
                     z = C2 - sign * Math.sqrt(val);
                 }
            }
            pts.push(new Vector2(y, z));
        }
        
        // Close shape? Lathe expects open path that connects axis?
        // We went 0->Aperture->0. Loop closed.
        // First point (0, frontZ). Last point (0, backZ).
        // It forms a solid cross section.
        
        return pts;
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
    const isConverging = component.focalLength > 0;
    const arrowSize = Math.min(a * 0.25, 3);

    const mainLine = useMemo(() =>
        new Float32Array([0, -a, 0, 0, a, 0]), [a]);

    const topArrowPts = useMemo(() => isConverging
        ? new Float32Array([arrowSize, a - arrowSize, 0, 0, a, 0, -arrowSize, a - arrowSize, 0])
        : new Float32Array([-arrowSize, a + arrowSize, 0, 0, a, 0, arrowSize, a + arrowSize, 0]),
    [a, arrowSize, isConverging]);

    const bottomArrowPts = useMemo(() => isConverging
        ? new Float32Array([arrowSize, -a + arrowSize, 0, 0, -a, 0, -arrowSize, -a + arrowSize, 0])
        : new Float32Array([-arrowSize, -a - arrowSize, 0, 0, -a, 0, arrowSize, -a - arrowSize, 0]),
    [a, arrowSize, isConverging]);

    return (
        <group 
            position={[component.position.x, component.position.y, component.position.z]} 
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
            {/* Main thin line */}
            <line>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[mainLine, 3]} />
                </bufferGeometry>
                <lineBasicMaterial color="#b388ff" linewidth={2} />
            </line>

            {/* Top arrowhead */}
            <line>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[topArrowPts, 3]} />
                </bufferGeometry>
                <lineBasicMaterial color="#b388ff" linewidth={2} />
            </line>

            {/* Bottom arrowhead */}
            <line>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[bottomArrowPts, 3]} />
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

    // Generate profile curve for LatheGeometry
    // Profile is in the XY plane: X = radial distance (0 to aperture), Y = thickness (along W-axis)
    const profilePoints = useMemo(() => {
        const frontPoints: Vector2[] = [];
        const backPoints: Vector2[] = [];
        const steps = 32;
        const frontApex = -thickness / 2;
        const backApex = thickness / 2;
        
        // Single loop to detect intersection
        for(let i=0; i<=steps; i++) {
            const r = (i/steps) * aperture;
            
            // Calculate Front W (local Z)
            let wFront = frontApex; 
            if (Math.abs(R1) < 1e8) {
                const val = R1*R1 - r*r;
                if (val >= 0) wFront = (frontApex + R1) - (R1>0?1:-1)*Math.sqrt(val);
            }
            
            // Calculate Back W (local Z)
            let wBack = backApex; 
            if (Math.abs(R2) < 1e8) {
                const val = R2*R2 - r*r;
                if (val >= 0) wBack = (backApex + R2) - (R2>0?1:-1)*Math.sqrt(val); 
            }
            
            // Check for intersection (Lens edge thickness <= 0)
            if (wFront >= wBack) {
                // Surfaces crossed. Lens is physically impossible at this radius.
                // Clamp to the crossing point
                const midW = (wFront + wBack) / 2;
                frontPoints.push(new Vector2(r, midW));
                backPoints.push(new Vector2(r, midW)); 
                break;
            }
            
            if (!isNaN(wFront)) frontPoints.push(new Vector2(r, wFront));
            if (!isNaN(wBack)) backPoints.push(new Vector2(r, wBack));
        }
        
        // Combine: Front (Center->Edge) + Back (Edge->Center)
        // Back points need to be reversed to go from Edge to Center
        const combined = [...frontPoints, ...backPoints.reverse()];
        
        // Safety: ensure at least 2 points to avoid Lathe crash
        if (combined.length < 2) {
            return [new Vector2(0, frontApex), new Vector2(aperture, frontApex), new Vector2(aperture, backApex), new Vector2(0, backApex)];
        }
        
        return combined;
    }, [aperture, thickness, R1, R2]);

    // Safety check for ring geometry args
    const ringArgs: [number, number, number] = [
        Math.max(0, aperture * 0.95), 
        Math.max(0.1, aperture * 1.02), 
        64
    ];

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
                    transmission={0.95} 
                    opacity={0.4}
                    transparent
                    roughness={0} 
                    metalness={0}
                    ior={component.ior || 1.5}
                    side={DoubleSide}
                />
            </mesh>

            {/* Selection Highlight — subtle aperture ring */}
            {isSelected && !isNaN(aperture) && (
                <mesh raycast={() => {}}>
                    <ringGeometry args={ringArgs} />
                    <meshBasicMaterial color="#64ffda" transparent opacity={0.8} side={DoubleSide} />
                </mesh>
            )}
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
    const arrowSize = Math.min(a * 0.2, 3); // arrow proportional to aperture
    
    // Build line geometry: vertical line + arrow tips
    const points = useMemo(() => {
        const pts: Vector3[] = [];
        // Main vertical line (in local ZY: optical axis is Z, transverse is Y in the plane we see)
        // But local space: Z = optical axis (W), Y = transverse (V)
        // We draw in the UV plane — a line along V at w=0
        pts.push(new Vector3(0, -a, 0)); // bottom
        pts.push(new Vector3(0, a, 0));  // top
        return pts;
    }, [a]);

    // Arrow heads at the tips
    const topArrow = useMemo(() => {
        const tip = new Vector3(0, a, 0);
        const inward = converging ? -1 : 1; // inward = toward axis
        return [
            new Vector3(inward * arrowSize, a - arrowSize, 0),
            tip,
            new Vector3(-inward * arrowSize, a - arrowSize, 0),
        ];
    }, [a, arrowSize, converging]);

    const bottomArrow = useMemo(() => {
        const tip = new Vector3(0, -a, 0);
        const inward = converging ? 1 : -1; // mirrored
        return [
            new Vector3(inward * arrowSize, -a + arrowSize, 0),
            tip,
            new Vector3(-inward * arrowSize, -a + arrowSize, 0),
        ];
    }, [a, arrowSize, converging]);

    const color = converging ? '#64ffda' : '#ff6b9d';

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={[component.rotation.x, component.rotation.y, component.rotation.z, component.rotation.w]}
        >
            {/* Main line */}
            <line>
                <bufferGeometry>
                    <bufferAttribute
                        attach="attributes-position"
                        args={[new Float32Array(points.flatMap(p => [p.x, p.y, p.z])), 3]}
                    />
                </bufferGeometry>
                <lineBasicMaterial color={color} linewidth={2} />
            </line>
            {/* Top arrow */}
            <line>
                <bufferGeometry>
                    <bufferAttribute
                        attach="attributes-position"
                        args={[new Float32Array(topArrow.flatMap(p => [p.x, p.y, p.z])), 3]}
                    />
                </bufferGeometry>
                <lineBasicMaterial color={color} linewidth={2} />
            </line>
            {/* Bottom arrow */}
            <line>
                <bufferGeometry>
                    <bufferAttribute
                        attach="attributes-position"
                        args={[new Float32Array(bottomArrow.flatMap(p => [p.x, p.y, p.z])), 3]}
                    />
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
            
            // Generate Collimated Beam (Parallel Rays) - Grid pattern covering Y and Z
            const steps = Math.max(1, rayConfig.rayCount);
            
            // Basis Vectors for the aperture plane
            const up = new Vector3(0, 1, 0); 
            if (Math.abs(direction.dot(up)) > 0.9) {
                 up.set(0, 0, 1); 
            }
            const right = new Vector3().crossVectors(direction, up).normalize();
            const trueUp = new Vector3().crossVectors(right, direction).normalize();
            
            // Generate rays around the beam circumference (marginal rays in 3D)
            for(let i = 0; i < steps; i++) {
                 const phi = (i / steps) * Math.PI * 2;
                 
                 const marginalOffset = new Vector3()
                    .addScaledVector(trueUp, Math.sin(phi) * beamRadius)
                    .addScaledVector(right, Math.cos(phi) * beamRadius);

                 sourceRays.push({
                    origin: origin.clone().add(marginalOffset),
                    direction: direction.clone().normalize(), // Enforce parallel
                    wavelength: laserWavelength, intensity: 1, polarization: {x:{re:1,im:0},y:{re:0,im:0}}, opticalPathLength: 0, footprintRadius: 0, coherenceMode: Coherence.Coherent
                });
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
