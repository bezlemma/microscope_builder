import { OpticalComponent } from '../physics/Component';
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
import { SlitAperture } from '../physics/components/SlitAperture';
import { Filter } from '../physics/components/Filter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { CurvedMirror } from '../physics/components/CurvedMirror';
import { PolygonScanner } from '../physics/components/PolygonScanner';
import { SampleChamber } from '../physics/components/SampleChamber';
import { PMT } from '../physics/components/PMT';
import { SpectralProfile } from '../physics/SpectralProfile';

const FOLD_MIRROR_NORMAL = [Math.SQRT1_2, -Math.SQRT1_2, 0] as const;

const FOLD_OPTIC_TYPES = new Set([
    'mirror',
    'beamSplitter',
    'dichroic',
]);

const AXIAL_OPTIC_TYPES = new Set([
    'lens',
    'laser',
    'lamp',
    'blocker',
    'card',
    'sample',
    'idealLens',
    'objective',
    'camera',
    'cylindricalLens',
    'halfWavePlate',
    'quarterWavePlate',
    'polarizer',
    'aperture',
    'slitAperture',
    'filter',
    'curvedMirror',
    'pmt',
]);

export function createComponentForType(type: string): OpticalComponent | null {
    if (type === 'lens') return new SphericalLens(1 / 50, 15, 4, 'New Lens');
    if (type === 'mirror') return new Mirror(25, 2, 'New Mirror');
    if (type === 'laser') return new Laser('New Laser');
    if (type === 'lamp') return new Lamp('New Lamp');
    if (type === 'blocker') return new Blocker(20, 5, 'Beam Blocker');
    if (type === 'card') return new Card(20, 20, 'Viewing Card');
    if (type === 'sample') return new Sample('New Sample');
    if (type === 'idealLens') return new IdealLens(50, 15, 'Ideal Lens');
    if (type === 'objective') return new Objective({ magnification: 10, NA: 0.25, name: 'New Objective' });
    if (type === 'camera') return new Camera(13, 13, 'New Camera');
    if (type === 'cylindricalLens') return new CylindricalLens(40, 1e9, 12, 24, 3, 'Cylindrical Lens');
    if (type === 'prism') return new PrismLens(Math.PI / 3, 20, 20, 'Prism');
    if (type === 'halfWavePlate') return new Waveplate('half', 12.5, Math.PI / 4, 'lambda/2 Plate');
    if (type === 'quarterWavePlate') return new Waveplate('quarter', 12.5, Math.PI / 4, 'lambda/4 Plate');
    if (type === 'polarizer') return new Waveplate('polarizer', 12.5, 0, 'Linear Polarizer');
    if (type === 'beamSplitter') return new BeamSplitter(25, 2, 0.5, 'Beam Splitter');
    if (type === 'aperture') return new Aperture(10, 25, 'Aperture');
    if (type === 'slitAperture') return new SlitAperture(5, 20, 25, 'Slit Aperture');
    if (type === 'filter') return new Filter(25, 3, new SpectralProfile('bandpass', 500, [{ center: 525, width: 50 }]), 'Filter');
    if (type === 'dichroic') return new DichroicMirror(25, 2, new SpectralProfile('longpass', 500), 'Dichroic');
    if (type === 'curvedMirror') return new CurvedMirror(25, 100, 3, 'Curved Mirror');
    if (type === 'polygonScanner') return new PolygonScanner({ numFaces: 6, inscribedRadius: 10, faceHeight: 10, name: 'Polygon Scanner' });
    if (type === 'lChamber') return new SampleChamber(75, 3, 30, 'X Sample Holder');
    if (type === 'pmt') return new PMT(10, 10, 'PMT Detector');
    return null;
}

/**
 * Default palette orientation for a newly dropped component.
 * A usable default optic should stand upright, with its forward axis in the XY plane.
 */
export function applyDefaultPlacementOrientation(comp: OpticalComponent, type: string): void {
    if (type === 'lChamber') {
        comp.setRotation(0, 0, 0);
        return;
    }

    if (type === 'prism') {
        comp.setRotation(0, Math.PI / 2, 0);
        return;
    }

    if (type === 'polygonScanner') {
        comp.setRotation(0, 0, 0);
        return;
    }

    if (FOLD_OPTIC_TYPES.has(type)) {
        comp.pointAlong(...FOLD_MIRROR_NORMAL);
        return;
    }

    if (AXIAL_OPTIC_TYPES.has(type)) {
        comp.pointAlong(1, 0, 0);
        return;
    }

    comp.pointAlong(1, 0, 0);
}
