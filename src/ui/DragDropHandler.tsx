import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useAtom } from 'jotai';
import { componentsAtom } from '../state/store';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Mirror } from '../physics/components/Mirror';
import { Laser } from '../physics/components/Laser';
import { Lamp } from '../physics/components/Lamp';
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
import { CurvedMirror } from '../physics/components/CurvedMirror';
import { SpectralProfile } from '../physics/SpectralProfile';
import { Vector3, Raycaster, Plane, Vector2 } from 'three';
import { OpticalComponent } from '../physics/Component';

/** Create a new component instance for the given type string. Returns null for unknown types. */
function createComponentForType(type: string): OpticalComponent | null {
    if (type === 'lens') return new SphericalLens(1 / 50, 15, 4, "New Lens");
    if (type === 'mirror') return new Mirror(25, 2, "New Mirror");
    if (type === 'laser') return new Laser("New Laser");
    if (type === 'lamp') return new Lamp("New Lamp");
    if (type === 'blocker') return new Blocker(20, 5, "Beam Blocker");
    if (type === 'card') return new Card(20, 20, "Viewing Card");
    if (type === 'sample') return new Sample("New Sample");
    if (type === 'idealLens') return new IdealLens(50, 15, "Ideal Lens");
    if (type === 'objective') return new Objective({ magnification: 10, NA: 0.25, name: "New Objective" });
    if (type === 'camera') return new Camera(13, 13, "New Camera");
    if (type === 'cylindricalLens') return new CylindricalLens(40, 1e9, 12, 24, 3, "Cylindrical Lens");
    if (type === 'prism') return new PrismLens(Math.PI / 3, 20, 20, "Prism");
    if (type === 'halfWavePlate') return new Waveplate('half', 12.5, Math.PI / 4, 'λ/2 Plate');
    if (type === 'quarterWavePlate') return new Waveplate('quarter', 12.5, Math.PI / 4, 'λ/4 Plate');
    if (type === 'polarizer') return new Waveplate('polarizer', 12.5, 0, 'Linear Polarizer');
    if (type === 'beamSplitter') return new BeamSplitter(25, 2, 0.5, 'Beam Splitter');
    if (type === 'aperture') return new Aperture(10, 25, 'Aperture');
    if (type === 'filter') return new Filter(25, 3, new SpectralProfile('bandpass', 500, [{ center: 525, width: 50 }]), 'Filter');
    if (type === 'dichroic') return new DichroicMirror(25, 2, new SpectralProfile('longpass', 500), 'Dichroic');
    if (type === 'curvedMirror') return new CurvedMirror(25, 100, 3, 'Curved Mirror');
    return null;
}

/** Apply a sensible default rotation for the given component type. */
function applyDefaultRotation(comp: OpticalComponent, type: string): void {
    if (type === 'mirror' || type === 'beamSplitter' || type === 'dichroic' || type === 'curvedMirror') {
        comp.setRotation(0, 0, 3 * Math.PI / 4);
    } else if (['blocker', 'halfWavePlate', 'quarterWavePlate', 'polarizer', 'aperture', 'filter'].includes(type)) {
        comp.setRotation(0, 0, 0);
    } else if (type === 'laser' || type === 'lamp') {
        comp.setRotation(0, 0, 0);
    } else {
        comp.setRotation(0, Math.PI / 2, 0);
    }
}

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

            // Calculate drop position via raycasting to Z=0 plane
            const rect = gl.domElement.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            const raycaster = new Raycaster();
            raycaster.setFromCamera(new Vector2(x, y), camera);
            const plane = new Plane(new Vector3(0, 0, 1), 0);
            const target = new Vector3();
            raycaster.ray.intersectPlane(plane, target);
            if (!target) return;

            const newComp = createComponentForType(type);
            if (newComp) {
                newComp.setPosition(target.x, target.y, 0);
                applyDefaultRotation(newComp, type);
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
