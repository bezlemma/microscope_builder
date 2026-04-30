import { useEffect, useRef } from 'react';
import type React from 'react';
import { useThree } from '@react-three/fiber';
import { useAtomValue } from 'jotai';
import { Color, Material, Object3D, Scene } from 'three';
import { SVGRenderer } from 'three-stdlib';
import { svgExportRequestAtom } from '../state/store';

type MaybeMaterial = Material | null | undefined;
type ObjectWithMaterial = Object3D & { material?: MaybeMaterial | MaybeMaterial[] };

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

function renderChildren(scene: Scene, camera: import('three').Camera, width: number, height: number, options: { root?: Object3D; hideExportGroups?: boolean }): Node[] {
    const renderer = makeRenderer(width, height);
    withSvgCompatibleScene(scene, () => {
        renderer.render(scene, camera);
    }, options);
    return Array.from(renderer.domElement.childNodes).map(node => node.cloneNode(true));
}

function appendGroup(svg: SVGElement, id: string, label: string, children: Node[]): void {
    if (children.length === 0) return;
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('id', id);
    group.setAttribute('data-name', label);
    for (const child of children) group.appendChild(child);
    svg.appendChild(group);
}

function exportGroupedSvg(scene: Scene, camera: import('three').Camera, width: number, height: number): SVGElement {
    const roundedWidth = Math.round(width);
    const roundedHeight = Math.round(height);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('version', '1.1');
    svg.setAttribute('width', String(roundedWidth));
    svg.setAttribute('height', String(roundedHeight));
    svg.setAttribute('viewBox', `${-roundedWidth / 2} ${-roundedHeight / 2} ${roundedWidth} ${roundedHeight}`);

    const exportGroups = collectExportGroups(scene).filter(group => group.visible);
    const overlayChildren = renderChildren(scene, camera, width, height, { hideExportGroups: true });
    appendGroup(svg, 'scene-overlays', 'Scene Overlays', overlayChildren);

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
    const { camera, scene, size } = useThree();
    const lastRequestRef = useRef(request);

    useEffect(() => {
        if (request === 0) return;
        if (request === lastRequestRef.current) return;
        if (size.width <= 0 || size.height <= 0) return;
        lastRequestRef.current = request;

        try {
            const svg = exportGroupedSvg(scene, camera, size.width, size.height);
            const svgText = `<?xml version="1.0" encoding="UTF-8"?>\n${svg.outerHTML}\n`;
            downloadSvg(svgText);
        } catch (error) {
            console.warn('SVG export failed:', error);
            const message = error instanceof Error ? error.message : 'Unknown SVG renderer error';
            window.alert(`SVG export failed: ${message}`);
        }
    }, [camera, request, scene, size.height, size.width]);

    return null;
};
