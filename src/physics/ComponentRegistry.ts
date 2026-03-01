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
import { Laser } from '../parts/Laser';
import { Lamp } from '../parts/Lamp';
import { SphericalLens } from '../parts/SphericalLens';
import { AchromaticDoublet } from '../parts/AchromaticDoublet';
import { CurvedMirror } from '../parts/CurvedMirror';
import { Mirror } from '../parts/Mirror';
import { Blocker } from '../parts/Blocker';
import { BeamSplitter } from '../parts/BeamSplitter';
import { DichroicMirror } from '../parts/DichroicMirror';
import { LXSampleHolder } from '../parts/LXSampleHolder';
import { Filter } from '../parts/Filter';
import { Camera } from '../parts/Camera';
import { Sample } from '../parts/Sample';
import { Objective } from '../parts/Objective';
import { PrismLens } from '../parts/PrismLens';
import { Waveplate } from '../parts/Waveplate';
import { Aperture } from '../parts/Aperture';
import { CylindricalLens } from '../parts/CylindricalLens';
import { IdealLens } from '../parts/IdealLens';
import { Card } from '../parts/Card';
import { SlitAperture } from '../parts/SlitAperture';
import { PolygonScanner } from '../parts/PolygonScanner';
import { PMT } from '../parts/PMT';
import { GalvoScanHead } from '../parts/GalvoScanHead';
import { DualGalvoScanHead } from '../parts/DualGalvoScanHead';
import { AsphericLens } from '../parts/AsphericLens';

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
    ['AchromaticDoublet', { ctor: AchromaticDoublet }],
    ['CurvedMirror',    { ctor: CurvedMirror }],
    ['Mirror',          { ctor: Mirror }],
    ['Blocker',         { ctor: Blocker }],
    ['BeamSplitter',    { ctor: BeamSplitter }],
    ['DichroicMirror',  { ctor: DichroicMirror }],
    ['LXSampleHolder',   { ctor: LXSampleHolder }],
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
    ['AsphericLens',    { ctor: AsphericLens }],
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
