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
import { PrismLens } from '../physics/components/PrismLens';
import { Waveplate } from '../physics/components/Waveplate';
import { BeamSplitter } from '../physics/components/BeamSplitter';
import { Aperture } from '../physics/components/Aperture';
import { SlitAperture } from '../physics/components/SlitAperture';
import { SampleChamber } from '../physics/components/SampleChamber';
import { Filter } from '../physics/components/Filter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { CurvedMirror } from '../physics/components/CurvedMirror';
import { PolygonScanner } from '../physics/components/PolygonScanner';
import { PMT } from '../physics/components/PMT';
import { GalvoScanHead } from '../physics/components/GalvoScanHead';
import { DualGalvoScanHead } from '../physics/components/DualGalvoScanHead';
import {
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
    FilterVisualizer,
    GalvoScanHeadVisualizer,
    IdealLensVisualizer,
    LampVisualizer,
    LensVisualizer,
    MirrorVisualizer,
    PMTVisualizer,
    PolygonScannerVisualizer,
    PrismVisualizer,
    SampleChamberVisualizer,
    SampleVisualizer,
    SlitApertureVisualizer,
    SourceVisualizer,
    WaveplateVisualizer,
    ObjectiveVisualizer,
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
    isPrism: boolean;
    isWaveplate: boolean;
    isAperture: boolean;
    isSlitAperture: boolean;
    isFilter: boolean;
    isDichroic: boolean;
    isCylindrical: boolean;
    isCurvedMirror: boolean;
    isFlatMirror: boolean;
    isPolygonScanner: boolean;
    isSample: boolean;
    isGalvoCapable: boolean;
    isScanHead: boolean;
    isGalvoOrScanHead: boolean;
    isPMT: boolean;
    isCamera: boolean;
    hasSpectralProfile: boolean;
}

interface VisualizerEntry {
    matches: (component: OpticalComponent) => boolean;
    render: (component: OpticalComponent) => React.ReactElement;
}

const VISUALIZER_ENTRIES: VisualizerEntry[] = [
    { matches: (component) => component instanceof DualGalvoScanHead, render: (component) => <DualGalvoScanHeadVisualizer component={component as DualGalvoScanHead} /> },
    { matches: (component) => component instanceof GalvoScanHead, render: (component) => <GalvoScanHeadVisualizer component={component as GalvoScanHead} /> },
    { matches: (component) => component instanceof CurvedMirror, render: (component) => <CurvedMirrorVisualizer component={component as CurvedMirror} /> },
    { matches: (component) => component instanceof ObjectiveCasing, render: (component) => <CasingVisualizer component={component as ObjectiveCasing} /> },
    { matches: (component) => component instanceof Objective, render: (component) => <ObjectiveVisualizer component={component as Objective} /> },
    { matches: (component) => component instanceof IdealLens, render: (component) => <IdealLensVisualizer component={component as IdealLens} /> },
    { matches: (component) => component instanceof SphericalLens, render: (component) => <LensVisualizer component={component as SphericalLens} /> },
    { matches: (component) => component instanceof Laser, render: (component) => <SourceVisualizer component={component as Laser} /> },
    { matches: (component) => component instanceof Lamp, render: (component) => <LampVisualizer component={component as Lamp} /> },
    { matches: (component) => component instanceof Blocker, render: (component) => <BlockerVisualizer component={component as Blocker} /> },
    { matches: (component) => component instanceof Card, render: (component) => <CardVisualizer component={component as Card} /> },
    { matches: (component) => component instanceof SampleChamber, render: (component) => <SampleChamberVisualizer component={component as SampleChamber} /> },
    { matches: (component) => component instanceof Sample, render: (component) => <SampleVisualizer component={component as Sample} /> },
    { matches: (component) => component instanceof Camera, render: (component) => <CameraVisualizer component={component as Camera} /> },
    { matches: (component) => component instanceof PMT, render: (component) => <PMTVisualizer component={component as PMT} /> },
    { matches: (component) => component instanceof CylindricalLens, render: (component) => <CylindricalLensVisualizer component={component as CylindricalLens} /> },
    { matches: (component) => component instanceof PolygonScanner, render: (component) => <PolygonScannerVisualizer component={component as PolygonScanner} /> },
    { matches: (component) => component instanceof PrismLens, render: (component) => <PrismVisualizer component={component as PrismLens} /> },
    { matches: (component) => component instanceof Waveplate, render: (component) => <WaveplateVisualizer component={component as Waveplate} /> },
    { matches: (component) => component instanceof BeamSplitter, render: (component) => <BeamSplitterVisualizer component={component as BeamSplitter} /> },
    { matches: (component) => component instanceof SlitAperture, render: (component) => <SlitApertureVisualizer component={component as SlitAperture} /> },
    { matches: (component) => component instanceof Aperture, render: (component) => <ApertureVisualizer component={component as Aperture} /> },
    { matches: (component) => component instanceof Filter, render: (component) => <FilterVisualizer component={component as Filter} /> },
    { matches: (component) => component instanceof DichroicMirror, render: (component) => <DichroicVisualizer component={component as DichroicMirror} /> },
    { matches: (component) => component instanceof Mirror, render: (component) => <MirrorVisualizer component={component as Mirror} /> },
];

export function getComponentVisualizer(component: OpticalComponent): React.ReactElement | null {
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
    const isPolygonScanner = component instanceof PolygonScanner;
    const isPrism = component instanceof PrismLens && !isPolygonScanner;
    const isWaveplate = component instanceof Waveplate;
    const isAperture = component instanceof Aperture;
    const isSlitAperture = component instanceof SlitAperture;
    const isFilter = component instanceof Filter;
    const isDichroic = component instanceof DichroicMirror;
    const isCylindrical = component instanceof CylindricalLens;
    const isCurvedMirror = component instanceof CurvedMirror;
    const isSample = component instanceof Sample || component instanceof SampleChamber;
    const isScanHead = component instanceof GalvoScanHead || component instanceof DualGalvoScanHead;
    const isFlatMirror = isMirror && !isCurvedMirror && !isDichroic && !isPolygonScanner;
    const isGalvoCapable = isFlatMirror || isCurvedMirror;
    const isPMT = component instanceof PMT;
    const isCamera = component instanceof Camera;

    return {
        isCard,
        isMirror,
        isBlocker,
        isLens,
        isIdealLens,
        isObjective,
        isLaser,
        isLamp,
        isPrism,
        isWaveplate,
        isAperture,
        isSlitAperture,
        isFilter,
        isDichroic,
        isCylindrical,
        isCurvedMirror,
        isFlatMirror,
        isPolygonScanner,
        isSample,
        isGalvoCapable,
        isScanHead,
        isGalvoOrScanHead: isGalvoCapable || isScanHead,
        isPMT,
        isCamera,
        hasSpectralProfile: isFilter || isDichroic,
    };
}
