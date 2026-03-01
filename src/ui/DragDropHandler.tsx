import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useAtom } from 'jotai';
import { componentsAtom, pushUndoAtom } from '../state/store';
import { SphericalLens } from '../parts/SphericalLens';
import { Mirror } from '../parts/Mirror';
import { Laser } from '../parts/Laser';
import { Lamp } from '../parts/Lamp';
import { Blocker } from '../parts/Blocker';
import { Card } from '../parts/Card';
import { Sample } from '../parts/Sample';
import { Objective } from '../parts/Objective';
import { IdealLens } from '../parts/IdealLens';
import { Camera } from '../parts/Camera';
import { CylindricalLens } from '../parts/CylindricalLens';
import { PrismLens } from '../parts/PrismLens';
import { Waveplate } from '../parts/Waveplate';
import { BeamSplitter } from '../parts/BeamSplitter';
import { Aperture } from '../parts/Aperture';
import { SlitAperture } from '../parts/SlitAperture';
import { Filter } from '../parts/Filter';
import { DichroicMirror } from '../parts/DichroicMirror';
import { CurvedMirror } from '../parts/CurvedMirror';
import { PolygonScanner } from '../parts/PolygonScanner';
import { LXSampleHolder } from '../parts/LXSampleHolder';
import { PMT } from '../parts/PMT';
import { AchromaticDoublet } from '../parts/AchromaticDoublet';
import { AsphericLens } from '../parts/AsphericLens';
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
    if (type === 'slitAperture') return new SlitAperture(5, 20, 25, 'Slit Aperture');
    if (type === 'filter') return new Filter(25, 3, new SpectralProfile('bandpass', 500, [{ center: 525, width: 50 }]), 'Filter');
    if (type === 'dichroic') return new DichroicMirror(25, 2, new SpectralProfile('longpass', 500), 'Dichroic');
    if (type === 'curvedMirror') return new CurvedMirror(25, 100, 3, 'Curved Mirror');
    if (type === 'polygonScanner') return new PolygonScanner({ numFaces: 6, inscribedRadius: 10, faceHeight: 10, name: 'Polygon Scanner' });
    if (type === 'lChamber') return new LXSampleHolder(75, 3, 30, 'L/X Sample Holder');
    if (type === 'pmt') return new PMT(10, 10, 'PMT Detector');
    if (type === 'achromaticDoublet') return new AchromaticDoublet('Achromatic Doublet');
    if (type === 'asphericLens') return new AsphericLens(12.5, 6, 'Aspheric Lens');
    return null;
}

/** Apply a sensible default rotation for the given component type.
 * NOTE: Most components should be defined so that identity rotation (0,0,0)
 * already looks correct on the table. Only override here for special cases
 * like beam splitters that need a 45° tilt. */
function applyDefaultRotation(comp: OpticalComponent, type: string): void {
    if (type === 'beamSplitter' || type === 'dichroic') {
        // Beam splitters face at 45° in the XY plane
        comp.pointAlong(1, 1, 0);
    }
    // All other components: identity rotation — geometry is defined to be
    // upright on the table by default (optical axis along local X).
}

export const DragDropHandler: React.FC = () => {
    const { camera, gl } = useThree();
    const [, setComponents] = useAtom(componentsAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);

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
                pushUndo();  // snapshot before add
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
    }, [camera, gl, setComponents, pushUndo]);

    return null;
};
