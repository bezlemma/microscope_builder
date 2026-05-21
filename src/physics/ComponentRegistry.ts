/**
 * ComponentRegistry — centralizes the mapping between component type names
 * and their constructors.
 *
 * Used as the serialization/deserialization source of truth in:
 *   - ubzSerializer.ts (getTypeName, createComponent)
 *
 * UI presentation metadata lives separately in the UI layer, so this file
 * stays free of React/view dependencies.
 */
import { OpticalComponent } from './Component';
import { Laser } from './components/Laser';
import { Lamp } from './components/Lamp';
import { SphericalLens } from './components/SphericalLens';
import { AsphericLens } from './components/AsphericLens';
import { CurvedMirror } from './components/CurvedMirror';
import { Mirror } from './components/Mirror';
import { Blocker } from './components/Blocker';
import { BeamSplitter } from './components/BeamSplitter';
import { DichroicMirror } from './components/DichroicMirror';
import { SampleChamber } from './components/SampleChamber';
import { Filter } from './components/Filter';
import { OpticalWindow } from './components/OpticalWindow';
import { Camera } from './components/Camera';
import { Sample } from './components/Sample';
import { Objective } from './components/Objective';
import { PrismLens } from './components/PrismLens';
import { Waveplate } from './components/Waveplate';
import { Aperture } from './components/Aperture';
import { CylindricalLens } from './components/CylindricalLens';
import { IdealLens } from './components/IdealLens';
import { Card } from './components/Card';
import { SlitAperture } from './components/SlitAperture';
import { PolygonScanner } from './components/PolygonScanner';
import { PMT } from './components/PMT';
import { GalvoScanHead } from './components/GalvoScanHead';
import { DualGalvoScanHead } from './components/DualGalvoScanHead';
import { DoubleSlit } from './components/DoubleSlit';
import { Diffuser } from './components/Diffuser';
import { PolarizingBeamSplitter } from './components/PolarizingBeamSplitter';
import { AchromatDoublet } from './components/AchromatDoublet';
import { FaradayIsolator } from './components/FaradayIsolator';
import { AOD } from './components/AOD';
import { QPD } from './components/QPD';
import { Rail } from './components/Rail';
import { MediumVolume } from './components/MediumVolume';
import { PointSource2D } from './components/PointSource2D';
import { PointSource3D } from './components/PointSource3D';
import { ConeSource3D } from './components/ConeSource3D';
import { WedgeSource2D } from './components/WedgeSource2D';
import { StructuredSource } from './components/StructuredSource';
import { Annotation } from './components/Annotation';
import { TrappedBead } from './components/TrappedBead';

interface ComponentEntry {
    ctor: abstract new (...args: never[]) => OpticalComponent;
}

/**
 * Master list of all registered component types.
 * Order matters: more specific subclasses must appear before their parents
 * (e.g., CurvedMirror before Mirror, DichroicMirror before Mirror).
 */
const REGISTRY: [string, ComponentEntry][] = [
    ['Laser',           { ctor: Laser }],
    ['Lamp',            { ctor: Lamp }],
    ['AsphericLens',    { ctor: AsphericLens }],
    ['SphericalLens',   { ctor: SphericalLens }],
    ['CurvedMirror',    { ctor: CurvedMirror }],
    ['Mirror',          { ctor: Mirror }],
    ['Blocker',         { ctor: Blocker }],
    ['BeamSplitter',    { ctor: BeamSplitter }],
    ['DichroicMirror',  { ctor: DichroicMirror }],
    ['SampleChamber',   { ctor: SampleChamber }],
    ['Filter',          { ctor: Filter }],
    ['OpticalWindow',   { ctor: OpticalWindow }],
    ['Camera',          { ctor: Camera }],
    ['Sample',          { ctor: Sample }],
    ['Objective',       { ctor: Objective }],
    ['PolygonScanner',  { ctor: PolygonScanner }],
    ['PrismLens',       { ctor: PrismLens }],
    ['Waveplate',       { ctor: Waveplate }],
    ['Aperture',        { ctor: Aperture }],
    ['CylindricalLens', { ctor: CylindricalLens }],
    ['IdealLens',       { ctor: IdealLens }],
    ['Card',            { ctor: Card }],
    ['SlitAperture',    { ctor: SlitAperture }],
    ['PMT',             { ctor: PMT }],
    ['GalvoScanHead',  { ctor: GalvoScanHead }],
    ['DualGalvoScanHead', { ctor: DualGalvoScanHead }],
    ['DoubleSlit',      { ctor: DoubleSlit }],
    ['Diffuser',        { ctor: Diffuser }],
    ['PolarizingBeamSplitter', { ctor: PolarizingBeamSplitter }],
    ['AchromatDoublet', { ctor: AchromatDoublet }],
    ['FaradayIsolator', { ctor: FaradayIsolator }],
    ['AOD',             { ctor: AOD }],
    ['QPD',             { ctor: QPD }],
    ['Rail',            { ctor: Rail }],
    ['MediumVolume',    { ctor: MediumVolume }],
    // Source variants (must appear before any parent class checks; they're leaf classes)
    ['PointSource2D',   { ctor: PointSource2D }],
    ['PointSource3D',   { ctor: PointSource3D }],
    ['ConeSource3D',    { ctor: ConeSource3D }],
    ['WedgeSource2D',   { ctor: WedgeSource2D }],
    ['StructuredSource', { ctor: StructuredSource }],
    ['Annotation',       { ctor: Annotation }],
    ['TrappedBead',      { ctor: TrappedBead }],
];

/**
 * Get the serialization type name for a component instance.
 * Returns null if the component isn't registered (should never happen).
 */
export function getComponentTypeName(comp: OpticalComponent): string | null {
    for (const [name, entry] of REGISTRY) {
        if (comp instanceof entry.ctor) return name;
    }
    return null;
}
