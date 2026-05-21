import React, { useEffect, useMemo, useState } from 'react';
import { Camera as ThreeCamera, DoubleSide, Object3D, Vector3 } from 'three';
import { useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Html, Text } from '@react-three/drei';
import { useAtomValue } from 'jotai';
import { selectionAtom } from '../state/store';
import { OpticalComponent } from '../physics/Component';
import { Ray } from '../physics/types';
import { Camera } from '../physics/components/Camera';
import { PMT } from '../physics/components/PMT';
import { QPD } from '../physics/components/QPD';
import { Card } from '../physics/components/Card';
import { Objective } from '../physics/components/Objective';
import { IdealLens } from '../physics/components/IdealLens';
import { SphericalLens } from '../physics/components/SphericalLens';
import { AsphericLens } from '../physics/components/AsphericLens';
import { Aperture } from '../physics/components/Aperture';
import { SlitAperture } from '../physics/components/SlitAperture';
import {
    adaptiveTerminalFieldWindow,
    analyzeTerminalField,
    collectTerminalPacketHitsFromRayPaths,
    fitZernikePupilFromHits,
    summarizePacketHitValidity,
    synthesizeTerminalAxialSectionsFromRayPaths,
    synthesizeTerminalFieldFromHits,
    type PacketHitValidity,
    type RadialMtfSample,
    type EncircledEnergySample,
    type TerminalFieldMetrics,
    type ZernikePupilFit,
} from '../physics/cardFieldSynthesis';

type LandmarkPointerEvent = ThreeEvent<PointerEvent>;
type LandmarkClickEvent = ThreeEvent<MouseEvent>;

type LandmarkConfidence = 'defined' | 'candidate' | 'ambiguous';
type OpticalPlaneKind = 'image' | 'pupil' | 'focal' | 'stop';

interface LocalOpticalLandmark {
    id: string;
    label: string;
    kind: OpticalPlaneKind;
    confidence: LandmarkConfidence;
    shape: 'circle' | 'rect';
    color: string;
    localZ: number;
    radius?: number;
    width?: number;
    height?: number;
    note?: string;
}

interface ComponentLandmarks {
    component: OpticalComponent;
    landmarks: LocalOpticalLandmark[];
}

interface OpticalLandmarkLabel {
    id: string;
    label: string;
    color: string;
    confidence: LandmarkConfidence;
    center: Vector3;
    position: Vector3;
    fontSize: number;
}

interface OpticalPlaneModel {
    entries: ComponentLandmarks[];
    labels: OpticalLandmarkLabel[];
}

interface PlaneRayStats {
    planeCrossings: number;
    hits: number;
    nearMisses: number;
    centroidX: number;
    centroidY: number;
    rmsRadius: number;
    rmsX: number;
    rmsY: number;
    chiefAngleDeg: number | null;
    coneNA: number | null;
}

interface PacketPlaneAnalysis {
    hitCount: number;
    effectiveHitCount: number;
    estimatedRelativeSamplingNoise: number | null;
    suggestedHitCount: number;
    validity: PacketHitValidity;
    metrics: TerminalFieldMetrics | null;
    previewUrl: string | null;
    axialXZUrl: string | null;
    axialYZUrl: string | null;
    zernikeFit: ZernikePupilFit | null;
    fieldViewWidth: number;
    fieldViewHeight: number;
    fieldCenterX: number;
    fieldCenterY: number;
    pixelPitchX: number;
    pixelPitchY: number;
    axialDepth: number | null;
}

interface SelectedOpticalPlane {
    id: string;
    component: OpticalComponent;
    landmark: LocalOpticalLandmark;
    label: OpticalLandmarkLabel | undefined;
}

const MAX_FOCAL_PLANE_DISTANCE_MM = 500;

const COLORS = {
    image: '#56f0d2',
    focal: '#58b7ff',
    pupil: '#b78cff',
    stop: '#ffbd66',
    ambiguous: '#a5adba',
};

const POPOVER_MARGIN_PX = 0;
const POPOVER_MAX_WIDTH_PX = 300;
const POPOVER_MAX_HEIGHT_PX = 720;
const POPOVER_COLLISION_GAP_PX = 1;
const PLANE_VISUAL_THICKNESS_MM = 2;

interface PopoverScreenLayout {
    width: number;
    maxHeight: number;
    margin: number;
}

interface PopoverScreenRect extends PopoverScreenLayout {
    x: number;
    y: number;
}

function clampScreenValue(value: number, min: number, max: number): number {
    if (max < min) return min;
    return Math.min(max, Math.max(min, value));
}

function calculateOpticalPlanePopoverLayout(
    size: { width: number; height: number },
    cardCount = 1,
): PopoverScreenLayout {
    const margin = Math.max(0, Math.min(POPOVER_MARGIN_PX, size.width / 2, size.height / 2));
    const usableWidth = Math.max(0, size.width - margin * 2);
    const usableHeight = Math.max(0, size.height - margin * 2);
    const visibleCardCount = Math.max(1, cardCount);
    const maxWidthForCount = (usableWidth - POPOVER_COLLISION_GAP_PX * (visibleCardCount - 1)) / visibleCardCount;
    const popoverWidth = Math.min(POPOVER_MAX_WIDTH_PX, Math.max(1, maxWidthForCount));
    const popoverHeight = Math.min(POPOVER_MAX_HEIGHT_PX, Math.max(24, usableHeight));

    return {
        width: popoverWidth,
        maxHeight: popoverHeight,
        margin,
    };
}

function projectedScreenPoint(
    world: Vector3,
    camera: ThreeCamera,
    size: { width: number; height: number },
): { x: number; y: number } | null {
    const projected = world.clone().project(camera);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) return null;
    return {
        x: (projected.x * size.width) / 2 + size.width / 2,
        y: -(projected.y * size.height) / 2 + size.height / 2,
    };
}

function preferredPopoverRect(
    anchorWorld: Vector3 | undefined,
    camera: ThreeCamera,
    size: { width: number; height: number },
    layout: PopoverScreenLayout,
): PopoverScreenRect {
    const anchor = anchorWorld ? projectedScreenPoint(anchorWorld, camera, size) : null;
    if (!anchor) {
        return {
            ...layout,
            x: size.width - layout.width - layout.margin,
            y: size.height - layout.maxHeight - layout.margin,
        };
    }

    let x = anchor.x + layout.margin;
    if (x + layout.width + layout.margin > size.width) {
        x = anchor.x - layout.width - layout.margin;
    }

    let y = anchor.y + layout.margin;
    if (y + layout.maxHeight + layout.margin > size.height) {
        y = anchor.y - layout.maxHeight - layout.margin;
    }

    return {
        ...layout,
        x: clampScreenValue(x, layout.margin, size.width - layout.width - layout.margin),
        y: clampScreenValue(y, layout.margin, size.height - layout.maxHeight - layout.margin),
    };
}

function resolveOpticalPlanePopoverRects(
    anchorWorlds: Vector3[],
    camera: ThreeCamera,
    size: { width: number; height: number },
): PopoverScreenRect[] {
    const layout = calculateOpticalPlanePopoverLayout(size, anchorWorlds.length);
    const desiredEntries = anchorWorlds
        .map((anchorWorld, index) => ({
            index,
            rect: preferredPopoverRect(anchorWorld, camera, size, layout),
        }))
        .sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y || a.index - b.index);
    const placed = new Array<PopoverScreenRect>(anchorWorlds.length);
    const xMin = layout.margin;
    const xStep = layout.width + POPOVER_COLLISION_GAP_PX;

    let i = 0;
    while (i < desiredEntries.length) {
        const group = [desiredEntries[i]];
        let groupRight = desiredEntries[i].rect.x + layout.width;
        let groupTop = desiredEntries[i].rect.y;
        let groupBottom = desiredEntries[i].rect.y + layout.maxHeight;
        i++;

        while (i < desiredEntries.length) {
            const next = desiredEntries[i];
            const verticallyRelated = next.rect.y < groupBottom && next.rect.y + layout.maxHeight > groupTop;
            const horizontallyRelated = next.rect.x < groupRight + POPOVER_COLLISION_GAP_PX;
            if (!verticallyRelated || !horizontallyRelated) break;

            group.push(next);
            groupRight = Math.max(groupRight, next.rect.x + layout.width);
            groupTop = Math.min(groupTop, next.rect.y);
            groupBottom = Math.max(groupBottom, next.rect.y + layout.maxHeight);
            i++;
        }

        if (group.length === 1) {
            const entry = group[0];
            placed[entry.index] = {
                ...layout,
                x: Math.round(entry.rect.x),
                y: Math.round(entry.rect.y),
            };
            continue;
        }

        const groupWidth = group.length * layout.width + (group.length - 1) * POPOVER_COLLISION_GAP_PX;
        const desiredStartX = Math.min(...group.map(entry => entry.rect.x));
        const startX = Math.round(clampScreenValue(desiredStartX, xMin, size.width - groupWidth - layout.margin));
        group.forEach((entry, index) => {
            placed[entry.index] = {
                ...layout,
                x: startX + index * xStep,
                y: Math.round(entry.rect.y),
            };
        });
    }

    return placed;
}

function calculateOpticalPlanePopoverPosition(
    _el: Object3D,
    camera: ThreeCamera,
    size: { width: number; height: number },
    anchorWorlds: Vector3[],
    popoverIndex: number,
): number[] {
    const rects = resolveOpticalPlanePopoverRects(anchorWorlds, camera, size);
    const layout = calculateOpticalPlanePopoverLayout(size, anchorWorlds.length);
    const rect = rects[popoverIndex] ?? {
        ...layout,
        x: size.width - layout.width - layout.margin,
        y: size.height - layout.maxHeight - layout.margin,
    };

    return [
        rect.x,
        rect.y,
    ];
}

function finiteFocalLength(focalLength: number): boolean {
    return Number.isFinite(focalLength)
        && Math.abs(focalLength) >= 1
        && Math.abs(focalLength) <= MAX_FOCAL_PLANE_DISTANCE_MM;
}

function focalLabel(base: string, focalLength: number): string {
    const suffix = focalLength < 0 ? ' virtual' : '';
    return `${base}${suffix}`;
}

function addLensFocalLandmarks(
    landmarks: LocalOpticalLandmark[],
    focalLength: number,
    radius: number,
    confidence: LandmarkConfidence,
): void {
    if (!finiteFocalLength(focalLength)) return;
    const displayRadius = Math.max(1, Math.min(radius, 40));
    landmarks.push({
        id: 'front-focal',
        label: focalLabel('Front focal plane', focalLength),
        kind: 'focal',
        confidence,
        shape: 'circle',
        color: confidence === 'defined' ? COLORS.focal : COLORS.ambiguous,
        localZ: -focalLength,
        radius: displayRadius,
    });
    landmarks.push({
        id: 'back-focal',
        label: focalLabel('Back focal plane', focalLength),
        kind: 'focal',
        confidence,
        shape: 'circle',
        color: confidence === 'defined' ? COLORS.focal : COLORS.ambiguous,
        localZ: focalLength,
        radius: displayRadius,
    });
}

function landmarksForComponent(component: OpticalComponent): LocalOpticalLandmark[] {
    const landmarks: LocalOpticalLandmark[] = [];

    if (component instanceof Camera) {
        landmarks.push({
            id: 'sensor',
            label: 'Image plane',
            kind: 'image',
            confidence: 'defined',
            shape: 'rect',
            color: COLORS.image,
            localZ: 0.12,
            width: component.width,
            height: component.height,
            note: 'Camera sensor plane',
        });
        return landmarks;
    }

    if (component instanceof PMT) {
        landmarks.push({
            id: 'detector',
            label: 'Image plane',
            kind: 'image',
            confidence: 'defined',
            shape: 'rect',
            color: COLORS.image,
            localZ: 0.12,
            width: component.width,
            height: component.height,
            note: 'PMT raster detector plane',
        });
        return landmarks;
    }

    if (component instanceof QPD) {
        landmarks.push({
            id: 'detector',
            label: 'Image plane',
            kind: 'image',
            confidence: 'defined',
            shape: 'circle',
            color: COLORS.image,
            localZ: 0.12,
            radius: component.activeDiameter / 2,
            note: 'QPD active detector plane',
        });
        return landmarks;
    }

    if (component instanceof Card) {
        landmarks.push({
            id: 'card-plane',
            label: 'Image plane',
            kind: 'image',
            confidence: 'defined',
            shape: 'rect',
            color: COLORS.image,
            localZ: 0.08,
            width: component.width,
            height: component.height,
            note: 'Viewing card plane',
        });
        return landmarks;
    }

    if (component instanceof Objective) {
        const frontRadius = Math.max(1, component.getFrontRadius());
        landmarks.push({
            id: 'objective-pupil',
            label: 'Pupil plane',
            kind: 'pupil',
            confidence: 'defined',
            shape: 'circle',
            color: COLORS.pupil,
            localZ: 0.08,
            radius: Math.max(1, component.pupilRadius || component.apertureRadius),
            note: 'Objective back focal plane / pupil',
        });
        landmarks.push({
            id: 'objective-front-focal',
            label: 'Front focal plane',
            kind: 'focal',
            confidence: 'defined',
            shape: 'circle',
            color: COLORS.focal,
            localZ: -component.focalLength,
            radius: frontRadius,
        });
        return landmarks;
    }

    if (component instanceof IdealLens) {
        landmarks.push({
            id: 'lens-stop',
            label: 'Stop plane',
            kind: 'stop',
            confidence: 'defined',
            shape: 'circle',
            color: COLORS.stop,
            localZ: 0,
            radius: component.apertureRadius,
        });
        addLensFocalLandmarks(landmarks, component.focalLength, component.apertureRadius, 'defined');
        return landmarks;
    }

    if (component instanceof SphericalLens || component instanceof AsphericLens) {
        const apertureRadius = Math.max(1, component.apertureRadius);
        addLensFocalLandmarks(landmarks, component.focalLength, apertureRadius, 'candidate');
        return landmarks;
    }

    if (component instanceof Aperture) {
        const innerRadius = Math.max(0.2, component.openingDiameter / 2);
        const halfT = Math.max(0, component.thickness / 2);
        if (component.thickness > 3) {
            landmarks.push({
                id: 'entrance-stop',
                label: 'Entrance stop plane',
                kind: 'stop',
                confidence: 'candidate',
                shape: 'circle',
                color: COLORS.stop,
                localZ: -halfT,
                radius: innerRadius,
            });
            landmarks.push({
                id: 'exit-stop',
                label: 'Exit stop plane',
                kind: 'stop',
                confidence: 'candidate',
                shape: 'circle',
                color: COLORS.stop,
                localZ: halfT,
                radius: innerRadius,
            });
        } else {
            landmarks.push({
                id: 'aperture-stop',
                label: 'Stop plane',
                kind: 'stop',
                confidence: 'defined',
                shape: 'circle',
                color: COLORS.stop,
                localZ: 0,
                radius: innerRadius,
            });
        }
        return landmarks;
    }

    if (component instanceof SlitAperture) {
        landmarks.push({
            id: 'slit-stop',
            label: 'Stop plane',
            kind: 'stop',
            confidence: 'defined',
            shape: 'rect',
            color: COLORS.stop,
            localZ: 0,
            width: component.slitWidth,
            height: component.slitHeight,
        });
        return landmarks;
    }

    return landmarks;
}

function confidenceOpacity(confidence: LandmarkConfidence): number {
    if (confidence === 'defined') return 0.18;
    if (confidence === 'candidate') return 0.12;
    return 0.08;
}

function confidenceLineOpacity(confidence: LandmarkConfidence): number {
    if (confidence === 'defined') return 0.78;
    if (confidence === 'candidate') return 0.52;
    return 0.35;
}

function landmarkSize(landmark: LocalOpticalLandmark): number {
    if (landmark.shape === 'circle') return Math.max(landmark.radius ?? 1, 1) * 2;
    return Math.max(landmark.width ?? 1, landmark.height ?? 1, 1);
}

function landmarkFontSize(landmark: LocalOpticalLandmark): number {
    const size = landmarkSize(landmark);
    return Math.max(1.15, Math.min(3.2, size * 0.11));
}

function landmarkLabelOffset(landmark: LocalOpticalLandmark): number {
    const size = landmarkSize(landmark);
    return size / 2 + Math.max(1.4, Math.min(5, size * 0.16));
}

function textBounds(label: OpticalLandmarkLabel, position: Vector3) {
    const width = Math.max(6, label.label.length * label.fontSize * 0.62);
    const height = label.fontSize * 1.35;
    return {
        minX: position.x - 0.35,
        maxX: position.x + width,
        minY: position.y - height * 0.5,
        maxY: position.y + height * 0.5,
    };
}

function boundsOverlap(
    a: ReturnType<typeof textBounds>,
    b: ReturnType<typeof textBounds>,
    pad: number,
): boolean {
    return a.minX < b.maxX + pad
        && a.maxX + pad > b.minX
        && a.minY < b.maxY + pad
        && a.maxY + pad > b.minY;
}

function layoutOpticalLabels(labels: OpticalLandmarkLabel[]): OpticalLandmarkLabel[] {
    const placedBounds: Array<ReturnType<typeof textBounds>> = [];
    const sorted = [...labels].sort((a, b) => (
        a.position.y - b.position.y
        || a.position.x - b.position.x
        || a.id.localeCompare(b.id)
    ));

    return sorted.map(label => {
        const base = label.position;
        const rowStep = Math.max(2.4, label.fontSize * 1.55);
        const columnStep = Math.max(4.5, label.fontSize * 2.2);
        let placed = base.clone();
        let bounds = textBounds(label, placed);

        for (let attempt = 0; attempt < 48; attempt++) {
            if (attempt > 0) {
                const row = Math.ceil(attempt / 2);
                const sign = attempt % 2 === 1 ? 1 : -1;
                const column = Math.floor(Math.max(0, attempt - 18) / 8);
                placed = base.clone();
                placed.x += column * columnStep;
                placed.y += sign * row * rowStep;
                bounds = textBounds(label, placed);
            }

            if (!placedBounds.some(existing => boundsOverlap(bounds, existing, 0.8))) break;
        }

        placedBounds.push(bounds);
        return { ...label, position: placed };
    });
}

function collectOpticalLandmarks(components: OpticalComponent[]): OpticalPlaneModel {
    const entries: ComponentLandmarks[] = [];
    const labels: OpticalLandmarkLabel[] = [];

    for (const component of components) {
        if (component.isSubComponent || component.isGhost) continue;

        const landmarks = landmarksForComponent(component);
        if (landmarks.length === 0) continue;

        component.updateMatrices();
        entries.push({ component, landmarks });

        const rightWorld = new Vector3(1, 0, 0).transformDirection(component.localToWorld);
        let labelDirection = new Vector3(rightWorld.x, rightWorld.y, 0);
        if (labelDirection.lengthSq() < 1e-8) {
            labelDirection.set(1, 0, 0);
        } else {
            labelDirection.normalize();
        }

        if (labelDirection.x < 0) labelDirection.multiplyScalar(-1);
        if (Math.abs(labelDirection.x) < 0.25) {
            labelDirection.x = 0.35;
            labelDirection.normalize();
        }

        for (const landmark of landmarks) {
            const center = new Vector3(0, 0, landmark.localZ).applyMatrix4(component.localToWorld);
            const basePosition = center.clone().add(labelDirection.clone().multiplyScalar(landmarkLabelOffset(landmark)));
            basePosition.z = center.z + 0.9;

            labels.push({
                id: `${component.id}:${landmark.id}`,
                label: landmark.label,
                color: landmark.color,
                confidence: landmark.confidence,
                center,
                position: basePosition,
                fontSize: landmarkFontSize(landmark),
            });
        }
    }

    return { entries, labels: layoutOpticalLabels(labels) };
}

function toVec3(v: { x: number; y: number; z: number }): Vector3 {
    return v instanceof Vector3 ? v : new Vector3(v.x, v.y, v.z);
}

function raySegmentEnd(path: Ray[], index: number): Vector3 | null {
    const ray = path[index];
    if (!ray) return null;
    if (ray.terminationPoint) return toVec3(ray.terminationPoint);
    if (ray.interactionDistance !== undefined) {
        return toVec3(ray.origin).clone().add(toVec3(ray.direction).clone().multiplyScalar(ray.interactionDistance));
    }
    const next = path[index + 1];
    if (next) return toVec3(next.origin);
    return null;
}

function landmarkPadding(landmark: LocalOpticalLandmark): number {
    return Math.max(3, Math.min(12, landmarkSize(landmark) * 0.25));
}

function pointInLandmark(landmark: LocalOpticalLandmark, point: Vector3, padding = 0): boolean {
    if (landmark.shape === 'circle') {
        const radius = Math.max(landmark.radius ?? 0, 0) + padding;
        return point.x * point.x + point.y * point.y <= radius * radius;
    }
    const halfW = Math.max(landmark.width ?? 0, 0) / 2 + padding;
    const halfH = Math.max(landmark.height ?? 0, 0) / 2 + padding;
    return Math.abs(point.x) <= halfW && Math.abs(point.y) <= halfH;
}

function analyzePlaneRays(
    rayPaths: Ray[][],
    component: OpticalComponent,
    landmark: LocalOpticalLandmark,
): PlaneRayStats {
    component.updateMatrices();
    const padding = landmarkPadding(landmark);
    const hits: { x: number; y: number; angleRad: number; isChief: boolean }[] = [];
    let planeCrossings = 0;
    let nearMisses = 0;

    for (let pathIndex = 0; pathIndex < rayPaths.length; pathIndex++) {
        const path = rayPaths[pathIndex];
        for (let rayIndex = 0; rayIndex < path.length; rayIndex++) {
            const ray = path[rayIndex];
            if ((ray.intensity ?? 1) < 1e-9) continue;

            const endWorld = raySegmentEnd(path, rayIndex);
            if (!endWorld) continue;

            const startLocal = toVec3(ray.origin).clone().applyMatrix4(component.worldToLocal);
            const endLocal = endWorld.clone().applyMatrix4(component.worldToLocal);
            const dz = endLocal.z - startLocal.z;
            if (Math.abs(dz) < 1e-9) continue;

            const t = (landmark.localZ - startLocal.z) / dz;
            if (t < -1e-6 || t > 1 + 1e-6) continue;
            if (t <= 1e-6 && rayIndex > 0) continue;

            const clampedT = Math.max(0, Math.min(1, t));
            const hit = startLocal.lerp(endLocal, clampedT);
            if (!pointInLandmark(landmark, hit, padding)) continue;

            planeCrossings++;
            if (!pointInLandmark(landmark, hit)) {
                nearMisses++;
                continue;
            }

            const localDir = toVec3(ray.direction).clone().transformDirection(component.worldToLocal).normalize();
            const normalComponent = Math.max(-1, Math.min(1, Math.abs(localDir.z)));
            const angleRad = Math.acos(normalComponent);
            hits.push({
                x: hit.x,
                y: hit.y,
                angleRad,
                isChief: Boolean(ray.isMainRay || path[0]?.isMainRay),
            });
        }
    }

    if (hits.length === 0) {
        return {
            planeCrossings,
            hits: 0,
            nearMisses,
            centroidX: 0,
            centroidY: 0,
            rmsRadius: 0,
            rmsX: 0,
            rmsY: 0,
            chiefAngleDeg: null,
            coneNA: null,
        };
    }

    const centroidX = hits.reduce((sum, hit) => sum + hit.x, 0) / hits.length;
    const centroidY = hits.reduce((sum, hit) => sum + hit.y, 0) / hits.length;
    let varX = 0;
    let varY = 0;
    let maxAngleRad = 0;
    for (const hit of hits) {
        varX += (hit.x - centroidX) ** 2;
        varY += (hit.y - centroidY) ** 2;
        maxAngleRad = Math.max(maxAngleRad, hit.angleRad);
    }
    varX /= hits.length;
    varY /= hits.length;
    const chief = hits.find(hit => hit.isChief) ?? hits[0];

    return {
        planeCrossings,
        hits: hits.length,
        nearMisses,
        centroidX,
        centroidY,
        rmsRadius: Math.sqrt(varX + varY),
        rmsX: Math.sqrt(varX),
        rmsY: Math.sqrt(varY),
        chiefAngleDeg: chief ? chief.angleRad * 180 / Math.PI : null,
        coneNA: Math.sin(maxAngleRad),
    };
}

function fmtMm(value: number, digits = 2): string {
    if (!Number.isFinite(value)) return '—';
    const abs = Math.abs(value);
    if (abs >= 100) return `${value.toFixed(1)} mm`;
    if (abs >= 10) return `${value.toFixed(2)} mm`;
    return `${value.toFixed(digits)} mm`;
}

function fmtPlain(value: number, digits = 2): string {
    if (!Number.isFinite(value)) return '—';
    return value.toFixed(digits);
}

function fmtPercent(value: number, digits = 1): string {
    if (!Number.isFinite(value)) return '—';
    return `${(value * 100).toFixed(digits)}%`;
}

function fmtPowerDensity(value: number): string {
    if (!Number.isFinite(value)) return '—';
    const abs = Math.abs(value);
    if (abs === 0) return '0 W/mm²';
    if (abs < 0.001 || abs >= 10000) return `${value.toExponential(2)} W/mm²`;
    if (abs < 1) return `${value.toFixed(4)} W/mm²`;
    if (abs < 100) return `${value.toFixed(3)} W/mm²`;
    return `${value.toFixed(1)} W/mm²`;
}

function landmarkFieldDimensions(landmark: LocalOpticalLandmark): { width: number; height: number; radius?: number } {
    if (landmark.shape === 'circle') {
        const diameter = Math.max((landmark.radius ?? 1) * 2, 1);
        return { width: diameter, height: diameter, radius: landmark.radius };
    }
    return {
        width: Math.max(landmark.width ?? 1, 1),
        height: Math.max(landmark.height ?? 1, 1),
    };
}

function fieldPreviewColor(normalized: number): [number, number, number] {
    const t = Math.max(0, Math.min(1, normalized));
    const lerp = (a: number, b: number, u: number) => Math.round(a + (b - a) * u);
    if (t <= 0.44) {
        const u = t / 0.44;
        return [0, lerp(0, 127, u), lerp(0, 255, u)];
    }
    if (t <= 0.65) {
        const u = (t - 0.44) / 0.21;
        return [lerp(0, 255, u), lerp(127, 150, u), lerp(255, 50, u)];
    }
    const u = (t - 0.65) / 0.35;
    return [255, lerp(150, 255, u), lerp(50, 255, u)];
}

function fieldPreviewDataUrl(field: { resX: number; resY: number; intensity: Float32Array } | null): string | null {
    if (!field || typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = field.resX;
    canvas.height = field.resY;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    let maxValue = 0;
    for (const value of field.intensity) maxValue = Math.max(maxValue, value);
    if (maxValue <= 0) return null;

    const image = ctx.createImageData(field.resX, field.resY);
    for (let i = 0; i < field.intensity.length; i++) {
        const normalized = Math.max(0, Math.min(1, field.intensity[i] / maxValue));
        const [r, g, b] = fieldPreviewColor(normalized);
        image.data[i * 4] = r;
        image.data[i * 4 + 1] = g;
        image.data[i * 4 + 2] = b;
        image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
}

function samplingStatsFromHits(hits: ReturnType<typeof collectTerminalPacketHitsFromRayPaths>): {
    effectiveHitCount: number;
    estimatedRelativeSamplingNoise: number | null;
    suggestedHitCount: number;
} {
    let sum = 0;
    let sumSq = 0;
    for (const hit of hits) {
        const weight = Math.max(hit.ray.powerWeight ?? hit.ray.intensity, 0);
        sum += weight;
        sumSq += weight * weight;
    }
    const effectiveHitCount = sumSq > 0 ? (sum * sum) / sumSq : hits.length;
    const estimatedRelativeSamplingNoise = effectiveHitCount > 0 ? 1 / Math.sqrt(effectiveHitCount) : null;
    const targetEffectiveHits = Math.ceil(1 / (0.03 * 0.03));
    const suggestedHitCount = effectiveHitCount > 0
        ? Math.ceil(hits.length * targetEffectiveHits / effectiveHitCount)
        : targetEffectiveHits;
    return {
        effectiveHitCount,
        estimatedRelativeSamplingNoise,
        suggestedHitCount,
    };
}

function analyzePacketPlane(
    rayPaths: Ray[][],
    component: OpticalComponent,
    landmark: LocalOpticalLandmark,
    stats: PlaneRayStats,
): PacketPlaneAnalysis {
    component.updateMatrices();
    const dims = landmarkFieldDimensions(landmark);
    const res = 64;
    const hits = collectTerminalPacketHitsFromRayPaths(rayPaths, {
        worldToLocal: component.worldToLocal,
        localToWorld: component.localToWorld,
        localZ: landmark.localZ,
        width: dims.width,
        height: dims.height,
        radius: dims.radius,
        detectorId: `${component.id}:${landmark.id}`,
    });
    const validity = summarizePacketHitValidity(hits);
    const sampling = samplingStatsFromHits(hits);
    if (hits.length === 0) {
        return {
            hitCount: 0,
            effectiveHitCount: 0,
            estimatedRelativeSamplingNoise: null,
            suggestedHitCount: sampling.suggestedHitCount,
            validity,
            metrics: null,
            previewUrl: null,
            axialXZUrl: null,
            axialYZUrl: null,
            zernikeFit: null,
            fieldViewWidth: dims.width,
            fieldViewHeight: dims.height,
            fieldCenterX: 0,
            fieldCenterY: 0,
            pixelPitchX: dims.width / res,
            pixelPitchY: dims.height / res,
            axialDepth: null,
        };
    }

    const fieldWindow = adaptiveTerminalFieldWindow(hits, {
        maxWidth: dims.width,
        maxHeight: dims.height,
    });
    const field = synthesizeTerminalFieldFromHits(hits, {
        width: fieldWindow.width,
        height: fieldWindow.height,
        centerX: fieldWindow.centerX,
        centerY: fieldWindow.centerY,
        resX: res,
        resY: res,
    });
    const wavelengthM = hits[0]?.ray.wavelength;
    const numericalAperture = component instanceof Objective
        ? component.NA
        : stats.coneNA;
    const metrics = analyzeTerminalField(field, {
        wavelengthM,
        numericalAperture,
    });
    const axialSections = validity.isPacketFieldValid
        ? synthesizeTerminalAxialSectionsFromRayPaths(
            rayPaths,
            {
                worldToLocal: component.worldToLocal,
                localToWorld: component.localToWorld,
                localZ: landmark.localZ,
                width: dims.width,
                height: dims.height,
                radius: dims.radius,
                detectorId: `${component.id}:${landmark.id}:axial`,
            },
            fieldWindow,
            {
                resTransverse: 48,
                resZ: 33,
            },
        )
        : null;
    const pupilRadius = landmark.kind === 'pupil'
        ? (dims.radius ?? Math.min(dims.width, dims.height) * 0.5)
        : null;
    const zernikeFit = pupilRadius
        ? fitZernikePupilFromHits(hits, { pupilRadius, maxIndex: 11 })
        : null;

    return {
        hitCount: hits.length,
        effectiveHitCount: sampling.effectiveHitCount,
        estimatedRelativeSamplingNoise: sampling.estimatedRelativeSamplingNoise,
        suggestedHitCount: sampling.suggestedHitCount,
        validity,
        metrics,
        previewUrl: fieldPreviewDataUrl(field),
        axialXZUrl: axialSections
            ? fieldPreviewDataUrl({ resX: axialSections.resTransverse, resY: axialSections.resZ, intensity: axialSections.xz })
            : null,
        axialYZUrl: axialSections
            ? fieldPreviewDataUrl({ resX: axialSections.resTransverse, resY: axialSections.resZ, intensity: axialSections.yz })
            : null,
        zernikeFit,
        fieldViewWidth: fieldWindow.width,
        fieldViewHeight: fieldWindow.height,
        fieldCenterX: fieldWindow.centerX,
        fieldCenterY: fieldWindow.centerY,
        pixelPitchX: fieldWindow.width / res,
        pixelPitchY: fieldWindow.height / res,
        axialDepth: axialSections?.axialDepth ?? null,
    };
}

const LandmarkPlane: React.FC<{
    landmark: LocalOpticalLandmark;
    selected: boolean;
    onSelect: () => void;
}> = ({ landmark, selected, onSelect }) => {
    const outlineOpacity = confidenceLineOpacity(landmark.confidence);
    const fillOpacity = confidenceOpacity(landmark.confidence);
    const hitPadding = Math.max(2, Math.min(8, landmarkSize(landmark) * 0.12));

    const handlePointerDown = (event: LandmarkPointerEvent) => {
        event.stopPropagation();
        onSelect();
    };
    const stopClick = (event: LandmarkClickEvent) => {
        event.stopPropagation();
    };

    return (
        <group position={[0, 0, landmark.localZ]} onPointerDown={handlePointerDown} onClick={stopClick}>
            {landmark.shape === 'circle' ? (
                <>
                    <mesh renderOrder={44} rotation={[Math.PI / 2, 0, 0]}>
                        <cylinderGeometry args={[
                            Math.max(landmark.radius ?? 1, 0.2),
                            Math.max(landmark.radius ?? 1, 0.2),
                            PLANE_VISUAL_THICKNESS_MM,
                            72,
                            1,
                            false,
                        ]} />
                        <meshBasicMaterial
                            color={landmark.color}
                            transparent
                            opacity={Math.max(fillOpacity * 0.75, 0.06)}
                            side={DoubleSide}
                            depthWrite={false}
                            depthTest={false}
                        />
                    </mesh>
                    <mesh renderOrder={60} rotation={[Math.PI / 2, 0, 0]}>
                        <cylinderGeometry args={[
                            Math.max((landmark.radius ?? 1) + hitPadding, 5),
                            Math.max((landmark.radius ?? 1) + hitPadding, 5),
                            PLANE_VISUAL_THICKNESS_MM,
                            48,
                            1,
                            false,
                        ]} />
                        <meshBasicMaterial transparent opacity={0} colorWrite={false} depthWrite={false} side={DoubleSide} />
                    </mesh>
                    <mesh renderOrder={45}>
                        <circleGeometry args={[Math.max(landmark.radius ?? 1, 0.2), 72]} />
                        <meshBasicMaterial
                            color={landmark.color}
                            transparent
                            opacity={fillOpacity}
                            side={DoubleSide}
                            depthWrite={false}
                            depthTest={false}
                        />
                    </mesh>
                    <mesh renderOrder={46}>
                        <ringGeometry args={[
                            Math.max((landmark.radius ?? 1) - 0.12, 0.05),
                            Math.max(landmark.radius ?? 1, 0.2),
                            72,
                        ]} />
                        <meshBasicMaterial
                            color={landmark.color}
                            transparent
                            opacity={outlineOpacity}
                            side={DoubleSide}
                            depthWrite={false}
                            depthTest={false}
                        />
                    </mesh>
                    {selected && (
                        <mesh renderOrder={61}>
                            <ringGeometry args={[
                                Math.max((landmark.radius ?? 1) + 0.35, 0.2),
                                Math.max((landmark.radius ?? 1) + 0.95, 0.8),
                                72,
                            ]} />
                            <meshBasicMaterial
                                color="#ffffff"
                                transparent
                                opacity={0.95}
                                side={DoubleSide}
                                depthWrite={false}
                                depthTest={false}
                            />
                        </mesh>
                    )}
                </>
            ) : (
                <>
                    <mesh renderOrder={44}>
                        <boxGeometry args={[
                            Math.max(landmark.width ?? 1, 0.2),
                            Math.max(landmark.height ?? 1, 0.2),
                            PLANE_VISUAL_THICKNESS_MM,
                        ]} />
                        <meshBasicMaterial
                            color={landmark.color}
                            transparent
                            opacity={Math.max(fillOpacity * 0.75, 0.06)}
                            side={DoubleSide}
                            depthWrite={false}
                            depthTest={false}
                        />
                    </mesh>
                    <mesh renderOrder={60}>
                        <boxGeometry args={[
                            Math.max((landmark.width ?? 1) + hitPadding * 2, 8),
                            Math.max((landmark.height ?? 1) + hitPadding * 2, 8),
                            PLANE_VISUAL_THICKNESS_MM,
                        ]} />
                        <meshBasicMaterial transparent opacity={0} colorWrite={false} depthWrite={false} side={DoubleSide} />
                    </mesh>
                    <mesh renderOrder={45}>
                        <planeGeometry args={[Math.max(landmark.width ?? 1, 0.2), Math.max(landmark.height ?? 1, 0.2)]} />
                        <meshBasicMaterial
                            color={landmark.color}
                            transparent
                            opacity={fillOpacity}
                            side={DoubleSide}
                            depthWrite={false}
                            depthTest={false}
                        />
                    </mesh>
                    <mesh renderOrder={46}>
                        <planeGeometry args={[Math.max(landmark.width ?? 1, 0.2), Math.max(landmark.height ?? 1, 0.2)]} />
                        <meshBasicMaterial
                            color={landmark.color}
                            transparent
                            opacity={outlineOpacity}
                            wireframe
                            side={DoubleSide}
                            depthWrite={false}
                            depthTest={false}
                        />
                    </mesh>
                    {selected && (
                        <mesh renderOrder={61}>
                            <planeGeometry args={[Math.max((landmark.width ?? 1) + 1.1, 1), Math.max((landmark.height ?? 1) + 1.1, 1)]} />
                            <meshBasicMaterial
                                color="#ffffff"
                                transparent
                                opacity={0.95}
                                wireframe
                                side={DoubleSide}
                                depthWrite={false}
                                depthTest={false}
                            />
                        </mesh>
                    )}
                </>
            )}
        </group>
    );
};

const LandmarkLabel: React.FC<{
    label: OpticalLandmarkLabel;
    selected: boolean;
    onSelect: () => void;
}> = ({ label, selected, onSelect }) => {
    const lineOpacity = confidenceLineOpacity(label.confidence);
    const handlePointerDown = (event: LandmarkPointerEvent) => {
        event.stopPropagation();
        onSelect();
    };
    const stopClick = (event: LandmarkClickEvent) => {
        event.stopPropagation();
    };

    return (
        <group onPointerDown={handlePointerDown} onClick={stopClick}>
            <mesh
                position={[label.center.x, label.center.y, label.center.z + 0.45]}
                renderOrder={49}
            >
                <circleGeometry args={[Math.max(0.2, label.fontSize * 0.18), 18]} />
                <meshBasicMaterial
                    color={label.color}
                    transparent
                    opacity={lineOpacity}
                    depthWrite={false}
                    depthTest={false}
                />
            </mesh>
            <Text
                position={[label.position.x, label.position.y, label.position.z]}
                fontSize={label.fontSize}
                color={label.color}
                anchorX="left"
                anchorY="middle"
                outlineWidth={selected ? 0.1 : 0.06}
                outlineColor={selected ? '#ffffff' : '#02040a'}
                renderOrder={50}
                material-depthTest={false}
                material-depthWrite={false}
            >
                {label.label}
            </Text>
        </group>
    );
};

const PlaneMetricRow: React.FC<{ label: string; value: React.ReactNode; tone?: 'default' | 'warning' }> = ({ label, value, tone = 'default' }) => (
    <div className={`optical-plane-metric${tone === 'warning' ? ' optical-plane-metric-warning' : ''}`}>
        <span>{label}</span>
        <strong>{value}</strong>
    </div>
);

function packetFieldLabel(analysis: PacketPlaneAnalysis): string {
    if (!analysis.validity.isPacketFieldValid) return 'geometric fallback';
    return analysis.validity.isPsfValid ? 'PSF-valid' : 'field only';
}

const MiniCurve: React.FC<{
    label: string;
    samples: EncircledEnergySample[] | RadialMtfSample[];
    xValue: (sample: EncircledEnergySample | RadialMtfSample) => number;
    yValue: (sample: EncircledEnergySample | RadialMtfSample) => number;
}> = ({ label, samples, xValue, yValue }) => {
    if (samples.length < 2) return null;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const sample of samples) {
        const x = xValue(sample);
        const y = yValue(sample);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }
    const spanX = Math.max(maxX - minX, 1e-9);
    const spanY = Math.max(maxY - minY, 1e-9);
    const points = samples.map(sample => {
        const x = 4 + ((xValue(sample) - minX) / spanX) * 76;
        const y = 32 - ((yValue(sample) - minY) / spanY) * 26;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    return (
        <div className="optical-plane-mini-curve">
            <span>{label}</span>
            <svg viewBox="0 0 84 36" role="img" aria-label={label}>
                <path d="M4 32H80M4 6V32" />
                <polyline points={points} />
            </svg>
        </div>
    );
};

function planeCenterWorld(component: OpticalComponent, landmark: LocalOpticalLandmark): Vector3 {
    component.updateMatrices();
    return new Vector3(0, 0, landmark.localZ).applyMatrix4(component.localToWorld);
}

function topZernikeCoefficients(fit: ZernikePupilFit): ZernikePupilFit['coefficients'] {
    return [...fit.coefficients]
        .filter(coefficient => coefficient.index !== 1 && Math.abs(coefficient.coefficientWaves) > 1e-4)
        .sort((a, b) => Math.abs(b.coefficientWaves) - Math.abs(a.coefficientWaves))
        .slice(0, 4);
}

const OpticalPlanePopover: React.FC<{
    component: OpticalComponent;
    landmark: LocalOpticalLandmark;
    label: OpticalLandmarkLabel | undefined;
    anchorWorld?: Vector3;
    anchorWorlds: Vector3[];
    popoverIndex: number;
    stats: PlaneRayStats;
    packetAnalysis: PacketPlaneAnalysis | null;
    onClose: () => void;
}> = ({ component, landmark, label, anchorWorld, anchorWorlds, popoverIndex, stats, packetAnalysis, onClose }) => {
    const canvasWidth = useThree(state => state.size.width);
    const canvasHeight = useThree(state => state.size.height);
    const screenLayout = useMemo(
        () => calculateOpticalPlanePopoverLayout({ width: canvasWidth, height: canvasHeight }, anchorWorlds.length),
        [canvasWidth, canvasHeight, anchorWorlds.length],
    );
    const stop = (event: React.PointerEvent | React.MouseEvent) => {
        event.stopPropagation();
    };
    const popoverPosition = anchorWorld?.clone()
        ?? label?.position.clone()
        ?? new Vector3(0, 0, landmark.localZ).applyMatrix4(component.localToWorld).add(new Vector3(10, 10, 6));
    const missesSamplingTarget = Boolean(
        packetAnalysis
        && packetAnalysis.suggestedHitCount > 0
        && packetAnalysis.hitCount < packetAnalysis.suggestedHitCount,
    );

    return (
        <Html
            position={[popoverPosition.x, popoverPosition.y, popoverPosition.z + 4]}
            calculatePosition={(el, camera, size) => calculateOpticalPlanePopoverPosition(el, camera, size, anchorWorlds, popoverIndex)}
            zIndexRange={[70, 0]}
            style={{ pointerEvents: 'auto' }}
        >
            <div
                className="optical-plane-popover"
                onPointerDown={stop}
                onPointerUp={stop}
                onClick={stop}
                style={{
                    width: `${screenLayout.width}px`,
                    maxHeight: `${screenLayout.maxHeight}px`,
                }}
            >
                <button
                    type="button"
                    className="optical-plane-popover-close"
                    aria-label="Close optical plane inspector"
                    onPointerDown={stop}
                    onClick={(event) => {
                        stop(event);
                        onClose();
                    }}
                >
                    ×
                </button>
                {packetAnalysis?.previewUrl && (
                    <div className="optical-plane-psf-preview-wrap">
                        <img
                            className="optical-plane-psf-preview"
                            src={packetAnalysis.previewUrl}
                            alt=""
                            draggable={false}
                        />
                        <div className="optical-plane-field-scale" aria-hidden="true">
                            <div className="optical-plane-image-meta">
                                <span>{`XY view ${fmtMm(packetAnalysis.fieldViewWidth)} × ${fmtMm(packetAnalysis.fieldViewHeight)}`}</span>
                                <span>{`peak ${packetAnalysis.metrics ? fmtPowerDensity(packetAnalysis.metrics.peakPowerDensity) : '—'}`}</span>
                            </div>
                            <div className="optical-plane-field-scale-bar" />
                            <div className="optical-plane-field-scale-labels">
                                <span>0</span>
                                <span>I/Imax 0.5</span>
                                <span>1.0</span>
                            </div>
                        </div>
                    </div>
                )}
                <div className="optical-plane-popover-scroll">
                <div className="optical-plane-popover-section">
                    <PlaneMetricRow label="Plane" value={`${landmark.label} · ${component.name}`} />
                    <PlaneMetricRow label="Rays in plane" value={`${stats.hits} / ${stats.planeCrossings}`} />
                    <PlaneMetricRow label="Near misses" value={stats.nearMisses} />
                    {stats.hits > 0 ? (
                        <>
                            <PlaneMetricRow label="Centroid" value={`${fmtMm(stats.centroidX)}, ${fmtMm(stats.centroidY)}`} />
                            <PlaneMetricRow label="RMS spot" value={fmtMm(stats.rmsRadius)} />
                            <PlaneMetricRow label="RMS X/Y" value={`${fmtMm(stats.rmsX)} / ${fmtMm(stats.rmsY)}`} />
                            <PlaneMetricRow label="Chief angle" value={stats.chiefAngleDeg === null ? '—' : `${stats.chiefAngleDeg.toFixed(2)}°`} />
                            <PlaneMetricRow label="Ray cone NA" value={stats.coneNA === null ? '—' : fmtPlain(stats.coneNA, 3)} />
                        </>
                    ) : (
                        <div className="optical-plane-empty">No traced rays intersect the active area.</div>
                    )}
                </div>

                <div className="optical-plane-popover-section">
                    {packetAnalysis && packetAnalysis.hitCount > 0 && packetAnalysis.metrics ? (
                        <>
                            <PlaneMetricRow label="Packet hits" value={packetAnalysis.hitCount} />
                            <PlaneMetricRow
                                label="Packet field"
                                value={packetFieldLabel(packetAnalysis)}
                            />
                            {!packetAnalysis.validity.isPacketFieldValid && (
                                <PlaneMetricRow
                                    label="Fallback"
                                    value={`${packetAnalysis.validity.fallbackHits + packetAnalysis.validity.unknownHits} / ${packetAnalysis.validity.totalHits}`}
                                />
                            )}
                            <PlaneMetricRow label="Field view" value={`${fmtMm(packetAnalysis.fieldViewWidth)} × ${fmtMm(packetAnalysis.fieldViewHeight)}`} />
                            <PlaneMetricRow label="Pixel pitch" value={`${fmtMm(packetAnalysis.pixelPitchX, 3)} × ${fmtMm(packetAnalysis.pixelPitchY, 3)}`} />
                            <PlaneMetricRow label="Image center" value={`${fmtMm(packetAnalysis.fieldCenterX)}, ${fmtMm(packetAnalysis.fieldCenterY)}`} />
                            <PlaneMetricRow label="Power" value={`${fmtPlain(packetAnalysis.metrics.totalPower, 3)} W`} />
                            <PlaneMetricRow label="Peak irradiance" value={fmtPowerDensity(packetAnalysis.metrics.peakPowerDensity)} />
                            <PlaneMetricRow label="RMS field" value={fmtMm(packetAnalysis.metrics.rmsRadius)} />
                            <PlaneMetricRow label="Field centroid" value={`${fmtMm(packetAnalysis.metrics.centroidX)}, ${fmtMm(packetAnalysis.metrics.centroidY)}`} />
                            <PlaneMetricRow label="N effective" value={fmtPlain(packetAnalysis.effectiveHitCount, 0)} />
                            <PlaneMetricRow
                                label="Sampling noise"
                                value={packetAnalysis.estimatedRelativeSamplingNoise === null ? '—' : `~${fmtPercent(packetAnalysis.estimatedRelativeSamplingNoise)}`}
                                tone={missesSamplingTarget ? 'warning' : 'default'}
                            />
                            <PlaneMetricRow
                                label="3% target"
                                value={`~${packetAnalysis.suggestedHitCount} hits`}
                                tone={missesSamplingTarget ? 'warning' : 'default'}
                            />
                            {(packetAnalysis.axialXZUrl || packetAnalysis.axialYZUrl) && (
                                <div className="optical-plane-axial-grid">
                                    {packetAnalysis.axialXZUrl && (
                                        <div>
                                            <span>{`XZ: x ${fmtMm(packetAnalysis.fieldViewWidth)}, z ${packetAnalysis.axialDepth === null ? '—' : fmtMm(packetAnalysis.axialDepth)}`}</span>
                                            <img src={packetAnalysis.axialXZUrl} alt="" draggable={false} />
                                        </div>
                                    )}
                                    {packetAnalysis.axialYZUrl && (
                                        <div>
                                            <span>{`YZ: y ${fmtMm(packetAnalysis.fieldViewHeight)}, z ${packetAnalysis.axialDepth === null ? '—' : fmtMm(packetAnalysis.axialDepth)}`}</span>
                                            <img src={packetAnalysis.axialYZUrl} alt="" draggable={false} />
                                        </div>
                                    )}
                                </div>
                            )}
                            {packetAnalysis.axialDepth !== null && (
                                <PlaneMetricRow label="Axial view" value={fmtMm(packetAnalysis.axialDepth)} />
                            )}
                            {packetAnalysis.validity.isPsfValid ? (
                                <>
                                    <PlaneMetricRow label="EE50 / EE80" value={`${packetAnalysis.metrics.ee50Radius === null ? '—' : fmtMm(packetAnalysis.metrics.ee50Radius)} / ${packetAnalysis.metrics.ee80Radius === null ? '—' : fmtMm(packetAnalysis.metrics.ee80Radius)}`} />
                                    <PlaneMetricRow label="MTF50" value={packetAnalysis.metrics.mtf50 === null ? '—' : `${fmtPlain(packetAnalysis.metrics.mtf50, 3)} cyc/mm`} />
                                    <PlaneMetricRow label="Strehl" value={packetAnalysis.metrics.strehlRatio === null ? '—' : fmtPlain(packetAnalysis.metrics.strehlRatio, 3)} />
                                    <div className="optical-plane-curve-grid">
                                        <MiniCurve
                                            label="EE"
                                            samples={packetAnalysis.metrics.encircledEnergy}
                                            xValue={sample => (sample as EncircledEnergySample).radius}
                                            yValue={sample => (sample as EncircledEnergySample).fraction}
                                        />
                                        <MiniCurve
                                            label="MTF"
                                            samples={packetAnalysis.metrics.radialMtf}
                                            xValue={sample => (sample as RadialMtfSample).spatialFrequency}
                                            yValue={sample => (sample as RadialMtfSample).value}
                                        />
                                    </div>
                                </>
                            ) : (
                                <PlaneMetricRow label="PSF metrics" value={packetAnalysis.validity.psfInvalidReason ?? 'n/a'} />
                            )}
                            {packetAnalysis.zernikeFit && (
                                <>
                                    <PlaneMetricRow label="Zernike RMS" value={`${fmtPlain(packetAnalysis.zernikeFit.rmsWaves, 3)} waves`} />
                                    <PlaneMetricRow label="Zernike PV" value={`${fmtPlain(packetAnalysis.zernikeFit.peakToValleyWaves, 3)} waves`} />
                                    {topZernikeCoefficients(packetAnalysis.zernikeFit).map(coefficient => (
                                        <PlaneMetricRow
                                            key={coefficient.index}
                                            label={coefficient.label}
                                            value={`${fmtPlain(coefficient.coefficientWaves, 3)} waves`}
                                        />
                                    ))}
                                </>
                            )}
                        </>
                    ) : (
                        <div className="optical-plane-empty">No packet field can be reconstructed on this plane.</div>
                    )}
                </div>
                </div>
            </div>
        </Html>
    );
};

function findOpticalPlane(model: OpticalPlaneModel, planeId: string | null): SelectedOpticalPlane | null {
    if (!planeId) return null;
    for (const entry of model.entries) {
        for (const landmark of entry.landmarks) {
            const id = `${entry.component.id}:${landmark.id}`;
            if (id === planeId) {
                return {
                    id,
                    component: entry.component,
                    landmark,
                    label: model.labels.find(label => label.id === id),
                };
            }
        }
    }
    return null;
}

export const OpticalPlaneVisualizer: React.FC<{ components: OpticalComponent[]; rayPaths?: Ray[][] }> = ({ components, rayPaths = [] }) => {
    const componentSelection = useAtomValue(selectionAtom);
    const landmarkSignature = components
        .map(component => `${component.id}:${component.version}:${component.position.x},${component.position.y},${component.position.z}:${component.rotation.x},${component.rotation.y},${component.rotation.z},${component.rotation.w}`)
        .join('|');
    const model = useMemo(() => collectOpticalLandmarks(components), [components, landmarkSignature]);
    const [selectedPlaneIdsList, setSelectedPlaneIdsList] = useState<string[]>([]);
    const componentSelectionSignature = componentSelection.join('|');

    useEffect(() => {
        if (selectedPlaneIdsList.length === 0) return;
        const liveIds = new Set(model.labels.map(label => label.id));
        const filtered = selectedPlaneIdsList.filter(id => liveIds.has(id));
        if (filtered.length !== selectedPlaneIdsList.length) {
            setSelectedPlaneIdsList(filtered);
        }
    }, [model.labels, selectedPlaneIdsList]);

    useEffect(() => {
        if (componentSelection.length !== 1) {
            return;
        }

        const selectedComponentId = componentSelection[0];
        const entry = model.entries.find(candidate => candidate.component.id === selectedComponentId);
        if (!entry || !(entry.component instanceof Objective)) {
            return;
        }

        const objectivePlaneIds = entry.landmarks
            .filter(landmark => landmark.id === 'objective-pupil' || landmark.id === 'objective-front-focal')
            .map(landmark => `${entry.component.id}:${landmark.id}`);
        setSelectedPlaneIdsList(objectivePlaneIds);
    }, [componentSelection, componentSelectionSignature, model.entries]);

    const togglePlaneSelection = (planeId: string) => {
        setSelectedPlaneIdsList(current => (
            current.includes(planeId)
                ? current.filter(id => id !== planeId)
                : [...current, planeId]
        ));
    };
    const popoverPlanes = useMemo(() => (
        selectedPlaneIdsList
            .map(planeId => findOpticalPlane(model, planeId))
            .filter((plane): plane is SelectedOpticalPlane => Boolean(plane))
    ), [model, selectedPlaneIdsList]);
    const selectedPlaneIds = useMemo(() => new Set(popoverPlanes.map(plane => plane.id)), [popoverPlanes]);
    const popoverAnalyses = useMemo(() => (
        popoverPlanes.map(plane => {
            const anchorWorld = planeCenterWorld(plane.component, plane.landmark);
            const stats = analyzePlaneRays(rayPaths, plane.component, plane.landmark);
            return {
                plane,
                stats,
                packetAnalysis: analyzePacketPlane(rayPaths, plane.component, plane.landmark, stats),
                anchorWorld,
            };
        })
    ), [popoverPlanes, rayPaths]);
    const popoverAnchorWorlds = useMemo(
        () => popoverAnalyses.map(({ anchorWorld }) => anchorWorld),
        [popoverAnalyses],
    );

    return (
        <group>
            {model.entries.map(({ component, landmarks }) => (
                <group
                    key={component.id}
                    position={[component.position.x, component.position.y, component.position.z]}
                    quaternion={component.rotation.clone()}
                >
                    {landmarks.map(landmark => (
                        <LandmarkPlane
                            key={landmark.id}
                            landmark={landmark}
                            selected={selectedPlaneIds.has(`${component.id}:${landmark.id}`)}
                            onSelect={() => togglePlaneSelection(`${component.id}:${landmark.id}`)}
                        />
                    ))}
                </group>
            ))}
            {model.labels.map(label => (
                <LandmarkLabel
                    key={label.id}
                    label={label}
                    selected={selectedPlaneIds.has(label.id)}
                    onSelect={() => togglePlaneSelection(label.id)}
                />
            ))}
            {popoverAnalyses.map(({ plane, stats, packetAnalysis, anchorWorld }, index) => (
                <OpticalPlanePopover
                    key={plane.id}
                    component={plane.component}
                    landmark={plane.landmark}
                    label={plane.label}
                    anchorWorld={anchorWorld}
                    anchorWorlds={popoverAnchorWorlds}
                    popoverIndex={index}
                    stats={stats}
                    packetAnalysis={packetAnalysis}
                    onClose={() => setSelectedPlaneIdsList(current => current.filter(id => id !== plane.id))}
                />
            ))}
        </group>
    );
};
