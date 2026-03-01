/**
 * Extracted component visualizers from OpticalTable.tsx
 * 
 * Each visualizer renders the 3D representation of an optical component.
 * Grouped here to keep OpticalTable.tsx focused on the solver/render loop.
 */
import React, { useMemo } from 'react';
import { Vector2, DoubleSide, BufferGeometry, Float32BufferAttribute, Shape, Path as ThreePath, ExtrudeGeometry } from 'three';
import { useAtom } from 'jotai';
import { selectionAtom } from '../../state/store';
import { Text } from '@react-three/drei';
import { OpticalComponent } from '../../physics/Component';
import { Mirror } from '../../physics/components/Mirror';
import { SphericalLens } from '../../physics/components/SphericalLens';
import { Laser } from '../../physics/components/Laser';
import { Blocker } from '../../physics/components/Blocker';
import { Card } from '../../physics/components/Card';
import { Sample } from '../../physics/components/Sample';
import { Objective } from '../../physics/components/Objective';
import { ObjectiveCasing } from '../../physics/components/ObjectiveCasing';
import { IdealLens } from '../../physics/components/IdealLens';
import { Camera } from '../../physics/components/Camera';
import { CylindricalLens } from '../../physics/components/CylindricalLens';
import { PrismLens } from '../../physics/components/PrismLens';
import { Waveplate } from '../../physics/components/Waveplate';
import { BeamSplitter } from '../../physics/components/BeamSplitter';
import { Aperture } from '../../physics/components/Aperture';
import { SlitAperture } from '../../physics/components/SlitAperture';
import { SampleChamber } from '../../physics/components/SampleChamber';
import { Filter } from '../../physics/components/Filter';
import { DichroicMirror } from '../../physics/components/DichroicMirror';
import { CurvedMirror } from '../../physics/components/CurvedMirror';
import { PolygonScanner } from '../../physics/components/PolygonScanner';
import { PMT } from '../../physics/components/PMT';
import { GalvoScanHead } from '../../physics/components/GalvoScanHead';
import { DualGalvoScanHead } from '../../physics/components/DualGalvoScanHead';

// ─── Shared Helpers ──────────────────────────────────────────────────

import { wavelengthToHex } from '../../physics/spectral';

/** Wall panel with a real circular hole (CSG via Shape + ExtrudeGeometry) */
const WallWithHole = ({ wallSize, holeRadius, thickness, position, rotation, color }: {
    wallSize: number;
    holeRadius: number;
    thickness: number;
    position: [number, number, number];
    rotation: [number, number, number];
    color: string;
}) => {
    const geometry = useMemo(() => {
        const hs = wallSize / 2;
        const shape = new Shape();
        shape.moveTo(-hs, -hs);
        shape.lineTo(hs, -hs);
        shape.lineTo(hs, hs);
        shape.lineTo(-hs, hs);
        shape.closePath();

        const hole = new ThreePath();
        hole.absarc(0, 0, holeRadius, 0, Math.PI * 2, false);
        shape.holes.push(hole);

        return new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    }, [wallSize, holeRadius, thickness]);

    return (
        <mesh position={position} rotation={rotation} geometry={geometry}>
            <meshStandardMaterial color={color} roughness={0.4} metalness={0.3} side={DoubleSide} transparent opacity={0.5} depthWrite={false} />
        </mesh>
    );
};

// ─── Component Visualizers ───────────────────────────────────────────

export const CasingVisualizer = ({ component }: { component: ObjectiveCasing }) => {
    const [selection] = useAtom(selectionAtom);
    const isSelected = selection.includes(component.id);
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[8, 8, 20, 32]} />
                <meshPhysicalMaterial
                    color="#ffffff"
                    transmission={0.99}
                    opacity={0.15}
                    transparent
                    depthWrite={false}
                    roughness={0}
                    metalness={0.05}
                    side={DoubleSide}
                />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -5, 0]}>
                <cylinderGeometry args={[8.2, 8.2, 5, 32]} />
                <meshStandardMaterial color="#444" metalness={0.5} roughness={0.7} />
            </mesh>
            {isSelected && (
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[8.5, 8.5, 20.5, 32]} />
                    <meshBasicMaterial color="#64ffda" transparent opacity={0.3} wireframe />
                </mesh>
            )}
        </group>
    );
};

export const SampleVisualizer = ({ component }: { component: Sample }) => {
    const outerSize = 40;
    const innerSize = 30;
    const thickness = 2;
    const frameWidth = (outerSize - innerSize) / 2;
    const offset = outerSize / 2 - frameWidth / 2;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <group>
                <group>
                    <mesh position={[0, offset, 0]}>
                        <boxGeometry args={[outerSize, frameWidth, thickness]} />
                        <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
                    </mesh>
                    <mesh position={[0, -offset, 0]}>
                        <boxGeometry args={[outerSize, frameWidth, thickness]} />
                        <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
                    </mesh>
                    <mesh position={[-offset, 0, 0]}>
                        <boxGeometry args={[frameWidth, innerSize, thickness]} />
                        <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
                    </mesh>
                    <mesh position={[offset, 0, 0]}>
                        <boxGeometry args={[frameWidth, innerSize, thickness]} />
                        <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
                    </mesh>
                </group>
                <mesh position={[0, 0, 0]}>
                    <boxGeometry args={[innerSize, innerSize, 0.5]} />
                    <meshPhysicalMaterial
                        color="#ffffff"
                        transmission={0.99}
                        opacity={0.1}
                        transparent
                        roughness={0}
                        metalness={0.0}
                        depthWrite={false}
                    />
                </mesh>
            </group>
            <group position={[component.specimenOffset.x, component.specimenOffset.y, component.specimenOffset.z]} rotation={[component.specimenRotation.x, component.specimenRotation.y, component.specimenRotation.z]}>
                <mesh position={[0, 0, 0]}>
                    <sphereGeometry args={[0.5, 32, 32]} />
                    <meshStandardMaterial color="#ffccaa" roughness={0.3} />
                </mesh>
                <mesh position={[-0.5, 0.5, 0]}>
                    <sphereGeometry args={[0.25, 32, 32]} />
                    <meshStandardMaterial color="black" roughness={0.3} />
                </mesh>
                <mesh position={[0.5, 0.5, 0]}>
                    <sphereGeometry args={[0.25, 32, 32]} />
                    <meshStandardMaterial color="black" roughness={0.3} />
                </mesh>
            </group>
        </group>
    );
};

export const ObjectiveVisualizer = ({ component }: { component: Objective }) => {
    const [selection] = useAtom(selectionAtom);
    const isSelected = selection.includes(component.id);

    const f = component.focalLength;
    const a = component.apertureRadius;
    const wd = component.workingDistance;
    const bodyR = Math.max(a + 1, component.diameter / 2);

    const parfocalDistance = 35;
    const zFront = -f + wd;
    const zBack = Math.max(-f + parfocalDistance, zFront + 20);
    const zTaperEnd = zFront + Math.min(15, (zBack - zFront) * 0.6);

    const immersionIdx = component.immersionIndex || 1;
    const maxSin = component.NA / immersionIdx;
    const maxTan = maxSin / Math.sqrt(1 - maxSin * maxSin);
    const opticalFrontRadius = wd * maxTan;
    const frontRadius = Math.max(opticalFrontRadius + 0.5, 2);
    const barrelLength = zBack - zFront;

    const getObjectiveBandColor = (mag: number) => {
        if (mag <= 4) return '#ff0000';
        if (mag <= 10) return '#ffd700';
        if (mag <= 20) return '#00ff00';
        if (mag <= 40) return '#00bfff';
        if (mag <= 60) return '#0000ff';
        return '#ffffff';
    };

    const lathePoints = React.useMemo(() => {
        const pts = [];
        pts.push(new Vector2(opticalFrontRadius, zFront));
        pts.push(new Vector2(frontRadius, zFront));
        if (zTaperEnd > zFront) pts.push(new Vector2(bodyR, zTaperEnd));
        if (zBack > zTaperEnd) pts.push(new Vector2(bodyR, zBack));
        pts.push(new Vector2(a, zBack));
        if (zBack > 0 && zFront < 0) pts.push(new Vector2(a, 0));
        pts.push(new Vector2(opticalFrontRadius, zFront));
        return pts;
    }, [opticalFrontRadius, zFront, frontRadius, bodyR, zTaperEnd, zBack, a]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={1}>
                <cylinderGeometry args={[a, a, 0.5, 32]} />
                <meshBasicMaterial color="#b388ff" transparent opacity={0.3} side={DoubleSide} depthWrite={false}/>
            </mesh>
            <mesh position={[0, 0, (zFront + 0.01) / 2]} rotation={[Math.PI / 2, 0, 0]} renderOrder={1}>
                <cylinderGeometry args={[a, opticalFrontRadius, Math.abs(zFront - 0.01), 32, 1, true]} />
                <meshStandardMaterial color="#88ccff" transparent opacity={0.15} depthWrite={false} roughness={0.1} side={DoubleSide} />
            </mesh>
            {wd > 0.1 && (
                <mesh position={[0, 0, (-f + zFront) / 2]} rotation={[Math.PI / 2, 0, 0]} renderOrder={1}>
                    <cylinderGeometry args={[frontRadius, 0.1, wd, 32]} />
                    <meshBasicMaterial color="#00ffcc" transparent opacity={0.15} wireframe={false} depthWrite={false} />
                </mesh>
            )}
            <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
                <latheGeometry args={[lathePoints, 32]} />
                <meshStandardMaterial color="#222222" roughness={0.8} metalness={0.2} side={DoubleSide} transparent opacity={0.5} depthWrite={false} />
            </mesh>
            <mesh position={[0, 0, zTaperEnd + 2]} rotation={[Math.PI / 2, 0, 0]} renderOrder={3}>
                <cylinderGeometry args={[bodyR + 0.1, bodyR + 0.1, 3, 32, 1, true]} />
                <meshStandardMaterial color={getObjectiveBandColor(component.magnification)} transparent opacity={0.8} depthWrite={false} roughness={0.3} side={DoubleSide} />
            </mesh>
            <mesh position={[0, 0, (zFront + zBack) / 2]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[bodyR * 1.5, bodyR * 1.5, barrelLength + 10, 8]} />
                <meshBasicMaterial transparent opacity={0} side={DoubleSide} depthWrite={false} colorWrite={false} />
            </mesh>
            {isSelected && (
                <mesh position={[0, 0, (zFront + zBack) / 2]} rotation={[Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[bodyR * 1.15, bodyR * 1.15, barrelLength + 2, 32]} />
                    <meshBasicMaterial color="#b388ff" transparent opacity={0.3} wireframe />
                </mesh>
            )}
        </group>
    );
};

export const CameraVisualizer = ({ component }: { component: Camera }) => {
    const width = 84;
    const height = 84;
    const depth = 122;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[0, 0, -depth / 2]}>
                <boxGeometry args={[width, height, depth]} />
                <meshStandardMaterial color="#333" metalness={0.6} roughness={0.4} />
            </mesh>
            <mesh position={[0, 0, 0.1]}>
                <planeGeometry args={[component.width, component.height]} />
                <meshStandardMaterial color="rgba(104, 65, 131, 1)" metalness={0.9} roughness={0.1} />
            </mesh>
            <Text
                position={[0, height / 2 + 0.1, -depth/4]}
                rotation={[-Math.PI / 2, 0, 0]}
                fontSize={16}
                color="#ffffff"
                anchorX="center"
                anchorY="top"
            >
                Camera
            </Text>
        </group>
    );
};

export const PMTVisualizer = ({ component }: { component: PMT }) => {
    const width = 20;
    const height = 20;
    const depth = 30;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[0, 0, 0]}>
                <boxGeometry args={[width, height, depth]} />
                <meshStandardMaterial color="#555" metalness={0.5} roughness={0.5} />
            </mesh>
            <mesh position={[0, 0, depth / 2 + 0.1]}>
                <circleGeometry args={[width * 0.3, 32]} />
                <meshStandardMaterial color="rgba(134, 45, 175, 1)" metalness={0.8} roughness={0.15} />
            </mesh>
        </group>
    );
};

export const MirrorVisualizer = ({ component }: { component: Mirror }) => {
    const radius = component.diameter / 2;
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[radius, radius, component.thickness, 32]} />
                <meshPhysicalMaterial
                    color="#ffffff"
                    metalness={0.95}
                    roughness={0.05}
                    clearcoat={1.0}
                    clearcoatRoughness={0.05}
                />
            </mesh>
        </group>
    );
};

export const GalvoScanHeadVisualizer = ({ component }: { component: GalvoScanHead }) => {
    const radius = component.diameter / 2;
    const boxW = component.diameter * 0.8;
    const boxD = component.thickness * 1.5;
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {/* Dark housing body */}
            <mesh>
                <boxGeometry args={[boxW, boxW, boxD]} />
                <meshStandardMaterial color="#111118" roughness={0.7} metalness={0.3} transparent opacity={0.7} />
            </mesh>
            {/* Reflective pivot mirror at z=0 (matches physics intersect plane) */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[radius * 0.85, radius * 0.85, 0.3, 32]} />
                <meshPhysicalMaterial color="#c0d8ff" metalness={0.95} roughness={0.03} clearcoat={1.0} />
            </mesh>
            {/* X-scan axis indicator (red bar) */}
            <mesh position={[0, radius * 0.6, boxD * 0.35]}>
                <boxGeometry args={[radius * 0.8, 0.5, 0.5]} />
                <meshStandardMaterial color="#ff4444" emissive="#661111" />
            </mesh>
            {/* Y-scan axis indicator (blue bar) */}
            <mesh position={[0, -radius * 0.6, -boxD * 0.35]}>
                <boxGeometry args={[0.5, radius * 0.8, 0.5]} />
                <meshStandardMaterial color="#4488ff" emissive="#112266" />
            </mesh>
        </group>
    );
};

export const DualGalvoScanHeadVisualizer = ({ component }: { component: DualGalvoScanHead }) => {
    const radius = component.mirrorDiameter / 2;
    const halfS = component.mirrorSpacing / 2;
    const housingW = component.mirrorSpacing + component.mirrorDiameter;
    const housingH = component.mirrorDiameter * 1.2;
    const housingD = component.mirrorDiameter * 1.2;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            {/* Shared housing */}
            <mesh>
                <boxGeometry args={[housingW, housingH, housingD]} />
                <meshStandardMaterial color="#111" metalness={0.4} roughness={0.8} transparent opacity={0.6} />
            </mesh>

            {/* Mirror 1 (X) */}
            <group position={[-halfS, 0, 0]} rotation={[0, 0, component.scanX]}>
                <mesh rotation={[0, 0, -Math.PI/4]}>
                    <cylinderGeometry args={[radius, radius, 1, 32]} />
                    <meshPhysicalMaterial color="#fff" metalness={1} roughness={0.05} />
                </mesh>
                <mesh position={[0, radius + 2, 0]}>
                    <boxGeometry args={[0.5, 4, 0.5]} />
                    <meshBasicMaterial color="red" />
                </mesh>
            </group>

            {/* Mirror 2 (Y) */}
            <group position={[halfS, 0, 0]} rotation={[0, component.scanY, 0]}>
                <mesh rotation={[0, 0, Math.PI/4]}>
                    <cylinderGeometry args={[radius, radius, 1, 32]} />
                    <meshPhysicalMaterial color="#fff" metalness={1} roughness={0.05} />
                </mesh>
                <mesh position={[0, radius + 2, 0]}>
                    <boxGeometry args={[4, 0.5, 0.5]} />
                    <meshBasicMaterial color="blue" />
                </mesh>
            </group>
        </group>
    );
};

export const PolygonScannerVisualizer = ({ component }: { component: PolygonScanner }) => {
    const N = component.numFaces;
    const R = component.circumRadius;

    const shape = useMemo(() => {
        const s = new Shape();
        for (let k = 0; k <= N; k++) {
            const angle = component.scanAngle + k * (2 * Math.PI / N);
            const x = R * Math.cos(angle);
            const y = R * Math.sin(angle);
            if (k === 0) s.moveTo(x, y);
            else s.lineTo(x, y);
        }
        return s;
    }, [N, R, component.scanAngle]);

    const outlineVerts = useMemo(() => {
        const verts: number[] = [];
        for (let k = 0; k <= N; k++) {
            const angle = component.scanAngle + k * (2 * Math.PI / N);
            verts.push(R * Math.cos(angle), R * Math.sin(angle), 0);
        }
        return new Float32Array(verts);
    }, [N, R, component.scanAngle]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[0, 0, -component.faceHeight / 2]}>
                <extrudeGeometry args={[shape, { depth: component.faceHeight, bevelEnabled: false }]} />
                <meshPhysicalMaterial
                    color="#c0c0c0"
                    metalness={0.9}
                    roughness={0.1}
                    clearcoat={1.0}
                    clearcoatRoughness={0.05}
                />
            </mesh>
            <line>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[outlineVerts, 3]} />
                </bufferGeometry>
                <lineBasicMaterial color="#888" linewidth={2} />
            </line>
        </group>
    );
};

export const CurvedMirrorVisualizer = ({ component }: { component: CurvedMirror }) => {
    const geom = useMemo(() => component.buildGeometry(), [component.diameter, component.radiusOfCurvature, component.thickness, component.version]);
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh geometry={geom} renderOrder={-1}>
                <meshPhysicalMaterial
                    color="#ffffff"
                    metalness={0.95}
                    roughness={0.05}
                    clearcoat={1.0}
                    clearcoatRoughness={0.05}
                    side={DoubleSide}
                />
            </mesh>
        </group>
    );
};

export const BeamSplitterVisualizer = ({ component }: { component: BeamSplitter }) => {
    const radius = component.diameter / 2;
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[radius, radius, component.thickness, 32]} />
                <meshPhysicalMaterial
                    color="#88ccff"
                    metalness={0.3}
                    roughness={0.1}
                    transparent={true}
                    opacity={0.6}
                    clearcoat={1.0}
                    clearcoatRoughness={0.05}
                />
            </mesh>
        </group>
    );
};

export const ApertureVisualizer = ({ component }: { component: Aperture }) => {
    const outerR = component.housingDiameter / 2;
    const innerR = component.openingDiameter / 2;
    const halfT = 0.5;

    const points = useMemo(() => [
        new Vector2(innerR, -halfT),
        new Vector2(outerR, -halfT),
        new Vector2(outerR,  halfT),
        new Vector2(innerR,  halfT),
    ], [innerR, outerR, halfT]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <latheGeometry args={[points, 48]} />
                <meshStandardMaterial color="#333" roughness={0.6} metalness={0.4} />
            </mesh>
        </group>
    );
};

export const SlitApertureVisualizer = ({ component }: { component: SlitAperture }) => {
    const outerR = component.housingDiameter / 2;
    const halfW = component.slitWidth / 2;
    const halfH = component.slitHeight / 2;
    const halfT = 0.5;

    const topBarHeight = outerR - halfH;
    const bottomBarHeight = outerR - halfH;
    const sideBarWidth = outerR - halfW;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <group rotation={[0, Math.PI / 2, 0]}>
            {topBarHeight > 0.1 && (
                <mesh position={[0, 0, halfH + topBarHeight / 2]}>
                    <boxGeometry args={[halfT * 2, outerR * 2, topBarHeight]} />
                    <meshStandardMaterial color="#444" roughness={0.5} metalness={0.5} />
                </mesh>
            )}
            {bottomBarHeight > 0.1 && (
                <mesh position={[0, 0, -(halfH + bottomBarHeight / 2)]}>
                    <boxGeometry args={[halfT * 2, outerR * 2, bottomBarHeight]} />
                    <meshStandardMaterial color="#444" roughness={0.5} metalness={0.5} />
                </mesh>
            )}
            {sideBarWidth > 0.1 && (
                <mesh position={[0, -(halfW + sideBarWidth / 2), 0]}>
                    <boxGeometry args={[halfT * 2, sideBarWidth, halfH * 2]} />
                    <meshStandardMaterial color="#444" roughness={0.5} metalness={0.5} />
                </mesh>
            )}
            {sideBarWidth > 0.1 && (
                <mesh position={[0, halfW + sideBarWidth / 2, 0]}>
                    <boxGeometry args={[halfT * 2, sideBarWidth, halfH * 2]} />
                    <meshStandardMaterial color="#444" roughness={0.5} metalness={0.5} />
                </mesh>
            )}
            </group>
        </group>
    );
};

export const FilterVisualizer = ({ component }: { component: Filter }) => {
    const radius = component.diameter / 2;
    const dominantNm = component.spectralProfile.getDominantPassWavelength();
    const tintColor = dominantNm ? wavelengthToHex(dominantNm) : '#888888';
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[radius, radius, component.thickness, 32]} />
                <meshPhysicalMaterial
                    color={tintColor}
                    metalness={0.1}
                    roughness={0.1}
                    transparent={true}
                    opacity={0.5}
                    clearcoat={1.0}
                    clearcoatRoughness={0.05}
                />
            </mesh>
        </group>
    );
};

export const DichroicVisualizer = ({ component }: { component: DichroicMirror }) => {
    const radius = component.diameter / 2;
    const dominantNm = component.spectralProfile.getDominantPassWavelength();
    const tintColor = dominantNm ? wavelengthToHex(dominantNm) : '#88ccff';
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[radius, radius, component.thickness, 32]} />
                <meshPhysicalMaterial
                    color={tintColor}
                    metalness={0.4}
                    roughness={0.05}
                    transparent={true}
                    opacity={0.55}
                    clearcoat={1.0}
                    clearcoatRoughness={0.02}
                />
            </mesh>
        </group>
    );
};

export const BlockerVisualizer = ({ component }: { component: Blocker }) => {
    const radius = component.diameter / 2;
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[radius, radius, component.thickness, 32]} />
                <meshStandardMaterial color="#222" roughness={0.8} />
            </mesh>
        </group>
    );
};

export const SampleChamberVisualizer = ({ component }: { component: SampleChamber }) => {
    const s = component.cubeSize;
    const wt = component.wallThickness;
    const boreR = component.boreDiameter / 2;
    const half = s / 2;
    const bodyColor = '#778899';

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[0, 0, -half]}>
                <boxGeometry args={[s, s, wt]} />
                <meshStandardMaterial color="#1a1a1a" roughness={0.8} metalness={0.1} />
            </mesh>
            <WallWithHole wallSize={s} holeRadius={boreR} thickness={wt} position={[half - wt, 0, 0]} rotation={[0, Math.PI / 2, 0]} color={bodyColor} />
            <WallWithHole wallSize={s} holeRadius={boreR} thickness={wt} position={[-half + wt, 0, 0]} rotation={[0, -Math.PI / 2, 0]} color={bodyColor} />
            <WallWithHole wallSize={s} holeRadius={boreR} thickness={wt} position={[0, half - wt, 0]} rotation={[-Math.PI / 2, 0, 0]} color={bodyColor} />
            <WallWithHole wallSize={s} holeRadius={boreR} thickness={wt} position={[0, -half + wt, 0]} rotation={[Math.PI / 2, 0, 0]} color={bodyColor} />
            <group position={[component.specimenOffset.x, component.specimenOffset.y, component.specimenOffset.z]} rotation={[component.specimenRotation.x, component.specimenRotation.y, component.specimenRotation.z]}>
                <mesh position={[0, 0, 0]}>
                    <sphereGeometry args={[0.5, 24, 24]} />
                    <meshStandardMaterial color="#ffccaa" roughness={0.6} />
                </mesh>
                <mesh position={[-0.5, 0.5, 0]}>
                    <sphereGeometry args={[0.25, 16, 16]} />
                    <meshStandardMaterial color="#3a3a3a" roughness={0.6} />
                </mesh>
                <mesh position={[0.5, 0.5, 0]}>
                    <sphereGeometry args={[0.25, 16, 16]} />
                    <meshStandardMaterial color="#3a3a3a" roughness={0.6} />
                </mesh>
            </group>
        </group>
    );
};

export const WaveplateVisualizer = ({ component }: { component: Waveplate }) => {
    const r = component.apertureRadius;
    const modeColors: Record<string, string> = {
        'half': '#6a5acd',
        'quarter': '#20b2aa',
        'polarizer': '#b8860b'
    };
    const color = modeColors[component.waveplateMode] || '#888';
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[r, r, 1.5, 32]} />
                <meshStandardMaterial color={color} transparent opacity={0.7} roughness={0.3} />
            </mesh>
            <mesh rotation={[0, Math.PI / 2, component.fastAxisAngle]}>
                <ringGeometry args={[r * 0.75, r * 1.1, 12, 1, Math.PI / 2 - Math.PI / 6, Math.PI / 3]} />
                <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.6} side={DoubleSide} />
            </mesh>
            <mesh rotation={[0, Math.PI / 2, component.fastAxisAngle]}>
                <ringGeometry args={[r * 0.75, r * 1.1, 12, 1, -Math.PI / 2 - Math.PI / 6, Math.PI / 3]} />
                <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.6} side={DoubleSide} />
            </mesh>
        </group>
    );
};

export const CardVisualizer = ({ component }: { component: Card }) => {
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh>
                <boxGeometry args={[component.width, component.height, 1]} />
                <meshStandardMaterial color="white" roughness={0.5} emissive="white" emissiveIntensity={0.1} />
            </mesh>
            <mesh>
                <boxGeometry args={[component.width, component.height, 10]} />
                <meshBasicMaterial transparent opacity={0} side={DoubleSide} depthWrite={false} />
            </mesh>
        </group>
    );
};

export const LensVisualizer = ({ component }: { component: SphericalLens }) => {
    const [selection] = useAtom(selectionAtom);
    const isSelected = selection.includes(component.id);

    if (!component || !component.rotation || !component.position) return null;

    const aperture = component.apertureRadius || 10;
    const thickness = component.thickness || 2;

    let R1 = 1e9;
    let R2 = -1e9;

    try {
        if (typeof component.getRadii === 'function') {
            const r = component.getRadii();
            R1 = (!isNaN(r.R1) && Math.abs(r.R1) < 1e12) ? r.R1 : (r.R1 > 0 ? 1e9 : -1e9);
            R2 = (!isNaN(r.R2) && Math.abs(r.R2) < 1e12) ? r.R2 : (r.R2 > 0 ? 1e9 : -1e9);
        } else {
            const power = component.curvature || 0;
            const ior = component.ior || 1.5;
            const R = Math.abs(power) > 1e-6 ? (2 * (ior - 1)) / power : 1e9;
            R1 = R;
            R2 = -R;
        }
    } catch (e) {
        console.warn("LensVisualizer: Error getting radii", e);
    }

    const profilePoints = useMemo(() => {
        const profile = SphericalLens.generateProfile(R1, R2, aperture, thickness, 32);
        if (profile.length < 2) {
            const frontApex = -thickness / 2;
            const backApex = thickness / 2;
            return [new Vector2(0, frontApex), new Vector2(aperture, frontApex), new Vector2(aperture, backApex), new Vector2(0, backApex)];
        }
        return profile;
    }, [aperture, thickness, R1, R2]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <latheGeometry args={[profilePoints, 32]} />
                <meshPhysicalMaterial
                    color={component.ior > 1.55 ? "#88ffee" : "#aaddff"}
                    transmission={isSelected ? 0.85 : 0.95}
                    opacity={isSelected ? 0.6 : 0.4}
                    transparent
                    roughness={0}
                    metalness={0}
                    ior={component.ior || 1.5}
                    side={DoubleSide}
                    depthWrite={false}
                    emissive={isSelected ? "#64ffda" : "#000000"}
                    emissiveIntensity={isSelected ? 0.15 : 0}
                />
            </mesh>
        </group>
    );
};

export const SourceVisualizer = ({ component }: { component: OpticalComponent }) => {
    const isLaser = component instanceof Laser || component.constructor.name === 'Laser';
    let beamColor = "#222";
    if (isLaser) {
        const wl = (component as Laser).wavelength;
        if (wl < 430) beamColor = "#8a2be2";
        else if (wl < 490) beamColor = "#00bfff";
        else if (wl < 550) beamColor = "#00ff00";
        else if (wl < 590) beamColor = "#ffd700";
        else if (wl < 630) beamColor = "#ff8c00";
        else beamColor = "#ff0000";
    }

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[0, 0, -33]}>
                <boxGeometry args={[38, 40, 70]} />
                <meshStandardMaterial color="#222" metalness={0.5} roughness={0.5} />
            </mesh>
            {isLaser && (
                <mesh position={[0, 20.1, -40]} rotation={[-Math.PI / 2, 0, 0]}>
                    <planeGeometry args={[20, 38]} />
                    <meshBasicMaterial color={beamColor} />
                </mesh>
            )}
            <mesh position={[0, 0, 2]} rotation={[-Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[10, 5, 2, 16]} />
                <meshStandardMaterial color="#666" />
            </mesh>
        </group>
    );
};

export const LampVisualizer = ({ component }: { component: OpticalComponent }) => {
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh position={[0, 0, -8.5]}>
                <boxGeometry args={[30, 22, 23]} />
                <meshStandardMaterial color="#2a2520" metalness={0.3} roughness={0.7} />
            </mesh>
            <mesh position={[0, 0, 3]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[5, 5, 2, 16]} />
                <meshStandardMaterial color="#BBB" />
            </mesh>
        </group>
    );
};

export const IdealLensVisualizer = ({ component }: { component: IdealLens }) => {
    const a = component.apertureRadius;
    const converging = component.focalLength > 0;
    const color = converging ? '#64ffda' : '#ff6b9d';

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={[component.rotation.x, component.rotation.y, component.rotation.z, component.rotation.w]}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[a, a, 0.5, 32]} />
                <meshStandardMaterial
                    color={color}
                    transparent
                    opacity={0.4}
                    roughness={0.2}
                    metalness={0.1}
                    side={DoubleSide}
                    depthWrite={false}
                />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[a, a, 4, 32]} />
                <meshBasicMaterial transparent opacity={0} side={DoubleSide} />
            </mesh>
        </group>
    );
};

export const CylindricalLensVisualizer = ({ component }: { component: CylindricalLens }) => {
    if (!component || !component.rotation || !component.position) return null;

    const geometry = useMemo(() => {
        const segsY = 24;
        const segsX = 2;
        const halfW = component.width / 2;
        const R1 = component.r1;
        const R2 = component.r2;
        const thickness = component.thickness;
        const maxY = component.apertureRadius;

        const sagFront = (y: number) => {
            const frontApex = -thickness / 2;
            if (Math.abs(R1) > 1e8) return frontApex;
            const val = R1 * R1 - y * y;
            if (val < 0) return frontApex;
            return (frontApex + R1) - (R1 > 0 ? 1 : -1) * Math.sqrt(val);
        };
        const sagBack = (y: number) => {
            const backApex = thickness / 2;
            if (Math.abs(R2) > 1e8) return backApex;
            const val = R2 * R2 - y * y;
            if (val < 0) return backApex;
            return (backApex + R2) - (R2 > 0 ? 1 : -1) * Math.sqrt(val);
        };

        const positions: number[] = [];
        const indices: number[] = [];
        const yCount = segsY + 1;

        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (component.width * xi) / segsX;
            for (let yi = 0; yi <= segsY; yi++) {
                const y = -maxY + (2 * maxY * yi) / segsY;
                positions.push(x, y, sagFront(Math.abs(y)));
            }
        }
        const backOff = (segsX + 1) * yCount;
        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (component.width * xi) / segsX;
            for (let yi = 0; yi <= segsY; yi++) {
                const y = -maxY + (2 * maxY * yi) / segsY;
                positions.push(x, y, sagBack(Math.abs(y)));
            }
        }

        for (let xi = 0; xi < segsX; xi++) {
            for (let yi = 0; yi < segsY; yi++) {
                const a = xi * yCount + yi;
                const b = (xi + 1) * yCount + yi;
                const c = (xi + 1) * yCount + (yi + 1);
                const d = xi * yCount + (yi + 1);
                indices.push(a, b, c, a, c, d);
            }
        }
        for (let xi = 0; xi < segsX; xi++) {
            for (let yi = 0; yi < segsY; yi++) {
                const a = backOff + xi * yCount + yi;
                const b = backOff + (xi + 1) * yCount + yi;
                const c = backOff + (xi + 1) * yCount + (yi + 1);
                const d = backOff + xi * yCount + (yi + 1);
                indices.push(a, c, b, a, d, c);
            }
        }

        const topOff = positions.length / 3;
        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (component.width * xi) / segsX;
            positions.push(x, maxY, sagFront(maxY));
            positions.push(x, maxY, sagBack(maxY));
        }
        for (let xi = 0; xi < segsX; xi++) {
            const a = topOff + xi * 2, b = topOff + (xi + 1) * 2;
            const c = topOff + (xi + 1) * 2 + 1, d = topOff + xi * 2 + 1;
            indices.push(a, b, c, a, c, d);
        }
        const botOff = positions.length / 3;
        for (let xi = 0; xi <= segsX; xi++) {
            const x = -halfW + (component.width * xi) / segsX;
            positions.push(x, -maxY, sagFront(maxY));
            positions.push(x, -maxY, sagBack(maxY));
        }
        for (let xi = 0; xi < segsX; xi++) {
            const a = botOff + xi * 2, b = botOff + (xi + 1) * 2;
            const c = botOff + (xi + 1) * 2 + 1, d = botOff + xi * 2 + 1;
            indices.push(a, c, b, a, d, c);
        }
        const leftOff = positions.length / 3;
        for (let yi = 0; yi <= segsY; yi++) {
            const y = -maxY + (2 * maxY * yi) / segsY;
            positions.push(-halfW, y, sagFront(Math.abs(y)));
            positions.push(-halfW, y, sagBack(Math.abs(y)));
        }
        for (let yi = 0; yi < segsY; yi++) {
            const a = leftOff + yi * 2, b = leftOff + (yi + 1) * 2;
            const c = leftOff + (yi + 1) * 2 + 1, d = leftOff + yi * 2 + 1;
            indices.push(a, c, b, a, d, c);
        }
        const rightOff = positions.length / 3;
        for (let yi = 0; yi <= segsY; yi++) {
            const y = -maxY + (2 * maxY * yi) / segsY;
            positions.push(halfW, y, sagFront(Math.abs(y)));
            positions.push(halfW, y, sagBack(Math.abs(y)));
        }
        for (let yi = 0; yi < segsY; yi++) {
            const a = rightOff + yi * 2, b = rightOff + (yi + 1) * 2;
            const c = rightOff + (yi + 1) * 2 + 1, d = rightOff + yi * 2 + 1;
            indices.push(a, b, c, a, c, d);
        }

        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        return geo;
    }, [component.r1, component.r2, component.apertureRadius, component.width, component.thickness]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh geometry={geometry}>
                <meshPhysicalMaterial
                    color="#ccffff"
                    transmission={0.99}
                    opacity={0.6}
                    transparent
                    roughness={0}
                    side={2}
                    depthWrite={false}
                />
            </mesh>
        </group>
    );
};

export const PrismVisualizer = ({ component }: { component: PrismLens }) => {
    if (!component || !component.rotation || !component.position) return null;

    const halfAngle = component.apexAngle / 2;
    const baseHalfWidth = component.height * Math.tan(halfAngle);
    const centroidY = component.height / 3;
    const halfW = component.width / 2;

    const geometry = useMemo(() => {
        const ay = component.height - centroidY, az = 0;
        const bly = -centroidY, blz = -baseHalfWidth;
        const bry = -centroidY, brz = baseHalfWidth;
        const positions = [
            -halfW, ay, az, -halfW, bly, blz, -halfW, bry, brz,
            halfW, ay, az, halfW, bly, blz, halfW, bry, brz,
            -halfW, ay, az, halfW, ay, az, -halfW, bly, blz, halfW, bly, blz,
            -halfW, ay, az, halfW, ay, az, -halfW, bry, brz, halfW, bry, brz,
            -halfW, bly, blz, halfW, bly, blz, -halfW, bry, brz, halfW, bry, brz,
        ];
        const indices = [0, 2, 1, 3, 4, 5, 6, 8, 7, 7, 8, 9, 10, 11, 12, 11, 13, 12, 14, 15, 16, 15, 17, 16];

        const frontDy = bly - ay, frontDz = blz - az;
        const frontLen = Math.sqrt(frontDy * frontDy + frontDz * frontDz);
        const fnY = -frontDz / frontLen, fnZ = frontDy / frontLen;

        const backDy = bry - ay, backDz = brz - az;
        const backLen = Math.sqrt(backDy * backDy + backDz * backDz);
        const bnY = backDz / backLen, bnZ = -backDy / backLen;

        const normals = [
            -1, 0, 0, -1, 0, 0, -1, 0, 0,
            1, 0, 0, 1, 0, 0, 1, 0, 0,
            0, fnY, fnZ, 0, fnY, fnZ, 0, fnY, fnZ, 0, fnY, fnZ,
            0, bnY, bnZ, 0, bnY, bnZ, 0, bnY, bnZ, 0, bnY, bnZ,
            0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
        ];

        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
        geo.setIndex(indices);
        return geo;
    }, [component.apexAngle, component.height, component.width]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh geometry={geometry}>
                <meshPhysicalMaterial
                    color="#ccffff"
                    transmission={0.99}
                    opacity={0.6}
                    transparent
                    roughness={0}
                    side={2}
                    depthWrite={false}
                />
            </mesh>
        </group>
    );
};
