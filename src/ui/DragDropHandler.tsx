import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useAtom } from 'jotai';
import { componentsAtom } from '../state/store';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Mirror } from '../physics/components/Mirror';
import { Laser } from '../physics/components/Laser';
import { Blocker } from '../physics/components/Blocker';
import { Card } from '../physics/components/Card';
import { Sample } from '../physics/components/Sample';
import { PointSource } from '../physics/components/PointSource';
import { Objective } from '../physics/components/Objective';
import { IdealLens } from '../physics/components/IdealLens';
import { Camera } from '../physics/components/Camera';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { PrismLens } from '../physics/components/PrismLens';
import { Vector3, Raycaster, Plane, Vector2 } from 'three';

export const DragDropHandler: React.FC = () => {
    const { camera, gl } = useThree();
    const [, setComponents] = useAtom(componentsAtom);

    useEffect(() => {
        const handleDragOver = (e: DragEvent) => {
            e.preventDefault();
        };

        const handleDrop = (e: DragEvent) => {
            e.preventDefault();
            const type = e.dataTransfer?.getData('componentType');
            if (!type) return;

            // Calculate Mouse Position in NDC (-1 to +1)
            const rect = gl.domElement.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            // Raycasting
            const raycaster = new Raycaster();
            raycaster.setFromCamera(new Vector2(x, y), camera);

            // Intersect with Optical Table Plane (Z=0 per PhysicsPlan.md Z-up)
            const plane = new Plane(new Vector3(0, 0, 1), 0);
            const target = new Vector3();
            raycaster.ray.intersectPlane(plane, target);
            
            // If we didn't hit the infinite plane (parallel ray?), fallback to 0,0
            // But with Top-Down or Angle, we should usually hit.
            if (!target) return;

            // Snap to Grid (Optional? User asked for "Drop in where I drag it", implied precision or snap?
            // "Drop in to where I drag it". Usually implies exact position. 
            // Draggable has snap logic. Let's start with exact, maybe snap if Alt is held?
            // Let's stick to exact for now as it feels smoother.
            
            console.log(`Dropped ${type} at`, target);

            let newComp;
            if (type === 'lens') {
                newComp = new SphericalLens(1/50, 15, 4, "New Lens");
            } else if (type === 'mirror') {
                newComp = new Mirror(20, 20, "New Mirror");
            } else if (type === 'laser') {
                newComp = new Laser("New Laser");
            } else if (type === 'blocker') {
                newComp = new Blocker(20, 20, 5, "Beam Blocker");
            } else if (type === 'card') {
                newComp = new Card(40, 40, "Viewing Card");
            } else if (type === 'sample') {
                newComp = new Sample("New Sample");
            } else if (type === 'idealLens') {
                newComp = new IdealLens(50, 15, "Ideal Lens"); // f=50mm, aperture=15mm
            } else if (type === 'objective') {
                newComp = new Objective({ magnification: 10, NA: 0.25, name: "New Objective" });
            } else if (type === 'pointSource') {
                newComp = new PointSource("Point Source");
            } else if (type === 'camera') {
                newComp = new Camera(50, 25, "New Camera");
            } else if (type === 'cylindricalLens') {
                newComp = new CylindricalLens(40, 1e9, 12, 24, 3, "Cylindrical Lens");
            } else if (type === 'prism') {
                newComp = new PrismLens(Math.PI / 3, 20, 20, "Prism");
            }

            if (newComp) {
                // Z-up world: set position on XY plane at Z=0
                newComp.setPosition(target.x, target.y, 0);
                
                // Align Optical Axis (Local Z) with World X
                // Rotate 90 degrees around Y axis: Local Z -> World X
                if (type === 'mirror') {
                   // Mirror Normal is Local X.
                   // To reflect X -> Y, we need Normal at 135 deg in XY plane.
                   // Just rotate around Z axis.
                   newComp.setRotation(0, 0, 3 * Math.PI / 4); 
                } else if (type === 'blocker') {
                    // Blocker Normal is Local X. Points along X.
                    // If we want it to block X-beam, it should face X.
                    // Default Logic (0,0,0) points X.
                    newComp.setRotation(0, 0, 0);
                } else {
                   newComp.setRotation(0, Math.PI / 2, 0);
                }
                
                // Laser is a bit special, usually points along X by default without rotation if its geometry is defined that way.
                // But if Laser follows Component logic (Local Z is output), then it also needs rotation if we want it to emit along X?
                // Visualizer draws box along Local -X?
                // Let's check Laser code or just assume standard behavior for now.
                if (type === 'laser') {
                    newComp.setRotation(0, 0, 0); // Laser visualizer assumes default
                }
                
                setComponents(prev => [...prev, newComp]);
            }
        };

        const canvas = gl.domElement;
        canvas.addEventListener('dragover', handleDragOver);
        canvas.addEventListener('drop', handleDrop);

        return () => {
            canvas.removeEventListener('dragover', handleDragOver);
            canvas.removeEventListener('drop', handleDrop);
        };
    }, [camera, gl, setComponents]);

    return null;
};
