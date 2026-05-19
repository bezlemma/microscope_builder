import { SphericalLens } from '../physics/components/SphericalLens';
import { AsphericLens } from '../physics/components/AsphericLens';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { AchromatDoublet } from '../physics/components/AchromatDoublet';
import { Objective } from '../physics/components/Objective';
import { PrismLens } from '../physics/components/PrismLens';
import type { OpticalComponent } from '../physics/Component';
import { Vector3 } from 'three';
import { THORLABS_GENERATED_CATALOG } from './thorlabsGeneratedCatalog';
import { THORLABS_SEED_CATALOG } from './thorlabsSeedCatalog';
import type { CatalogAttachment, CatalogFile, CatalogPart, CatalogComponentType } from './types';
import { resolveCatalogPartGeometry } from './catalogGeometryAssets';

export const CATALOG_SNAPSHOT_VERSION = 'thorlabs-optics-2026-05-19';

const GENERATED_PART_IDS = new Set(THORLABS_GENERATED_CATALOG.map(part => part.id));

const RAW_CATALOG_PARTS: CatalogPart[] = [
    ...THORLABS_GENERATED_CATALOG,
    ...THORLABS_SEED_CATALOG.filter(part => !GENERATED_PART_IDS.has(part.id)),
];

function numericSpec(part: CatalogPart, key: string): number | undefined {
    const value = part.specs[key]?.value;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function objectiveThreadDiameterMm(part: CatalogPart): number | undefined {
    const threading = part.specs.threading?.value;
    if (typeof threading !== 'string') return undefined;
    const match = threading.match(/\bM\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (!match) return undefined;
    const diameter = Number.parseFloat(match[1]);
    return Number.isFinite(diameter) && diameter > 0 ? diameter : undefined;
}

function normalizeCatalogFiles(files: CatalogFile[]): CatalogFile[] {
    return files.map((file) => {
        if (file.role) return file;
        if (file.kind === 'zemax' || file.kind === 'opticStudio' || file.kind === 'codeV' || file.kind === 'oslo') {
            return { ...file, role: 'opticalPrescription' };
        }
        if (file.kind === 'step' || file.kind === 'solidworks') return { ...file, role: 'mechanicalModel' };
        if (file.kind === 'pdf') return { ...file, role: 'datasheet' };
        if (file.kind === 'dxf') return { ...file, role: 'drawing' };
        if (file.kind === 'glassCatalog') return { ...file, role: 'glassCatalog' };
        if (file.kind === 'coating') return { ...file, role: 'coating' };
        if (file.kind === 'image') return { ...file, role: 'image' };
        return file;
    });
}

function normalizeCatalogPart(part: CatalogPart): CatalogPart {
    const base = {
        ...part,
        files: normalizeCatalogFiles(part.files),
    };

    if (base.normalized.kind !== 'asphericLens') return base;

    const { note: _note, ...specs } = base.specs;
    const diameter = numericSpec(base, 'diameter');
    const clearAperture = numericSpec(base, 'clearAperture');
    const apertureDiameter = diameter ?? clearAperture ?? base.normalized.apertureRadiusMm * 2;

    return {
        ...base,
        specs,
        normalized: {
            ...base.normalized,
            apertureRadiusMm: apertureDiameter / 2,
        },
    };
}

export const CATALOG_PARTS: CatalogPart[] = RAW_CATALOG_PARTS.map(normalizeCatalogPart);

const PART_BY_ID = new Map(CATALOG_PARTS.map(part => [part.id, part]));

export function findCatalogPart(id: string | undefined | null): CatalogPart | null {
    return id ? PART_BY_ID.get(id) ?? null : null;
}

export function componentCatalogType(component: OpticalComponent): CatalogComponentType {
    if (component instanceof SphericalLens) return 'sphericalLens';
    if (component instanceof AsphericLens) return 'asphericLens';
    if (component instanceof CylindricalLens) return 'cylindricalLens';
    if (component instanceof AchromatDoublet) return 'achromatDoublet';
    if (component instanceof Objective) return 'objective';
    if (component instanceof PrismLens) return 'prism';
    return 'unknown';
}

export function catalogComponentTypeForPaletteType(type: string): CatalogComponentType {
    switch (type) {
        case 'lens': return 'sphericalLens';
        case 'asphericLens': return 'asphericLens';
        case 'cylindricalLens': return 'cylindricalLens';
        case 'achromatDoublet': return 'achromatDoublet';
        case 'objective': return 'objective';
        case 'prism': return 'prism';
        default: return 'unknown';
    }
}

export function catalogPartsForPaletteType(type: string): CatalogPart[] {
    const catalogType = catalogComponentTypeForPaletteType(type);
    if (catalogType === 'unknown') return [];
    return CATALOG_PARTS.filter(part => part.componentType === catalogType);
}

export function compatibleCatalogParts(component: OpticalComponent): CatalogPart[] {
    const type = componentCatalogType(component);
    if (type === 'unknown') return [];
    return CATALOG_PARTS.filter(part => part.componentType === type);
}

function relativeDifference(a: number | undefined | null, b: number | undefined | null): number {
    if (a === undefined || a === null || b === undefined || b === null) return 0.35;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 2;
    return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1);
}

function radiusDifference(a: number | undefined | null, b: number | undefined | null): number {
    const ra = a ?? 1e9;
    const rb = b ?? 1e9;
    const flatA = Math.abs(ra) >= 1e8;
    const flatB = Math.abs(rb) >= 1e8;
    if (flatA && flatB) return 0;
    if (flatA || flatB) return 0.9;
    return relativeDifference(ra, rb);
}

export function scoreCatalogPartAgainstSphericalLens(lens: SphericalLens, part: CatalogPart): number {
    if (part.normalized.kind !== 'sphericalLens') return Number.POSITIVE_INFINITY;
    const params = part.normalized;
    const radii = lens.getRadii();
    const designFocal = lens.focalLength;
    const catalogFocal = params.focalLengthMm;
    const focalSignPenalty = catalogFocal !== undefined && Math.sign(designFocal) !== Math.sign(catalogFocal) ? 3 : 0;

    return (
        focalSignPenalty +
        4.0 * relativeDifference(Math.abs(designFocal), catalogFocal === undefined ? undefined : Math.abs(catalogFocal)) +
        1.4 * relativeDifference(lens.apertureRadius, params.apertureRadiusMm) +
        0.8 * relativeDifference(lens.thickness, params.thicknessMm) +
        0.8 * radiusDifference(radii.R1, params.r1Mm) +
        0.8 * radiusDifference(radii.R2, params.r2Mm) +
        0.4 * relativeDifference(lens.ior, params.ior)
    );
}

export function rankCatalogPartsForSphericalLens(lens: SphericalLens, parts: CatalogPart[]): CatalogPart[] {
    return [...parts].sort((a, b) => {
        const scoreA = scoreCatalogPartAgainstSphericalLens(lens, a);
        const scoreB = scoreCatalogPartAgainstSphericalLens(lens, b);
        if (scoreA !== scoreB) return scoreA - scoreB;
        return a.sku.localeCompare(b.sku);
    });
}

function thickLensFocalFromRadii(r1: number | null | undefined, r2: number | null | undefined, thickness: number, ior: number): number | undefined {
    const R1 = r1 ?? 1e9;
    const R2 = r2 ?? 1e9;
    const flat1 = Math.abs(R1) >= 1e8;
    const flat2 = Math.abs(R2) >= 1e8;
    const invR1 = flat1 ? 0 : 1 / R1;
    const invR2 = flat2 ? 0 : 1 / R2;
    const thickTerm = flat1 || flat2 ? 0 : ((ior - 1) ** 2 * thickness) / (ior * R1 * R2);
    const invF = (ior - 1) * (invR1 - invR2) + thickTerm;
    return Math.abs(invF) < 1e-12 ? undefined : 1 / invF;
}

function achromatApproxFocal(lens: AchromatDoublet): number | undefined {
    const invR1 = Math.abs(lens.r1) >= 1e8 ? 0 : 1 / lens.r1;
    const invR2 = Math.abs(lens.r2) >= 1e8 ? 0 : 1 / lens.r2;
    const invR3 = Math.abs(lens.r3) >= 1e8 ? 0 : 1 / lens.r3;
    const power = (lens.ior1 - 1) * invR1 + (lens.ior2 - lens.ior1) * invR2 + (1 - lens.ior2) * invR3;
    return Math.abs(power) < 1e-12 ? undefined : 1 / power;
}

function focalScore(designFocal: number | undefined, catalogFocal: number | undefined): number {
    if (designFocal === undefined || catalogFocal === undefined) return 0.35;
    const signPenalty = Math.sign(designFocal) !== Math.sign(catalogFocal) ? 3 : 0;
    return signPenalty + relativeDifference(Math.abs(designFocal), Math.abs(catalogFocal));
}

function normalized2dVertices(vertices: readonly [number, number][]): [number, number][] {
    if (vertices.length === 0) return [];
    const cx = vertices.reduce((sum, [x]) => sum + x, 0) / vertices.length;
    const cy = vertices.reduce((sum, [, y]) => sum + y, 0) / vertices.length;
    return vertices.map(([x, y]) => [x - cx, y - cy]);
}

function sortedInternalAngles(vertices: readonly [number, number][]): number[] {
    const centered = normalized2dVertices(vertices);
    return centered.map((current, index) => {
        const prev = centered[(index - 1 + centered.length) % centered.length];
        const next = centered[(index + 1) % centered.length];
        const ax = prev[0] - current[0];
        const ay = prev[1] - current[1];
        const bx = next[0] - current[0];
        const by = next[1] - current[1];
        const denom = Math.hypot(ax, ay) * Math.hypot(bx, by) || 1;
        const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / denom));
        return Math.acos(cos) * 180 / Math.PI;
    }).sort((a, b) => a - b);
}

function angleProfileDifference(a: readonly [number, number][], b: readonly [number, number][]): number {
    if (a.length !== b.length) return 1;
    const anglesA = sortedInternalAngles(a);
    const anglesB = sortedInternalAngles(b);
    if (anglesA.length === 0) return 1;
    const total = anglesA.reduce((sum, angle, index) => sum + Math.abs(angle - (anglesB[index] ?? angle)), 0);
    return total / (anglesA.length * 180);
}

export function scoreCatalogPartAgainstDesignComponent(component: OpticalComponent, part: CatalogPart): number {
    if (component instanceof SphericalLens) return scoreCatalogPartAgainstSphericalLens(component, part);

    if (component instanceof AsphericLens) {
        if (part.normalized.kind !== 'asphericLens') return Number.POSITIVE_INFINITY;
        const params = part.normalized;
        return (
            4.0 * focalScore(component.focalLength, params.focalLengthMm) +
            1.4 * relativeDifference(component.apertureRadius, params.apertureRadiusMm) +
            0.8 * relativeDifference(component.thickness, params.thicknessMm) +
            0.8 * radiusDifference(component.r1, params.r1Mm) +
            0.8 * radiusDifference(component.r2, params.r2Mm) +
            0.3 * relativeDifference(component.k1, params.k1) +
            0.3 * relativeDifference(component.k2, params.k2) +
            0.4 * relativeDifference(component.ior, params.ior)
        );
    }

    if (component instanceof CylindricalLens) {
        if (part.normalized.kind !== 'cylindricalLens') return Number.POSITIVE_INFINITY;
        const params = part.normalized;
        const designFocal = thickLensFocalFromRadii(component.r1, component.r2, component.thickness, component.ior);
        return (
            4.0 * focalScore(designFocal, params.focalLengthMm) +
            1.4 * relativeDifference(component.apertureRadius, params.apertureRadiusMm) +
            0.8 * relativeDifference(component.width, params.widthMm) +
            0.8 * relativeDifference(component.thickness, params.thicknessMm) +
            0.8 * radiusDifference(component.r1, params.r1Mm) +
            0.8 * radiusDifference(component.r2, params.r2Mm) +
            0.4 * relativeDifference(component.ior, params.ior)
        );
    }

    if (component instanceof AchromatDoublet) {
        if (part.normalized.kind !== 'achromatDoublet') return Number.POSITIVE_INFINITY;
        const params = part.normalized;
        return (
            4.0 * focalScore(achromatApproxFocal(component), params.focalLengthMm) +
            1.4 * relativeDifference(component.apertureRadius, params.apertureRadiusMm) +
            0.8 * relativeDifference(component.t1, params.t1Mm) +
            0.8 * relativeDifference(component.t2, params.t2Mm) +
            0.8 * radiusDifference(component.r1, params.r1Mm) +
            0.8 * radiusDifference(component.r2, params.r2Mm) +
            0.8 * radiusDifference(component.r3, params.r3Mm) +
            0.4 * relativeDifference(component.ior1, params.ior1) +
            0.4 * relativeDifference(component.ior2, params.ior2)
        );
    }

    if (component instanceof Objective) {
        if (part.normalized.kind !== 'objective') return Number.POSITIVE_INFINITY;
        const params = part.normalized;
        return (
            3.0 * relativeDifference(component.magnification, params.magnification) +
            3.0 * relativeDifference(component.NA, params.numericalAperture) +
            1.2 * relativeDifference(component.workingDistance, params.workingDistanceMm) +
            0.4 * relativeDifference(component.tubeLensFocal, params.tubeLensFocalMm) +
            0.4 * relativeDifference(component.immersionIndex, params.immersionIndex)
        );
    }

    if (component instanceof PrismLens) {
        if (part.normalized.kind !== 'prism') return Number.POSITIVE_INFINITY;
        const params = part.normalized;
        return (
            1.5 * relativeDifference(component.width, params.widthMm) +
            0.8 * angleProfileDifference(component.vertices, params.verticesMm) +
            0.6 * relativeDifference(component.ior, params.ior) +
            0.8 * relativeDifference(component.numFaces, params.verticesMm.length)
        );
    }

    return Number.POSITIVE_INFINITY;
}

export function rankCatalogPartsForDesignComponent(component: OpticalComponent, parts: CatalogPart[]): CatalogPart[] {
    return [...parts].sort((a, b) => {
        const scoreA = scoreCatalogPartAgainstDesignComponent(component, a);
        const scoreB = scoreCatalogPartAgainstDesignComponent(component, b);
        if (scoreA !== scoreB) return scoreA - scoreB;
        return a.sku.localeCompare(b.sku);
    });
}

export function makeCatalogAttachment(part: CatalogPart): CatalogAttachment {
    return {
        partId: part.id,
        vendor: part.vendor,
        sku: part.sku,
        title: part.title,
        productUrl: part.productUrl,
        snapshotVersion: CATALOG_SNAPSHOT_VERSION,
        attachedAt: new Date().toISOString(),
        confidence: part.confidence,
        price: part.price,
    };
}

function applySphericalLensPart(component: SphericalLens, part: CatalogPart): boolean {
    if (part.normalized.kind !== 'sphericalLens') return false;
    const params = part.normalized;
    component.name = part.sku;
    component.apertureRadius = params.apertureRadiusMm;
    component.thickness = params.thicknessMm;
    component.ior = params.ior ?? component.ior;
    component.r1 = params.r1Mm ?? undefined;
    component.r2 = params.r2Mm ?? undefined;
    if (params.focalLengthMm && component.r1 === undefined && component.r2 === undefined) {
        component.curvature = 1 / params.focalLengthMm;
    } else if (params.focalLengthMm) {
        component.curvature = 1 / params.focalLengthMm;
    }
    component.bounds.set(
        new Vector3(-component.apertureRadius, -component.apertureRadius, -component.thickness / 2),
        new Vector3(component.apertureRadius, component.apertureRadius, component.thickness / 2),
    );
    component.invalidateMesh();
    return true;
}

function applyAsphericLensPart(component: AsphericLens, part: CatalogPart): boolean {
    if (part.normalized.kind !== 'asphericLens') return false;
    const params = part.normalized;
    component.name = part.sku;
    component.r1 = params.r1Mm;
    component.r2 = params.r2Mm;
    component.k1 = params.k1;
    component.k2 = params.k2;
    component.A1 = [...(params.a1 ?? [])];
    component.A2 = [...(params.a2 ?? [])];
    component.apertureRadius = params.apertureRadiusMm;
    component.thickness = params.thicknessMm;
    component.ior = params.ior ?? component.ior;
    component.recomputeBounds();
    component.invalidateMesh();
    return true;
}

function applyCylindricalLensPart(component: CylindricalLens, part: CatalogPart): boolean {
    if (part.normalized.kind !== 'cylindricalLens') return false;
    const params = part.normalized;
    component.name = part.sku;
    component.r1 = params.r1Mm;
    component.r2 = params.r2Mm;
    component.apertureRadius = params.apertureRadiusMm;
    component.width = params.widthMm;
    component.thickness = params.thicknessMm;
    component.ior = params.ior ?? component.ior;
    component.bounds.set(
        new Vector3(-component.width / 2, -component.apertureRadius, -component.thickness / 2),
        new Vector3(component.width / 2, component.apertureRadius, component.thickness / 2),
    );
    component.invalidateMesh();
    return true;
}

function applyAchromatPart(component: AchromatDoublet, part: CatalogPart): boolean {
    if (part.normalized.kind !== 'achromatDoublet') return false;
    const params = part.normalized;
    component.name = part.sku;
    component.r1 = params.r1Mm;
    component.r2 = params.r2Mm;
    component.r3 = params.r3Mm;
    component.t1 = params.t1Mm;
    component.t2 = params.t2Mm;
    component.apertureRadius = params.apertureRadiusMm;
    component.ior1 = params.ior1 ?? component.ior1;
    component.ior2 = params.ior2 ?? component.ior2;
    const total = component.totalThickness;
    component.bounds.set(
        new Vector3(-component.apertureRadius, -component.apertureRadius, -total / 2),
        new Vector3(component.apertureRadius, component.apertureRadius, total / 2),
    );
    component.invalidateMesh();
    return true;
}

function applyObjectivePart(component: Objective, part: CatalogPart): boolean {
    if (part.normalized.kind !== 'objective') return false;
    const params = part.normalized;
    component.name = part.sku;
    component.magnification = params.magnification;
    component.NA = params.numericalAperture;
    component.workingDistance = params.workingDistanceMm;
    component.tubeLensFocal = params.tubeLensFocalMm ?? component.tubeLensFocal;
    component.diameter = params.diameterMm ?? objectiveThreadDiameterMm(part) ?? component.diameter;
    component.coverslipThickness = params.coverGlassThicknessMm ?? component.coverslipThickness;
    component.fieldNumber = params.fieldNumberMm ?? component.fieldNumber;
    component.immersionMediumKind = params.immersionMediumKind ?? component.immersionMediumKind;
    component.immersionIndex = params.immersionIndex ?? component.immersionIndex;
    component.recalculate();
    return true;
}

function applyPrismPart(component: PrismLens, part: CatalogPart): boolean {
    if (part.normalized.kind !== 'prism') return false;
    const params = part.normalized;
    component.name = part.sku;
    component.width = params.widthMm;
    component.ior = params.ior ?? component.ior;
    component.setVertices(params.verticesMm.map(([a, b]) => [a, b] as [number, number]));
    return true;
}

export function applyCatalogPartToComponent(component: OpticalComponent, part: CatalogPart): boolean {
    let applied = false;
    if (component instanceof SphericalLens) applied = applySphericalLensPart(component, part);
    else if (component instanceof AsphericLens) applied = applyAsphericLensPart(component, part);
    else if (component instanceof CylindricalLens) applied = applyCylindricalLensPart(component, part);
    else if (component instanceof AchromatDoublet) applied = applyAchromatPart(component, part);
    else if (component instanceof Objective) applied = applyObjectivePart(component, part);
    else if (component instanceof PrismLens) applied = applyPrismPart(component, part);

    if (applied) {
        component.catalog = makeCatalogAttachment(part);
        component.version++;
    }
    return applied;
}

export async function applyCatalogPartToComponentWithLazyGeometry(component: OpticalComponent, part: CatalogPart): Promise<boolean> {
    const resolvedPart = await resolveCatalogPartGeometry(part);
    return applyCatalogPartToComponent(component, resolvedPart);
}

export interface BomLine {
    part: CatalogAttachment;
    quantity: number;
    componentNames: string[];
    unitPrice?: number;
    totalPrice?: number;
    currency?: string;
}

export interface BomSummary {
    lines: BomLine[];
    totalByCurrency: Record<string, number>;
}

export function summarizeBom(components: OpticalComponent[]): BomSummary {
    const grouped = new Map<string, BomLine>();

    for (const component of components) {
        const catalog = component.catalog;
        if (!catalog || component.isGhost || component.isSubComponent) continue;
        const line = grouped.get(catalog.partId) ?? {
            part: catalog,
            quantity: 0,
            componentNames: [],
            unitPrice: catalog.price?.amount,
            currency: catalog.price?.currency,
        };
        line.quantity += 1;
        line.componentNames.push(component.name);
        if (line.unitPrice !== undefined) line.totalPrice = line.unitPrice * line.quantity;
        grouped.set(catalog.partId, line);
    }

    const lines = [...grouped.values()].sort((a, b) => a.part.sku.localeCompare(b.part.sku));
    const totalByCurrency: Record<string, number> = {};
    for (const line of lines) {
        if (line.totalPrice === undefined || !line.currency) continue;
        totalByCurrency[line.currency] = (totalByCurrency[line.currency] ?? 0) + line.totalPrice;
    }
    return { lines, totalByCurrency };
}
