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
import { PolygonScanner } from '../physics/components/PolygonScanner';
import { Waveplate } from '../physics/components/Waveplate';
import { BeamSplitter } from '../physics/components/BeamSplitter';
import { PolarizingBeamSplitter } from '../physics/components/PolarizingBeamSplitter';
import { Aperture } from '../physics/components/Aperture';
import { SlitAperture } from '../physics/components/SlitAperture';
import { Filter } from '../physics/components/Filter';
import { Diffuser } from '../physics/components/Diffuser';
import { DoubleSlit } from '../physics/components/DoubleSlit';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { CurvedMirror } from '../physics/components/CurvedMirror';
import { SampleChamber } from '../physics/components/SampleChamber';
import { PMT } from '../physics/components/PMT';
import { AchromatDoublet } from '../physics/components/AchromatDoublet';
import { DualGalvoScanHead } from '../physics/components/DualGalvoScanHead';
import { PupilMaskElement } from '../physics/components/PupilMaskElement';
import { MediumVolume } from '../physics/components/MediumVolume';
import { Rail } from '../physics/components/Rail';
import { PointSource2D } from '../physics/components/PointSource2D';
import { PointSource3D } from '../physics/components/PointSource3D';
import { ConeSource3D } from '../physics/components/ConeSource3D';
import { WedgeSource2D } from '../physics/components/WedgeSource2D';
import { StructuredSource } from '../physics/components/StructuredSource';
import { FaradayIsolator } from '../physics/components/FaradayIsolator';
import { QPD } from '../physics/components/QPD';
import { AOD } from '../physics/components/AOD';
import { Annotation } from '../physics/components/Annotation';
import { SpectralProfile } from '../physics/SpectralProfile';

const FOLD_MIRROR_NORMAL = [Math.SQRT1_2, -Math.SQRT1_2, 0] as const;

const FOLD_OPTIC_TYPES = new Set([
    'mirror',
    'beamSplitter',
    'polarizingBeamSplitter',
    'dichroic',
]);

const AXIAL_OPTIC_TYPES = new Set([
    'lens',
    'laser',
    'lamp',
    'blocker',
    'card',
    'sample',
    'sampleSlide',
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
    'diffuser',
    'doubleSlit',
    'curvedMirror',
    'pmt',
    'achromatDoublet',
    'dualGalvoScanHead',
    'pupilMask',
    'mediumVolume',
    'pointSource2D',
    'pointSource3D',
    'coneSource3D',
    'wedgeSource2D',
    'structuredSource',
    'faradayIsolator',
    'qpd',
    'aod',
    'abstractPlane',
    'textAnnotation',
    'arrowAnnotation',
    'curvedArrowAnnotation',
]);

export function createComponentForType(type: string): OpticalComponent | null {
    if (type === 'lens') return new SphericalLens(1 / 50, 15, 4, 'New Lens');
    if (type === 'mirror') return new Mirror(25, 2, 'New Mirror');
    if (type === 'laser') return new Laser('New Laser');
    if (type === 'lamp') return new Lamp('New Lamp');
    if (type === 'blocker') return new Blocker(20, 5, 'Beam Blocker');
    if (type === 'card') return new Card(20, 20, 'Viewing Card');
    if (type === 'sample') return new Sample('New Sample');
    if (type === 'sampleSlide') return new Sample('2D Sample Holder');
    if (type === 'idealLens') return new IdealLens(50, 15, 'Ideal Lens');
    if (type === 'objective') return new Objective({ magnification: 10, NA: 0.25, name: 'New Objective' });
    if (type === 'camera') return new Camera(13, 13, 'New Camera');
    if (type === 'cylindricalLens') return new CylindricalLens(40, 1e9, 12, 24, 3, 'Cylindrical Lens');
    if (type === 'prism') return new PrismLens(Math.PI / 3, 20, 20, 'Prism');
    if (type === 'abstractPlane') {
        // Blocker-like flat plane using the polygon system
        const plane = new Blocker(25, 3, 'Abstract Plane');
        return plane;
    }
    if (type === 'halfWavePlate') return new Waveplate('half', 12.5, Math.PI / 4, 'lambda/2 Plate');
    if (type === 'quarterWavePlate') return new Waveplate('quarter', 12.5, Math.PI / 4, 'lambda/4 Plate');
    if (type === 'polarizer') return new Waveplate('polarizer', 12.5, 0, 'Linear Polarizer');
    if (type === 'beamSplitter') return new BeamSplitter(25, 2, 0.5, 'Beam Splitter');
    if (type === 'polarizingBeamSplitter') return new PolarizingBeamSplitter(25, 2, 'PBS Cube');
    if (type === 'aperture') return new Aperture(10, 25, 'Aperture');
    if (type === 'slitAperture') return new SlitAperture(0.5, 20, 25, 'Slit Aperture');
    if (type === 'filter') return new Filter(25, 3, new SpectralProfile('bandpass', 500, [{ center: 525, width: 50 }]), 'Filter');
    if (type === 'diffuser') return new Diffuser(25.4, 2, 1 * Math.PI / 180, 'Diffuser');
    if (type === 'doubleSlit') return new DoubleSlit(0.5, 2, 20, 25, 'Double Slit');
    if (type === 'dichroic') return new DichroicMirror(25, 2, new SpectralProfile('longpass', 500), 'Dichroic');
    if (type === 'curvedMirror') return new CurvedMirror(25, 100, 3, 'Curved Mirror');
    if (type === 'polygonScanner') return new PolygonScanner({ numFaces: 6, inscribedRadius: 10, faceHeight: 10, name: 'Polygon Scanner' });
    if (type === 'lChamber') return new SampleChamber(75, 3, 30, 'X Sample Holder');
    if (type === 'pmt') return new PMT(10, 10, 'PMT Detector');
    if (type === 'achromatDoublet') return new AchromatDoublet();
    if (type === 'dualGalvoScanHead') return new DualGalvoScanHead();
    if (type === 'pupilMask') return new PupilMaskElement();
    if (type === 'mediumVolume') return new MediumVolume();
    if (type === 'rail') return new Rail();
    if (type === 'pointSource2D') return new PointSource2D();
    if (type === 'pointSource3D') return new PointSource3D();
    if (type === 'coneSource3D') return new ConeSource3D();
    if (type === 'wedgeSource2D') return new WedgeSource2D();
    if (type === 'structuredSource') return new StructuredSource();
    if (type === 'faradayIsolator') return new FaradayIsolator();
    if (type === 'qpd') return new QPD();
    if (type === 'aod') return new AOD();
    if (type === 'textAnnotation') return new Annotation('text', 'Text Label', 'Label');
    if (type === 'arrowAnnotation') return new Annotation('arrow', 'Arrow', '', 60);
    if (type === 'curvedArrowAnnotation') return new Annotation('curvedArrow', 'Curved Arrow', '', 60);
    return null;
}

/**
 * Default palette orientation for a newly dropped component.
 * A usable default optic should stand upright, with its forward axis in the XY plane.
 */
export function applyDefaultPlacementOrientation(comp: OpticalComponent, type: string): void {
    if (type === 'rail') {
        // Rail orientation is determined by its endpoints, not placement rotation
        return;
    }

    if (type === 'lChamber') {
        comp.setRotation(0, 0, 0);
        return;
    }

    if (type === 'polygonScanner') {
        // PolygonScanner uses profileAxes=[0,1] (XY profile), extrusion along Z.
        // Identity rotation already puts the polygon face-up in top-down view.
        comp.setRotation(0, 0, 0);
        return;
    }

    if (type === 'prism') {
        // PrismLens uses profileAxes=[1,2] (YZ profile), extrusion along local X.
        // Without a rotation, the triangle profile lives in the world YZ plane —
        // edge-on from above, so the prism looks like a rectangle in top-down view
        // and there is no obvious rotation to fix that. Orient it so the triangle
        // lies flat in the world XY plane (visible top-down) with the extrusion
        // axis standing vertical along world Z.
        //
        //   local X (extrusion)  → world Z  (vertical column)
        //   local Y (apex axis)  → world X  (horizontal)
        //   local Z (base axis)  → world Y  (horizontal)
        comp.panAngle = Math.PI / 2;
        comp.tiltAngle = 0;
        comp.rollAngle = Math.PI / 2;
        comp.recomputeRotation();
        return;
    }

    if (FOLD_OPTIC_TYPES.has(type)) {
        comp.pointAlong(...FOLD_MIRROR_NORMAL);
        return;
    }

    if (AXIAL_OPTIC_TYPES.has(type)) {
        comp.pointAlong(1, 0, 0);
        // Cylindrical lens: default roll = 90° so the cylinder axis is
        // vertical (world Z), making curvature visible in top-down view.
        if (type === 'cylindricalLens') {
            comp.rollAngle = Math.PI / 2;
            comp.recomputeRotation();
        }
        return;
    }

    comp.pointAlong(1, 0, 0);
}
