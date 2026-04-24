import React from 'react';
import { OpticalComponent } from '../physics/Component';
import { Mirror } from '../physics/components/Mirror';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Laser } from '../physics/components/Laser';
import { Lamp } from '../physics/components/Lamp';
import { Blocker } from '../physics/components/Blocker';
import { Card } from '../physics/components/Card';
import { Sample } from '../physics/components/Sample';
import { Objective } from '../physics/components/Objective';
import { ObjectiveCasing } from '../physics/components/ObjectiveCasing';
import { IdealLens } from '../physics/components/IdealLens';
import { Camera } from '../physics/components/Camera';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { AbstractPolygonOptic } from '../physics/components/AbstractPolygonOptic';
import { Waveplate } from '../physics/components/Waveplate';
import { BeamSplitter } from '../physics/components/BeamSplitter';
import { PolarizingBeamSplitter } from '../physics/components/PolarizingBeamSplitter';
import { Aperture } from '../physics/components/Aperture';
import { SlitAperture } from '../physics/components/SlitAperture';
import { SampleChamber } from '../physics/components/SampleChamber';
import { Diffuser } from '../physics/components/Diffuser';
import { DoubleSlit } from '../physics/components/DoubleSlit';
import { Filter } from '../physics/components/Filter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { CurvedMirror } from '../physics/components/CurvedMirror';
import { PMT } from '../physics/components/PMT';
import { GalvoScanHead } from '../physics/components/GalvoScanHead';
import { DualGalvoScanHead } from '../physics/components/DualGalvoScanHead';
import { AchromatDoublet } from '../physics/components/AchromatDoublet';
import { PupilMaskElement } from '../physics/components/PupilMaskElement';
import { MediumVolume } from '../physics/components/MediumVolume';
import { Rail } from '../physics/components/Rail';
import { PointSource2D } from '../physics/components/PointSource2D';
import { PointSource3D } from '../physics/components/PointSource3D';
import { ConeSource3D } from '../physics/components/ConeSource3D';
import { WedgeSource2D } from '../physics/components/WedgeSource2D';
import { StructuredSource } from '../physics/components/StructuredSource';
import { PointSourceBase } from '../physics/components/PointSourceBase';
import { FaradayIsolator } from '../physics/components/FaradayIsolator';
import { QPD } from '../physics/components/QPD';
import { AOD } from '../physics/components/AOD';
import { Annotation } from '../physics/components/Annotation';
import { AnnotationVisualizer } from './visualizers/AnnotationVisualizer';
import {
    AchromatDoubletVisualizer,
    ApertureVisualizer,
    BeamSplitterVisualizer,
    BlockerVisualizer,
    CameraVisualizer,
    CardVisualizer,
    CasingVisualizer,
    CurvedMirrorVisualizer,
    CylindricalLensVisualizer,
    DichroicVisualizer,
    DualGalvoScanHeadVisualizer,
    DiffuserVisualizer,
    DoubleSlitVisualizer,
    FilterVisualizer,
    GalvoScanHeadVisualizer,
    IdealLensVisualizer,
    LampVisualizer,
    LensVisualizer,
    MirrorVisualizer,
    PMTVisualizer,
    PupilMaskVisualizer,
    PolygonOpticVisualizer,
    SampleChamberVisualizer,
    SampleVisualizer,
    SlitApertureVisualizer,
    SourceVisualizer,
    MediumVolumeVisualizer,
    WaveplateVisualizer,
    ObjectiveVisualizer,
    RailVisualizer,
    PointSourceVisualizer,
    StructuredSourceVisualizer,
    FaradayIsolatorVisualizer,
    QPDVisualizer,
    AODVisualizer,
    GhostVisualizer,
} from './visualizers/ComponentVisualizers';

export interface ComponentCapabilities {
    isCard: boolean;
    isMirror: boolean;
    isBlocker: boolean;
    isLens: boolean;
    isIdealLens: boolean;
    isObjective: boolean;
    isLaser: boolean;
    isLamp: boolean;
    isPolygonOptic: boolean;
    isWaveplate: boolean;
    isAperture: boolean;
    isSlitAperture: boolean;
    isFilter: boolean;
    isDichroic: boolean;
    isCylindrical: boolean;
    isCurvedMirror: boolean;
    isFlatMirror: boolean;
    isSample: boolean;
    isGalvoCapable: boolean;
    isScanHead: boolean;
    isDualGalvo: boolean;
    isGalvoOrScanHead: boolean;
    isPMT: boolean;
    isCamera: boolean;
    isAchromatDoublet: boolean;
    isPupilMask: boolean;
    isMediumVolume: boolean;
    isPointSource2D: boolean;
    isPointSource3D: boolean;
    isConeSource3D: boolean;
    isWedgeSource2D: boolean;
    isStructuredSource: boolean;
    isFaradayIsolator: boolean;
    isQPD: boolean;
    isAOD: boolean;
    isDiffuser: boolean;
    isDoubleSlit: boolean;
    isAnnotation: boolean;
    hasSpectralProfile: boolean;
}

interface VisualizerEntry {
    matches: (component: OpticalComponent) => boolean;
    render: (component: OpticalComponent) => React.ReactElement;
}

const VISUALIZER_ENTRIES: VisualizerEntry[] = [
    { matches: (component) => component instanceof Annotation, render: (component) => <AnnotationVisualizer component={component as Annotation} /> },
    { matches: (component) => component instanceof Rail, render: (component) => <RailVisualizer component={component as Rail} /> },
    { matches: (component) => component instanceof StructuredSource, render: (component) => <StructuredSourceVisualizer component={component as StructuredSource} /> },
    { matches: (component) => component instanceof PointSourceBase, render: (component) => <PointSourceVisualizer component={component as PointSourceBase} /> },
    { matches: (component) => component instanceof DualGalvoScanHead, render: (component) => <DualGalvoScanHeadVisualizer component={component as DualGalvoScanHead} /> },
    { matches: (component) => component instanceof GalvoScanHead, render: (component) => <GalvoScanHeadVisualizer component={component as GalvoScanHead} /> },
    { matches: (component) => component instanceof CurvedMirror, render: (component) => <CurvedMirrorVisualizer component={component as CurvedMirror} /> },
    { matches: (component) => component instanceof ObjectiveCasing, render: (component) => <CasingVisualizer component={component as ObjectiveCasing} /> },
    { matches: (component) => component instanceof Objective, render: (component) => <ObjectiveVisualizer component={component as Objective} /> },
    { matches: (component) => component instanceof IdealLens, render: (component) => <IdealLensVisualizer component={component as IdealLens} /> },
    { matches: (component) => component instanceof AchromatDoublet, render: (component) => <AchromatDoubletVisualizer component={component as AchromatDoublet} /> },
    { matches: (component) => component instanceof SphericalLens, render: (component) => <LensVisualizer component={component as SphericalLens} /> },
    { matches: (component) => component instanceof Laser, render: (component) => <SourceVisualizer component={component as Laser} /> },
    { matches: (component) => component instanceof Lamp, render: (component) => <LampVisualizer component={component as Lamp} /> },
    { matches: (component) => component instanceof Blocker, render: (component) => <BlockerVisualizer component={component as Blocker} /> },
    { matches: (component) => component instanceof Card, render: (component) => <CardVisualizer component={component as Card} /> },
    { matches: (component) => component instanceof SampleChamber, render: (component) => <SampleChamberVisualizer component={component as SampleChamber} /> },
    { matches: (component) => component instanceof Sample, render: (component) => <SampleVisualizer component={component as Sample} /> },
    { matches: (component) => component instanceof Camera, render: (component) => <CameraVisualizer component={component as Camera} /> },
    { matches: (component) => component instanceof QPD, render: (component) => <QPDVisualizer component={component as QPD} /> },
    { matches: (component) => component instanceof PMT, render: (component) => <PMTVisualizer component={component as PMT} /> },
    { matches: (component) => component instanceof CylindricalLens, render: (component) => <CylindricalLensVisualizer component={component as CylindricalLens} /> },
    { matches: (component) => component instanceof AbstractPolygonOptic, render: (component) => <PolygonOpticVisualizer component={component as AbstractPolygonOptic} /> },
    { matches: (component) => component instanceof FaradayIsolator, render: (component) => <FaradayIsolatorVisualizer component={component as FaradayIsolator} /> },
    { matches: (component) => component instanceof AOD, render: (component) => <AODVisualizer component={component as AOD} /> },
    { matches: (component) => component instanceof Waveplate, render: (component) => <WaveplateVisualizer component={component as Waveplate} /> },
    { matches: (component) => component instanceof PupilMaskElement, render: (component) => <PupilMaskVisualizer component={component as PupilMaskElement} /> },
    { matches: (component) => component instanceof BeamSplitter, render: (component) => <BeamSplitterVisualizer component={component as BeamSplitter} /> },
    { matches: (component) => component instanceof PolarizingBeamSplitter, render: (component) => <BeamSplitterVisualizer component={component as unknown as BeamSplitter} /> },
    { matches: (component) => component instanceof DoubleSlit, render: (component) => <DoubleSlitVisualizer component={component as DoubleSlit} /> },
    { matches: (component) => component instanceof SlitAperture, render: (component) => <SlitApertureVisualizer component={component as SlitAperture} /> },
    { matches: (component) => component instanceof Aperture, render: (component) => <ApertureVisualizer component={component as Aperture} /> },
    { matches: (component) => component instanceof Diffuser, render: (component) => <DiffuserVisualizer component={component as Diffuser} /> },
    { matches: (component) => component instanceof Filter, render: (component) => <FilterVisualizer component={component as Filter} /> },
    { matches: (component) => component instanceof MediumVolume, render: (component) => <MediumVolumeVisualizer component={component as MediumVolume} /> },
    { matches: (component) => component instanceof DichroicMirror, render: (component) => <DichroicVisualizer component={component as DichroicMirror} /> },
    { matches: (component) => component instanceof Mirror, render: (component) => <MirrorVisualizer component={component as Mirror} /> },
];

export function getComponentVisualizer(component: OpticalComponent): React.ReactElement | null {
    if (component.isGhost) {
        return <GhostVisualizer component={component} />;
    }
    for (const entry of VISUALIZER_ENTRIES) {
        if (entry.matches(component)) return entry.render(component);
    }
    return null;
}

export function getComponentCapabilities(component: OpticalComponent | null | undefined): ComponentCapabilities {
    const isCard = component instanceof Card;
    const isMirror = component instanceof Mirror;
    const isBlocker = component instanceof Blocker;
    const isLens = component instanceof SphericalLens;
    const isIdealLens = component instanceof IdealLens;
    const isObjective = component instanceof Objective;
    const isLaser = component instanceof Laser;
    const isLamp = component instanceof Lamp;
    const isPolygonOptic = component instanceof AbstractPolygonOptic;
    const isWaveplate = component instanceof Waveplate;
    const isAperture = component instanceof Aperture;
    const isSlitAperture = component instanceof SlitAperture;
    const isFilter = component instanceof Filter;
    const isDichroic = component instanceof DichroicMirror;
    const isCylindrical = component instanceof CylindricalLens;
    const isCurvedMirror = component instanceof CurvedMirror;
    const isSample = component instanceof Sample || component instanceof SampleChamber;
    const isDualGalvo = component instanceof DualGalvoScanHead;
    const isScanHead = component instanceof GalvoScanHead || isDualGalvo;
    const isFlatMirror = isMirror && !isCurvedMirror && !isDichroic && !isPolygonOptic;
    const isGalvoCapable = isFlatMirror || isCurvedMirror;
    const isPMT = component instanceof PMT;
    const isCamera = component instanceof Camera;
    const isAchromatDoublet = component instanceof AchromatDoublet;
    const isPupilMask = component instanceof PupilMaskElement;
    const isMediumVolume = component instanceof MediumVolume;
    const isPointSource2D = component instanceof PointSource2D;
    const isPointSource3D = component instanceof PointSource3D;
    const isConeSource3D = component instanceof ConeSource3D;
    const isWedgeSource2D = component instanceof WedgeSource2D;
    const isStructuredSource = component instanceof StructuredSource;
    const isFaradayIsolator = component instanceof FaradayIsolator;
    const isQPD = component instanceof QPD;
    const isAOD = component instanceof AOD;
    const isDiffuser = component instanceof Diffuser;
    const isDoubleSlit = component instanceof DoubleSlit;
    const isAnnotation = component instanceof Annotation;

    return {
        isCard,
        isMirror,
        isBlocker,
        isLens,
        isIdealLens,
        isObjective,
        isLaser,
        isLamp,
        isPolygonOptic,
        isWaveplate,
        isAperture,
        isSlitAperture,
        isFilter,
        isDichroic,
        isCylindrical,
        isCurvedMirror,
        isFlatMirror,
        isSample,
        isGalvoCapable,
        isScanHead,
        isDualGalvo,
        isGalvoOrScanHead: isGalvoCapable || isScanHead,
        isPMT,
        isCamera,
        isAchromatDoublet,
        isPupilMask,
        isMediumVolume,
        isPointSource2D,
        isPointSource3D,
        isConeSource3D,
        isWedgeSource2D,
        isStructuredSource,
        isFaradayIsolator,
        isQPD,
        isAOD,
        isDiffuser,
        isDoubleSlit,
        isAnnotation,
        hasSpectralProfile: isFilter || isDichroic,
    };
}
