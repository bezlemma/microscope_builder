import React from 'react';
import { useFrame } from '@react-three/fiber';
import {
    DoubleSide,
    Material,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    type BufferGeometry,
} from 'three';
import { RAY_OCCLUSION_RENDER_ORDER } from './renderOrder';

type RenderMaterial = Material & {
    colorWrite?: boolean;
    opacity?: number;
    transparent?: boolean;
    transmission?: number;
    wireframe?: boolean;
};

interface OverlayEntry {
    source: Mesh;
    overlay: Mesh;
}

const MIN_DECORATIVE_OPACITY = 0.2;
const MIN_TRANSMISSION = 0.01;

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function materialsFor(material: Material | Material[]): Material[] {
    return Array.isArray(material) ? material : [material];
}

export function rayOcclusionOpacityForMaterial(material: Material): number | null {
    const mat = material as RenderMaterial;
    if (!mat.visible || mat.colorWrite === false || mat.wireframe) return null;

    const opacity = clamp01(mat.opacity ?? 1);
    const transmission = clamp01(mat.transmission ?? 0);
    const isTranslucent = mat.transparent === true || transmission > 0 || opacity < 0.999;
    if (!isTranslucent || opacity <= 0.01) return null;

    if (opacity < MIN_DECORATIVE_OPACITY && transmission <= MIN_TRANSMISSION) return null;

    const transmissionLift = transmission > MIN_TRANSMISSION ? 0.015 : 0;
    return Math.max(0.045, Math.min(0.15, 0.045 + opacity * 0.08 + transmissionLift));
}

function rayOcclusionOpacityForObjectMaterial(material: Material | Material[]): number | null {
    let opacity: number | null = null;
    for (const item of materialsFor(material)) {
        const itemOpacity = rayOcclusionOpacityForMaterial(item);
        if (itemOpacity === null) continue;
        opacity = opacity === null ? itemOpacity : Math.max(opacity, itemOpacity);
    }
    return opacity;
}

function materialSignature(material: Material | Material[]): string {
    return materialsFor(material).map((item) => {
        const mat = item as RenderMaterial;
        return [
            item.uuid,
            mat.visible ? 1 : 0,
            mat.colorWrite === false ? 0 : 1,
            mat.wireframe ? 1 : 0,
            Math.round((mat.opacity ?? 1) * 1000),
            Math.round((mat.transmission ?? 0) * 1000),
            mat.transparent ? 1 : 0,
        ].join(':');
    }).join('|');
}

function shouldSkipObject(object: Object3D, root: Object3D): boolean {
    let current: Object3D | null = object;
    while (current && current !== root.parent) {
        if (current.userData?.rayOcclusion === 'skip') return true;
        if (current === root) break;
        current = current.parent;
    }
    return false;
}

function collectEligibleMeshes(root: Object3D): Mesh[] {
    const meshes: Mesh[] = [];
    root.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh || !mesh.geometry || !mesh.material) return;
        if (shouldSkipObject(mesh, root)) return;
        if (rayOcclusionOpacityForObjectMaterial(mesh.material) === null) return;
        meshes.push(mesh);
    });
    return meshes;
}

function overlaySignature(meshes: Mesh[]): string {
    return meshes.map(mesh => [
        mesh.uuid,
        (mesh.geometry as BufferGeometry).uuid,
        materialSignature(mesh.material),
    ].join('/')).join(';');
}

function makeOverlayMaterial(opacity: number): MeshBasicMaterial {
    const material = new MeshBasicMaterial({
        color: 0x020304,
        transparent: true,
        opacity,
        depthTest: true,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
    });
    material.name = 'ray-occlusion-overlay';
    return material;
}

function disposeOverlayEntries(entries: OverlayEntry[]): void {
    for (const { overlay } of entries) {
        const materials = materialsFor(overlay.material as Material | Material[]);
        for (const material of materials) material.dispose();
    }
}

export const RayOcclusionLayer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const sourceRef = React.useRef<Object3D>(null);
    const overlayRef = React.useRef<Object3D>(null);
    const entriesRef = React.useRef<OverlayEntry[]>([]);
    const signatureRef = React.useRef('');
    const overlayWorldInverseRef = React.useRef(new Matrix4());

    const rebuildIfNeeded = React.useCallback(() => {
        const source = sourceRef.current;
        const overlay = overlayRef.current;
        if (!source || !overlay) return;

        const meshes = collectEligibleMeshes(source);
        const signature = overlaySignature(meshes);
        if (signature === signatureRef.current) return;

        disposeOverlayEntries(entriesRef.current);
        overlay.clear();

        const entries: OverlayEntry[] = [];
        for (const sourceMesh of meshes) {
            const opacity = rayOcclusionOpacityForObjectMaterial(sourceMesh.material);
            if (opacity === null) continue;

            const overlayMesh = new Mesh(sourceMesh.geometry, makeOverlayMaterial(opacity));
            overlayMesh.name = `${sourceMesh.name || 'mesh'}-ray-occlusion`;
            overlayMesh.matrixAutoUpdate = false;
            overlayMesh.frustumCulled = sourceMesh.frustumCulled;
            overlayMesh.renderOrder = RAY_OCCLUSION_RENDER_ORDER;
            overlayMesh.raycast = () => null;
            overlay.add(overlayMesh);
            entries.push({ source: sourceMesh, overlay: overlayMesh });
        }

        entriesRef.current = entries;
        signatureRef.current = signature;
    }, []);

    const syncOverlayTransforms = React.useCallback(() => {
        const source = sourceRef.current;
        const overlay = overlayRef.current;
        if (!source || !overlay) return;

        source.updateWorldMatrix(true, true);
        overlay.updateWorldMatrix(true, false);
        const overlayWorldInverse = overlayWorldInverseRef.current.copy(overlay.matrixWorld).invert();

        for (const entry of entriesRef.current) {
            entry.overlay.matrix.copy(overlayWorldInverse).multiply(entry.source.matrixWorld);
            entry.overlay.matrixWorldNeedsUpdate = true;
        }
    }, []);

    React.useLayoutEffect(() => {
        rebuildIfNeeded();
        syncOverlayTransforms();

        return () => {
            disposeOverlayEntries(entriesRef.current);
            entriesRef.current = [];
            signatureRef.current = '';
        };
    }, [rebuildIfNeeded, syncOverlayTransforms]);

    useFrame(() => {
        rebuildIfNeeded();
        syncOverlayTransforms();
    });

    return (
        <group>
            <group ref={sourceRef}>{children}</group>
            <group ref={overlayRef} userData={{ svgExport: 'skip', rayOcclusion: 'skip' }} />
        </group>
    );
};
