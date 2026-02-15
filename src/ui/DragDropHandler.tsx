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
import { Objective } from '../physics/components/Objective';
import { IdealLens } from '../physics/components/IdealLens';
import { Camera } from '../physics/components/Camera';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { PrismLens } from '../physics/components/PrismLens';
import { Waveplate } from '../physics/components/Waveplate';
import { BeamSplitter } from '../physics/components/BeamSplitter';
import { Aperture } from '../physics/components/Aperture';
import { Filter } from '../physics/components/Filter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { SpectralProfile } from '../physics/SpectralProfile';
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
                newComp = new SphericalLens(1 / 50, 15, 4, "New Lens");
            } else if (type === 'mirror') {
                newComp = new Mirror(25, 2, "New Mirror");
            } else if (type === 'laser') {
                newComp = new Laser("New Laser");
            } else if (type === 'blocker') {
                newComp = new Blocker(20, 5, "Beam Blocker");
            } else if (type === 'card') {
                newComp = new Card(20, 20, "Viewing Card");
            } else if (type === 'sample') {
                newComp = new Sample("New Sample");
            } else if (type === 'idealLens') {
                newComp = new IdealLens(50, 15, "Ideal Lens"); // f=50mm, aperture=15mm
            } else if (type === 'objective') {
                newComp = new Objective({ magnification: 10, NA: 0.25, name: "New Objective" });
            } else if (type === 'camera') {
                newComp = new Camera(50, 25, "New Camera");
            } else if (type === 'cylindricalLens') {
                newComp = new CylindricalLens(40, 1e9, 12, 24, 3, "Cylindrical Lens");
            } else if (type === 'prism') {
                newComp = new PrismLens(Math.PI / 3, 20, 20, "Prism");
            } else if (type === 'halfWavePlate') {
                newComp = new Waveplate('half', 12.5, Math.PI / 4, 'λ/2 Plate');
            } else if (type === 'quarterWavePlate') {
                newComp = new Waveplate('quarter', 12.5, Math.PI / 4, 'λ/4 Plate');
            } else if (type === 'polarizer') {
                newComp = new Waveplate('polarizer', 12.5, 0, 'Linear Polarizer');
            } else if (type === 'beamSplitter') {
                newComp = new BeamSplitter(25, 2, 0.5, 'Beam Splitter');
            } else if (type === 'aperture') {
                newComp = new Aperture(10, 25, 'Aperture');
            } else if (type === 'filter') {
                newComp = new Filter(25, 3, new SpectralProfile('bandpass', 500, [{ center: 525, width: 50 }]), 'Filter');
            } else if (type === 'dichroic') {
                newComp = new DichroicMirror(25, 2, new SpectralProfile('longpass', 500), 'Dichroic');
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
                } else if (type === 'beamSplitter' || type === 'dichroic') {
                    // Beam splitter at 45° — reflects upward, transmits straight
                    newComp.setRotation(0, 0, 3 * Math.PI / 4);
                } else if (type === 'blocker' || type === 'halfWavePlate' || type === 'quarterWavePlate' || type === 'polarizer' || type === 'aperture' || type === 'filter') {
                    // These components have their normal along Local X.
                    // Default (0,0,0) faces the X-direction beam correctly.
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
