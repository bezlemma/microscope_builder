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
import { Camera } from '../physics/components/Camera';
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
const DynamicLens = ({ component }: { component: SphericalLens }) => {
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
            pts.push(new Vector2(y, -z)); // Note: Lathe rotates around Y. We map Z->Y? No. 
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
            pts.push(new Vector2(y, -z));
        }
        
        // Close shape? Lathe expects open path that connects axis?
        // We went 0->Aperture->0. Loop closed.
        // First point (0, frontZ). Last point (0, backZ).
        // It forms a solid cross section.
        
        return pts;
    }, [component]);

    // Color based on material (Crown vs Flint ior?)
    const color = component.ior > 1.6 ? "#aaaaff" : "#ccffff"; // Simple heuristic for visual distinction

    return (
        <mesh rotation={[Math.PI/2, 0, 0]}> 
            {/* Rotate Lathe (Y-axis symmetry) to Optical Axis (Z) */}
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
    
    return (
        <group 
            position={[component.position.x, component.position.y, component.position.z]} 
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
            {/* Iterate over internal elements and render them exactly */}
            {component.elements.map((elem, index) => {
                // Determine visualizer based on type
                // But TypeScript doesn't know type easily. Check 'constructor.name' or property?
                const CompType = elem.constructor.name;
                
                if (CompType === 'SphericalLens') {
                    return (
                        <group key={index} position={[elem.position.x, elem.position.y, elem.position.z]}>
                            <DynamicLens component={elem as SphericalLens} />
                        </group>
                    );
                } else if (CompType === 'ObjectiveCasing') {
                    // Skip or render casing? We removed casing physics, so likely not here.
                    return null;
                }
                return null;
            })}

            {isSelected && (
                <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 14]}>
                     <cylinderGeometry args={[9, 9, 32, 32]} />
                     <meshBasicMaterial color="#64ffda" transparent opacity={0.3} wireframe />
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
             {/* Camera Body (Box) */}
             <mesh position={[0, 0, -depth/2]}> 
                <boxGeometry args={[width, height, depth]} />
                <meshStandardMaterial color="#333" metalness={0.6} roughness={0.4} />
             </mesh>
             
             {/* Sensor Face (Blue) */}
             <mesh position={[0, 0, 0.1]}>
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
            <mesh rotation={[0, 0, -Math.PI/4]}>
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
    const aperture = component.apertureRadius;
    const thickness = component.thickness;
    
    // Compute R from curvature (same formula as physics)
    // R > 0 = biconvex (converging), R < 0 = biconcave (diverging)
    const power = component.curvature;
    const ior = component.ior;
    const R = Math.abs(power) > 1e-6 ? (2 * (ior - 1)) / power : 1000;
    const absR = Math.abs(R);
    const isConvex = R > 0;
    
    // Compute sag (cap height) from R and aperture: sag = R - sqrt(R² - aperture²)
    const sagSquared = absR * absR - aperture * aperture;
    const sag = sagSquared > 0 ? absR - Math.sqrt(sagSquared) : aperture * 0.3;

    // Generate profile curve for LatheGeometry
    // Profile is in the XY plane: X = radial distance (0 to aperture), Y = thickness (along W-axis)
    const profilePoints = useMemo(() => {
        const points: Vector2[] = [];
        const steps = 20;
        
        for (let i = 0; i <= steps; i++) {
            const r = (i / steps) * aperture; // Radial distance from center
            
            // Spherical cap: sag at radius r = R - sqrt(R² - r²)
            const localSag = absR * absR - r * r > 0 
                ? absR - Math.sqrt(absR * absR - r * r) 
                : 0;
            
            // For biconvex (R > 0): lens bulges outward at center
            //   Front surface at w = -thickness/2 - (sag - localSag)  [bulges towards -w]
            //   Back surface at w = +thickness/2 + (sag - localSag)   [bulges towards +w]
            //   Total thickness at radius r = thickness + 2*(sag - localSag)
            // For biconcave (R < 0): lens is thinner at center
            //   Total thickness at radius r = thickness - 2*(sag - localSag)
            
            const surfaceDelta = sag - localSag; // 0 at edge, sag at center
            const halfThickness = isConvex 
                ? thickness / 2 + surfaceDelta  // Convex: thicker at center
                : Math.max(thickness / 2 - surfaceDelta, 0.5); // Concave: thinner at center (min 0.5mm)
            
            // Profile goes from front surface to back surface at each radius
            // We'll define the full silhouette: start at center-front, go to edge, then back to center-back
            points.push(new Vector2(r, halfThickness));
        }
        // Add bottom half (mirror the profile for closed shape)
        for (let i = steps; i >= 0; i--) {
            const r = (i / steps) * aperture;
            const localSag = absR * absR - r * r > 0 
                ? absR - Math.sqrt(absR * absR - r * r) 
                : 0;
            const surfaceDelta = sag - localSag;
            const halfThickness = isConvex 
                ? thickness / 2 + surfaceDelta 
                : Math.max(thickness / 2 - surfaceDelta, 0.5);
            points.push(new Vector2(r, -halfThickness));
        }
        return points;
    }, [aperture, thickness, absR, sag, isConvex]);

    return (
        <group 
            position={[component.position.x, component.position.y, component.position.z]} 
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
            {/* Lens body - LatheGeometry for accurate spherical cap profile */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <latheGeometry args={[profilePoints, 32]} />
                <meshPhysicalMaterial 
                    color={isConvex ? "#88ffee" : "#aaddff"}
                    transmission={0.95} 
                    opacity={0.4}
                    transparent
                    roughness={0} 
                    metalness={0}
                    ior={ior}
                    side={DoubleSide}
                />
            </mesh>

            {/* Selection Highlight */}
            {isSelected && (
                <mesh>
                    <ringGeometry args={[aperture * 0.95, aperture * 1.02, 64]} />
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
             {/* Laser Box Body */}
             <mesh position={[-25, 0, 0]}> 
                <boxGeometry args={[50, 25, 25]} />
                <meshStandardMaterial color="#222" metalness={0.5} roughness={0.5} />
             </mesh>
             {/* Aperture Ring */}
             <mesh position={[2, 0, 0]} rotation={[0, 0, Math.PI/2]}>
                 <cylinderGeometry args={[4, 4, 4, 16]} />
                 <meshStandardMaterial color="#666" />
             </mesh>
             {/* Emission Point */}
             <mesh position={[4, 0, 0]}>
                 <sphereGeometry args={[1, 16, 16]} />
                 <meshBasicMaterial color="lime" />
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
        
        // Find Laser Component
        const sourceComp = components.find(c => c instanceof Laser);
        
        const sourceRays: Ray[] = [];
        
        let origin = new Vector3(0,0,0);
        let direction = new Vector3(1,0,0);
        
        if (sourceComp) {
            origin = sourceComp.position.clone();
            // Improve: sourceComp.rotation applied to (1,0,0).
            direction = new Vector3(1,0,0).applyQuaternion(sourceComp.rotation).normalize();
            
            // Offset origin slightly so it starts "outside" the box 
            // Box ends at 0. Start at +5.
            const offset = direction.clone().multiplyScalar(5);
            origin.add(offset);
        }

        // Always Central Ray
        sourceRays.push({
            origin: origin.clone(),
            direction: direction.clone(),
            wavelength: 532e-9, intensity: 1, polarization: {x:{re:1,im:0},y:{re:0,im:0}}, opticalPathLength: 0, footprintRadius: 0, coherenceMode: Coherence.Coherent
        });
        
        // Generate Collimated Beam (Parallel Rays) - Grid pattern covering Y and Z
        const steps = Math.max(1, rayConfig.rayCount);
        const beamRadius = 5.0; // 5mm beam half-width
        
        // Basis Vectors for the aperture plane
        const up = new Vector3(0, 1, 0); 
        if (Math.abs(direction.dot(up)) > 0.9) {
             up.set(0, 0, 1); 
        }
        const right = new Vector3().crossVectors(direction, up).normalize(); // Z direction
        const trueUp = new Vector3().crossVectors(right, direction).normalize(); // Y direction
        
        // Generate rays around the beam circumference (marginal rays in 3D)
        // This creates rays at equal angular intervals around the beam edge
        for(let i = 0; i < steps; i++) {
             const phi = (i / steps) * Math.PI * 2;
             
             // Position on circle at beam radius (marginal rays)
             const offset = new Vector3()
                .addScaledVector(trueUp, Math.sin(phi) * beamRadius)
                .addScaledVector(right, Math.cos(phi) * beamRadius);

             sourceRays.push({
                origin: origin.clone().add(offset),
                direction: direction.clone(), // Parallel!
                wavelength: 532e-9, intensity: 1, polarization: {x:{re:1,im:0},y:{re:0,im:0}}, opticalPathLength: 0, footprintRadius: 0, coherenceMode: Coherence.Coherent
            });
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
                else if (c instanceof SphericalLens) visual = <LensVisualizer component={c} />;
                else if (c instanceof Laser) visual = <SourceVisualizer component={c} />;
                else if (c instanceof Blocker) visual = <BlockerVisualizer component={c} />;
                else if (c instanceof Card) visual = <CardVisualizer component={c} />;
                else if (c instanceof Sample) visual = <SampleVisualizer component={c} />;
                else if (c instanceof Camera) visual = <CameraVisualizer component={c} />;
                
                if (visual) {
                    return (
                        <Draggable key={c.id} component={c}>
                            {visual}
                        </Draggable>
                    );
                }
                return null;
            })}
            <RayVisualizer paths={rays} />
        </group>
    );
};
