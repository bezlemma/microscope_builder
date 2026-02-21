/**
 * UBZ Serializer — Save/Load scenes as plain-text .ubz files.
 *
 * Format: one block per component, separated by blank lines.
 * Lines starting with # are comments.
 * Each block starts with [ComponentType] and lists key = value pairs.
 */

import { OpticalComponent } from '../physics/Component';
import { Euler } from 'three';

// Component imports
import { Laser } from '../physics/components/Laser';
import { Lamp } from '../physics/components/Lamp';
import { SphericalLens } from '../physics/components/SphericalLens';
import { CurvedMirror } from '../physics/components/CurvedMirror';
import { Mirror } from '../physics/components/Mirror';
import { Blocker } from '../physics/components/Blocker';
import { BeamSplitter } from '../physics/components/BeamSplitter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { Filter } from '../physics/components/Filter';
import { Camera } from '../physics/components/Camera';
import { Sample } from '../physics/components/Sample';
import { Objective } from '../physics/components/Objective';
import { PrismLens } from '../physics/components/PrismLens';
import { Waveplate } from '../physics/components/Waveplate';
import { Aperture } from '../physics/components/Aperture';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { IdealLens } from '../physics/components/IdealLens';
import { Card } from '../physics/components/Card';
import { SampleChamber } from '../physics/components/SampleChamber';
import { SlitAperture } from '../physics/components/SlitAperture';
import { PolygonScanner } from '../physics/components/PolygonScanner';
import { SpectralProfile, ProfilePreset, ProfileBand } from '../physics/SpectralProfile';

// ════════════════════════════════════════════════════════════
//  SERIALIZE
// ════════════════════════════════════════════════════════════

export function serializeScene(components: OpticalComponent[]): string {
    const lines: string[] = [];
    lines.push('# Microscope Builder Scene (.ubz)');
    lines.push(`# Saved: ${new Date().toISOString()}`);
    lines.push('');

    for (const comp of components) {
        const typeName = getTypeName(comp);
        if (!typeName) continue;

        lines.push(`[${typeName}]`);
        lines.push(`id = ${comp.id}`);
        lines.push(`name = ${comp.name}`);

        // Position
        const p = comp.position;
        lines.push(`position = ${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}`);

        // Rotation as Euler angles
        const euler = new Euler().setFromQuaternion(comp.rotation);
        lines.push(`rotation = ${fmt(euler.x)}, ${fmt(euler.y)}, ${fmt(euler.z)}`);

        // Component-specific properties
        writeComponentProps(comp, lines);

        lines.push(''); // blank line separator
    }

    return lines.join('\n');
}

function fmt(n: number): string {
    // Remove trailing zeros, max 8 decimal places
    return parseFloat(n.toFixed(8)).toString();
}

function getTypeName(comp: OpticalComponent): string | null {
    if (comp instanceof Laser) return 'Laser';
    if (comp instanceof Lamp) return 'Lamp';
    if (comp instanceof SphericalLens) return 'SphericalLens';
    if (comp instanceof CurvedMirror) return 'CurvedMirror';
    if (comp instanceof Mirror) return 'Mirror';
    if (comp instanceof Blocker) return 'Blocker';
    if (comp instanceof BeamSplitter) return 'BeamSplitter';
    if (comp instanceof DichroicMirror) return 'DichroicMirror';
    if (comp instanceof SampleChamber) return 'SampleChamber';
    if (comp instanceof Filter) return 'Filter';
    if (comp instanceof Camera) return 'Camera';
    if (comp instanceof Sample) return 'Sample';
    if (comp instanceof Objective) return 'Objective';
    if (comp instanceof PrismLens) return 'PrismLens';
    if (comp instanceof Waveplate) return 'Waveplate';
    if (comp instanceof Aperture) return 'Aperture';
    if (comp instanceof CylindricalLens) return 'CylindricalLens';
    if (comp instanceof IdealLens) return 'IdealLens';
    if (comp instanceof Card) return 'Card';
    if (comp instanceof SlitAperture) return 'SlitAperture';
    if (comp instanceof PolygonScanner) return 'PolygonScanner';
    return null;
}

function writeComponentProps(comp: OpticalComponent, lines: string[]) {
    if (comp instanceof Laser) {
        lines.push(`wavelength = ${fmt(comp.wavelength)}`);
        lines.push(`beamRadius = ${fmt(comp.beamRadius)}`);
        lines.push(`power = ${fmt(comp.power)}`);
    } else if (comp instanceof Lamp) {
        lines.push(`beamRadius = ${fmt(comp.beamRadius)}`);
        lines.push(`power = ${fmt(comp.power)}`);
        lines.push(`spectralWavelengths = ${comp.spectralWavelengths.map(w => fmt(w)).join(', ')}`);
    } else if (comp instanceof SphericalLens) {
        lines.push(`curvature = ${fmt(comp.curvature)}`);
        lines.push(`aperture = ${fmt(comp.apertureRadius)}`);
        lines.push(`thickness = ${fmt(comp.thickness)}`);
        lines.push(`ior = ${fmt(comp.ior)}`);
        if (comp.r1 !== undefined) lines.push(`r1 = ${fmt(comp.r1)}`);
        if (comp.r2 !== undefined) lines.push(`r2 = ${fmt(comp.r2)}`);
    } else if (comp instanceof CurvedMirror) {
        lines.push(`diameter = ${fmt(comp.diameter)}`);
        lines.push(`radiusOfCurvature = ${fmt(comp.radiusOfCurvature)}`);
        lines.push(`thickness = ${fmt(comp.thickness)}`);
    } else if (comp instanceof Mirror) {
        lines.push(`diameter = ${fmt(comp.diameter)}`);
        lines.push(`thickness = ${fmt(comp.thickness)}`);
    } else if (comp instanceof Blocker) {
        lines.push(`diameter = ${fmt(comp.diameter)}`);
        lines.push(`thickness = ${fmt(comp.thickness)}`);
    } else if (comp instanceof BeamSplitter) {
        lines.push(`diameter = ${fmt(comp.diameter)}`);
        lines.push(`thickness = ${fmt(comp.thickness)}`);
        lines.push(`splitRatio = ${fmt(comp.splitRatio)}`);
    } else if (comp instanceof DichroicMirror) {
        lines.push(`diameter = ${fmt(comp.diameter)}`);
        lines.push(`thickness = ${fmt(comp.thickness)}`);
        writeSpectralProfile(comp.spectralProfile, lines);
    } else if (comp instanceof Filter) {
        lines.push(`diameter = ${fmt(comp.diameter)}`);
        lines.push(`thickness = ${fmt(comp.thickness)}`);
        writeSpectralProfile(comp.spectralProfile, lines);
    } else if (comp instanceof Camera) {
        lines.push(`width = ${fmt(comp.width)}`);
        lines.push(`height = ${fmt(comp.height)}`);
        lines.push(`sensorNA = ${fmt(comp.sensorNA)}`);
        lines.push(`samplesPerPixel = ${fmt(comp.samplesPerPixel)}`);
    } else if (comp instanceof SampleChamber) {
        lines.push(`cubeSize = ${fmt(comp.cubeSize)}`);
        lines.push(`wallThickness = ${fmt(comp.wallThickness)}`);
        lines.push(`boreDiameter = ${fmt(comp.boreDiameter)}`);
        writeSpectralProfile(comp.excitationSpectrum, lines, 'excitation');
        writeSpectralProfile(comp.emissionSpectrum, lines, 'emission');
        lines.push(`fluorescenceEfficiency = ${fmt(comp.fluorescenceEfficiency)}`);
        lines.push(`absorption = ${fmt(comp.absorption)}`);
    } else if (comp instanceof Sample) {
        writeSpectralProfile(comp.excitationSpectrum, lines, 'excitation');
        writeSpectralProfile(comp.emissionSpectrum, lines, 'emission');
        lines.push(`fluorescenceEfficiency = ${fmt(comp.fluorescenceEfficiency)}`);
        lines.push(`absorption = ${fmt(comp.absorption)}`);
    } else if (comp instanceof Objective) {
        lines.push(`NA = ${fmt(comp.NA)}`);
        lines.push(`magnification = ${fmt(comp.magnification)}`);
        lines.push(`immersionIndex = ${fmt(comp.immersionIndex)}`);
        lines.push(`workingDistance = ${fmt(comp.workingDistance)}`);
        lines.push(`tubeLensFocal = ${fmt(comp.tubeLensFocal)}`);
        lines.push(`diameter = ${fmt(comp.diameter)}`);
    } else if (comp instanceof PrismLens) {
        lines.push(`apexAngle = ${fmt(comp.apexAngle)}`);
        lines.push(`height = ${fmt(comp.height)}`);
        lines.push(`width = ${fmt(comp.width)}`);
        lines.push(`ior = ${fmt(comp.ior)}`);
    } else if (comp instanceof Waveplate) {
        lines.push(`mode = ${comp.waveplateMode}`);
        lines.push(`apertureRadius = ${fmt(comp.apertureRadius)}`);
        lines.push(`fastAxisAngle = ${fmt(comp.fastAxisAngle)}`);
    } else if (comp instanceof Aperture) {
        lines.push(`openingDiameter = ${fmt(comp.openingDiameter)}`);
        lines.push(`housingDiameter = ${fmt(comp.housingDiameter)}`);
    } else if (comp instanceof CylindricalLens) {
        lines.push(`r1 = ${fmt(comp.r1)}`);
        lines.push(`r2 = ${fmt(comp.r2)}`);
        lines.push(`apertureRadius = ${fmt(comp.apertureRadius)}`);
        lines.push(`width = ${fmt(comp.width)}`);
        lines.push(`thickness = ${fmt(comp.thickness)}`);
        lines.push(`ior = ${fmt(comp.ior)}`);
    } else if (comp instanceof IdealLens) {
        lines.push(`focalLength = ${fmt(comp.focalLength)}`);
        lines.push(`apertureRadius = ${fmt(comp.apertureRadius)}`);
    } else if (comp instanceof Card) {
        lines.push(`width = ${fmt(comp.width)}`);
        lines.push(`height = ${fmt(comp.height)}`);

    } else if (comp instanceof PolygonScanner) {
        lines.push(`numFaces = ${fmt(comp.numFaces)}`);
        lines.push(`inscribedRadius = ${fmt(comp.inscribedRadius)}`);
        lines.push(`faceHeight = ${fmt(comp.faceHeight)}`);
        lines.push(`scanAngle = ${fmt(comp.scanAngle)}`);
    }
}

function writeSpectralProfile(sp: SpectralProfile, lines: string[], prefix: string = 'spectral') {
    lines.push(`${prefix}.preset = ${sp.preset}`);
    lines.push(`${prefix}.cutoffNm = ${fmt(sp.cutoffNm)}`);
    lines.push(`${prefix}.edgeSteepness = ${fmt(sp.edgeSteepness)}`);
    if (sp.bands.length > 0) {
        lines.push(`${prefix}.bands = ${sp.bands.map(b => `${fmt(b.center)}:${fmt(b.width)}`).join('; ')}`);
    }
}

// ════════════════════════════════════════════════════════════
//  DESERIALIZE
// ════════════════════════════════════════════════════════════

interface PropMap { [key: string]: string }

export function deserializeScene(text: string): OpticalComponent[] {
    const components: OpticalComponent[] = [];
    const blocks = parseBlocks(text);

    for (const block of blocks) {
        const comp = createComponent(block.type, block.props);
        if (!comp) {
            console.warn(`UBZ: Unknown component type "${block.type}", skipping`);
            continue;
        }

        // Set common properties
        if (block.props['id']) comp.id = block.props['id'];
        if (block.props['name']) comp.name = block.props['name'];

        if (block.props['position']) {
            const [x, y, z] = block.props['position'].split(',').map(s => parseFloat(s.trim()));
            comp.setPosition(x, y, z);
        }
        if (block.props['rotation']) {
            const [x, y, z] = block.props['rotation'].split(',').map(s => parseFloat(s.trim()));
            comp.setRotation(x, y, z);
        }

        components.push(comp);
    }

    return components;
}

interface Block { type: string; props: PropMap }

function parseBlocks(text: string): Block[] {
    const blocks: Block[] = [];
    let currentType: string | null = null;
    let currentProps: PropMap = {};

    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();

        // Skip comments and empty lines
        if (line.startsWith('#') || line === '') {
            // Empty line ends current block
            if (line === '' && currentType) {
                blocks.push({ type: currentType, props: currentProps });
                currentType = null;
                currentProps = {};
            }
            continue;
        }

        // Type header
        const headerMatch = line.match(/^\[(\w+)\]$/);
        if (headerMatch) {
            // Save previous block if any
            if (currentType) {
                blocks.push({ type: currentType, props: currentProps });
            }
            currentType = headerMatch[1];
            currentProps = {};
            continue;
        }

        // Key = value
        const eqIdx = line.indexOf('=');
        if (eqIdx > 0) {
            const key = line.substring(0, eqIdx).trim();
            const value = line.substring(eqIdx + 1).trim();
            currentProps[key] = value;
        }
    }

    // Final block
    if (currentType) {
        blocks.push({ type: currentType, props: currentProps });
    }

    return blocks;
}

function num(props: PropMap, key: string, fallback: number): number {
    if (props[key] === undefined) return fallback;
    const v = parseFloat(props[key]);
    return isNaN(v) ? fallback : v;
}

function str(props: PropMap, key: string, fallback: string): string {
    return props[key] ?? fallback;
}

function parseSpectralProfile(props: PropMap, prefix: string = 'spectral'): SpectralProfile {
    const preset = str(props, `${prefix}.preset`, 'longpass') as ProfilePreset;
    const cutoffNm = num(props, `${prefix}.cutoffNm`, 500);
    const edgeSteepness = num(props, `${prefix}.edgeSteepness`, 15);
    const bands: ProfileBand[] = [];

    if (props[`${prefix}.bands`]) {
        for (const part of props[`${prefix}.bands`].split(';')) {
            const [center, width] = part.trim().split(':').map(s => parseFloat(s.trim()));
            if (!isNaN(center) && !isNaN(width)) {
                bands.push({ center, width });
            }
        }
    }

    return new SpectralProfile(preset, cutoffNm, bands.length > 0 ? bands : undefined, edgeSteepness);
}

function createComponent(type: string, props: PropMap): OpticalComponent | null {
    switch (type) {
        case 'Laser': {
            const c = new Laser(str(props, 'name', 'Laser'));
            c.wavelength = num(props, 'wavelength', 532);
            c.beamRadius = num(props, 'beamRadius', num(props, 'beamWaist', 2));  // backward compat
            c.power = num(props, 'power', 1);
            return c;
        }
        case 'Lamp': {
            const c = new Lamp(str(props, 'name', 'Lamp'));
            c.beamRadius = num(props, 'beamRadius', num(props, 'beamWaist', 3));  // backward compat
            c.power = num(props, 'power', 1);
            if (props['spectralWavelengths']) {
                c.spectralWavelengths = props['spectralWavelengths'].split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
            }
            return c;
        }
        case 'SphericalLens': {
            const curvature = num(props, 'curvature', 0.02);
            const aperture = num(props, 'aperture', 10);
            const thickness = num(props, 'thickness', 5);
            const ior = num(props, 'ior', 1.5168);
            const r1 = props['r1'] !== undefined ? parseFloat(props['r1']) : undefined;
            const r2 = props['r2'] !== undefined ? parseFloat(props['r2']) : undefined;
            return new SphericalLens(curvature, aperture, thickness, str(props, 'name', 'Lens'), r1, r2, ior);
        }
        case 'CurvedMirror': {
            return new CurvedMirror(
                num(props, 'diameter', 25),
                num(props, 'radiusOfCurvature', 100),
                num(props, 'thickness', 3),
                str(props, 'name', 'Curved Mirror')
            );
        }
        case 'Mirror': {
            return new Mirror(
                num(props, 'diameter', 20),
                num(props, 'thickness', 2),
                str(props, 'name', 'Mirror')
            );
        }
        case 'PolygonScanner': {
            return new PolygonScanner({
                numFaces: num(props, 'numFaces', 6),
                inscribedRadius: num(props, 'inscribedRadius', 10),
                faceHeight: num(props, 'faceHeight', 10),
                scanAngle: num(props, 'scanAngle', 0),
                name: str(props, 'name', 'Polygon Scanner'),
            });
        }
        case 'Blocker': {
            return new Blocker(
                num(props, 'diameter', 20),
                num(props, 'thickness', 5),
                str(props, 'name', 'Blocker')
            );
        }
        case 'BeamSplitter': {
            return new BeamSplitter(
                num(props, 'diameter', 25),
                num(props, 'thickness', 2),
                num(props, 'splitRatio', 0.5),
                str(props, 'name', 'Beam Splitter')
            );
        }
        case 'DichroicMirror': {
            return new DichroicMirror(
                num(props, 'diameter', 25),
                num(props, 'thickness', 2),
                parseSpectralProfile(props),
                str(props, 'name', 'Dichroic')
            );
        }
        case 'Filter': {
            return new Filter(
                num(props, 'diameter', 25),
                num(props, 'thickness', 3),
                parseSpectralProfile(props),
                str(props, 'name', 'Filter')
            );
        }
        case 'Camera': {
            const c = new Camera(
                num(props, 'width', 13),
                num(props, 'height', 13),
                str(props, 'name', 'Camera')
            );
            c.sensorNA = num(props, 'sensorNA', 0);
            c.samplesPerPixel = num(props, 'samplesPerPixel', 1);
            return c;
        }
        case 'Sample': {
            const c = new Sample(str(props, 'name', 'Sample'));
            c.excitationSpectrum = parseSpectralProfile(props, 'excitation');
            c.emissionSpectrum = parseSpectralProfile(props, 'emission');
            c.fluorescenceEfficiency = num(props, 'fluorescenceEfficiency', 1e-4);
            c.absorption = num(props, 'absorption', 3.0);
            return c;
        }
        case 'Objective': {
            return new Objective({
                NA: num(props, 'NA', 0.25),
                magnification: num(props, 'magnification', 10),
                immersionIndex: num(props, 'immersionIndex', 1),
                workingDistance: num(props, 'workingDistance', 10),
                tubeLensFocal: num(props, 'tubeLensFocal', 200),
                diameter: num(props, 'diameter', 20),
                name: str(props, 'name', 'Objective'),
            });
        }
        case 'PrismLens': {
            return new PrismLens(
                num(props, 'apexAngle', Math.PI / 3),
                num(props, 'height', 20),
                num(props, 'width', 20),
                str(props, 'name', 'Prism'),
                num(props, 'ior', 1.5168)
            );
        }
        case 'Waveplate': {
            const mode = str(props, 'mode', 'half') as 'half' | 'quarter' | 'polarizer';
            return new Waveplate(
                mode,
                num(props, 'apertureRadius', 12.5),
                num(props, 'fastAxisAngle', 0),
                str(props, 'name', undefined as any)
            );
        }
        case 'Aperture': {
            return new Aperture(
                num(props, 'openingDiameter', 10),
                num(props, 'housingDiameter', 25),
                str(props, 'name', 'Aperture')
            );
        }
        case 'SlitAperture': {
            return new SlitAperture(
                num(props, 'slitWidth', 5),
                num(props, 'slitHeight', 20),
                num(props, 'housingDiameter', 25),
                str(props, 'name', 'Slit Aperture')
            );
        }
        case 'CylindricalLens': {
            return new CylindricalLens(
                num(props, 'r1', 50),
                num(props, 'r2', -50),
                num(props, 'apertureRadius', 10),
                num(props, 'width', 20),
                num(props, 'thickness', 5),
                str(props, 'name', 'Cylindrical Lens'),
                num(props, 'ior', 1.5168)
            );
        }
        case 'IdealLens': {
            return new IdealLens(
                num(props, 'focalLength', 50),
                num(props, 'apertureRadius', 12.5),
                str(props, 'name', 'Ideal Lens')
            );
        }
        case 'Card': {
            return new Card(
                num(props, 'width', 20),
                num(props, 'height', 20),
                str(props, 'name', 'Card')
            );
        }
        case 'SampleChamber': {
            const sc = new SampleChamber(
                num(props, 'cubeSize', 75),
                num(props, 'wallThickness', 3),
                num(props, 'boreDiameter', 30),
                str(props, 'name', 'L/X Sample Holder')
            );
            sc.excitationSpectrum = parseSpectralProfile(props, 'excitation') ?? sc.excitationSpectrum;
            sc.emissionSpectrum = parseSpectralProfile(props, 'emission') ?? sc.emissionSpectrum;
            sc.fluorescenceEfficiency = num(props, 'fluorescenceEfficiency', 1e-4);
            sc.absorption = num(props, 'absorption', 3.0);
            return sc;
        }
        default:
            return null;
    }
}

// ════════════════════════════════════════════════════════════
//  FILE I/O HELPERS
// ════════════════════════════════════════════════════════════

/** Save scene to a .ubz file using native Save dialog */
export async function downloadUbz(components: OpticalComponent[], filename: string = 'scene.ubz') {
    const text = serializeScene(components);

    // Use File System Access API if available (native save dialog)
    if ('showSaveFilePicker' in window) {
        try {
            const handle = await (window as any).showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'Microscope Builder Scene',
                    accept: { 'text/plain': ['.ubz'] },
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(text);
            await writable.close();
            return;
        } catch (e: any) {
            if (e.name === 'AbortError') return; // User cancelled
            console.warn('Save dialog failed, falling back to download:', e);
        }
    }

    // Fallback: auto-download
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/** Open file picker and load a .ubz file, returns parsed components */
export function openUbzFilePicker(): Promise<OpticalComponent[]> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.ubz';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) { reject(new Error('No file selected')); return; }
            const text = await file.text();
            try {
                const components = deserializeScene(text);
                resolve(components);
            } catch (e) {
                reject(e);
            }
        };
        input.click();
    });
}
