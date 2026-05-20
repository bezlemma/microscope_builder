import type { OpticalComponent } from '../physics/Component';
import { SphericalLens } from '../physics/components/SphericalLens';
import { AsphericLens } from '../physics/components/AsphericLens';
import { AchromatDoublet } from '../physics/components/AchromatDoublet';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import type { NormalizedCatalogParams } from './types';

export type PrescriptionFormat =
    | 'zemaxSequentialText'
    | 'codeVSequence'
    | 'osloLensText'
    | 'csvSurfaceTable'
    | 'textSurfaceTable'
    | 'jsonOpticalPrescription';

export interface PrescriptionSurface {
    index: number;
    type?: string;
    comment?: string;
    isStop?: boolean;
    isBlackBox?: boolean;
    radiusMm: number;
    thicknessToNextMm?: number;
    glass?: string;
    ior?: number;
    semiDiameterMm?: number;
    conic?: number;
    evenAsphereTerms?: number[];
}

export interface OpticalPrescription {
    format: PrescriptionFormat;
    name: string;
    surfaces: PrescriptionSurface[];
    allSurfaces?: PrescriptionSurface[];
    blackBoxSurfaces?: PrescriptionSurface[];
    entrancePupilDiameterMm?: number;
    objectNumericalAperture?: number;
    wavelengthsNm?: number[];
    fieldYValues?: number[];
    warnings: string[];
}

export interface ImportedOptic {
    component: OpticalComponent;
    prescription: OpticalPrescription;
    normalized: NormalizedCatalogParams;
}

export class UnsupportedOpticImportError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UnsupportedOpticImportError';
    }
}

const FLAT_RADIUS = 1e9;
const UNIT_TO_MM: Record<string, number> = {
    MM: 1,
    CM: 10,
    M: 1000,
    IN: 25.4,
    INCH: 25.4,
    INCHES: 25.4,
};

const BINARY_OR_MECHANICAL_EXTENSIONS = new Set([
    'zos',
    'zar',
    'zda',
    'cfg',
    'zip',
    'step',
    'stp',
    'iges',
    'igs',
    'sat',
    'sldprt',
    'prt',
    'x_t',
    'zof',
]);

const GLASS_IOR = new Map<string, number>([
    ['N-BK7', 1.5168],
    ['BK7', 1.5168],
    ['UV FUSED SILICA', 1.4585],
    ['FUSED SILICA', 1.4585],
    ['UVFS', 1.4585],
    ['CAF2', 1.4338],
    ['CA F2', 1.4338],
    ['N-SF11', 1.7847],
    ['SF11', 1.7847],
    ['N-SF5', 1.6727],
    ['N-SF6', 1.8052],
    ['N-SF6HT', 1.8052],
    ['N-BAF10', 1.67],
    ['N-LASF9', 1.8503],
    ['N-LAF7', 1.7495],
    ['N-LAK22', 1.6511],
]);

interface ZemaxSurfaceScratch {
    index: number;
    type?: string;
    comment?: string;
    isStop?: boolean;
    curvature?: number;
    radiusMm?: number;
    thicknessToNextMm?: number;
    glass?: string;
    ior?: number;
    semiDiameterMm?: number;
    conic?: number;
    evenAsphereTerms: number[];
    unsupportedParams: Map<number, number>;
}

function cleanName(fileName: string): string {
    const base = fileName.split(/[\\/]/).pop() ?? fileName;
    return base.replace(/\.[^.]+$/, '') || 'Imported Optic';
}

function fileExtension(fileName: string): string {
    const path = fileName.split(/[?#]/)[0] ?? fileName;
    return path.toLowerCase().split('.').pop() ?? '';
}

function bytesFrom(value: Uint8Array | ArrayBuffer): Uint8Array {
    return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function unsupportedMessageForExtension(extension: string): string | null {
    if (!BINARY_OR_MECHANICAL_EXTENSIONS.has(extension)) return null;
    if (extension === 'zos') {
        return '.zos is OpticStudio binary lens data. Export/save as text .zmx, or provide a table/JSON prescription, so the simulator can inspect the surfaces.';
    }
    if (extension === 'zar' || extension === 'zip') {
        return '.zar/.zip archives need an archive extraction layer before import. Extract the contained .zmx/text prescription and import that file.';
    }
    if (['step', 'stp', 'iges', 'igs', 'sat', 'sldprt', 'prt', 'x_t', 'zof'].includes(extension)) {
        return 'CAD/mechanical files describe solid geometry, not a full optical prescription. Import a Zemax/text/table prescription for ray tracing; CAD visual import needs a separate mechanical-model pipeline.';
    }
    return `.${extension} is not an optical prescription file this importer can read directly.`;
}

function isLikelyUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
    let nullOdd = 0;
    let nullEven = 0;
    const sampleLength = Math.min(bytes.length, 512);
    for (let i = 0; i < sampleLength; i++) {
        if (bytes[i] !== 0) continue;
        if (i % 2 === 0) nullEven++;
        else nullOdd++;
    }
    if (nullOdd > Math.max(4, nullEven * 2)) return 'utf-16le';
    if (nullEven > Math.max(4, nullOdd * 2)) return 'utf-16be';
    return null;
}

export function decodePrescriptionBytes(input: Uint8Array | ArrayBuffer, fileName: string): string {
    const extension = fileExtension(fileName);
    const unsupported = unsupportedMessageForExtension(extension);
    if (unsupported) throw new UnsupportedOpticImportError(unsupported);

    const bytes = bytesFrom(input);
    const utf16 = isLikelyUtf16(bytes);
    if (utf16) return new TextDecoder(utf16).decode(bytes);

    const sampleLength = Math.min(bytes.length, 1024);
    let suspiciousControls = 0;
    for (let i = 0; i < sampleLength; i++) {
        const b = bytes[i];
        if (b === 0) throw new UnsupportedOpticImportError('This looks like a binary file, not a text optical prescription.');
        if (b < 9 || (b > 13 && b < 32)) suspiciousControls++;
    }
    if (suspiciousControls > sampleLength * 0.05) {
        throw new UnsupportedOpticImportError('This looks like a binary file, not a text optical prescription.');
    }

    return new TextDecoder('utf-8').decode(bytes);
}

function parseNumberToken(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const cleaned = value.replace(/,/g, '').trim();
    if (/^(?:flat|plano)$/i.test(cleaned)) return Infinity;
    if (/^[+-]?(?:inf|infinity|∞)$/i.test(cleaned)) return cleaned.startsWith('-') ? -Infinity : Infinity;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFiniteNumber(value: string | undefined): number | undefined {
    const parsed = parseNumberToken(value);
    return parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;
}

function radiusFromCurvature(curvature: number | undefined, unitScaleMm: number): number {
    if (curvature === undefined || Math.abs(curvature) < 1e-14) return FLAT_RADIUS;
    return unitScaleMm / curvature;
}

function normalizeGlassName(value: string | undefined): string | undefined {
    if (!value || /^air$|^__blank$/i.test(value)) return undefined;
    return value.replace(/^"|"$/g, '').replace(/_/g, '-').trim();
}

function iorForGlass(glass: string | undefined, fallback = 1.5168): number {
    if (!glass) return fallback;
    const upper = glass.toUpperCase().replace(/[^A-Z0-9-]+/g, ' ').trim();
    return GLASS_IOR.get(upper) ?? fallback;
}

function coefficientToMmUnits(value: number, radialPower: number, unitScaleMm: number): number {
    return value / Math.pow(unitScaleMm, radialPower - 1);
}

function zemaxParamPower(surfaceType: string | undefined, parmIndex: number): number | null {
    const type = surfaceType?.toUpperCase() ?? '';
    if (!type.includes('EVEN') || !type.includes('ASPH')) return null;
    if (parmIndex < 1 || parmIndex > 6) return null;
    return 2 * parmIndex + 2;
}

function cleanZemaxComment(tokens: string[]): string | undefined {
    const value = tokens.join(' ').trim();
    if (!value) return undefined;
    return value.replace(/^"|"$/g, '');
}

function zemaxScratchToSurface(surface: ZemaxSurfaceScratch, unitScaleMm: number): PrescriptionSurface {
    const type = surface.type?.trim();
    const isBlackBox = type?.toUpperCase() === 'BLACKBOX';
    return {
        index: surface.index,
        ...(type ? { type } : {}),
        ...(surface.comment ? { comment: surface.comment } : {}),
        ...(surface.isStop ? { isStop: true } : {}),
        ...(isBlackBox ? { isBlackBox: true } : {}),
        radiusMm: surface.radiusMm ?? radiusFromCurvature(surface.curvature, unitScaleMm),
        thicknessToNextMm: surface.thicknessToNextMm,
        glass: surface.glass,
        ior: surface.ior,
        semiDiameterMm: surface.semiDiameterMm,
        conic: surface.conic,
        evenAsphereTerms: surface.evenAsphereTerms.length > 0 ? [...surface.evenAsphereTerms] : undefined,
    };
}

function parseZemaxSequentialText(text: string, fileName: string): OpticalPrescription {
    const warnings: string[] = [];
    const surfaces: ZemaxSurfaceScratch[] = [];
    let current: ZemaxSurfaceScratch | null = null;
    let unitScaleMm = 1;
    let mappedZemaxParams = false;
    let entrancePupilDiameterMm: number | undefined;
    let objectNumericalAperture: number | undefined;
    let fieldYValues: number[] | undefined;
    const wavelengthsNm: number[] = [];

    const commit = () => {
        if (current) surfaces.push(current);
        current = null;
    };

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('!')) continue;
        const tokens = line.split(/\s+/);
        const command = tokens[0].toUpperCase();

        if (command === 'UNIT') {
            const unit = tokens[1]?.toUpperCase();
            if (unit && UNIT_TO_MM[unit]) unitScaleMm = UNIT_TO_MM[unit];
            else if (unit) warnings.push(`Unsupported Zemax unit "${unit}"; imported as millimeters.`);
            continue;
        }

        if (command === 'ENPD') {
            const value = parseFiniteNumber(tokens[1]);
            if (value !== undefined) entrancePupilDiameterMm = value * unitScaleMm;
            continue;
        }

        if (command === 'OBNA') {
            objectNumericalAperture = parseFiniteNumber(tokens[1]);
            continue;
        }

        if (command === 'WAVM') {
            const wavelengthUm = parseFiniteNumber(tokens[2]);
            if (wavelengthUm !== undefined) wavelengthsNm.push(wavelengthUm * 1000);
            continue;
        }

        if (command === 'YFLN') {
            const values = tokens.slice(1)
                .map(parseFiniteNumber)
                .filter((value): value is number => value !== undefined)
                .map(value => value * unitScaleMm);
            if (values.length > 0) fieldYValues = values;
            continue;
        }

        if (command === 'SURF') {
            commit();
            const index = Math.trunc(parseNumberToken(tokens[1]) ?? surfaces.length);
            current = {
                index,
                evenAsphereTerms: [],
                unsupportedParams: new Map(),
            };
            continue;
        }

        if (!current) continue;

        if (command === 'TYPE') {
            current.type = tokens.slice(1).join(' ');
        } else if (command === 'COMM') {
            current.comment = cleanZemaxComment(tokens.slice(1));
        } else if (command === 'STOP') {
            current.isStop = true;
        } else if (command === 'CURV') {
            current.curvature = parseNumberToken(tokens[1]);
            current.radiusMm = radiusFromCurvature(current.curvature, unitScaleMm);
        } else if (command === 'DISZ') {
            const value = parseNumberToken(tokens[1]);
            if (value !== undefined && Number.isFinite(value)) current.thicknessToNextMm = value * unitScaleMm;
        } else if (command === 'GLAS') {
            current.glass = normalizeGlassName(tokens[1]);
            const explicitIndex = tokens.slice(2).map(parseNumberToken).find(value => value !== undefined && value > 1 && value < 5);
            current.ior = explicitIndex ?? iorForGlass(current.glass);
        } else if (command === 'DIAM') {
            const value = parseNumberToken(tokens[1]);
            if (value !== undefined && Number.isFinite(value)) current.semiDiameterMm = value * unitScaleMm;
        } else if (command === 'CONI') {
            current.conic = parseNumberToken(tokens[1]);
        } else if (command === 'PARM') {
            const parmIndex = Math.trunc(parseNumberToken(tokens[1]) ?? -1);
            const value = parseNumberToken(tokens[2]);
            if (parmIndex > 0 && value !== undefined) {
                const power = zemaxParamPower(current.type, parmIndex);
                if (power !== null) {
                    current.evenAsphereTerms[parmIndex - 1] = coefficientToMmUnits(value, power, unitScaleMm);
                    mappedZemaxParams = true;
                } else {
                    current.unsupportedParams.set(parmIndex, value);
                }
            }
        } else {
            const powerMatch = command.match(/^A(4|6|8|10|12|14)$/);
            if (powerMatch) {
                const power = Number(powerMatch[1]);
                const index = (power - 4) / 2;
                const value = parseNumberToken(tokens[1]);
                if (value !== undefined) current.evenAsphereTerms[index] = coefficientToMmUnits(value, power, unitScaleMm);
            }
        }
    }
    commit();

    if (mappedZemaxParams) {
        warnings.push('Mapped Zemax EVENASPH PARM 1-6 to A4-A14. Other surface parameterizations are retained as warnings until a specific parser is added.');
    }

    for (const surface of surfaces) {
        if (surface.unsupportedParams.size > 0) {
            warnings.push(`Surface ${surface.index} has unsupported PARM terms for type "${surface.type ?? 'standard'}".`);
        }
    }

    const physical = surfaces
        .filter(surface => surface.index > 0)
        .filter(surface => (
            surface.curvature !== undefined ||
            surface.glass !== undefined ||
            surface.conic !== undefined ||
            surface.evenAsphereTerms.length > 0 ||
            surface.type?.toUpperCase() === 'BLACKBOX' ||
            surface.isStop
        ));
    const allSurfaces = physical.map(surface => zemaxScratchToSurface(surface, unitScaleMm));
    const blackBoxSurfaces = allSurfaces.filter(surface => surface.isBlackBox);

    if (blackBoxSurfaces.length > 0) {
        const names = blackBoxSurfaces
            .map(surface => surface.comment)
            .filter((value): value is string => Boolean(value))
            .join(', ');
        warnings.push(`Contains ${blackBoxSurfaces.length} Zemax BLACKBOX surface(s)${names ? ` (${names})` : ''}; internal surfaces are hidden in .ZBB data and cannot be reconstructed from the ZMX wrapper.`);
    }

    const firstGlass = physical.findIndex(surface => surface.glass !== undefined);
    const start = firstGlass >= 0 ? firstGlass : 0;
    const lensSurfaces: PrescriptionSurface[] = [];
    for (let i = start; i < physical.length; i++) {
        const surface = physical[i];
        lensSurfaces.push(zemaxScratchToSurface(surface, unitScaleMm));
        if (i > start && surface.glass === undefined) break;
        if (lensSurfaces.length >= 3) break;
    }

    if (lensSurfaces.length < 2) {
        throw new Error('Could not find at least two physical lens surfaces in this Zemax text file.');
    }

    return {
        format: 'zemaxSequentialText',
        name: cleanName(fileName),
        surfaces: lensSurfaces,
        allSurfaces,
        blackBoxSurfaces,
        entrancePupilDiameterMm,
        objectNumericalAperture,
        wavelengthsNm: wavelengthsNm.length > 0 ? wavelengthsNm : undefined,
        fieldYValues,
        warnings,
    };
}

function parseJsonOpticalPrescription(text: string, fileName: string): OpticalPrescription {
    const payload = JSON.parse(text) as Partial<OpticalPrescription>;
    if (!Array.isArray(payload.surfaces)) throw new Error('Optical prescription JSON must contain a surfaces array.');
    return {
        format: 'jsonOpticalPrescription',
        name: payload.name ?? cleanName(fileName),
        surfaces: payload.surfaces.map((surface, index) => ({
            index: Number(surface.index ?? index + 1),
            type: surface.type,
            radiusMm: Number(surface.radiusMm),
            thicknessToNextMm: surface.thicknessToNextMm,
            glass: surface.glass,
            ior: surface.ior,
            semiDiameterMm: surface.semiDiameterMm,
            conic: surface.conic,
            evenAsphereTerms: surface.evenAsphereTerms,
        })),
        warnings: payload.warnings ?? [],
    };
}

function stripInlineComment(line: string): string {
    return line
        .replace(/!.*/, '')
        .replace(/#.*/, '')
        .replace(/\/\/.*/, '')
        .trim();
}

function splitDelimitedLine(line: string): string[] {
    const delimiter = line.includes('\t') ? '\t'
        : line.includes(',') ? ','
            : line.includes(';') ? ';'
                : null;
    if (!delimiter) return line.trim().split(/\s+/);

    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            quoted = !quoted;
            continue;
        }
        if (ch === delimiter && !quoted) {
            cells.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    cells.push(current.trim());
    return cells;
}

function normalizedHeader(value: string): string {
    return value
        .toLowerCase()
        .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
        .replace(/[^a-z0-9]+/g, '');
}

function headerUnitScale(value: string): number {
    const lower = value.toLowerCase();
    if (/\bin(?:ch|ches)?\b|["]/.test(lower)) return 25.4;
    if (/\bcm\b/.test(lower)) return 10;
    if (/\bm\b/.test(lower) && !/\bmm\b/.test(lower)) return 1000;
    return 1;
}

function findHeaderIndex(headers: string[], names: string[]): number {
    const normalized = headers.map(normalizedHeader);
    return normalized.findIndex(header => names.some(name => (
        header === name ||
        (name.length > 2 && header.includes(name))
    )));
}

function tableLooksLikeSurfaceHeader(cells: string[]): boolean {
    const headers = cells.map(normalizedHeader);
    const hasRadius = headers.some(header => ['radius', 'r', 'roc', 'curv', 'curvature', 'rd', 'rdy'].some(name => header === name || header.includes(name)));
    const hasThickness = headers.some(header => ['thickness', 'thick', 'disz', 'distance', 'separation', 'thi', 'ct'].some(name => header === name || header.includes(name)));
    const hasSurface = headers.some(header => ['surf', 'surface', 'srf', 'number', 'no', 'index'].some(name => header === name || header.includes(name)));
    return hasRadius && (hasThickness || hasSurface || cells.length >= 4);
}

function parseRadiusCell(value: string | undefined, scale: number, curvature = false): number | undefined {
    const parsed = parseNumberToken(value);
    if (parsed === undefined) return undefined;
    if (!Number.isFinite(parsed)) return FLAT_RADIUS * Math.sign(parsed || 1);
    if (curvature) return radiusFromCurvature(parsed, scale);
    if (Math.abs(parsed) < 1e-14 && /^(?:0|0\.0+)$/.test(String(value).trim())) return FLAT_RADIUS;
    return parsed * scale;
}

function firstExistingIndex(headers: string[], groups: string[][]): number {
    for (const group of groups) {
        const index = findHeaderIndex(headers, group);
        if (index >= 0) return index;
    }
    return -1;
}

function parseSurfaceTableText(text: string, fileName: string, format: PrescriptionFormat): OpticalPrescription {
    const lines = text.split(/\r?\n/)
        .map(stripInlineComment)
        .filter(Boolean);
    let headerCells: string[] | null = null;
    let headerLineIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        const cells = splitDelimitedLine(lines[i]);
        if (tableLooksLikeSurfaceHeader(cells)) {
            headerCells = cells;
            headerLineIndex = i;
            break;
        }
    }
    if (!headerCells) throw new Error('Could not find a surface table header with radius/thickness columns.');

    const radiusIndex = firstExistingIndex(headerCells, [['radius', 'roc', 'rd', 'rdy', 'r']]);
    const curvatureIndex = firstExistingIndex(headerCells, [['curv', 'curvature', 'cv']]);
    const thicknessIndex = firstExistingIndex(headerCells, [['thickness', 'thick', 'disz', 'distance', 'separation', 'thi', 'ct']]);
    const glassIndex = firstExistingIndex(headerCells, [['glass', 'material', 'substrate']]);
    const iorIndex = firstExistingIndex(headerCells, [['ior', 'index', 'nd', 'refractiveindex']]);
    const semiDiameterIndex = firstExistingIndex(headerCells, [['semidiameter', 'semidiam', 'sdiam', 'sd', 'clearsemiaperture']]);
    const diameterIndex = firstExistingIndex(headerCells, [['diameter', 'diam', 'clearaperture', 'aperturediameter']]);
    const conicIndex = firstExistingIndex(headerCells, [['conic', 'coni', 'k']]);
    const typeIndex = firstExistingIndex(headerCells, [['type', 'surfacetype']]);
    const indexIndex = firstExistingIndex(headerCells, [['surface', 'surf', 'srf', 'number', 'no', 'index']]);

    const aTermIndices = [4, 6, 8, 10, 12, 14].map(power => ({
        power,
        index: firstExistingIndex(headerCells!, [[`a${power}`, `ad${power}`, `c${power}`]]),
    }));

    const surfaces: PrescriptionSurface[] = [];
    const warnings: string[] = [];
    for (let i = headerLineIndex + 1; i < lines.length; i++) {
        const row = splitDelimitedLine(lines[i]);
        if (row.length < Math.max(2, headerCells.length / 2)) continue;

        const radiusMm = radiusIndex >= 0
            ? parseRadiusCell(row[radiusIndex], headerUnitScale(headerCells[radiusIndex]))
            : parseRadiusCell(row[curvatureIndex], headerUnitScale(headerCells[curvatureIndex] ?? ''), true);
        if (radiusMm === undefined) continue;

        const thicknessToNextMm = thicknessIndex >= 0
            ? parseFiniteNumber(row[thicknessIndex]) !== undefined
                ? parseFiniteNumber(row[thicknessIndex])! * headerUnitScale(headerCells[thicknessIndex])
                : undefined
            : undefined;
        const semiDiameterMm = semiDiameterIndex >= 0
            ? parseFiniteNumber(row[semiDiameterIndex]) !== undefined
                ? parseFiniteNumber(row[semiDiameterIndex])! * headerUnitScale(headerCells[semiDiameterIndex])
                : undefined
            : diameterIndex >= 0 && parseFiniteNumber(row[diameterIndex]) !== undefined
                ? parseFiniteNumber(row[diameterIndex])! * headerUnitScale(headerCells[diameterIndex]) / 2
                : undefined;

        const glass = glassIndex >= 0 ? normalizeGlassName(row[glassIndex]) : undefined;
        const ior = iorIndex >= 0 ? parseFiniteNumber(row[iorIndex]) : undefined;
        const conic = conicIndex >= 0 ? parseFiniteNumber(row[conicIndex]) : undefined;
        const evenAsphereTerms = aTermIndices
            .map(({ power, index }) => index >= 0 && parseFiniteNumber(row[index]) !== undefined
                ? coefficientToMmUnits(parseFiniteNumber(row[index])!, power, headerUnitScale(headerCells![index]))
                : 0);

        surfaces.push({
            index: indexIndex >= 0 ? Math.trunc(parseFiniteNumber(row[indexIndex]) ?? surfaces.length + 1) : surfaces.length + 1,
            type: typeIndex >= 0 ? row[typeIndex] : undefined,
            radiusMm,
            thicknessToNextMm,
            glass,
            ior,
            semiDiameterMm,
            conic,
            evenAsphereTerms: evenAsphereTerms.some(value => value !== 0) ? evenAsphereTerms : undefined,
        });
    }

    if (surfaces.length < 2) throw new Error('Surface table did not contain at least two usable optical surfaces.');
    if (radiusIndex < 0 && curvatureIndex >= 0) warnings.push('Imported radius from curvature column.');
    return { format, name: cleanName(fileName), surfaces, warnings };
}

function commandFragments(text: string): string[] {
    return text.split(/\r?\n|;/)
        .map(stripInlineComment)
        .filter(Boolean);
}

function parseCodeVSequenceText(text: string, fileName: string): OpticalPrescription {
    const warnings: string[] = [];
    const surfaces: PrescriptionSurface[] = [];
    let current: PrescriptionSurface | null = null;
    let title = cleanName(fileName);

    const commit = () => {
        if (current) surfaces.push(current);
        current = null;
    };
    const ensure = () => {
        if (!current) current = { index: surfaces.length + 1, radiusMm: FLAT_RADIUS };
        return current;
    };

    for (const fragment of commandFragments(text)) {
        const tokens = fragment.trim().split(/\s+/);
        const command = tokens[0].toUpperCase();
        const args = tokens.slice(1);
        const surfaceMatch = fragment.match(/^(?:S|SRF|SUR|SURF)\s*#?(\d+)\b/i) ?? fragment.match(/^S(\d+)\b/i) ?? fragment.match(/^INS\s+S?(\d+)\b/i);
        if (surfaceMatch) {
            commit();
            current = { index: Number(surfaceMatch[1]), radiusMm: FLAT_RADIUS };
            continue;
        }
        if (command === 'TIT' || command === 'TITLE') {
            title = args.join(' ').replace(/^"|"$/g, '') || title;
            continue;
        }

        const surface = ensure();
        if (['RD', 'RDY', 'RDX', 'RADIUS', 'RAD'].includes(command)) {
            surface.radiusMm = parseRadiusCell(args[0], 1) ?? surface.radiusMm;
        } else if (['CU', 'CUY', 'CUX', 'CURV', 'CURVATURE'].includes(command)) {
            surface.radiusMm = parseRadiusCell(args[0], 1, true) ?? surface.radiusMm;
        } else if (['TH', 'THI', 'THICK', 'THICKNESS'].includes(command)) {
            surface.thicknessToNextMm = parseFiniteNumber(args[0]);
        } else if (['GLA', 'GLASS', 'MAT', 'MATERIAL'].includes(command)) {
            surface.glass = normalizeGlassName(args[0]);
            surface.ior = iorForGlass(surface.glass);
        } else if (['SD', 'SDY', 'SDX', 'SEMI', 'SEMIDIAMETER'].includes(command)) {
            surface.semiDiameterMm = parseFiniteNumber(args[0]);
        } else if (['DIA', 'DIAM', 'DIAMETER', 'CA'].includes(command)) {
            const diameter = parseFiniteNumber(args[0]);
            if (diameter !== undefined) surface.semiDiameterMm = diameter / 2;
        } else if (['CON', 'CONI', 'CC', 'CCY', 'K'].includes(command)) {
            surface.conic = parseFiniteNumber(args[0]);
        } else {
            const aMatch = command.match(/^A(4|6|8|10|12|14)$/);
            if (aMatch) {
                const power = Number(aMatch[1]);
                const index = (power - 4) / 2;
                const terms = surface.evenAsphereTerms ? [...surface.evenAsphereTerms] : [];
                terms[index] = parseFiniteNumber(args[0]) ?? 0;
                surface.evenAsphereTerms = terms;
                surface.type = surface.type ?? 'EVENASPH';
            }
        }
    }
    commit();

    const usable = surfaces.filter(surface => (
        surface.radiusMm !== undefined ||
        surface.thicknessToNextMm !== undefined ||
        surface.glass !== undefined ||
        surface.evenAsphereTerms?.length
    ));
    if (usable.length < 2) throw new Error('Could not find at least two usable Code V-style surfaces.');
    warnings.push('Imported as Code V-style text using common surface commands; verify any unsupported commands manually.');
    return { format: 'codeVSequence', name: title, surfaces: usable, warnings };
}

function looksLikeZemax(text: string): boolean {
    return /^\s*SURF\s+\d+/im.test(text) && /^\s*(CURV|DISZ|DIAM|GLAS)\s+/im.test(text);
}

function looksLikeCodeV(text: string): boolean {
    return /^\s*(?:RDY?|THI?|GLA|SDY|INS\s+S\d+)/im.test(text);
}

function looksLikeSurfaceTable(text: string): boolean {
    return text.split(/\r?\n/).some(line => tableLooksLikeSurfaceHeader(splitDelimitedLine(stripInlineComment(line))));
}

function addModelCoverageWarnings(prescription: OpticalPrescription): OpticalPrescription {
    const warnings = [...prescription.warnings];
    const explicitSurfaceCount = prescription.allSurfaces?.length ?? prescription.surfaces.length;
    if (explicitSurfaceCount > 3) {
        warnings.push(`Read ${explicitSurfaceCount} sequential surfaces. Current simulator components model a singlet/asphere or cemented doublet, so only the first supported lens group is instantiated.`);
    }
    return { ...prescription, warnings };
}

export function parseOpticalPrescription(text: string, fileName: string): OpticalPrescription {
    const extension = fileExtension(fileName);
    const unsupported = unsupportedMessageForExtension(extension);
    if (unsupported) throw new UnsupportedOpticImportError(unsupported);

    const trimmed = text.trim();
    const attempts: Array<() => OpticalPrescription> = [];
    if (extension === 'json' || trimmed.startsWith('{')) attempts.push(() => parseJsonOpticalPrescription(text, fileName));
    if (['csv', 'tsv'].includes(extension)) attempts.push(() => parseSurfaceTableText(text, fileName, 'csvSurfaceTable'));
    if (['seq'].includes(extension)) attempts.push(() => parseCodeVSequenceText(text, fileName));
    if (['len', 'dat'].includes(extension)) attempts.push(() => parseSurfaceTableText(text, fileName, 'osloLensText'));
    if (looksLikeZemax(text) || ['zmx', 'zemax'].includes(extension)) attempts.push(() => parseZemaxSequentialText(text, fileName));
    if (looksLikeCodeV(text)) attempts.push(() => parseCodeVSequenceText(text, fileName));
    if (looksLikeSurfaceTable(text)) attempts.push(() => parseSurfaceTableText(text, fileName, 'textSurfaceTable'));
    attempts.push(() => parseZemaxSequentialText(text, fileName));
    attempts.push(() => parseSurfaceTableText(text, fileName, 'textSurfaceTable'));
    attempts.push(() => parseCodeVSequenceText(text, fileName));

    const errors: string[] = [];
    for (const attempt of attempts) {
        try {
            return addModelCoverageWarnings(attempt());
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    throw new Error(`Could not import optical prescription. Tried Zemax text, Code V-style text, JSON, CSV/TSV, and generic surface tables. ${errors[0] ?? ''}`);
}

function apertureRadiusFromSurfaces(surfaces: PrescriptionSurface[]): number {
    const radii = surfaces
        .map(surface => surface.semiDiameterMm)
        .filter((value): value is number => value !== undefined && Number.isFinite(value) && value > 0);
    return radii.length > 0 ? Math.max(...radii) : 12.7;
}

function hasAsphericTerms(surface: PrescriptionSurface): boolean {
    return Boolean(
        surface.type?.toUpperCase().includes('ASPH') ||
        (surface.conic !== undefined && Math.abs(surface.conic) > 1e-12) ||
        surface.evenAsphereTerms?.some(value => value !== 0),
    );
}

function hasCylindricalTerms(surface: PrescriptionSurface): boolean {
    const type = surface.type?.toUpperCase() ?? '';
    return type.includes('TOROIDAL') || type.includes('CYLINDRICAL');
}

function surfaceIor(surface: PrescriptionSurface, fallback = 1.5168): number {
    return surface.ior ?? iorForGlass(surface.glass, fallback);
}

export function normalizedParamsFromPrescription(prescription: OpticalPrescription): NormalizedCatalogParams {
    if ((prescription.blackBoxSurfaces?.length ?? 0) > 0) {
        throw new Error('Zemax BLACKBOX prescriptions cannot be reduced to a simulator lens because the internal surfaces are hidden.');
    }

    const surfaces = prescription.surfaces;
    const apertureRadiusMm = apertureRadiusFromSurfaces(surfaces);
    const front = surfaces[0];
    const back = surfaces[1];
    const thicknessMm = front.thicknessToNextMm ?? 4;
    const ior = surfaceIor(front);

    if (surfaces.some(hasCylindricalTerms) && !surfaces.some(hasAsphericTerms)) {
        return {
            kind: 'cylindricalLens',
            apertureRadiusMm,
            widthMm: apertureRadiusMm * 2,
            thicknessMm,
            r1Mm: front.radiusMm,
            r2Mm: back.radiusMm,
            ior,
            ...(front.glass ? { material: front.glass } : {}),
        };
    }

    if (surfaces.length >= 3 && !surfaces.some(hasAsphericTerms)) {
        return {
            kind: 'achromatDoublet',
            apertureRadiusMm,
            r1Mm: front.radiusMm,
            r2Mm: back.radiusMm,
            r3Mm: surfaces[2].radiusMm,
            t1Mm: front.thicknessToNextMm ?? 2,
            t2Mm: back.thicknessToNextMm ?? 2,
            ior1: surfaceIor(front, 1.5168),
            ior2: surfaceIor(back, 1.65),
            ...(front.glass ? { glass1: front.glass } : {}),
            ...(back.glass ? { glass2: back.glass } : {}),
        };
    }

    if (surfaces.some(hasAsphericTerms)) {
        return {
            kind: 'asphericLens',
            apertureRadiusMm,
            thicknessMm,
            r1Mm: front.radiusMm,
            r2Mm: back.radiusMm,
            k1: front.conic ?? 0,
            k2: back.conic ?? 0,
            a1: front.evenAsphereTerms ?? [],
            a2: back.evenAsphereTerms ?? [],
            ior,
            ...(front.glass ? { material: front.glass } : {}),
            surfaceSource: 'exactPrescription',
        };
    }

    return {
        kind: 'sphericalLens',
        apertureRadiusMm,
        thicknessMm,
        r1Mm: front.radiusMm,
        r2Mm: back.radiusMm,
        ior,
        ...(front.glass ? { material: front.glass } : {}),
    };
}

export function componentFromOpticalPrescription(prescription: OpticalPrescription): OpticalComponent {
    const params = normalizedParamsFromPrescription(prescription);
    if (params.kind === 'achromatDoublet') {
        return new AchromatDoublet(
            params.r1Mm,
            params.r2Mm,
            params.r3Mm,
            params.t1Mm,
            params.t2Mm,
            params.apertureRadiusMm,
            params.ior1,
            params.ior2,
            prescription.name,
        );
    }
    if (params.kind === 'asphericLens') {
        return new AsphericLens({
            name: prescription.name,
            front: { R: params.r1Mm, k: params.k1, A: params.a1 ?? [] },
            back: { R: params.r2Mm, k: params.k2, A: params.a2 ?? [] },
            apertureRadius: params.apertureRadiusMm,
            thickness: params.thicknessMm,
            ior: params.ior,
        });
    }
    if (params.kind === 'sphericalLens') {
        return new SphericalLens(
            params.focalLengthMm ? 1 / params.focalLengthMm : 1 / 50,
            params.apertureRadiusMm,
            params.thicknessMm,
            prescription.name,
            params.r1Mm ?? undefined,
            params.r2Mm ?? undefined,
            params.ior,
        );
    }
    if (params.kind === 'cylindricalLens') {
        return new CylindricalLens(
            params.r1Mm,
            params.r2Mm,
            params.apertureRadiusMm,
            params.widthMm,
            params.thicknessMm,
            prescription.name,
            params.ior,
        );
    }
    throw new Error('Unsupported optical prescription.');
}

export function importOpticFromText(text: string, fileName: string): ImportedOptic {
    const prescription = parseOpticalPrescription(text, fileName);
    const normalized = normalizedParamsFromPrescription(prescription);
    const component = componentFromOpticalPrescription(prescription);
    return { component, prescription, normalized };
}
