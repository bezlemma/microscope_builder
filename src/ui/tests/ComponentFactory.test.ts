import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { applyDefaultPlacementOrientation, createCatalogComponentForType, createComponentForType } from '../componentFactory';
import { SphericalLens } from '../../physics/components/SphericalLens';
import { AsphericLens } from '../../physics/components/AsphericLens';
import { CylindricalLens } from '../../physics/components/CylindricalLens';
import { AchromatDoublet } from '../../physics/components/AchromatDoublet';
import { Objective } from '../../physics/components/Objective';
import { PrismLens } from '../../physics/components/PrismLens';

function forwardDirection(type: string): Vector3 {
    const component = createComponentForType(type);
    if (!component) throw new Error(`Unknown component type: ${type}`);
    applyDefaultPlacementOrientation(component, type);
    return new Vector3(0, 0, 1).applyQuaternion(component.rotation).normalize();
}

describe('Component factory placement defaults', () => {
    test('axial optics drop upright instead of parallel to the table', () => {
        for (const type of [
            'blocker',
            'card',
            'aperture',
            'slitAperture',
            'filter',
            'halfWavePlate',
            'quarterWavePlate',
            'polarizer',
            'laser',
            'lamp',
            'sample',
            'colloidSampleSlide',
        ]) {
            const forward = forwardDirection(type);
            expect(Math.abs(forward.z)).toBeLessThan(1e-6);
            expect(forward.x).toBeGreaterThan(0.99);
        }
    });

    test('prism drops with its triangular profile visible top-down', () => {
        const prism = createComponentForType('prism');
        expect(prism).toBeDefined();
        applyDefaultPlacementOrientation(prism!, 'prism');
        const extrusion = new Vector3(1, 0, 0).applyQuaternion(prism!.rotation).normalize();
        const apexAxis = new Vector3(0, 1, 0).applyQuaternion(prism!.rotation).normalize();
        const baseAxis = new Vector3(0, 0, 1).applyQuaternion(prism!.rotation).normalize();
        expect(extrusion.z).toBeGreaterThan(0.99);
        expect(apexAxis.x).toBeGreaterThan(0.99);
        expect(baseAxis.y).toBeGreaterThan(0.99);
    });

    test('sample chamber keeps its bowl/base geometry upright on the table', () => {
        const chamber = createComponentForType('lChamber');
        expect(chamber).toBeDefined();
        applyDefaultPlacementOrientation(chamber!, 'lChamber');
        const forward = new Vector3(0, 0, 1).applyQuaternion(chamber!.rotation).normalize();
        expect(forward.z).toBeGreaterThan(0.99);
    });

    test('polygon scanner keeps its spin axis vertical on drop', () => {
        const scanner = createComponentForType('polygonScanner');
        expect(scanner).toBeDefined();
        applyDefaultPlacementOrientation(scanner!, 'polygonScanner');
        const spinAxis = new Vector3(0, 0, 1).applyQuaternion(scanner!.rotation).normalize();
        expect(spinAxis.z).toBeGreaterThan(0.99);
    });

    test('fold optics drop upright with an in-plane diagonal normal', () => {
        for (const type of ['mirror', 'beamSplitter', 'dichroic']) {
            const forward = forwardDirection(type);
            expect(Math.abs(forward.z)).toBeLessThan(1e-6);
            expect(forward.x).toBeGreaterThan(0.6);
            expect(forward.y).toBeLessThan(-0.6);
        }
    });

    test('camera drops facing back toward a typical +X-end microscope beam path', () => {
        const forward = forwardDirection('camera');
        expect(Math.abs(forward.z)).toBeLessThan(1e-6);
        expect(forward.x).toBeLessThan(-0.99);
    });

    test('dragged-out camera starts with brightfield-friendly detector defaults', () => {
        const camera = createComponentForType('camera') as any;
        expect(camera.sensorResX).toBe(32);
        expect(camera.sensorResY).toBe(32);
        expect(camera.sensorNA).toBe(0.025);
    });

    test('sample drawer includes a colloid flow-cell holder variant', () => {
        const sample = createComponentForType('colloidSampleSlide') as any;
        expect(sample.specimenKind).toBe('colloids');
        expect(sample.colloidSpheres).toHaveLength(320);
        expect(sample.flowCellWidth).toBeCloseTo(8, 6);
        expect(sample.flowCellHeight).toBeCloseTo(8, 6);
        expect(sample.flowCellDepth).toBeCloseTo(0.0075, 6);
    });

    test('dragged-out trapped bead uses micron-scale physical size with a visible halo', () => {
        const bead = createComponentForType('trappedBead') as any;
        expect(bead.diameter).toBeLessThanOrEqual(0.01);
        expect(bead.visualGlowRadius).toBeGreaterThan(bead.radius);
        expect(bead.visualGlowRadius).toBeLessThanOrEqual(0.015);
    });

    test('catalog-backed creation is explicit and leaves platonic defaults unchanged', () => {
        const plain = createComponentForType('lens') as SphericalLens;
        const catalog = createCatalogComponentForType('lens', 'thorlabs:LA1509-A') as SphericalLens;

        expect(plain.catalog).toBeUndefined();
        expect(plain.name).toBe('New Lens');
        expect(catalog.catalog?.partId).toBe('thorlabs:LA1509-A');
        expect(catalog.name).toBe('LA1509-A');
        expect(catalog.apertureRadius).toBeCloseTo(12.7, 6);
    });

    test('catalog-backed creation supports generated non-spherical lens families', () => {
        const asphere = createCatalogComponentForType('asphericLens', 'thorlabs:354060-A') as AsphericLens;
        const cylinder = createCatalogComponentForType('cylindricalLens', 'thorlabs:LJ1821L1') as CylindricalLens;
        const achromat = createCatalogComponentForType('achromatDoublet', 'thorlabs:AC254-200-A') as AchromatDoublet;
        const objective = createCatalogComponentForType('objective', 'thorlabs:TL10X-2P') as Objective;
        const prism = createCatalogComponentForType('prism', 'thorlabs:PS910') as PrismLens;

        expect(asphere.catalog?.partId).toBe('thorlabs:354060-A');
        expect(asphere.apertureRadius).toBeCloseTo(3.1625, 6);
        expect(cylinder.catalog?.partId).toBe('thorlabs:LJ1821L1');
        expect(cylinder.width).toBeCloseTo(50, 6);
        expect(achromat.catalog?.partId).toBe('thorlabs:AC254-200-A');
        expect(achromat.r1).toBeCloseTo(77.4, 6);
        expect(objective.catalog?.partId).toBe('thorlabs:TL10X-2P');
        expect(objective.NA).toBeCloseTo(0.5, 6);
        expect(objective.diameter).toBeCloseTo(32, 6);
        expect(prism.catalog?.partId).toBe('thorlabs:PS910');
        expect(prism.vertices).toHaveLength(3);
    });
});
