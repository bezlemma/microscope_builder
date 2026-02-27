import React, { useMemo, useState, useEffect } from 'react';
import { Vector3 } from 'three';
import { Ray, Coherence } from '../../physics/types';
import { Solver1 } from '../../physics/Solver1';
import { OpticalComponent } from '../../physics/Component';
import { SphericalLens } from '../../physics/components/SphericalLens';
import { RayVisualizer } from '../RayVisualizer';
import { LensVisualizer } from '../visualizers/ComponentVisualizers';

export const InfinitySystemTest: React.FC = () => {
    const sceneComponents = useMemo(() => {
        const comps: OpticalComponent[] = [];
        
        // Objective Lens: f = 20mm.
        // Planoconvex R = f * (n-1) = 20 * 0.5 = 10mm.
        // Position at x = 20mm (Source is at 0).
        const objective = new SphericalLens(1/10.0, 10, 3, "Objective (f=20)");
        objective.setPosition(20, 0, 0);
        objective.setRotation(0, Math.PI / 2, 0);
        comps.push(objective);

        // Tube Lens: f = 100mm.
        // R = 50mm.
        // Position at x = 120mm (100mm gap "Infinity Space").
        const tubeLens = new SphericalLens(1/50.0, 25, 4, "Tube Lens (f=100)");
        tubeLens.setPosition(120, 0, 0);
        tubeLens.setRotation(0, Math.PI / 2, 0);
        comps.push(tubeLens);

        return comps;
    }, []);

    const [rays, setRays] = useState<Ray[][]>([]);

    useEffect(() => {
        console.log("InfinityTest: Setup Solver");
        const solver = new Solver1(sceneComponents);
        
        // Point Source at Origin (x=0)
        // Diverging rays.
        const sourceRays: Ray[] = [
            // Center (On axis)
            {
                origin: new Vector3(0, 0, 0),
                direction: new Vector3(1, 0, 0).normalize(),
                wavelength: 532e-9, intensity: 1, polarization: {x:{re:1,im:0},y:{re:0,im:0}}, opticalPathLength: 0, footprintRadius: 0, coherenceMode: Coherence.Coherent
            },
            // Divergent Up (Angle ~ 0.1 rad)
            {
                origin: new Vector3(0, 0, 0),
                direction: new Vector3(1, 0.1, 0).normalize(),
                wavelength: 532e-9, intensity: 1, polarization: {x:{re:1,im:0},y:{re:0,im:0}}, opticalPathLength: 0, footprintRadius: 0, coherenceMode: Coherence.Coherent
            },
            // Divergent Down
            {
                origin: new Vector3(0, 0, 0),
                direction: new Vector3(1, -0.1, 0).normalize(), // 
                wavelength: 532e-9, intensity: 1, polarization: {x:{re:1,im:0},y:{re:0,im:0}}, opticalPathLength: 0, footprintRadius: 0, coherenceMode: Coherence.Coherent
            }
        ];

        console.log("InfinityTest: Tracing Rays...");
        const calculatedPaths = solver.trace(sourceRays);
        console.log("InfinityTest: Trace Complete. Paths:", calculatedPaths);
        setRays(calculatedPaths);

    }, [sceneComponents]);

    return (
        <group>
            {sceneComponents.map(c => {
                 if (c instanceof SphericalLens) return <LensVisualizer key={c.id} component={c} />;
                return null;
            })}
            <RayVisualizer paths={rays} />
            
            {/* Sensor Plane Marker */}
            <mesh position={[220, 0, 0]} rotation={[0, Math.PI/2, 0]}>
                <planeGeometry args={[20, 20]} />
                <meshBasicMaterial color="red" wireframe />
            </mesh>
        </group>
    );
};
