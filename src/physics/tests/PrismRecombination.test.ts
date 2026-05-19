import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';

import { createPrismRecombinationScene } from '../../presets/prismRecombination';
import { Solver1 } from '../Solver1';
import { createSourceRays } from '../SourceRayFactory';
import type { Ray } from '../types';
import { Card } from '../components/Card';
import { IdealLens } from '../components/IdealLens';
import { Lamp } from '../components/Lamp';
import { PrismLens } from '../components/PrismLens';

function wavelengthNm(ray: Ray): number {
    return Math.round(ray.wavelength * 1e9);
}

function transverseBasis(normal: Vector3): Vector3 {
    const n = normal.clone().normalize();
    const u = new Vector3(-n.y, n.x, 0);
    if (u.lengthSq() < 1e-12) u.set(0, 1, 0);
    return u.normalize();
}

function raysAfterOrderedPrisms(paths: Ray[][], prismNames: string[]): Ray[] {
    const result: Ray[] = [];
    for (const path of paths) {
        let nextPrism = 0;
        for (const ray of path) {
            if (ray.exitSurfaceId?.startsWith(`${prismNames[nextPrism]}:`)) {
                nextPrism++;
            }
            if (nextPrism === prismNames.length) {
                result.push(ray);
                break;
            }
        }
    }
    return result;
}

function wavelengthCentroidsAtVirtualPlane(rays: Ray[], distanceFromMainRayOrigin: number): Map<number, number> {
    const mainRay = rays.find(ray => ray.isMainRay && wavelengthNm(ray) === 540)
        ?? rays.find(ray => wavelengthNm(ray) === 540)
        ?? rays[0];
    expect(mainRay).toBeDefined();

    const planeNormal = mainRay.direction.clone().normalize();
    const planePoint = mainRay.origin.clone().addScaledVector(planeNormal, distanceFromMainRayOrigin);
    const transverse = transverseBasis(planeNormal);
    const sums = new Map<number, { power: number; x: number }>();

    for (const ray of rays) {
        const denom = ray.direction.dot(planeNormal);
        if (Math.abs(denom) < 1e-9) continue;
        const t = planePoint.clone().sub(ray.origin).dot(planeNormal) / denom;
        if (t < 0) continue;
        const point = ray.origin.clone().addScaledVector(ray.direction, t);
        const x = point.clone().sub(planePoint).dot(transverse);
        const wl = wavelengthNm(ray);
        const entry = sums.get(wl) ?? { power: 0, x: 0 };
        entry.power += ray.intensity;
        entry.x += x * ray.intensity;
        sums.set(wl, entry);
    }

    return new Map(
        Array.from(sums.entries())
            .filter(([, value]) => value.power > 0)
            .map(([wl, value]) => [wl, value.x / value.power]),
    );
}

function centroidRange(centroids: Map<number, number>): number {
    const values = Array.from(centroids.values());
    return Math.max(...values) - Math.min(...values);
}

function mainRayAngleRange(rays: Ray[]): number {
    const angles = rays
        .filter(ray => ray.isMainRay)
        .map(ray => Math.atan2(ray.direction.y, ray.direction.x));
    return Math.max(...angles) - Math.min(...angles);
}

function prismProfileVertices(prism: PrismLens): Vector3[] {
    prism.updateMatrices();
    return prism.vertices.map(([a, b]) =>
        new Vector3(0, a, b).applyMatrix4(prism.localToWorld)
    );
}

function closestPrismVertexDistance(a: PrismLens, b: PrismLens): number {
    let closest = Infinity;
    for (const va of prismProfileVertices(a)) {
        for (const vb of prismProfileVertices(b)) {
            closest = Math.min(closest, va.distanceTo(vb));
        }
    }
    return closest;
}

describe('Prism recombination preset', () => {
    test('contains only a white lamp and physical prisms', () => {
        const { scene, rayCount, rayConfig } = createPrismRecombinationScene();
        const lamp = scene.find((c): c is Lamp => c instanceof Lamp);
        const prisms = scene.filter((c): c is PrismLens => c instanceof PrismLens);

        expect(scene.filter(c => c instanceof Lamp)).toHaveLength(1);
        expect(prisms).toHaveLength(4);
        expect(scene.filter(c => c instanceof IdealLens)).toHaveLength(0);
        expect(scene.filter(c => c instanceof Card)).toHaveLength(0);
        expect(lamp?.beamRadius).toBe(3);
        expect(lamp?.sourcePointCount).toBe(3);
        expect(lamp?.emitterRadius).toBeCloseTo(0.9, 12);
        expect(prisms[1].position.y).toBeCloseTo(prisms[2].position.y, 12);
        expect(prisms[1].position.y).toBe(-72);
        expect(prisms[3].position.y).toBe(33);
        expect(closestPrismVertexDistance(prisms[1], prisms[2])).toBeLessThan(4);
        expect(prisms[2].height).toBe(prisms[0].height);
        expect(rayCount).toBe(1000);
        expect(rayConfig?.minRayOpacity).toBe(0);
        expect(rayConfig?.maxRayOpacity).toBe(0.10);
    });

    test('the center ray hits near the middle of the first prism entrance face', () => {
        const { scene } = createPrismRecombinationScene();
        const lamp = scene.find((c): c is Lamp => c instanceof Lamp);
        const firstPrism = scene.find((c): c is PrismLens => c instanceof PrismLens);
        expect(lamp).toBeDefined();
        expect(firstPrism).toBeDefined();

        const centerRay = createSourceRays([lamp!], 1, 'center')
            .find(ray => wavelengthNm(ray) === 540)
            ?? createSourceRays([lamp!], 1, 'center')[0];
        const hit = firstPrism!.chkIntersection(centerRay, Infinity);
        expect(hit).toBeDefined();
        expect(firstPrism!.classifyFace(hit!.surfaceIndex ?? 0)).toBe('Dispersing flint prism:front');
        expect(hit!.t).toBeLessThan(45);

        const entranceMidpoint: [number, number] = [
            (firstPrism!.vertices[0][0] + firstPrism!.vertices[1][0]) / 2,
            (firstPrism!.vertices[0][1] + firstPrism!.vertices[1][1]) / 2,
        ];
        const hitDistanceFromFaceCenter = Math.hypot(
            hit!.localPoint.y - entranceMidpoint[0],
            hit!.localPoint.z - entranceMidpoint[1],
        );

        expect(hitDistanceFromFaceCenter).toBeLessThan(1.2);
    });

    test('the prism train separates wavelengths, then emits an overlapped collimated white beam', () => {
        const { scene } = createPrismRecombinationScene();
        const prisms = scene.filter((c): c is PrismLens => c instanceof PrismLens);
        const traceRayCount = 96;
        const sourceRays = createSourceRays(scene, traceRayCount, 'full');
        const paths = new Solver1(scene).trace(sourceRays);

        const afterFirst = raysAfterOrderedPrisms(paths, [prisms[0].name]);
        const afterSecond = raysAfterOrderedPrisms(paths, [prisms[0].name, prisms[1].name]);
        const afterFourth = raysAfterOrderedPrisms(paths, prisms.map(prism => prism.name));
        const centerPath = paths.find(path => path[0]?.isMainRay && Math.abs(wavelengthNm(path[0]) - 538) <= 1)
            ?? paths.find(path => path[0]?.isMainRay);
        const centerRayAfterFirst = centerPath?.find(ray => ray.exitSurfaceId?.startsWith(`${prisms[0].name}:`));

        expect(afterFirst).toHaveLength(sourceRays.length);
        expect(afterSecond).toHaveLength(sourceRays.length);
        expect(afterFourth).toHaveLength(sourceRays.length);
        expect(centerRayAfterFirst?.interactionDistance).toBeGreaterThan(70);

        const firstSpectrum = wavelengthCentroidsAtVirtualPlane(afterFirst, 25);
        const parallelRainbow = wavelengthCentroidsAtVirtualPlane(afterSecond, 50);
        const recombined = wavelengthCentroidsAtVirtualPlane(afterFourth, 120);

        expect(firstSpectrum.size).toBe(7);
        expect(parallelRainbow.size).toBe(7);
        expect(recombined.size).toBe(7);
        expect(centroidRange(firstSpectrum)).toBeGreaterThan(2.0);
        expect(centroidRange(parallelRainbow)).toBeGreaterThan(10.0);
        expect(centroidRange(recombined)).toBeLessThan(0.5);
        expect(mainRayAngleRange(afterFourth)).toBeLessThan(1e-6);
    });
});
