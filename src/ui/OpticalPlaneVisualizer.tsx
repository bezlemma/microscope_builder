import React, { useEffect, useMemo, useState } from 'react';
import { Camera as ThreeCamera, DoubleSide, Object3D, Vector3 } from 'three';
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
import { PupilMaskElement } from '../physics/components/PupilMaskElement';

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

const MAX_FOCAL_PLANE_DISTANCE_MM = 500;

const COLORS = {
    image: '#56f0d2',
    focal: '#58b7ff',
    pupil: '#b78cff',
    stop: '#ffbd66',
    ambiguous: '#a5adba',
};

const POPOVER_MARGIN_PX = 10;
const POPOVER_MAX_WIDTH_PX = 260;
const POPOVER_MAX_HEIGHT_PX = 340;

function clampScreenValue(value: number, min: number, max: number): number {
    if (max < min) return min;
    return Math.min(max, Math.max(min, value));
}

function calculateOpticalPlanePopoverPosition(
    el: Object3D,
    camera: ThreeCamera,
    size: { width: number; height: number },
): number[] {
    const projected = new Vector3().setFromMatrixPosition(el.matrixWorld).project(camera);
    const anchorX = Number.isFinite(projected.x)
        ? (projected.x * size.width) / 2 + size.width / 2
        : size.width / 2;
    const anchorY = Number.isFinite(projected.y)
        ? -(projected.y * size.height) / 2 + size.height / 2
        : size.height / 2;
    const margin = Math.max(0, Math.min(POPOVER_MARGIN_PX, size.width / 2, size.height / 2));
    const popoverWidth = Math.min(POPOVER_MAX_WIDTH_PX, Math.max(0, size.width - margin * 2));
    const popoverHeight = Math.min(POPOVER_MAX_HEIGHT_PX, Math.max(0, size.height - margin * 2));

    let x = anchorX + margin;
    if (x + popoverWidth + margin > size.width) {
        x = anchorX - popoverWidth - margin;
    }

    let y = anchorY + margin;
    if (y + popoverHeight + margin > size.height) {
        y = anchorY - popoverHeight - margin;
    }

    return [
        clampScreenValue(x, margin, size.width - popoverWidth - margin),
        clampScreenValue(y, margin, size.height - popoverHeight - margin),
    ];
}

function finiteFocalLength(focalLength: number): boolean {
    return Number.isFinite(focalLength)
        && Math.abs(focalLength) >= 1
        && Math.abs(focalLength) <= MAX_FOCAL_PLANE_DISTANCE_MM;
}

function focalLabel(base: string, focalLength: number, approximate: boolean): string {
    const suffix = focalLength < 0 ? ' virtual' : '';
    return approximate ? `${base}${suffix} approx` : `${base}${suffix}`;
}

function addLensFocalLandmarks(
    landmarks: LocalOpticalLandmark[],
    focalLength: number,
    radius: number,
    confidence: LandmarkConfidence,
    approximate: boolean,
): void {
    if (!finiteFocalLength(focalLength)) return;
    const displayRadius = Math.max(1, Math.min(radius, 40));
    landmarks.push({
        id: 'front-focal',
        label: focalLabel('Front focal plane', focalLength, approximate),
        kind: 'focal',
        confidence,
        shape: 'circle',
        color: confidence === 'defined' ? COLORS.focal : COLORS.ambiguous,
        localZ: -focalLength,
        radius: displayRadius,
    });
    landmarks.push({
        id: 'back-focal',
        label: focalLabel('Back focal plane', focalLength, approximate),
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
        addLensFocalLandmarks(landmarks, component.focalLength, component.apertureRadius, 'defined', false);
        return landmarks;
    }

    if (component instanceof SphericalLens || component instanceof AsphericLens) {
        const apertureRadius = Math.max(1, component.apertureRadius);
        landmarks.push({
            id: 'lens-stop',
            label: 'Stop plane approx',
            kind: 'stop',
            confidence: 'candidate',
            shape: 'circle',
            color: COLORS.stop,
            localZ: 0,
            radius: apertureRadius,
        });
        addLensFocalLandmarks(landmarks, component.focalLength, apertureRadius, 'candidate', true);
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

    if (component instanceof PupilMaskElement) {
        landmarks.push({
            id: 'pupil-mask',
            label: 'Pupil plane',
            kind: 'pupil',
            confidence: 'defined',
            shape: 'circle',
            color: COLORS.pupil,
            localZ: 0,
            radius: component.radius,
            note: 'Pupil mask plane',
        });
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

function planeKindLabel(kind: OpticalPlaneKind): string {
    if (kind === 'image') return 'Image Plane';
    if (kind === 'pupil') return 'Pupil Plane';
    if (kind === 'focal') return 'Focal Plane';
    return 'Stop Plane';
}

function confidenceLabel(confidence: LandmarkConfidence): string {
    if (confidence === 'defined') return 'Defined';
    if (confidence === 'candidate') return 'Candidate';
    return 'Ambiguous';
}

function landmarkSizeLabel(landmark: LocalOpticalLandmark): string {
    if (landmark.shape === 'circle') return `diameter ${fmtMm((landmark.radius ?? 0) * 2)}`;
    return `${fmtMm(landmark.width ?? 0)} × ${fmtMm(landmark.height ?? 0)}`;
}

function componentPlaneNotes(component: OpticalComponent, landmark: LocalOpticalLandmark): string[] {
    const notes: string[] = [];
    if (landmark.note) notes.push(landmark.note);
    if (component instanceof Camera) {
        notes.push(`${component.sensorResX} × ${component.sensorResY} px`);
        notes.push(`sensor NA ${fmtPlain(component.sensorNA, 3)}`);
    } else if (component instanceof Objective) {
        notes.push(`NA ${fmtPlain(component.NA, 3)}`);
        notes.push(`pupil R ${fmtMm(component.pupilRadius)}`);
        notes.push(component.pupil?.aberrations?.coefficients.length
            ? `${component.pupil.aberrations.coefficients.length} Zernike terms`
            : 'diffraction-limited pupil');
    } else if (component instanceof QPD) {
        notes.push(`active Ø ${fmtMm(component.activeDiameter)}`);
    } else if (component instanceof PMT) {
        notes.push(`${component.scanResX} × ${component.scanResY} raster`);
    }
    return notes;
}

function preferredAutoSelectLandmark(landmarks: LocalOpticalLandmark[]): LocalOpticalLandmark | null {
    return landmarks.find(landmark => landmark.kind === 'image')
        ?? landmarks.find(landmark => landmark.kind === 'pupil')
        ?? landmarks.find(landmark => landmark.kind === 'stop')
        ?? landmarks[0]
        ?? null;
}

const LandmarkPlane: React.FC<{
    landmark: LocalOpticalLandmark;
    selected: boolean;
    onSelect: () => void;
}> = ({ landmark, selected, onSelect }) => {
    const outlineOpacity = confidenceLineOpacity(landmark.confidence);
    const fillOpacity = confidenceOpacity(landmark.confidence);
    const hitPadding = Math.max(2, Math.min(8, landmarkSize(landmark) * 0.12));

    const handlePointerDown = (event: any) => {
        event.stopPropagation();
        onSelect();
    };

    return (
        <group position={[0, 0, landmark.localZ]} onPointerDown={handlePointerDown}>
            {landmark.shape === 'circle' ? (
                <>
                    <mesh renderOrder={60}>
                        <circleGeometry args={[Math.max((landmark.radius ?? 1) + hitPadding, 5), 48]} />
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
                    <mesh renderOrder={60}>
                        <planeGeometry args={[Math.max((landmark.width ?? 1) + hitPadding * 2, 8), Math.max((landmark.height ?? 1) + hitPadding * 2, 8)]} />
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
    const handlePointerDown = (event: any) => {
        event.stopPropagation();
        onSelect();
    };

    return (
        <group onPointerDown={handlePointerDown}>
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

const PlaneMetricRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div className="optical-plane-metric">
        <span>{label}</span>
        <strong>{value}</strong>
    </div>
);

const OpticalPlanePopover: React.FC<{
    component: OpticalComponent;
    landmark: LocalOpticalLandmark;
    label: OpticalLandmarkLabel | undefined;
    stats: PlaneRayStats;
    onClose: () => void;
}> = ({ component, landmark, label, stats, onClose }) => {
    const stop = (event: React.PointerEvent | React.MouseEvent) => {
        event.stopPropagation();
    };
    const popoverPosition = label?.position.clone()
        ?? new Vector3(0, 0, landmark.localZ).applyMatrix4(component.localToWorld).add(new Vector3(10, 10, 6));

    const notes = componentPlaneNotes(component, landmark);
    const localPosition = `${landmark.localZ >= 0 ? '+' : ''}${fmtMm(landmark.localZ)}`;

    return (
        <Html
            position={[popoverPosition.x, popoverPosition.y, popoverPosition.z + 4]}
            calculatePosition={calculateOpticalPlanePopoverPosition}
            zIndexRange={[70, 0]}
            style={{ pointerEvents: 'auto' }}
        >
            <div
                className="optical-plane-popover"
                onPointerDown={stop}
                onPointerUp={stop}
                onClick={stop}
            >
                <div className="optical-plane-popover-header">
                    <span
                        className="optical-plane-popover-swatch"
                        style={{ background: landmark.color, color: landmark.color }}
                    />
                    <div className="optical-plane-popover-title-group">
                        <div className="optical-plane-popover-title">{planeKindLabel(landmark.kind)}</div>
                        <div className="optical-plane-popover-subtitle">{component.name}</div>
                    </div>
                    <button
                        type="button"
                        className="optical-plane-popover-close"
                        aria-label="Close optical plane inspector"
                        onClick={onClose}
                    >
                        ×
                    </button>
                </div>

                <div className="optical-plane-popover-section">
                    <PlaneMetricRow label="Landmark" value={landmark.label} />
                    <PlaneMetricRow label="Confidence" value={confidenceLabel(landmark.confidence)} />
                    <PlaneMetricRow label="Size" value={landmarkSizeLabel(landmark)} />
                    <PlaneMetricRow label="Local axis" value={localPosition} />
                    {notes.map(note => (
                        <PlaneMetricRow key={note} label="Note" value={note} />
                    ))}
                </div>

                <div className="optical-plane-popover-section">
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
            </div>
        </Html>
    );
};

export const OpticalPlaneVisualizer: React.FC<{ components: OpticalComponent[]; rayPaths?: Ray[][] }> = ({ components, rayPaths = [] }) => {
    const componentSelection = useAtomValue(selectionAtom);
    const landmarkSignature = components
        .map(component => `${component.id}:${component.version}:${component.position.x},${component.position.y},${component.position.z}:${component.rotation.x},${component.rotation.y},${component.rotation.z},${component.rotation.w}`)
        .join('|');
    const model = useMemo(() => collectOpticalLandmarks(components), [components, landmarkSignature]);
    const [selectedPlaneId, setSelectedPlaneId] = useState<string | null>(null);
    const selectedComponentId = componentSelection.length === 1 ? componentSelection[0] : null;
    const autoPlaneId = useMemo(() => {
        if (!selectedComponentId) return null;
        const entry = model.entries.find(entry => entry.component.id === selectedComponentId);
        const landmark = entry ? preferredAutoSelectLandmark(entry.landmarks) : null;
        return entry && landmark ? `${entry.component.id}:${landmark.id}` : null;
    }, [model.entries, selectedComponentId]);

    useEffect(() => {
        if (!selectedPlaneId) return;
        if (!model.labels.some(label => label.id === selectedPlaneId)) {
            setSelectedPlaneId(null);
        }
    }, [model.labels, selectedPlaneId]);

    useEffect(() => {
        if (componentSelection.length !== 1) {
            if (componentSelection.length > 1) setSelectedPlaneId(null);
            return;
        }

        if (!selectedComponentId) return;
        if (!autoPlaneId) {
            setSelectedPlaneId(null);
            return;
        }

        if (!selectedPlaneId || !selectedPlaneId.startsWith(`${selectedComponentId}:`)) {
            setSelectedPlaneId(autoPlaneId);
        }
    }, [autoPlaneId, componentSelection.length, selectedComponentId, selectedPlaneId]);

    const selectedPlane = useMemo(() => {
        if (!selectedPlaneId) return null;
        for (const entry of model.entries) {
            for (const landmark of entry.landmarks) {
                const id = `${entry.component.id}:${landmark.id}`;
                if (id === selectedPlaneId) {
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
    }, [model, selectedPlaneId]);

    const selectedStats = useMemo(() => (
        selectedPlane
            ? analyzePlaneRays(rayPaths, selectedPlane.component, selectedPlane.landmark)
            : null
    ), [rayPaths, selectedPlane]);

    return (
        <group>
            {model.entries.map(({ component, landmarks }) => (
                <group
                    key={`${component.id}:${component.version}`}
                    position={[component.position.x, component.position.y, component.position.z]}
                    quaternion={component.rotation.clone()}
                >
                    {landmarks.map(landmark => (
                        <LandmarkPlane
                            key={landmark.id}
                            landmark={landmark}
                            selected={selectedPlaneId === `${component.id}:${landmark.id}`}
                            onSelect={() => setSelectedPlaneId(`${component.id}:${landmark.id}`)}
                        />
                    ))}
                </group>
            ))}
            {model.labels.map(label => (
                <LandmarkLabel
                    key={label.id}
                    label={label}
                    selected={selectedPlaneId === label.id}
                    onSelect={() => setSelectedPlaneId(label.id)}
                />
            ))}
            {selectedPlane && selectedStats && (
                <OpticalPlanePopover
                    component={selectedPlane.component}
                    landmark={selectedPlane.landmark}
                    label={selectedPlane.label}
                    stats={selectedStats}
                    onClose={() => setSelectedPlaneId(null)}
                />
            )}
        </group>
    );
};
