/**
 * ComponentRegistry — centralizes the mapping between component type names
 * and their constructors.
 *
 * Replaces the need for instanceof dispatch chains in:
 *   - ubzSerializer.ts (getTypeName, createComponent)
 *   - OpticalTable.tsx (visualizer dispatch)
 *   - Inspector.tsx (editor dispatch)
 *
 * When adding a new component type, you register it here ONCE and all
 * dispatch sites pick it up automatically.
 */
import { OpticalComponent } from './Component';
import { Laser } from './components/Laser';
import { Lamp } from './components/Lamp';
import { SphericalLens } from './components/SphericalLens';
import { CurvedMirror } from './components/CurvedMirror';
import { Mirror } from './components/Mirror';
import { Blocker } from './components/Blocker';
import { BeamSplitter } from './components/BeamSplitter';
import { DichroicMirror } from './components/DichroicMirror';
import { SampleChamber } from './components/SampleChamber';
import { Filter } from './components/Filter';
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

/** Registry entry for a component type. */
export interface ComponentEntry {
    /** Constructor for creating instances. */
    ctor: new (...args: any[]) => OpticalComponent;
}

/**
 * Master list of all registered component types.
 * Order matters: more specific subclasses must appear before their parents
 * (e.g., CurvedMirror before Mirror, DichroicMirror before Mirror).
 */
const REGISTRY: [string, ComponentEntry][] = [
    ['Laser',           { ctor: Laser }],
    ['Lamp',            { ctor: Lamp }],
    ['SphericalLens',   { ctor: SphericalLens }],
    ['CurvedMirror',    { ctor: CurvedMirror }],
    ['Mirror',          { ctor: Mirror }],
    ['Blocker',         { ctor: Blocker }],
    ['BeamSplitter',    { ctor: BeamSplitter }],
    ['DichroicMirror',  { ctor: DichroicMirror }],
    ['SampleChamber',   { ctor: SampleChamber }],
    ['Filter',          { ctor: Filter }],
    ['Camera',          { ctor: Camera }],
    ['Sample',          { ctor: Sample }],
    ['Objective',       { ctor: Objective }],
    ['PrismLens',       { ctor: PrismLens }],
    ['Waveplate',       { ctor: Waveplate }],
    ['Aperture',        { ctor: Aperture }],
    ['CylindricalLens', { ctor: CylindricalLens }],
    ['IdealLens',       { ctor: IdealLens }],
    ['Card',            { ctor: Card }],
    ['SlitAperture',    { ctor: SlitAperture }],
    ['PolygonScanner',  { ctor: PolygonScanner }],
    ['PMT',             { ctor: PMT }],
    ['GalvoScanHead',  { ctor: GalvoScanHead }],
    ['DualGalvoScanHead', { ctor: DualGalvoScanHead }],
];

/** Map from type name → entry. */
export const componentsByName = new Map<string, ComponentEntry>(REGISTRY);

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
