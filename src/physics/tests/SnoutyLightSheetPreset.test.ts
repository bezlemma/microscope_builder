import { describe, expect, test } from 'bun:test';
import { Quaternion, Vector3 } from 'three';
import { createSnoutyLightSheetScene } from '../../presets/snoutyLightSheet';
import { Annotation } from '../components/Annotation';
import { Blocker } from '../components/Blocker';
import { Camera } from '../components/Camera';
import { ConeSource3D } from '../components/ConeSource3D';
import { DichroicMirror } from '../components/DichroicMirror';
import { Filter } from '../components/Filter';
import { GalvoScanHead } from '../components/GalvoScanHead';
import { Laser } from '../components/Laser';
import { Objective, OBJECTIVE_SURFACE_SNOUT_BACK, OBJECTIVE_SURFACE_SNOUT_ENTRY } from '../components/Objective';
import { Sample } from '../components/Sample';
import { mechanicalVisualAssetForCatalogPart } from '../../catalog/mechanicalVisualAssets';
import { findCatalogPart, makeCatalogAttachment } from '../../catalog/catalog';
import type { Ray } from '../types';

function makeLocalRay(origin: Vector3, direction: Vector3): Ray {
    return {
        origin,
        direction: direction.clone().normalize(),
        wavelength: 525e-9,
        intensity: 1,
        polarization: {
            x: { re: 1, im: 0 },
            y: { re: 0, im: 0 },
            z: { re: 0, im: 0 },
        },
        opticalPathLength: 0,
        footprintRadius: 0.01,
        coherenceMode: 0,
    };
}

function forwardAxis(component: { rotation: Quaternion }): Vector3 {
    return new Vector3(0, 0, 1).applyQuaternion(component.rotation.clone()).normalize();
}

describe('Snouty Light Sheet preset', () => {
    test('matches the appendix remote-refocus objective chain', () => {
        const result = createSnoutyLightSheetScene();
        const names = result.scene.map(component => component.name);
        const primary = result.scene.find((component): component is Objective =>
            component instanceof Objective && component.name.startsWith('O1 Nikon 100x/1.35'),
        );
        const secondary = result.scene.find((component): component is Objective =>
            component instanceof Objective && component.name.startsWith('O2 Nikon 40x/0.95'),
        );
        const tertiary = result.scene.find((component): component is Objective =>
            component instanceof Objective && component.name.startsWith('O3 ASI AMS-AGY v1 Snout Objective'),
        );
        const laser = result.scene.find((component): component is Laser => component instanceof Laser);
        const annotations = result.scene.filter((component): component is Annotation => component instanceof Annotation);
        const fluorescenceSource = result.scene.find((component): component is ConeSource3D =>
            component instanceof ConeSource3D && component.name === '525 nm Sample Fluorescence Cone',
        );
        const camera = result.scene.find((component): component is Camera => component instanceof Camera);
        const sample = result.scene.find((component): component is Sample => component instanceof Sample);
        const excitationDump = result.scene.find((component): component is Blocker =>
            component instanceof Blocker && component.name === 'Post-Sample Excitation Beam Dump',
        );
        const remoteWindow = result.scene.find((component): component is Filter =>
            component instanceof Filter && component.name === 'O2* Remote Coverslip Window',
        );
        const dichroic = result.scene.find((component): component is DichroicMirror =>
            component instanceof DichroicMirror && component.name.startsWith('D Quad Dichroic'),
        );
        const galvo = result.scene.find((component): component is GalvoScanHead =>
            component instanceof GalvoScanHead && component.name.startsWith('G1 Thorlabs GVS201'),
        );
        const tl1 = result.scene.find(component => component.name.startsWith('TL1 Nikon'));
        const sl1 = result.scene.find(component => component.name.startsWith('SL1 Thorlabs CLS-SL'));
        const sl2 = result.scene.find(component => component.name.startsWith('SL2 Thorlabs LSM03-VIS'));
        const tl2 = result.scene.find(component => component.name.startsWith('TL2 Nikon'));

        expect(primary).toBeDefined();
        expect(primary!.NA).toBeCloseTo(1.35, 6);
        expect(primary!.magnification).toBe(100);
        expect(primary!.focalLength).toBeCloseTo(2, 6);
        expect(primary!.immersionMediumKind).toBe('silicone');
        expect(secondary).toBeDefined();
        expect(secondary!.NA).toBeCloseTo(0.95, 6);
        expect(secondary!.magnification).toBe(40);
        expect(secondary!.focalLength).toBeCloseTo(5, 6);
        expect(secondary!.immersionMediumKind).toBe('air');
        expect(tertiary).toBeDefined();
        expect(tertiary!.NA).toBeCloseTo(1.0, 6);
        expect(tertiary!.magnification).toBe(40);
        expect(tertiary!.focalLength).toBeCloseTo(5, 6);
        expect(tertiary!.workingDistance).toBe(0);
        expect(tertiary!.diameter).toBeCloseTo(26, 6);
        expect(tertiary!.mechanicalStyle).toBe('snout');
        expect(tertiary!.catalog?.partId).toBe('asi:54-10-5');
        expect(tertiary!.snoutRadius).toBeCloseTo(3.38, 6);
        expect(tertiary!.snoutCutAngle).toBeCloseTo(-Math.PI / 2, 6);
        expect(tertiary!.rollAngle).toBeCloseTo(-Math.PI / 2, 6);
        expect(tertiary!.snoutLength).toBeGreaterThan(10);
        expect(tertiary!.snoutCutOffset).toBeGreaterThan(tertiary!.getOpticalFrontRadius());
        const bevel = tertiary!.getSnoutBevelPlane();
        expect(bevel).not.toBeNull();
        expect(bevel!.normal.angleTo(new Vector3(0, 0, -1))).toBeCloseTo(Math.PI / 4, 6);
        const worldBevelNormal = bevel!.normal.clone().applyQuaternion(tertiary!.rotation).normalize();
        expect(Math.abs(worldBevelNormal.z)).toBeLessThan(1e-6);
        expect(mechanicalVisualAssetForCatalogPart(findCatalogPart(tertiary!.catalog?.partId))?.url)
            .toBe('/catalog/mechanical/objectives/asi-54-10-5-ams-agy-v1.wrl');
        expect(laser?.wavelength).toBe(488);
        expect(fluorescenceSource?.wavelength).toBe(525);
        expect(fluorescenceSource?.halfAngle).toBeCloseTo(Math.asin(1.35 / 1.406), 6);
        expect(camera?.sensorResX).toBe(16);
        expect(sample).toBeDefined();
        expect(sample!.specimenKind).toBe('mickey');
        expect(sample!.position.x).toBeCloseTo(-2.82, 6);
        expect(sample!.specimenOffset.z).toBeCloseTo(-0.8, 6);
        const o1FrontX = primary!.getMechanicalMetrics().zFront + primary!.position.x;
        const sampleObjectiveSideSurfaceX = sample!.position.x + 1;
        expect(o1FrontX).toBeGreaterThan(sampleObjectiveSideSurfaceX);
        expect(o1FrontX - sampleObjectiveSideSurfaceX).toBeGreaterThan(0.05);
        expect(Math.abs(fluorescenceSource!.position.x - (primary!.position.x - primary!.focalLength))).toBeLessThan(0.05);
        expect(sampleObjectiveSideSurfaceX - fluorescenceSource!.position.x).toBeGreaterThan(0.1);
        expect(sampleObjectiveSideSurfaceX - fluorescenceSource!.position.x).toBeLessThan(0.3);
        expect(annotations).toHaveLength(0);
        expect(excitationDump).toBeDefined();
        expect(excitationDump!.diameter).toBe(90);
        expect(excitationDump!.position.x).toBeLessThan(sample!.position.x);
        expect(forwardAxis(excitationDump!).angleTo(new Vector3(1, 0, 0))).toBeLessThan(1e-6);
        expect(remoteWindow).toBeDefined();
        expect(dichroic).toBeDefined();
        expect(forwardAxis(dichroic!).angleTo(new Vector3(-1, 1, 0).normalize())).toBeLessThan(1e-6);
        const excitationRay = makeLocalRay(
            dichroic!.position.clone().add(new Vector3(50, 0, 0)),
            new Vector3(-1, 0, 0),
        );
        excitationRay.wavelength = 488e-9;
        const excitationHit = dichroic!.chkIntersection(excitationRay);
        expect(excitationHit).not.toBeNull();
        const reflectedExcitation = dichroic!.interact(excitationRay, excitationHit!).rays.find(ray =>
            ray.direction.angleTo(new Vector3(0, -1, 0)) < 1e-6,
        );
        expect(reflectedExcitation).toBeDefined();
        expect(galvo).toBeDefined();
        expect(names).toContain('TL1 Nikon MXA22018 Tube Lens (f=200)');
        expect(names).toContain('SL1 Thorlabs CLS-SL Scan Lens (f=70)');
        expect(names).toContain('G1 Thorlabs GVS201 1D Galvo Scan Mirror');
        expect(names).toContain('SL2 Thorlabs LSM03-VIS Scan Lens (f=39)');
        expect(names).toContain('TL2 Nikon MXA22018 Tube Lens (f=200)');
        expect(names).toContain('TL3 Nikon MXA22018 Tube Lens (f=200)');
        expect(tl1?.position.distanceTo(sl1!.position)).toBeCloseTo(270, 6);
        expect(sl1?.position.distanceTo(galvo!.position)).toBeCloseTo(70, 6);
        expect(galvo?.position.distanceTo(sl2!.position)).toBeCloseTo(39, 6);
        expect(sl2?.position.distanceTo(tl2!.position)).toBeCloseTo(239, 6);

        const remoteImageAxis = forwardAxis(secondary!).negate();
        const tiltDeg = remoteImageAxis.angleTo(forwardAxis(tertiary!)) * 180 / Math.PI;
        expect(tiltDeg).toBeCloseTo(30, 0);

        const remoteRefocusMagnification = primary!.magnification / secondary!.magnification;
        const bfpMagnification = 200 / 200;
        const totalMagnification = remoteRefocusMagnification * tertiary!.magnification;
        expect(remoteRefocusMagnification).toBeCloseTo(2.5, 6);
        expect(bfpMagnification).toBeCloseTo(1, 6);
        expect(totalMagnification).toBeCloseTo(100, 6);
    });

    test('snout objective gates rays with a 45 degree beveled front', () => {
        const objective = new Objective({
            magnification: 40,
            NA: 1.0,
            workingDistance: 0,
            tubeLensFocal: 200,
            diameter: 26,
            mechanicalStyle: 'snout',
            snoutRadius: 3.38,
            snoutLength: 11,
            snoutCutAngle: -Math.PI / 2,
        });

        const bevel = objective.getSnoutBevelPlane();
        expect(bevel).not.toBeNull();
        expect(bevel!.zMax - bevel!.zMin).toBeCloseTo(6.76, 2);

        const centralHit = objective.intersect(makeLocalRay(
            new Vector3(0, 0, -20),
            new Vector3(0, 0, 1),
        ));
        expect(centralHit).not.toBeNull();
        expect(centralHit?.isBlocked).not.toBe(true);

        const clippedHit = objective.intersect(makeLocalRay(
            new Vector3(0, -5, -20),
            new Vector3(0, 0, 1),
        ));
        expect(clippedHit).not.toBeNull();
        expect(clippedHit?.isBlocked).toBe(true);
    });

    test('catalog Snouty traces rays through the exposed Zemax black-box envelope', () => {
        const objective = new Objective({
            magnification: 40,
            NA: 1.0,
            workingDistance: 0,
            tubeLensFocal: 200,
            diameter: 26,
            mechanicalStyle: 'snout',
            snoutRadius: 3.38,
            snoutLength: 11,
            snoutCutAngle: -Math.PI / 2,
        });
        const part = findCatalogPart('asi:54-10-5');
        expect(part).not.toBeNull();
        objective.catalog = makeCatalogAttachment(part!);
        objective.updateMatrices();

        const frontRay = makeLocalRay(new Vector3(0, 0, -20), new Vector3(0, 0, 1));
        const frontHit = objective.intersect(frontRay);
        expect(frontHit?.surfaceIndex).toBe(OBJECTIVE_SURFACE_SNOUT_ENTRY);
        expect(frontHit?.point.z).toBeCloseTo(-1.62, 2);
        const frontResult = objective.interact(frontRay, frontHit!);
        expect(frontResult.rays).toHaveLength(1);
        expect(frontResult.rays[0].exitSurfaceId).toBe('Objective:zbbez:forward');
        expect(frontResult.rays[0].entryPoint?.distanceTo(frontHit!.point)).toBeLessThan(1e-9);
        expect(frontResult.rays[0].internalPath).toHaveLength(2);
        expect(frontResult.rays[0].internalPath?.[0].z).toBeLessThan(0);
        expect(frontResult.rays[0].internalPath?.[1].z).toBeCloseTo(26.872594113995483, 6);
        expect(frontResult.rays[0].origin.z).toBeGreaterThan(29.999);
        expect(frontResult.rays[0].direction.z).toBeGreaterThan(0.99);

        const backRay = makeLocalRay(new Vector3(0, 0, 40), new Vector3(0, 0, -1));
        const backHit = objective.intersect(backRay);
        expect(backHit?.surfaceIndex).toBe(OBJECTIVE_SURFACE_SNOUT_BACK);
        const backResult = objective.interact(backRay, backHit!);
        expect(backResult.rays).toHaveLength(1);
        expect(backResult.rays[0].exitSurfaceId).toBe('Objective:zbbez:reverse');
        expect(backResult.rays[0].entryPoint?.distanceTo(backHit!.point)).toBeLessThan(1e-9);
        expect(backResult.rays[0].internalPath?.[0].z).toBeCloseTo(0, 6);
        expect(backResult.rays[0].origin.z).toBeLessThan(0);
        expect(backResult.rays[0].direction.z).toBeLessThan(-0.99);
    });

    test('uses static appendix layout ray defaults', () => {
        const result = createSnoutyLightSheetScene();

        expect(result.description).toContain('Appendix-style');
        expect(result.channels).toEqual([]);
        expect(result.animationPlaying).toBe(false);
        expect(result.animationSpeed).toBe(1);
        expect(result.scanSteps).toBe(1);
        expect(result.rayCount).toBe(64);
        expect(result.rayConfig?.minRayOpacity).toBeCloseTo(0.08, 6);
        expect(result.rayConfig?.maxRayOpacity).toBeCloseTo(0.72, 6);
    });
});
