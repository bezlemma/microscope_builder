/**
 * UBZ Serializer — Save/Load scenes as plain-text .ubz files.
 *
 * Format: one block per component, separated by blank lines.
 * Lines starting with # are comments.
 * Each block starts with [ComponentType] and lists key = value pairs.
 */

import { OpticalComponent } from '../physics/Component';
import { Euler, Vector3 } from 'three';

// Component imports
import { Laser } from '../physics/components/Laser';
import { getComponentTypeName } from '../physics/ComponentRegistry';
import { Lamp } from '../physics/components/Lamp';
import { SphericalLens } from '../physics/components/SphericalLens';
import { AsphericLens } from '../physics/components/AsphericLens';
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
import { GalvoScanHead } from '../physics/components/GalvoScanHead';
import { DualGalvoScanHead } from '../physics/components/DualGalvoScanHead';
import { PMT } from '../physics/components/PMT';
import { DoubleSlit } from '../physics/components/DoubleSlit';
import { Diffuser } from '../physics/components/Diffuser';
import { PolarizingBeamSplitter } from '../physics/components/PolarizingBeamSplitter';
import { AchromatDoublet } from '../physics/components/AchromatDoublet';
import { FaradayIsolator } from '../physics/components/FaradayIsolator';
import { AOD } from '../physics/components/AOD';
import { QPD } from '../physics/components/QPD';
import { Rail } from '../physics/components/Rail';
import { MediumVolume } from '../physics/components/MediumVolume';
import { PupilMaskElement } from '../physics/components/PupilMaskElement';
import { TrappedBead } from '../physics/components/TrappedBead';
import { PointSource2D } from '../physics/components/PointSource2D';
import { PointSource3D } from '../physics/components/PointSource3D';
import { ConeSource3D } from '../physics/components/ConeSource3D';
import { WedgeSource2D } from '../physics/components/WedgeSource2D';
import { StructuredSource } from '../physics/components/StructuredSource';
import { Annotation, type AnnotationKind } from '../physics/components/Annotation';
import { SpectralProfile, ProfilePreset, ProfileBand } from '../physics/SpectralProfile';
import type { ZernikeCoefficient } from '../physics/PupilFunction';
import type { CatalogAttachment, CatalogVendor } from '../catalog/types';

// ════════════════════════════════════════════════════════════
//  SERIALIZE
// ════════════════════════════════════════════════════════════

export function serializeScene(components: OpticalComponent[]): string {
    const lines: string[] = [];
    lines.push('# Microscope Builder Scene (.ubz)');
    lines.push(`# Saved: ${new Date().toISOString()}`);
    lines.push('');

    for (const comp of components) {
        // Skip non-persistent components:
        //   - Ghost components are tutorial / preview scaffolding, not part of
        //     the user's scene. Persisting them would turn drag-target hints
        //     into permanent real components on the next load.
        //   - Subcomponents (e.g. DualGalvoScanHead's child mirrors) are
        //     auto-recreated by their parent's deserializer; persisting them
        //     would produce duplicate orphan mirrors. Managed trapped beads
        //     are the exception because their dynamic specimen state belongs
        //     to the flow-cell sample and needs to survive save/load.
        if (comp.isGhost || (comp.isSubComponent && !(comp instanceof TrappedBead && comp.parentSampleId))) continue;

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
        writeCatalogProps(comp, lines);

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

type SourceLike = {
    wavelength: number;
    beamRadius: number;
    power: number;
};

function writeSourceProps(source: SourceLike, lines: string[]) {
    lines.push(`wavelength = ${fmt(source.wavelength)}`);
    lines.push(`beamRadius = ${fmt(source.beamRadius)}`);
    lines.push(`power = ${fmt(source.power)}`);
}

function escapeTextValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function unescapeTextValue(value: string): string {
    let result = '';
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch !== '\\' || i === value.length - 1) {
            result += ch;
            continue;
        }
        const next = value[++i];
        if (next === 'n') result += '\n';
        else if (next === 'r') result += '\r';
        else result += next;
    }
    return result;
}

function writeCatalogProps(comp: OpticalComponent, lines: string[]): void {
    const catalog = comp.catalog;
    if (!catalog) return;
    lines.push(`catalog.partId = ${escapeTextValue(catalog.partId)}`);
    lines.push(`catalog.vendor = ${catalog.vendor}`);
    lines.push(`catalog.sku = ${escapeTextValue(catalog.sku)}`);
    lines.push(`catalog.title = ${escapeTextValue(catalog.title)}`);
    lines.push(`catalog.productUrl = ${escapeTextValue(catalog.productUrl)}`);
    lines.push(`catalog.snapshotVersion = ${escapeTextValue(catalog.snapshotVersion)}`);
    lines.push(`catalog.attachedAt = ${escapeTextValue(catalog.attachedAt)}`);
    lines.push(`catalog.confidence = ${catalog.confidence}`);
    if (catalog.price) {
        lines.push(`catalog.price.amount = ${fmt(catalog.price.amount)}`);
        lines.push(`catalog.price.currency = ${catalog.price.currency}`);
        lines.push(`catalog.price.quantity = ${fmt(catalog.price.quantity)}`);
        lines.push(`catalog.price.region = ${escapeTextValue(catalog.price.region)}`);
        lines.push(`catalog.price.checkedAt = ${escapeTextValue(catalog.price.checkedAt)}`);
        lines.push(`catalog.price.sourceUrl = ${escapeTextValue(catalog.price.sourceUrl)}`);
    }
}

function getTypeName(comp: OpticalComponent): string | null {
    return getComponentTypeName(comp);
}

function writeComponentProps(comp: OpticalComponent, lines: string[]) {
    if (comp instanceof Laser) {
        lines.push(`wavelength = ${fmt(comp.wavelength)}`);
        lines.push(`beamRadius = ${fmt(comp.beamRadius)}`);
        lines.push(`power = ${fmt(comp.power)}`);
        lines.push(`isOn = ${comp.isOn ? 'true' : 'false'}`);
        lines.push(`polarizationAngle = ${fmt(comp.polarizationAngle)}`);
    } else if (comp instanceof Lamp) {
        lines.push(`beamRadius = ${fmt(comp.beamRadius)}`);
        lines.push(`power = ${fmt(comp.power)}`);
        lines.push(`sourcePointCount = ${fmt(comp.sourcePointCount)}`);
        lines.push(`emitterRadius = ${fmt(comp.emitterRadius)}`);
        lines.push(`spectralWavelengths = ${comp.spectralWavelengths.map(w => fmt(w)).join(', ')}`);
    } else if (comp instanceof PointSource2D || comp instanceof PointSource3D) {
        writeSourceProps(comp, lines);
    } else if (comp instanceof ConeSource3D) {
        writeSourceProps(comp, lines);
        lines.push(`halfAngle = ${fmt(comp.halfAngle)}`);
    } else if (comp instanceof WedgeSource2D) {
        writeSourceProps(comp, lines);
        lines.push(`subtendedAngle = ${fmt(comp.subtendedAngle)}`);
    } else if (comp instanceof StructuredSource) {
        writeSourceProps(comp, lines);
        lines.push(`diameter = ${fmt(comp.diameter)}`);
        lines.push(`asciiChar = ${escapeTextValue(comp.asciiChar)}`);
    } else if (comp instanceof AsphericLens) {
        lines.push(`r1 = ${fmt(comp.r1)}`);
        lines.push(`r2 = ${fmt(comp.r2)}`);
        lines.push(`k1 = ${fmt(comp.k1)}`);
        lines.push(`k2 = ${fmt(comp.k2)}`);
        if (comp.A1.length > 0) lines.push(`a1 = ${comp.A1.map(fmt).join(',')}`);
        if (comp.A2.length > 0) lines.push(`a2 = ${comp.A2.map(fmt).join(',')}`);
        lines.push(`aperture = ${fmt(comp.apertureRadius)}`);
        lines.push(`thickness = ${fmt(comp.thickness)}`);
        lines.push(`ior = ${fmt(comp.ior)}`);
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
        lines.push(`sensorResX = ${fmt(comp.sensorResX)}`);
        lines.push(`sensorResY = ${fmt(comp.sensorResY)}`);
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
        lines.push(`specimenRotation = ${fmt(comp.specimenRotation.x)}, ${fmt(comp.specimenRotation.y)}, ${fmt(comp.specimenRotation.z)}`);
        lines.push(`specimenOffset = ${fmt(comp.specimenOffset.x)}, ${fmt(comp.specimenOffset.y)}, ${fmt(comp.specimenOffset.z)}`);
    } else if (comp instanceof TrappedBead) {
        lines.push(`diameter = ${fmt(comp.diameter)}`);
        lines.push(`iorBead = ${fmt(comp.iorBead)}`);
        lines.push(`iorMedium = ${fmt(comp.iorMedium)}`);
        lines.push(`viscosity = ${fmt(comp.viscosity)}`);
        lines.push(`temperatureK = ${fmt(comp.temperatureK)}`);
        lines.push(`displayScale = ${fmt(comp.displayScale)}`);
        lines.push(`thermalMotionScale = ${fmt(comp.thermalMotionScale)}`);
        lines.push(`rayMomentumScale = ${fmt(comp.rayMomentumScale)}`);
        lines.push(`surfaceReflectionScale = ${fmt(comp.surfaceReflectionScale)}`);
        lines.push(`gradientForceScale = ${fmt(comp.gradientForceScale)}`);
        lines.push(`trapCaptureRadius = ${fmt(comp.trapCaptureRadius)}`);
        lines.push(`trapAxialCaptureRange = ${fmt(comp.trapAxialCaptureRange)}`);
        lines.push(`visualGlowRadius = ${fmt(comp.visualGlowRadius)}`);
        lines.push(`glowColor = ${comp.glowColor}`);
        if (comp.parentSampleId) {
            lines.push(`parentSampleId = ${comp.parentSampleId}`);
            lines.push(`managedBySample = true`);
        }
        // Save the running offset so a serialized scene reloads with the
        // bead at wherever it had drifted to.
        lines.push(`specimenOffset = ${fmt(comp.specimenOffset.x)}, ${fmt(comp.specimenOffset.y)}, ${fmt(comp.specimenOffset.z)}`);
        if (comp.confinementHalfSize) {
            lines.push(`confinementHalfSize = ${fmt(comp.confinementHalfSize.x)}, ${fmt(comp.confinementHalfSize.y)}, ${fmt(comp.confinementHalfSize.z)}`);
        }
    } else if (comp instanceof Sample) {
        writeSpectralProfile(comp.excitationSpectrum, lines, 'excitation');
        writeSpectralProfile(comp.emissionSpectrum, lines, 'emission');
        lines.push(`fluorescenceEfficiency = ${fmt(comp.fluorescenceEfficiency)}`);
        lines.push(`absorption = ${fmt(comp.absorption)}`);
        lines.push(`specimenRotation = ${fmt(comp.specimenRotation.x)}, ${fmt(comp.specimenRotation.y)}, ${fmt(comp.specimenRotation.z)}`);
        lines.push(`specimenOffset = ${fmt(comp.specimenOffset.x)}, ${fmt(comp.specimenOffset.y)}, ${fmt(comp.specimenOffset.z)}`);
        lines.push(`specimenKind = ${comp.specimenKind}`);
        if (comp.specimenKind === 'colloids') {
            lines.push(`flowCellWidth = ${fmt(comp.flowCellWidth)}`);
            lines.push(`flowCellHeight = ${fmt(comp.flowCellHeight)}`);
            lines.push(`flowCellDepth = ${fmt(comp.flowCellDepth)}`);
            lines.push(`flowCellGlassThickness = ${fmt(comp.flowCellGlassThickness)}`);
            lines.push(`fillMediumIndex = ${fmt(comp.fillMediumIndex)}`);
            lines.push(`colloidGlowColor = ${comp.colloidGlowColor}`);
            lines.push(`colloidTemperatureK = ${fmt(comp.colloidTemperatureK)}`);
            lines.push(`colloidViscosity = ${fmt(comp.colloidViscosity)}`);
            lines.push(`colloidDiffusionScale = ${fmt(comp.colloidDiffusionScale)}`);
            lines.push(`colloids = ${formatColloids(comp)}`);
        }
    } else if (comp instanceof Objective) {
        lines.push(`NA = ${fmt(comp.NA)}`);
        lines.push(`magnification = ${fmt(comp.magnification)}`);
        lines.push(`immersionIndex = ${fmt(comp.immersionIndex)}`);
        lines.push(`workingDistance = ${fmt(comp.workingDistance)}`);
        lines.push(`tubeLensFocal = ${fmt(comp.tubeLensFocal)}`);
        lines.push(`diameter = ${fmt(comp.diameter)}`);
        lines.push(`coverslipThickness = ${fmt(comp.coverslipThickness)}`);
        lines.push(`fieldNumber = ${fmt(comp.fieldNumber)}`);
        lines.push(`immersionMediumKind = ${comp.immersionMediumKind}`);
        if (comp.pupil?.aberrations && comp.pupil.aberrations.coefficients.length > 0) {
            lines.push(`pupilReferenceWavelengthNm = ${fmt(comp.pupil.aberrations.referenceWavelengthNm)}`);
            lines.push(`pupilZernike = ${comp.pupil.aberrations.coefficients.map(({ index, coefficient }) => `${index}:${fmt(coefficient)}`).join('; ')}`);
        }
    } else if (comp instanceof PolygonScanner) {
        lines.push(`numFaces = ${fmt(comp.numFaces)}`);
        lines.push(`inscribedRadius = ${fmt(comp.inscribedRadius)}`);
        lines.push(`faceHeight = ${fmt(comp.faceHeight)}`);
        lines.push(`scanAngle = ${fmt(comp.scanAngle)}`);
        lines.push(`vertices = ${formatVertices(comp.vertices)}`);
        lines.push(`faceROC = ${comp.faceROC.map((value) => Number.isFinite(value) ? fmt(value) : 'Infinity').join(', ')}`);
    } else if (comp instanceof PrismLens) {
        lines.push(`apexAngle = ${fmt(comp.apexAngle)}`);
        lines.push(`height = ${fmt(comp.height)}`);
        lines.push(`width = ${fmt(comp.width)}`);
        lines.push(`ior = ${fmt(comp.ior)}`);
        lines.push(`vertices = ${formatVertices(comp.vertices)}`);
        lines.push(`faceROC = ${comp.faceROC.map((value) => Number.isFinite(value) ? fmt(value) : 'Infinity').join(', ')}`);
    } else if (comp instanceof Waveplate) {
        lines.push(`mode = ${comp.waveplateMode}`);
        lines.push(`apertureRadius = ${fmt(comp.apertureRadius)}`);
        lines.push(`fastAxisAngle = ${fmt(comp.fastAxisAngle)}`);
    } else if (comp instanceof Aperture) {
        lines.push(`openingDiameter = ${fmt(comp.openingDiameter)}`);
        lines.push(`housingDiameter = ${fmt(comp.housingDiameter)}`);
        lines.push(`thickness = ${fmt(comp.thickness)}`);
    } else if (comp instanceof SlitAperture) {
        lines.push(`slitWidth = ${fmt(comp.slitWidth)}`);
        lines.push(`slitHeight = ${fmt(comp.slitHeight)}`);
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
        lines.push(`opaque = ${comp.opaque ? 'true' : 'false'}`);
    } else if (comp instanceof GalvoScanHead) {
        lines.push(`diameter = ${fmt(comp.diameter)}`);
        lines.push(`thickness = ${fmt(comp.thickness)}`);
        lines.push(`scanX = ${fmt(comp.scanX)}`);
        lines.push(`scanY = ${fmt(comp.scanY)}`);
    } else if (comp instanceof DualGalvoScanHead) {
        lines.push(`mirrorSpacing = ${fmt(comp.mirrorSpacing)}`);
        lines.push(`mirrorDiameter = ${fmt(comp.mirrorDiameter)}`);
        lines.push(`scanX = ${fmt(comp.scanX)}`);
        lines.push(`scanY = ${fmt(comp.scanY)}`);
    } else if (comp instanceof PMT) {
        lines.push(`width = ${fmt(comp.width)}`);
        lines.push(`height = ${fmt(comp.height)}`);
        lines.push(`sensorNA = ${fmt(comp.sensorNA)}`);
        lines.push(`samplesPerPixel = ${fmt(comp.samplesPerPixel)}`);
        if (comp.xAxisComponentId) lines.push(`xAxisComponentId = ${comp.xAxisComponentId}`);
        if (comp.xAxisProperty) lines.push(`xAxisProperty = ${comp.xAxisProperty}`);
        if (comp.yAxisComponentId) lines.push(`yAxisComponentId = ${comp.yAxisComponentId}`);
        if (comp.yAxisProperty) lines.push(`yAxisProperty = ${comp.yAxisProperty}`);
        lines.push(`pmtSampleHz = ${fmt(comp.pmtSampleHz)}`);
        lines.push(`scanResX = ${fmt(comp.scanResX)}`);
        lines.push(`scanResY = ${fmt(comp.scanResY)}`);
    } else if (comp instanceof AchromatDoublet) {
        lines.push(`r1 = ${fmt(comp.r1)}`);
        lines.push(`r2 = ${fmt(comp.r2)}`);
        lines.push(`r3 = ${fmt(comp.r3)}`);
        lines.push(`t1 = ${fmt(comp.t1)}`);
        lines.push(`t2 = ${fmt(comp.t2)}`);
        lines.push(`apertureRadius = ${fmt(comp.apertureRadius)}`);
        lines.push(`ior1 = ${fmt(comp.ior1)}`);
        lines.push(`ior2 = ${fmt(comp.ior2)}`);
    } else if (comp instanceof DoubleSlit) {
        lines.push(`slitWidth = ${fmt(comp.slitWidth)}`);
        lines.push(`slitSeparation = ${fmt(comp.slitSeparation)}`);
        lines.push(`slitHeight = ${fmt(comp.slitHeight)}`);
        lines.push(`housingDiameter = ${fmt(comp.housingDiameter)}`);
    } else if (comp instanceof Diffuser) {
        lines.push(`diameter = ${fmt(comp.diameter)}`);
        lines.push(`thickness = ${fmt(comp.thickness)}`);
        lines.push(`coneHalfAngle = ${fmt(comp.coneHalfAngle)}`);
    } else if (comp instanceof PolarizingBeamSplitter) {
        lines.push(`diameter = ${fmt(comp.diameter)}`);
        lines.push(`thickness = ${fmt(comp.thickness)}`);
    } else if (comp instanceof FaradayIsolator) {
        lines.push(`insertionLoss = ${fmt(comp.insertionLoss)}`);
        lines.push(`extinctionDB = ${fmt(comp.extinctionDB)}`);
        lines.push(`apertureRadius = ${fmt(comp.apertureRadius)}`);
    } else if (comp instanceof AOD) {
        lines.push(`deflectionAngle = ${fmt(comp.deflectionAngle)}`);
        lines.push(`efficiency = ${fmt(comp.efficiency)}`);
        lines.push(`maxAngle = ${fmt(comp.maxAngle)}`);
        lines.push(`apertureRadius = ${fmt(comp.apertureRadius)}`);
    } else if (comp instanceof QPD) {
        lines.push(`activeDiameter = ${fmt(comp.activeDiameter)}`);
        lines.push(`gapWidth = ${fmt(comp.gapWidth)}`);
        lines.push(`backstopTransmission = ${fmt(comp.backstopTransmission)}`);
    } else if (comp instanceof MediumVolume) {
        lines.push(`width = ${fmt(comp.width)}`);
        lines.push(`height = ${fmt(comp.height)}`);
        lines.push(`depth = ${fmt(comp.depth)}`);
        lines.push(`refractiveIndex = ${fmt(comp.refractiveIndex)}`);
        lines.push(`exteriorRefractiveIndex = ${fmt(comp.exteriorRefractiveIndex)}`);
        lines.push(`visualMode = ${comp.visualMode}`);
        lines.push(`bridgeStartRadius = ${fmt(comp.bridgeStartRadius)}`);
        lines.push(`bridgeEndRadius = ${fmt(comp.bridgeEndRadius)}`);
    } else if (comp instanceof PupilMaskElement) {
        lines.push(`mode = ${comp.mode}`);
        lines.push(`radius = ${fmt(comp.radius)}`);
        lines.push(`thickness = ${fmt(comp.thickness)}`);
        lines.push(`innerRadius = ${fmt(comp.innerRadius)}`);
        lines.push(`outerRadius = ${fmt(comp.outerRadius)}`);
        lines.push(`ringTransmission = ${fmt(comp.ringTransmission)}`);
        lines.push(`ringPhaseShift = ${fmt(comp.ringPhaseShift)}`);
        lines.push(`backgroundTransmission = ${fmt(comp.backgroundTransmission)}`);
        lines.push(`backgroundPhaseShift = ${fmt(comp.backgroundPhaseShift)}`);
        lines.push(`resolution = ${fmt(comp.resolution)}`);
    } else if (comp instanceof Rail) {
        lines.push(`holeA = ${fmt(comp.holeA.x)}, ${fmt(comp.holeA.y)}, ${fmt(comp.holeA.z)}`);
        lines.push(`holeB = ${fmt(comp.holeB.x)}, ${fmt(comp.holeB.y)}, ${fmt(comp.holeB.z)}`);
    } else if (comp instanceof Annotation) {
        lines.push(`kind = ${comp.kind}`);
        lines.push(`text = ${escapeTextValue(comp.text)}`);
        lines.push(`length = ${fmt(comp.length)}`);
        lines.push(`fontSize = ${fmt(comp.fontSize)}`);
        lines.push(`color = ${comp.color}`);
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
const MAX_LAMP_SOURCE_POINTS = 32;

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
        comp.catalog = parseCatalogProps(block.props);

        components.push(comp);
        // DualGalvoScanHead is composite — its child mirrors must also be in the scene
        if (comp instanceof DualGalvoScanHead) {
            components.push(...comp.getManagedSubcomponents());
        }
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

function finiteNum(props: PropMap, key: string, fallback: number): number {
    const value = num(props, key, fallback);
    return Number.isFinite(value) ? value : fallback;
}

function intRange(props: PropMap, key: string, fallback: number, min: number, max: number): number {
    const value = Math.round(finiteNum(props, key, fallback));
    return Math.max(min, Math.min(max, value));
}

function bool(props: PropMap, key: string, fallback: boolean): boolean {
    const value = props[key]?.trim().toLowerCase();
    if (value === undefined) return fallback;
    if (['true', '1', 'yes', 'on'].includes(value)) return true;
    if (['false', '0', 'no', 'off'].includes(value)) return false;
    return fallback;
}

function parseCatalogProps(props: PropMap): CatalogAttachment | undefined {
    const partId = props['catalog.partId'];
    const vendor = props['catalog.vendor'];
    const sku = props['catalog.sku'];
    if (!partId || !vendor || !sku) return undefined;

    const amount = props['catalog.price.amount'] !== undefined
        ? parseFloat(props['catalog.price.amount'])
        : NaN;
    const hasPrice = Number.isFinite(amount) && Boolean(props['catalog.price.currency']);

    return {
        partId: unescapeTextValue(partId),
        vendor: vendor as CatalogVendor,
        sku: unescapeTextValue(sku),
        title: unescapeTextValue(str(props, 'catalog.title', sku)),
        productUrl: unescapeTextValue(str(props, 'catalog.productUrl', '')),
        snapshotVersion: unescapeTextValue(str(props, 'catalog.snapshotVersion', 'unknown')),
        attachedAt: unescapeTextValue(str(props, 'catalog.attachedAt', '')),
        confidence: str(props, 'catalog.confidence', 'approximate') as CatalogAttachment['confidence'],
        price: hasPrice
            ? {
                amount,
                currency: str(props, 'catalog.price.currency', 'USD'),
                quantity: num(props, 'catalog.price.quantity', 1),
                region: unescapeTextValue(str(props, 'catalog.price.region', 'US')),
                checkedAt: unescapeTextValue(str(props, 'catalog.price.checkedAt', '')),
                sourceUrl: unescapeTextValue(str(props, 'catalog.price.sourceUrl', '')),
            }
            : undefined,
    };
}

function parseLampSpectralWavelengths(value: string | undefined): number[] | null {
    if (value === undefined) return null;
    const wavelengths = value
        .split(',')
        .map(s => parseFloat(s.trim()))
        .filter(wavelength => Number.isFinite(wavelength) && wavelength > 0);
    return wavelengths.length > 0 ? wavelengths : null;
}

function str(props: PropMap, key: string, fallback: string): string {
    return props[key] ?? fallback;
}

function parseSpectralProfile(props: PropMap, prefix: string = 'spectral'): SpectralProfile | null {
    if (!Object.prototype.hasOwnProperty.call(props, `${prefix}.preset`) &&
        !Object.prototype.hasOwnProperty.call(props, `${prefix}.cutoffNm`) &&
        !Object.prototype.hasOwnProperty.call(props, `${prefix}.edgeSteepness`) &&
        !Object.prototype.hasOwnProperty.call(props, `${prefix}.bands`)) {
        return null;
    }
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

function formatColloids(sample: Sample): string {
    return sample.colloidSpheres.map(sphere => [
        fmt(sphere.center.x),
        fmt(sphere.center.y),
        fmt(sphere.center.z),
        fmt(sphere.radius),
        sphere.glowColor ?? sample.colloidGlowColor,
    ].join(':')).join('; ');
}

function parseSampleSpecimenProps(sample: Sample, props: PropMap): void {
    const kind = str(props, 'specimenKind', sample.specimenKind);
    if (kind !== 'colloids') return;

    sample.specimenKind = 'colloids';
    sample.flowCellWidth = num(props, 'flowCellWidth', sample.flowCellWidth);
    sample.flowCellHeight = num(props, 'flowCellHeight', sample.flowCellHeight);
    sample.flowCellDepth = num(props, 'flowCellDepth', sample.flowCellDepth);
    sample.flowCellGlassThickness = num(props, 'flowCellGlassThickness', sample.flowCellGlassThickness);
    sample.fillMediumIndex = num(props, 'fillMediumIndex', sample.fillMediumIndex);
    sample.colloidGlowColor = str(props, 'colloidGlowColor', sample.colloidGlowColor);
    sample.colloidTemperatureK = num(props, 'colloidTemperatureK', sample.colloidTemperatureK);
    sample.colloidViscosity = num(props, 'colloidViscosity', sample.colloidViscosity);
    sample.colloidDiffusionScale = num(props, 'colloidDiffusionScale', sample.colloidDiffusionScale);

    const raw = props['colloids'];
    if (!raw) {
        sample.colloidSpheres = Sample.makeDefaultColloids(
            10,
            0.0025,
            sample.flowCellWidth,
            sample.flowCellHeight,
            sample.flowCellDepth,
        );
        return;
    }

    const parsed = raw
        .split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => {
            const [xRaw, yRaw, zRaw, rRaw, colorRaw] = part.split(':').map(v => v.trim());
            const x = parseFloat(xRaw);
            const y = parseFloat(yRaw);
            const z = parseFloat(zRaw);
            const radius = parseFloat(rRaw);
            if ([x, y, z, radius].some(Number.isNaN)) return null;
            return {
                center: new Vector3(x, y, z),
                radius,
                glowColor: colorRaw || sample.colloidGlowColor,
            };
        })
        .filter((sphere): sphere is { center: Vector3; radius: number; glowColor: string } => Boolean(sphere));
    sample.colloidSpheres = parsed.length > 0 ? parsed : Sample.makeDefaultColloids(
        10,
        0.0025,
        sample.flowCellWidth,
        sample.flowCellHeight,
        sample.flowCellDepth,
    );
}

function formatVertices(vertices: [number, number][]): string {
    return vertices.map(([a, b]) => `${fmt(a)}:${fmt(b)}`).join('; ');
}

function parseVertices(props: PropMap): [number, number][] | null {
    const raw = props['vertices'];
    if (!raw) return null;
    const vertices = raw
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const [a, b] = part.split(':').map((value) => parseFloat(value.trim()));
            if (Number.isNaN(a) || Number.isNaN(b)) return null;
            return [a, b] as [number, number];
        })
        .filter((vertex): vertex is [number, number] => vertex !== null);
    return vertices.length >= 3 ? vertices : null;
}

function parseFaceROC(props: PropMap): number[] | null {
    const raw = props['faceROC'];
    if (!raw) return null;
    const values = raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => (part === 'Infinity' ? Infinity : parseFloat(part)));
    return values.every((value) => Number.isFinite(value) || value === Infinity) ? values : null;
}

function applySourceProps(source: SourceLike, props: PropMap) {
    source.wavelength = num(props, 'wavelength', 532);
    source.beamRadius = num(props, 'beamRadius', num(props, 'beamWaist', source.beamRadius));
    source.power = num(props, 'power', 1);
}

function parseZernikeCoefficients(raw: string | undefined): ZernikeCoefficient[] {
    if (!raw) return [];
    return raw
        .split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => {
            const [indexRaw, coefficientRaw] = part.split(':').map(value => value.trim());
            const index = parseInt(indexRaw, 10);
            const coefficient = parseFloat(coefficientRaw);
            if (!Number.isFinite(index) || !Number.isFinite(coefficient)) return null;
            return { index, coefficient };
        })
        .filter((entry): entry is ZernikeCoefficient => entry !== null);
}

function createComponent(type: string, props: PropMap): OpticalComponent | null {
    switch (type) {
        case 'Laser': {
            const c = new Laser(str(props, 'name', 'Laser'));
            c.wavelength = num(props, 'wavelength', 532);
            c.beamRadius = num(props, 'beamRadius', num(props, 'beamWaist', 2));  // backward compat
            c.power = num(props, 'power', 1);
            c.isOn = bool(props, 'isOn', c.isOn);
            c.polarizationAngle = num(props, 'polarizationAngle', c.polarizationAngle);
            return c;
        }
        case 'Lamp': {
            const c = new Lamp(str(props, 'name', 'Lamp'));
            c.beamRadius = Math.max(0, finiteNum(props, 'beamRadius', finiteNum(props, 'beamWaist', 3)));  // backward compat
            c.power = Math.max(0, finiteNum(props, 'power', 1));
            c.sourcePointCount = Math.min(
                MAX_LAMP_SOURCE_POINTS,
                Math.max(1, Math.round(finiteNum(props, 'sourcePointCount', c.sourcePointCount))),
            );
            c.emitterRadius = Math.max(0, finiteNum(props, 'emitterRadius', c.emitterRadius));
            c.spectralWavelengths = parseLampSpectralWavelengths(props['spectralWavelengths'])
                ?? c.spectralWavelengths;
            return c;
        }
        case 'PointSource2D': {
            const c = new PointSource2D(str(props, 'name', 'Point Source 2D'));
            applySourceProps(c, props);
            return c;
        }
        case 'PointSource3D': {
            const c = new PointSource3D(str(props, 'name', 'Point Source 3D'));
            applySourceProps(c, props);
            return c;
        }
        case 'ConeSource3D': {
            const c = new ConeSource3D(str(props, 'name', 'Cone Source 3D'));
            applySourceProps(c, props);
            c.halfAngle = num(props, 'halfAngle', num(props, 'coneAngle', c.halfAngle));
            return c;
        }
        case 'WedgeSource2D': {
            const c = new WedgeSource2D(str(props, 'name', 'Wedge Source 2D'));
            applySourceProps(c, props);
            c.subtendedAngle = num(props, 'subtendedAngle', c.subtendedAngle);
            if (props['coneAngle'] !== undefined && props['subtendedAngle'] === undefined) {
                c.coneAngle = num(props, 'coneAngle', c.coneAngle);
            }
            return c;
        }
        case 'StructuredSource': {
            const c = new StructuredSource(str(props, 'name', 'Structured Source'));
            applySourceProps(c, props);
            c.diameter = num(props, 'diameter', c.diameter);
            if (props['beamRadius'] === undefined && props['beamWaist'] === undefined && props['diameter'] !== undefined) {
                c.beamRadius = Math.max(c.diameter / 2, 0.05);
            }
            c.asciiChar = unescapeTextValue(str(props, 'asciiChar', c.asciiChar));
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
        case 'AsphericLens': {
            const parseArr = (key: string): number[] => {
                if (!props[key]) return [];
                return props[key].split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
            };
            return new AsphericLens({
                name: str(props, 'name', 'Aspheric Lens'),
                front: { R: num(props, 'r1', 13), k: num(props, 'k1', -1), A: parseArr('a1') },
                back: { R: num(props, 'r2', 1e9), k: num(props, 'k2', 0), A: parseArr('a2') },
                apertureRadius: num(props, 'aperture', 3),
                thickness: num(props, 'thickness', 4),
                ior: num(props, 'ior', 1.5168),
            });
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
            const scanner = new PolygonScanner({
                numFaces: num(props, 'numFaces', 6),
                inscribedRadius: num(props, 'inscribedRadius', 10),
                faceHeight: num(props, 'faceHeight', 10),
                scanAngle: num(props, 'scanAngle', 0),
                name: str(props, 'name', 'Polygon Scanner'),
            });
            const vertices = parseVertices(props);
            if (vertices) scanner.setVertices(vertices);
            const faceROC = parseFaceROC(props);
            if (faceROC) {
                for (let i = 0; i < Math.min(faceROC.length, scanner.faceROC.length); i++) {
                    scanner.faceROC[i] = faceROC[i];
                }
                scanner.invalidateMesh();
            }
            if (props['scanAngle']) scanner.applyScanAngle(num(props, 'scanAngle', 0));
            return scanner;
        }
        case 'GalvoScanHead': {
            const c = new GalvoScanHead(
                num(props, 'diameter', 15),
                num(props, 'thickness', 2),
                str(props, 'name', 'Galvo Scan Head')
            );
            c.scanX = num(props, 'scanX', 0);
            c.scanY = num(props, 'scanY', 0);
            return c;
        }
        case 'DualGalvoScanHead': {
            const c = new DualGalvoScanHead(
                num(props, 'mirrorSpacing', 15),
                num(props, 'mirrorDiameter', 12),
                str(props, 'name', 'Dual Galvo Scan Head')
            );
            c.scanX = num(props, 'scanX', 0);
            c.scanY = num(props, 'scanY', 0);
            return c;
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
                parseSpectralProfile(props) ?? new SpectralProfile('longpass', 500),
                str(props, 'name', 'Dichroic')
            );
        }
        case 'Filter': {
            return new Filter(
                num(props, 'diameter', 25),
                num(props, 'thickness', 3),
                parseSpectralProfile(props) ?? new SpectralProfile('longpass', 500),
                str(props, 'name', 'Filter')
            );
        }
        case 'Camera': {
            const c = new Camera(
                num(props, 'width', 13),
                num(props, 'height', 13),
                str(props, 'name', 'Camera')
            );
            c.sensorResX = intRange(props, 'sensorResX', 64, 1, 2048);
            c.sensorResY = intRange(props, 'sensorResY', 64, 1, 2048);
            c.sensorNA = num(props, 'sensorNA', 0);
            c.samplesPerPixel = num(props, 'samplesPerPixel', 4);
            return c;
        }
        case 'Sample': {
            const c = new Sample(str(props, 'name', 'Sample'));
            c.excitationSpectrum = parseSpectralProfile(props, 'excitation') ?? c.excitationSpectrum;
            c.emissionSpectrum = parseSpectralProfile(props, 'emission') ?? c.emissionSpectrum;
            c.fluorescenceEfficiency = num(props, 'fluorescenceEfficiency', 1e-4);
            c.absorption = num(props, 'absorption', 3.0);
            if (props['specimenRotation']) {
                const [rx, ry, rz] = props['specimenRotation'].split(',').map(s => parseFloat(s.trim()));
                c.specimenRotation.set(rx, ry, rz);
            }
            if (props['specimenOffset']) {
                const [ox, oy, oz] = props['specimenOffset'].split(',').map(s => parseFloat(s.trim()));
                c.specimenOffset.set(ox, oy, oz);
            }
            parseSampleSpecimenProps(c, props);
            return c;
        }
        case 'TrappedBead': {
            const c = new TrappedBead(
                num(props, 'diameter', 1.0),
                num(props, 'iorBead', 1.59),
                num(props, 'iorMedium', 1.33),
                str(props, 'name', 'Trapped Bead'),
            );
            c.viscosity = num(props, 'viscosity', 1e-3);
            c.temperatureK = num(props, 'temperatureK', 295);
            c.displayScale = num(props, 'displayScale', 50);
            c.thermalMotionScale = num(props, 'thermalMotionScale', c.thermalMotionScale);
            c.rayMomentumScale = num(props, 'rayMomentumScale', c.rayMomentumScale);
            c.surfaceReflectionScale = num(props, 'surfaceReflectionScale', c.surfaceReflectionScale);
            c.gradientForceScale = num(props, 'gradientForceScale', c.gradientForceScale);
            c.trapCaptureRadius = num(props, 'trapCaptureRadius', c.trapCaptureRadius);
            c.trapAxialCaptureRange = num(props, 'trapAxialCaptureRange', c.trapAxialCaptureRange);
            c.visualGlowRadius = num(props, 'visualGlowRadius', c.visualGlowRadius);
            c.glowColor = str(props, 'glowColor', c.glowColor);
            c.parentSampleId = str(props, 'parentSampleId', '') || null;
            c.isSubComponent = str(props, 'managedBySample', 'false') === 'true';
            if (props['specimenOffset']) {
                const [ox, oy, oz] = props['specimenOffset'].split(',').map(s => parseFloat(s.trim()));
                c.specimenOffset.set(ox, oy, oz);
            }
            if (props['confinementHalfSize']) {
                const [x, y, z] = props['confinementHalfSize'].split(',').map(s => parseFloat(s.trim()));
                c.confinementHalfSize = new Vector3(x, y, z);
                c.constrainToFlowCell();
            }
            return c;
        }
        case 'Objective': {
            const c = new Objective({
                NA: num(props, 'NA', 0.25),
                magnification: num(props, 'magnification', 10),
                immersionIndex: num(props, 'immersionIndex', 1),
                workingDistance: num(props, 'workingDistance', 10),
                tubeLensFocal: num(props, 'tubeLensFocal', 200),
                diameter: num(props, 'diameter', 20),
                name: str(props, 'name', 'Objective'),
            });
            c.coverslipThickness = num(props, 'coverslipThickness', c.coverslipThickness);
            c.fieldNumber = num(props, 'fieldNumber', c.fieldNumber);
            c.immersionMediumKind = str(props, 'immersionMediumKind', c.immersionMediumKind) as Objective['immersionMediumKind'];
            const coefficients = parseZernikeCoefficients(props['pupilZernike']);
            if (coefficients.length > 0) {
                c.pupil = {
                    aberrations: {
                        coefficients,
                        referenceWavelengthNm: num(props, 'pupilReferenceWavelengthNm', 550),
                    },
                    apodization: null,
                };
            }
            c.recalculate();
            return c;
        }
        case 'PrismLens': {
            const prism = new PrismLens(
                num(props, 'apexAngle', Math.PI / 3),
                num(props, 'height', 20),
                num(props, 'width', 20),
                str(props, 'name', 'Prism'),
                num(props, 'ior', 1.5168)
            );
            const vertices = parseVertices(props);
            if (vertices) prism.setVertices(vertices);
            const faceROC = parseFaceROC(props);
            if (faceROC) {
                for (let i = 0; i < Math.min(faceROC.length, prism.faceROC.length); i++) {
                    prism.faceROC[i] = faceROC[i];
                }
                prism.invalidateMesh();
            }
            return prism;
        }
        case 'Waveplate': {
            const mode = str(props, 'mode', 'half') as 'half' | 'quarter' | 'polarizer';
            return new Waveplate(
                mode,
                num(props, 'apertureRadius', 12.5),
                num(props, 'fastAxisAngle', 0),
                str(props, 'name', 'Waveplate')
            );
        }
        case 'Aperture': {
            return new Aperture(
                num(props, 'openingDiameter', 10),
                num(props, 'housingDiameter', 25),
                str(props, 'name', 'Aperture'),
                num(props, 'thickness', 1)
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
            const c = new Card(
                num(props, 'width', 20),
                num(props, 'height', 20),
                str(props, 'name', 'Card')
            );
            c.opaque = bool(props, 'opaque', c.opaque);
            return c;
        }
        case 'PMT': {
            const c = new PMT(
                num(props, 'width', 10),
                num(props, 'height', 10),
                str(props, 'name', 'PMT Detector')
            );
            c.sensorNA = num(props, 'sensorNA', 0.01);
            c.samplesPerPixel = num(props, 'samplesPerPixel', 4);
            c.xAxisComponentId = props['xAxisComponentId'] || null;
            c.xAxisProperty = props['xAxisProperty'] || null;
            c.yAxisComponentId = props['yAxisComponentId'] || null;
            c.yAxisProperty = props['yAxisProperty'] || null;
            c.pmtSampleHz = num(props, 'pmtSampleHz', 4096);
            c.scanResX = num(props, 'scanResX', 64);
            c.scanResY = num(props, 'scanResY', 64);
            return c;
        }
        case 'SampleChamber': {
            const sc = new SampleChamber(
                num(props, 'cubeSize', 75),
                num(props, 'wallThickness', 3),
                num(props, 'boreDiameter', 30),
                str(props, 'name', 'X Sample Holder')
            );
            sc.excitationSpectrum = parseSpectralProfile(props, 'excitation') ?? sc.excitationSpectrum;
            sc.emissionSpectrum = parseSpectralProfile(props, 'emission') ?? sc.emissionSpectrum;
            sc.fluorescenceEfficiency = num(props, 'fluorescenceEfficiency', 1e-4);
            sc.absorption = num(props, 'absorption', 3.0);
            if (props['specimenRotation']) {
                const [rx, ry, rz] = props['specimenRotation'].split(',').map(s => parseFloat(s.trim()));
                sc.specimenRotation.set(rx, ry, rz);
            }
            if (props['specimenOffset']) {
                const [ox, oy, oz] = props['specimenOffset'].split(',').map(s => parseFloat(s.trim()));
                sc.specimenOffset.set(ox, oy, oz);
            }
            return sc;
        }
        case 'AchromatDoublet': {
            const c = new AchromatDoublet(
                num(props, 'r1', 77.4), num(props, 'r2', -87.6), num(props, 'r3', 291.1),
                num(props, 't1', 4.0), num(props, 't2', 2.5), num(props, 'apertureRadius', 25.4),
                num(props, 'ior1', 1.658), num(props, 'ior2', 1.750),
                str(props, 'name', 'Achromatic Doublet')
            );
            return c;
        }
        case 'DoubleSlit': {
            return new DoubleSlit(
                num(props, 'slitWidth', 0.5), num(props, 'slitSeparation', 2),
                num(props, 'slitHeight', 20), num(props, 'housingDiameter', 25),
                str(props, 'name', 'Double Slit')
            );
        }
        case 'Diffuser': {
            return new Diffuser(
                num(props, 'diameter', 25.4), num(props, 'thickness', 2),
                num(props, 'coneHalfAngle', Math.PI / 180),
                str(props, 'name', 'Diffuser')
            );
        }
        case 'PolarizingBeamSplitter': {
            return new PolarizingBeamSplitter(
                num(props, 'diameter', 25.4), num(props, 'thickness', 2),
                str(props, 'name', 'Polarizing BS')
            );
        }
        case 'FaradayIsolator': {
            const c = new FaradayIsolator(str(props, 'name', 'Faraday Isolator'));
            c.insertionLoss = num(props, 'insertionLoss', 0.95);
            c.extinctionDB = num(props, 'extinctionDB', 35);
            c.apertureRadius = num(props, 'apertureRadius', 12.5);
            return c;
        }
        case 'AOD': {
            const c = new AOD(str(props, 'name', 'AOD'));
            c.deflectionAngle = num(props, 'deflectionAngle', 0);
            c.efficiency = num(props, 'efficiency', 0.85);
            c.maxAngle = num(props, 'maxAngle', 0.05);
            c.apertureRadius = num(props, 'apertureRadius', 5);
            return c;
        }
        case 'QPD': {
            const c = new QPD(num(props, 'activeDiameter', 5), str(props, 'name', 'QPD'));
            c.gapWidth = num(props, 'gapWidth', 0.1);
            c.backstopTransmission = num(props, 'backstopTransmission', c.backstopTransmission);
            return c;
        }
        case 'MediumVolume': {
            return new MediumVolume({
                width: num(props, 'width', 10), height: num(props, 'height', 10),
                depth: num(props, 'depth', 10), refractiveIndex: num(props, 'refractiveIndex', 1.33),
                exteriorRefractiveIndex: num(props, 'exteriorRefractiveIndex', 1.0),
                visualMode: (str(props, 'visualMode', 'box') as 'box' | 'bridge'),
                bridgeStartRadius: props['bridgeStartRadius'] ? parseFloat(props['bridgeStartRadius']) : undefined,
                bridgeEndRadius: props['bridgeEndRadius'] ? parseFloat(props['bridgeEndRadius']) : undefined,
                name: str(props, 'name', 'Medium Volume'),
            });
        }
        case 'PupilMaskElement': {
            const c = new PupilMaskElement(str(props, 'name', 'Pupil Mask'));
            c.mode = str(props, 'mode', 'phaseRing') as 'uniform' | 'annulus' | 'phaseRing';
            c.radius = num(props, 'radius', 4);
            c.thickness = num(props, 'thickness', 1);
            c.innerRadius = num(props, 'innerRadius', 0.55);
            c.outerRadius = num(props, 'outerRadius', 0.8);
            c.ringTransmission = num(props, 'ringTransmission', 1);
            c.ringPhaseShift = num(props, 'ringPhaseShift', Math.PI / 2);
            c.backgroundTransmission = num(props, 'backgroundTransmission', 1);
            c.backgroundPhaseShift = num(props, 'backgroundPhaseShift', 0);
            c.resolution = num(props, 'resolution', 64);
            c.rebuildMask();
            return c;
        }
        case 'Rail': {
            const c = new Rail();
            if (props['holeA']) {
                const [ax, ay, az] = props['holeA'].split(',').map(s => parseFloat(s.trim()));
                c.holeA.set(ax, ay, az);
            }
            if (props['holeB']) {
                const [bx, by, bz] = props['holeB'].split(',').map(s => parseFloat(s.trim()));
                c.holeB.set(bx, by, bz);
            }
            c._updateFromEndpoints();
            return c;
        }
        case 'Annotation': {
            const kind = str(props, 'kind', 'text') as AnnotationKind;
            return new Annotation(
                kind,
                str(props, 'name', kind === 'text' ? 'Text Label' : 'Annotation'),
                unescapeTextValue(str(props, 'text', '')),
                num(props, 'length', 60),
                num(props, 'fontSize', 12),
                str(props, 'color', '#007fff'),
            );
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
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
    }, 1000);
}

/** Open file picker and load a .ubz file, returns parsed components */
export function openUbzFilePicker(): Promise<OpticalComponent[]> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.ubz';
        input.style.display = 'none';
        let settled = false;
        let fallbackTimer: number | null = null;

        const cleanup = () => {
            if (fallbackTimer !== null) {
                window.clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }
            window.removeEventListener('focus', handleWindowFocus);
            input.remove();
        };
        const rejectNoSelection = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('No file selected'));
        };
        const handleWindowFocus = () => {
            if (settled || input.files?.length) return;
            fallbackTimer = window.setTimeout(() => {
                if (!settled && !input.files?.length) {
                    rejectNoSelection();
                }
            }, 500);
        };
        input.onchange = async () => {
            try {
                const file = input.files?.[0];
                if (!file) {
                    rejectNoSelection();
                    return;
                }
                const text = await file.text();
                const components = deserializeScene(text);
                settled = true;
                resolve(components);
            } catch (e) {
                settled = true;
                reject(e);
            } finally {
                cleanup();
            }
        };
        input.oncancel = () => {
            rejectNoSelection();
        };
        document.body.appendChild(input);
        // Safari/WebKit versions have not consistently emitted `cancel` for
        // file inputs. When the chooser returns focus without a file, reject so
        // the caller does not wait forever.
        window.addEventListener('focus', handleWindowFocus);
        input.click();
    });
}

// ════════════════════════════════════════════════════════════
//  URL HASH SCENE SHARING
// ════════════════════════════════════════════════════════════

export function encodeSceneToUrlHash(components: OpticalComponent[]): string {
    const text = serializeScene(components);
    const bytes = new TextEncoder().encode(text);
    // Chunked conversion to avoid stack overflow on large scenes
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    // Make URL-safe: replace +/= with -_~
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '~');
}

export function decodeSceneFromUrlHash(hash: string): OpticalComponent[] {
    const base64 = hash.replace(/-/g, '+').replace(/_/g, '/').replace(/~/g, '=');
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const text = new TextDecoder().decode(bytes);
    return deserializeScene(text);
}

export function generateSceneUrl(components: OpticalComponent[]): string {
    const encoded = encodeSceneToUrlHash(components);
    const base = window.location.href.split('#')[0];
    return `${base}#scene=${encoded}`;
}

export function loadSceneFromUrlHash(): OpticalComponent[] | null {
    const hash = window.location.hash;
    if (!hash.startsWith('#scene=')) return null;
    const encoded = hash.slice('#scene='.length);
    if (!encoded) return null;
    try {
        return decodeSceneFromUrlHash(encoded);
    } catch (e) {
        console.warn('Failed to decode scene from URL:', e);
        return null;
    }
}
