import React, { useMemo, useState, useEffect } from 'react';
import { Vector3 } from 'three';
import { Ray, Coherence } from '../../physics/types';
import { Solver1 } from '../../physics/Solver1';
import { OpticalComponent } from '../../physics/Component';
import { SphericalLens } from '../../physics/components/SphericalLens';
import { RayVisualizer } from '../RayVisualizer';

// Re-export visualizer or duplicate for now (better to export)
const LensVis = ({ component }: { component: SphericalLens }) => {
    return (
        <mesh position={component.position} quaternion={component.rotation}>
            <sphereGeometry args={[component.apertureRadius, 32, 16]} />
            <meshPhysicalMaterial transmission={0.9} roughness={0} thickness={component.thickness} color="skyblue" />
        </mesh>
    );
};

export const BeamExpanderTest: React.FC = () => {
    const sceneComponents = useMemo(() => {
        const comps: OpticalComponent[] = [];
        
        // Lens A: f = 50mm.
        // For planoconvex: R = f * (n-1). n=1.5 -> R = 50 * 0.5 = 25mm.
        // Position at x = 0 for simplicity.
        const lensA = new SphericalLens(1/25.0, 15, 5, "Lens A (f=50)");
        lensA.setPosition(0, 0, 0); 
        // Default rotation is looking down Z? No. default is no rotation.
        // Lens axis is W.
        // If we want beam along X, we must rotate Lens so its W axis aligns with X.
        // Default W is Z. 
        // Rotate Y by 90 deg -> W becomes X.
        lensA.setRotation(0, Math.PI / 2, 0);
        comps.push(lensA);

        // Lens B: f = 100mm.
        // R = 100 * 0.5 = 50mm.
        // Position at x = 150 (Confocal: f1 + f2 = 50 + 100 = 150).
        const lensB = new SphericalLens(1/50.0, 25, 5, "Lens B (f=100)");
        lensB.setPosition(150, 0, 0);
        lensB.setRotation(0, Math.PI / 2, 0);
        comps.push(lensB);

        return comps;
    }, []);

    const [rays, setRays] = useState<Ray[][]>([]);

    useEffect(() => {
        console.log("BeamExpanderTest: Setup Solver");
        const solver = new Solver1(sceneComponents);
        
        // Source: Parallel beam (3 rays).
        // Along X axis.
        const sourceRays: Ray[] = [
            // Center
            {
                origin: new Vector3(-50, 0, 0),
                direction: new Vector3(1, 0, 0),
                wavelength: 532e-9, intensity: 1, polarization: {x:{re:1,im:0},y:{re:0,im:0}}, opticalPathLength: 0, footprintRadius: 0, coherenceMode: Coherence.Coherent
            },
            // Marginal + (y=5)
            {
                origin: new Vector3(-50, 5, 0),
                direction: new Vector3(1, 0, 0),
                wavelength: 532e-9, intensity: 1, polarization: {x:{re:1,im:0},y:{re:0,im:0}}, opticalPathLength: 0, footprintRadius: 0, coherenceMode: Coherence.Coherent
            },
            // Marginal - (y=-5)
            {
                origin: new Vector3(-50, -5, 0),
                direction: new Vector3(1, 0, 0),
                wavelength: 532e-9, intensity: 1, polarization: {x:{re:1,im:0},y:{re:0,im:0}}, opticalPathLength: 0, footprintRadius: 0, coherenceMode: Coherence.Coherent
            }
        ];

        console.log("BeamExpanderTest: Tracing Rays...");
        const calculatedPaths = solver.trace(sourceRays);
        console.log("BeamExpanderTest: Trace Complete. Paths:", calculatedPaths);
        setRays(calculatedPaths);

    }, [sceneComponents]);

    return (
        <group>
            {sceneComponents.map(c => {
                if (c instanceof SphericalLens) return <LensVis key={c.id} component={c} />;
                return null;
            })}
            <RayVisualizer paths={rays} />
        </group>
    );
};
