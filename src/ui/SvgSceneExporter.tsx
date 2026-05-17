import { useEffect, useRef } from 'react';
import type React from 'react';
import { useThree } from '@react-three/fiber';
import { useAtomValue, useStore } from 'jotai';
import { Color, Material, Object3D, Scene, Vector3, type Camera } from 'three';
import { SVGRenderer } from 'three-stdlib';
import { forwardRaysAtom, rayConfigAtom, reverseRaysAtom, svgExportRequestAtom } from '../state/store';
import { Coherence, type Ray } from '../physics/types';
import { wavelengthToRGB } from '../physics/spectral';

type MaybeMaterial = Material | null | undefined;
type ObjectWithMaterial = Object3D & { material?: MaybeMaterial | MaybeMaterial[] };
type DisplayRGB = ReturnType<typeof wavelengthToRGB>;
type RayExportDirection = 'forward' | 'reverse';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_DRAW_RELATIVE_INTENSITY = 1e-3;
const OPEN_TAIL_RELATIVE_INTENSITY = 3e-2;

function timestampForFilename(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function downloadSvg(svgText: string): void {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `microscope-scene-${timestampForFilename()}.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function sanitizeSvgId(value: string): string {
    const cleaned = value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return cleaned || 'object';
}

function formatSvgNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function rgbToHex(rgb: Pick<DisplayRGB, 'r' | 'g' | 'b'>): string {
    const toHex = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0');
    return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/** Mirrors `isThermalForDisplay` in `RayVisualizer.tsx`: thermal sources get
 *  additive-blending wavelength colour even when the ray is tagged Coherent
 *  (any nonzero spectral bandwidth means it's a lamp-like source). */
function isThermalForDisplay(ray: Ray | undefined): boolean {
    if (!ray) return false;
    if (ray.coherenceMode === Coherence.Incoherent) return true;
    return (ray.bandwidth ?? 0) > 0;
}

function coherentDisplayRGB(wavelengthMeters: number): DisplayRGB {
    const nm = wavelengthMeters * 1e9;
    const rgb = wavelengthToRGB(nm);
    if (!rgb.isVisible || nm < 700 || nm > 800) return rgb;

    const edge = Math.max(0, Math.min(1, (nm - 700) / 100));
    const lift = 0.14 + 0.18 * edge;
    return {
        ...rgb,
        r: Math.min(1, rgb.r + (1 - rgb.r) * lift),
        g: Math.min(1, rgb.g + lift * 0.25),
        b: Math.min(1, rgb.b + lift * 0.12),
    };
}

function toVec3(v: { x: number; y: number; z: number }): Vector3 {
    return v instanceof Vector3 ? v : new Vector3(v.x, v.y, v.z);
}

function lastVisibleRay(path: Ray[]): Ray | undefined {
    const sourceIntensity = Math.max(path[0]?.intensity ?? 0, 1e-30);
    const extinctIdx = path.findIndex(r => r.intensity / sourceIntensity < 1e-9);
    if (extinctIdx >= 0) return path[Math.max(0, extinctIdx - 1)];
    return path[path.length - 1];
}

function relativePathIntensity(path: Ray[], ray: Ray | undefined): number {
    const sourceIntensity = Math.max(path[0]?.intensity ?? 0, 1e-12);
    return Math.max(0, Math.min(1, (ray?.intensity ?? 0) / sourceIntensity));
}

function terminalVisualizationDistance(
    ray: Pick<Ray, 'interactionDistance' | 'suppressOpenTail' | 'terminationPoint'> | undefined,
    shouldDrawOpenTail: boolean,
    allowSuppressedOpenTail = false,
): number | null {
    if (!ray || ray.terminationPoint) return null;
    if (ray.interactionDistance !== undefined) return ray.interactionDistance;
    if ((ray.suppressOpenTail && !allowSuppressedOpenTail) || !shouldDrawOpenTail) return null;
    return 1000;
}

function openTailSuppressionExpired(path: Ray[]): boolean {
    const firstSuppressedIndex = path.findIndex(ray => ray.suppressOpenTail && !ray.suppressVisualization);
    if (firstSuppressedIndex < 0) return false;

    for (let i = firstSuppressedIndex; i < path.length - 1; i++) {
        const ray = path[i];
        const nextRay = path[i + 1];
        if (ray.suppressVisualization) break;
        if (ray.interactionDistance === undefined || !ray.interactionComponentId) continue;

        const currentDir = toVec3(ray.direction).clone().normalize();
        const nextDir = toVec3(nextRay.direction).clone().normalize();
        if (currentDir.dot(nextDir) < 0.999999) return true;
    }

    return false;
}

function rayVisualPoints(path: Ray[]): Vector3[] {
    const points: Vector3[] = [];
    let truncatedForVisualization = false;

    for (const ray of path) {
        if (relativePathIntensity(path, ray) < 1e-9) break;
        if (ray.entryPoint) points.push(toVec3(ray.entryPoint));
        if (ray.internalPath) {
            for (const point of ray.internalPath) points.push(toVec3(point));
        }
        points.push(toVec3(ray.origin));
        if (ray.suppressVisualization) {
            truncatedForVisualization = true;
            break;
        }
    }

    if (points.length > 0 && path.length > 0) {
        const isMain = path[0].isMainRay === true;
        const lastRay = lastVisibleRay(path);
        const terminalRelativeIntensity = relativePathIntensity(path, lastRay);
        const shouldDrawOpenTail = isMain
            || isThermalForDisplay(path[0])
            || terminalRelativeIntensity >= OPEN_TAIL_RELATIVE_INTENSITY;
        const dist = terminalVisualizationDistance(
            lastRay,
            shouldDrawOpenTail,
            openTailSuppressionExpired(path),
        );
        if (!truncatedForVisualization && lastRay && lastRay.intensity >= 1e-6 && dist !== null) {
            const origin = toVec3(lastRay.origin);
            const direction = toVec3(lastRay.direction);
            points.push(origin.clone().add(direction.clone().multiplyScalar(dist)));
        }
    }

    return points;
}

function quantizeCoherentLineWidth(lineWidth: number): number {
    if (lineWidth < 1.25) return 1;
    if (lineWidth < 1.75) return 1.25;
    return 1.5;
}

function raySvgStyle(path: Ray[], direction: RayExportDirection, minOpacity: number, maxOpacity: number): { color: string; opacity: number; lineWidth: number; dashed: boolean } | null {
    if (path.length === 0) return null;

    const firstRay = path[0];
    const wavelength = firstRay.wavelength;
    const wavelengthNm = wavelength * 1e9;
    const isMain = firstRay.isMainRay === true;
    const reverseScale = direction === 'reverse' ? 0.72 : 1;

    if (isThermalForDisplay(firstRay)) {
        const rgb = wavelengthToRGB(wavelengthNm);
        const rawOpacity = Math.min(1, firstRay.intensity);
        return {
            color: rgb.isVisible ? rgbToHex(rgb) : '#888888',
            opacity: (minOpacity + rawOpacity * (maxOpacity - minOpacity)) * reverseScale,
            lineWidth: isMain ? 4 : 2,
            dashed: !rgb.isVisible,
        };
    }

    const rgb = coherentDisplayRGB(wavelength);
    if (isMain) {
        const rawOpacity = Math.min(1, firstRay.intensity);
        return {
            color: rgb.isVisible ? rgbToHex(rgb) : '#ffffff',
            opacity: (minOpacity + rawOpacity * (maxOpacity - minOpacity)) * reverseScale,
            lineWidth: 4,
            dashed: !rgb.isVisible,
        };
    }

    const terminalRelativeIntensity = relativePathIntensity(path, lastVisibleRay(path));
    if (terminalRelativeIntensity < MIN_DRAW_RELATIVE_INTENSITY) return null;

    const visibility = Math.pow(Math.max(0, Math.min(1, terminalRelativeIntensity)), 0.25);
    return {
        color: rgb.isVisible ? rgbToHex(rgb) : '#888888',
        opacity: Math.max(minOpacity * terminalRelativeIntensity, Math.min(maxOpacity, visibility * maxOpacity)) * reverseScale,
        lineWidth: quantizeCoherentLineWidth(1.0 + 1.5 * visibility),
        dashed: !rgb.isVisible,
    };
}

function projectPointToSvg(point: Vector3, camera: Camera, width: number, height: number): { x: number; y: number } | null {
    const projected = point.clone().project(camera);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z)) return null;
    return {
        x: projected.x * width / 2,
        y: -projected.y * height / 2,
    };
}

function rayPathData(points: Vector3[], camera: Camera, width: number, height: number): string | null {
    const projectedPoints = points
        .map(point => projectPointToSvg(point, camera, width, height))
        .filter(point => point !== null);
    if (projectedPoints.length < 2) return null;

    return projectedPoints
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${formatSvgNumber(point.x)} ${formatSvgNumber(point.y)}`)
        .join(' ');
}

function renderRayChildren(
    paths: Ray[][],
    direction: RayExportDirection,
    camera: Camera,
    width: number,
    height: number,
    minOpacity: number,
    maxOpacity: number,
): Node[] {
    const children: Node[] = [];
    for (let index = 0; index < paths.length; index++) {
        const path = paths[index];
        const points = rayVisualPoints(path);
        if (points.length < 2) continue;

        const style = raySvgStyle(path, direction, minOpacity, maxOpacity);
        if (!style || style.opacity <= 0.001) continue;

        const d = rayPathData(points, camera, width, height);
        if (!d) continue;

        const element = document.createElementNS(SVG_NS, 'path');
        element.setAttribute('d', d);
        element.setAttribute('fill', 'none');
        element.setAttribute('stroke', style.color);
        element.setAttribute('stroke-width', formatSvgNumber(style.lineWidth));
        element.setAttribute('stroke-opacity', formatSvgNumber(Math.max(0, Math.min(1, style.opacity))));
        element.setAttribute('stroke-linecap', 'round');
        element.setAttribute('stroke-linejoin', 'round');
        element.setAttribute('data-ray-index', String(index));
        element.setAttribute('data-direction', direction);
        element.setAttribute('data-wavelength-nm', formatSvgNumber((path[0]?.wavelength ?? 0) * 1e9));
        if (style.dashed) element.setAttribute('stroke-dasharray', '6 4');
        children.push(element);
    }
    return children;
}

function rawMaterialsFor(object: Object3D): MaybeMaterial[] {
    const material = (object as ObjectWithMaterial).material;
    if (!material) return [];
    return Array.isArray(material) ? material : [material];
}

function isSvgRenderableMaterial(material: MaybeMaterial): boolean {
    if (!material) return false;
    const m = material as Material & Record<string, unknown>;
    if (material.visible === false || material.opacity <= 0.001) return false;
    if (m.colorWrite === false) return false;

    return Boolean(
        m.isMeshBasicMaterial ||
        m.isMeshLambertMaterial ||
        m.isMeshPhongMaterial ||
        m.isMeshStandardMaterial ||
        m.isMeshNormalMaterial ||
        m.isLineBasicMaterial ||
        m.isLineDashedMaterial ||
        m.isSpriteMaterial ||
        m.isPointsMaterial,
    );
}

function shouldHideForSvgExport(object: Object3D): boolean {
    if (object.userData?.svgExport === 'skip') return true;

    const maybeText = object as Object3D & { isText?: boolean; text?: unknown; sync?: unknown };
    if (maybeText.isText || (typeof maybeText.text === 'string' && typeof maybeText.sync === 'function')) return true;

    const renderable = object as Object3D & {
        isMesh?: boolean;
        isLine?: boolean;
        isPoints?: boolean;
        isSprite?: boolean;
    };

    if (!renderable.isMesh && !renderable.isLine && !renderable.isPoints && !renderable.isSprite) return false;

    const materials = rawMaterialsFor(object);
    if (materials.length === 0) return true;
    return materials.some(material => !isSvgRenderableMaterial(material));
}

function isRenderableObject(object: Object3D): boolean {
    const renderable = object as Object3D & {
        isMesh?: boolean;
        isLine?: boolean;
        isPoints?: boolean;
        isSprite?: boolean;
    };
    return Boolean(renderable.isMesh || renderable.isLine || renderable.isPoints || renderable.isSprite);
}

function isDescendantOf(object: Object3D, ancestor: Object3D): boolean {
    let current: Object3D | null = object;
    while (current) {
        if (current === ancestor) return true;
        current = current.parent;
    }
    return false;
}

function collectExportGroups(scene: Scene): Object3D[] {
    const groups: Object3D[] = [];
    scene.traverse(object => {
        if (object.userData?.svgExportGroup) groups.push(object);
    });
    return groups;
}

function setTemporaryVisibility(hidden: { object: Object3D; visible: boolean }[], object: Object3D, visible: boolean): void {
    if (object.visible === visible) return;
    if (!hidden.some(item => item.object === object)) hidden.push({ object, visible: object.visible });
    object.visible = visible;
}

function withSvgCompatibleScene(scene: Scene, render: () => void, options: { root?: Object3D; hideExportGroups?: boolean } = {}): void {
    const hidden: { object: Object3D; visible: boolean }[] = [];
    const originalBackground = scene.background;
    const root = options.root;

    scene.background = null;
    scene.traverse(object => {
        if (!object.visible) return;
        if (shouldHideForSvgExport(object)) {
            setTemporaryVisibility(hidden, object, false);
            return;
        }

        if (root) {
            if (object.userData?.svgExportGroup && object !== root) {
                setTemporaryVisibility(hidden, object, false);
                return;
            }
            if (isRenderableObject(object) && !isDescendantOf(object, root)) {
                setTemporaryVisibility(hidden, object, false);
            }
            return;
        }

        if (options.hideExportGroups && object.userData?.svgExportGroup) {
            setTemporaryVisibility(hidden, object, false);
        }
    });

    try {
        render();
    } finally {
        scene.background = originalBackground;
        for (const item of hidden) item.object.visible = item.visible;
    }
}

function makeRenderer(width: number, height: number): SVGRenderer {
    const renderer = new SVGRenderer();
    renderer.setSize(width, height);
    renderer.setPrecision(3);
    renderer.setClearColor(new Color('#000000'), 0);
    return renderer;
}

function renderChildren(scene: Scene, camera: Camera, width: number, height: number, options: { root?: Object3D; hideExportGroups?: boolean }): Node[] {
    const renderer = makeRenderer(width, height);
    withSvgCompatibleScene(scene, () => {
        renderer.render(scene, camera);
    }, options);
    return Array.from(renderer.domElement.childNodes).map(node => node.cloneNode(true));
}

function appendGroup(svg: SVGElement, id: string, label: string, children: Node[]): void {
    if (children.length === 0) return;
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('id', id);
    group.setAttribute('data-name', label);
    for (const child of children) group.appendChild(child);
    svg.appendChild(group);
}

function exportGroupedSvg(
    scene: Scene,
    camera: Camera,
    width: number,
    height: number,
    rays: { forward: Ray[][]; reverse: Ray[][]; minOpacity: number; maxOpacity: number },
): SVGElement {
    const roundedWidth = Math.round(width);
    const roundedHeight = Math.round(height);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('version', '1.1');
    svg.setAttribute('width', String(roundedWidth));
    svg.setAttribute('height', String(roundedHeight));
    svg.setAttribute('viewBox', `${-roundedWidth / 2} ${-roundedHeight / 2} ${roundedWidth} ${roundedHeight}`);

    const exportGroups = collectExportGroups(scene).filter(group => group.visible);
    const overlayChildren = renderChildren(scene, camera, width, height, { hideExportGroups: true });
    appendGroup(svg, 'scene-overlays', 'Scene Overlays', overlayChildren);
    appendGroup(svg, 'forward-rays', 'Forward Rays', renderRayChildren(rays.forward, 'forward', camera, width, height, rays.minOpacity, rays.maxOpacity));
    appendGroup(svg, 'reverse-rays', 'Reverse Rays', renderRayChildren(rays.reverse, 'reverse', camera, width, height, rays.minOpacity, rays.maxOpacity));

    for (const groupRoot of exportGroups) {
        const id = String(groupRoot.userData.svgExportGroup ?? groupRoot.id);
        const label = String(groupRoot.userData.svgExportName ?? groupRoot.name ?? id);
        const children = renderChildren(scene, camera, width, height, { root: groupRoot });
        appendGroup(svg, `component-${sanitizeSvgId(id)}`, label, children);
    }

    return svg;
}

export const SvgSceneExporter: React.FC = () => {
    const request = useAtomValue(svgExportRequestAtom);
    // This component lives INSIDE the R3F <Canvas> (it needs useThree for the
    // scene/camera). R3F runs its own reconciler on a frame-driven schedule,
    // so a component in here is not guaranteed a React render on every atom
    // change. forwardRaysAtom / reverseRaysAtom are reassigned on every
    // animation frame — subscribing to them with useAtomValue would queue one
    // update (each retaining a full Ray[][]) per frame in this fiber's hook
    // queue, and that queue never drains here → unbounded memory growth.
    // We only need those ray snapshots at the instant of an export, so read
    // them imperatively from the store (no subscription) inside the effect.
    const store = useStore();
    const { camera, scene, size } = useThree();
    const lastRequestRef = useRef(request);

    useEffect(() => {
        if (request === 0) return;
        if (request === lastRequestRef.current) return;
        if (size.width <= 0 || size.height <= 0) return;
        lastRequestRef.current = request;

        try {
            const rayConfig = store.get(rayConfigAtom);
            const svg = exportGroupedSvg(scene, camera, size.width, size.height, {
                forward: store.get(forwardRaysAtom),
                reverse: store.get(reverseRaysAtom),
                minOpacity: rayConfig.minRayOpacity,
                maxOpacity: rayConfig.maxRayOpacity,
            });
            const svgText = `<?xml version="1.0" encoding="UTF-8"?>\n${svg.outerHTML}\n`;
            downloadSvg(svgText);
        } catch (error) {
            console.warn('SVG export failed:', error);
            const message = error instanceof Error ? error.message : 'Unknown SVG renderer error';
            window.alert(`SVG export failed: ${message}`);
        }
    }, [camera, request, scene, size.height, size.width, store]);

    return null;
};
