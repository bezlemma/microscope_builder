import React, { useMemo } from 'react';
import { DoubleSide, Vector3 } from 'three';
import { Text } from '@react-three/drei';
import { OpticalComponent } from '../physics/Component';
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

interface LocalOpticalLandmark {
    id: string;
    label: string;
    confidence: LandmarkConfidence;
    shape: 'circle' | 'rect';
    color: string;
    localZ: number;
    radius?: number;
    width?: number;
    height?: number;
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

const MAX_FOCAL_PLANE_DISTANCE_MM = 500;

const COLORS = {
    image: '#56f0d2',
    focal: '#58b7ff',
    pupil: '#b78cff',
    stop: '#ffbd66',
    ambiguous: '#a5adba',
};

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
        label: focalLabel('Front focal', focalLength, approximate),
        confidence,
        shape: 'circle',
        color: confidence === 'defined' ? COLORS.focal : COLORS.ambiguous,
        localZ: -focalLength,
        radius: displayRadius,
    });
    landmarks.push({
        id: 'back-focal',
        label: focalLabel('Back focal', focalLength, approximate),
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
            label: 'Sensor / image',
            confidence: 'defined',
            shape: 'rect',
            color: COLORS.image,
            localZ: 0.12,
            width: component.width,
            height: component.height,
        });
        return landmarks;
    }

    if (component instanceof PMT) {
        landmarks.push({
            id: 'detector',
            label: 'Detector plane',
            confidence: 'defined',
            shape: 'rect',
            color: COLORS.image,
            localZ: 0.12,
            width: component.width,
            height: component.height,
        });
        return landmarks;
    }

    if (component instanceof QPD) {
        landmarks.push({
            id: 'detector',
            label: 'Detector plane',
            confidence: 'defined',
            shape: 'circle',
            color: COLORS.image,
            localZ: 0.12,
            radius: component.activeDiameter / 2,
        });
        return landmarks;
    }

    if (component instanceof Card) {
        landmarks.push({
            id: 'card-plane',
            label: 'Viewing plane',
            confidence: 'defined',
            shape: 'rect',
            color: COLORS.image,
            localZ: 0.08,
            width: component.width,
            height: component.height,
        });
        return landmarks;
    }

    if (component instanceof Objective) {
        const frontRadius = Math.max(1, component.getFrontRadius());
        landmarks.push({
            id: 'objective-pupil',
            label: 'Back focal / pupil',
            confidence: 'defined',
            shape: 'circle',
            color: COLORS.pupil,
            localZ: 0.08,
            radius: Math.max(1, component.pupilRadius || component.apertureRadius),
        });
        landmarks.push({
            id: 'objective-front-focal',
            label: 'Front focal',
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
            label: 'Lens / stop',
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
            label: 'Lens stop',
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
                label: 'Tube entrance stop',
                confidence: 'candidate',
                shape: 'circle',
                color: COLORS.stop,
                localZ: -halfT,
                radius: innerRadius,
            });
            landmarks.push({
                id: 'exit-stop',
                label: 'Tube exit stop',
                confidence: 'candidate',
                shape: 'circle',
                color: COLORS.stop,
                localZ: halfT,
                radius: innerRadius,
            });
        } else {
            landmarks.push({
                id: 'aperture-stop',
                label: 'Aperture stop',
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
            label: 'Slit stop',
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
            label: 'Pupil mask plane',
            confidence: 'defined',
            shape: 'circle',
            color: COLORS.pupil,
            localZ: 0,
            radius: component.radius,
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

const LandmarkPlane: React.FC<{ landmark: LocalOpticalLandmark }> = ({ landmark }) => {
    const outlineOpacity = confidenceLineOpacity(landmark.confidence);
    const fillOpacity = confidenceOpacity(landmark.confidence);

    return (
        <group position={[0, 0, landmark.localZ]}>
            {landmark.shape === 'circle' ? (
                <>
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
                </>
            ) : (
                <>
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
                </>
            )}
        </group>
    );
};

const LandmarkLabel: React.FC<{ label: OpticalLandmarkLabel }> = ({ label }) => {
    const lineOpacity = confidenceLineOpacity(label.confidence);

    return (
        <group>
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
                outlineWidth={0.06}
                outlineColor="#02040a"
                renderOrder={50}
                material-depthTest={false}
                material-depthWrite={false}
            >
                {label.label}
            </Text>
        </group>
    );
};

export const OpticalPlaneVisualizer: React.FC<{ components: OpticalComponent[] }> = ({ components }) => {
    const landmarkSignature = components
        .map(component => `${component.id}:${component.version}:${component.position.x},${component.position.y},${component.position.z}:${component.rotation.x},${component.rotation.y},${component.rotation.z},${component.rotation.w}`)
        .join('|');
    const model = useMemo(() => collectOpticalLandmarks(components), [components, landmarkSignature]);

    return (
        <group>
            {model.entries.map(({ component, landmarks }) => (
                <group
                    key={`${component.id}:${component.version}`}
                    position={[component.position.x, component.position.y, component.position.z]}
                    quaternion={component.rotation.clone()}
                >
                    {landmarks.map(landmark => (
                        <LandmarkPlane key={landmark.id} landmark={landmark} />
                    ))}
                </group>
            ))}
            {model.labels.map(label => (
                <LandmarkLabel key={label.id} label={label} />
            ))}
        </group>
    );
};
