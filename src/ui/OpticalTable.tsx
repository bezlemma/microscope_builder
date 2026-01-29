import React, { useState, useEffect } from 'react';
import { Vector3, DoubleSide } from 'three';
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
import { RayVisualizer } from './RayVisualizer';
import { Draggable } from './Draggable';

// Visualization components
export const MirrorVisualizer = ({ component }: { component: Mirror }) => {
    const [, setSelection] = useAtom(selectionAtom);
    return (
        <group 
            position={[component.position.x, component.position.y, component.position.z]} 
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
            <mesh>
                <boxGeometry args={[component.width, component.height, 2]} />
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
    return (
        <group 
            position={[component.position.x, component.position.y, component.position.z]} 
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
            <mesh>
                <boxGeometry args={[component.width, component.height, component.depth]} />
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
    
    // Compute sag (cap height) from R and aperture
    const sagSquared = absR * absR - aperture * aperture;
    const sag = sagSquared > 0 ? absR - Math.sqrt(sagSquared) : aperture * 0.3;
    
    // Visual depth depends on lens type:
    // - Biconvex (R > 0): ellipsoid bulges at center, depth = thickness + 2*sag
    // - Biconcave (R < 0): edges are thicker, center is thinner
    //   We'll show edge thickness = thickness + 2*sag, center = thickness
    const isConvex = R > 0;
    const centerDepth = isConvex ? thickness + 2 * sag : thickness;
    const edgeDepth = isConvex ? thickness : thickness + 2 * sag;

    return (
        <group 
            position={[component.position.x, component.position.y, component.position.z]} 
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); setSelection(component.id); }}
        >
            {isConvex ? (
                /* Biconvex lens - ellipsoid bulging at center */
                <mesh scale={[aperture, aperture, centerDepth / 2]}>
                    <sphereGeometry args={[1, 32, 32]} />
                    <meshPhysicalMaterial 
                        color="#88ffee" 
                        transmission={0.95} 
                        opacity={0.4}
                        transparent
                        roughness={0} 
                        metalness={0}
                        ior={ior}
                        side={DoubleSide}
                    />
                </mesh>
            ) : (
                /* Biconcave lens - use torus-like shape (thicker at edges) */
                <group>
                    {/* Outer edge ring */}
                    <mesh rotation={[Math.PI / 2, 0, 0]}>
                        <torusGeometry args={[aperture * 0.85, edgeDepth / 2, 16, 32]} />
                        <meshPhysicalMaterial 
                            color="#88ffee" 
                            transmission={0.95} 
                            opacity={0.4}
                            transparent
                            roughness={0} 
                            metalness={0}
                            ior={ior}
                            side={DoubleSide}
                        />
                    </mesh>
                    {/* Thin center disc */}
                    <mesh scale={[aperture * 0.7, aperture * 0.7, centerDepth / 2]}>
                        <sphereGeometry args={[1, 32, 32]} />
                        <meshPhysicalMaterial 
                            color="#88ffee" 
                            transmission={0.95} 
                            opacity={0.3}
                            transparent
                            roughness={0} 
                            metalness={0}
                            ior={ior}
                            side={DoubleSide}
                        />
                    </mesh>
                </group>
            )}

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
                <boxGeometry args={[50, 15, 25]} />
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
        // Removed unused maxAngle
        
        let origin = new Vector3(0,0,0);
        let direction = new Vector3(1,0,0);
        
        if (sourceComp) {
            origin = sourceComp.position.clone();
            // Assuming Laser emits along its local X?
            // If rotated, we need to transform vector. 
            // For now, assume unrotated or X-aligned.
            // Improve: sourceComp.rotation applied to (1,0,0).
            direction = new Vector3(1,0,0).applyQuaternion(sourceComp.rotation).normalize();
            
            // Offset origin slightly so it starts "outside" the box? 
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
                else if (c instanceof SphericalLens) visual = <LensVisualizer component={c} />;
                else if (c instanceof Laser) visual = <SourceVisualizer component={c} />;
                else if (c instanceof Blocker) visual = <BlockerVisualizer component={c} />;
                else if (c instanceof Card) visual = <CardVisualizer component={c} />;
                
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
