import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import { useAtom } from 'jotai';
import { Vector3, Euler } from 'three';
import { Sample } from '../physics/components/Sample';
import { SampleChamber } from '../physics/components/SampleChamber';
import { Camera as OpticCamera } from '../physics/components/Camera';
import { forwardRaysAtom, componentsAtom, cameraImageTickAtom } from '../state/store';
import { wavelengthToCSS } from '../physics/spectral';
import type { Ray } from '../physics/types';

interface SampleZoomViewerProps {
    sample: Sample | SampleChamber;
    size?: number;
}

interface MiniViewProps {
    label: string;
    cellSize: number;
    cameraPos: [number, number, number];
    upVec: [number, number, number];
    orbit?: boolean;
    sample: Sample | SampleChamber;
    mickey: { c: Vector3; r: number }[];
    segments: { points: [number, number, number][]; color: string }[];
    focus: { x: number; y: number; z: number };
}

const MICKEY_COLORS = ['#ffd0aa', '#3a2a22', '#3a2a22'];

const MiniView: React.FC<MiniViewProps> = ({
    label,
    cellSize,
    cameraPos,
    upVec,
    orbit,
    sample,
    mickey,
    segments,
    focus,
}) => {
    const sampleQuat = sample.rotation.clone();
    const specimenRot = sample instanceof Sample
        ? [sample.specimenRotation.x, sample.specimenRotation.y, sample.specimenRotation.z] as [number, number, number]
        : [0, 0, 0] as [number, number, number];
    const specimenOffset = sample instanceof Sample
        ? [sample.specimenOffset.x, sample.specimenOffset.y, sample.specimenOffset.z] as [number, number, number]
        : [0, 0, 0] as [number, number, number];

    return (
        <div style={{ position: 'relative', width: cellSize, height: cellSize, background: '#1a1d22', borderRadius: 2 }}>
            <Canvas
                camera={{ position: cameraPos, up: upVec, fov: 35, near: 0.05, far: 200 }}
                style={{ width: '100%', height: '100%' }}
            >
                <ambientLight intensity={0.95} />
                <hemisphereLight args={['#ffffff', '#444855', 0.6]} />
                <pointLight position={[10, 10, 10]} intensity={0.7} />
                <pointLight position={[-10, -8, 10]} intensity={0.5} />
                <group position={[-focus.x, -focus.y, -focus.z]}>
                    <group
                        position={[sample.position.x, sample.position.y, sample.position.z]}
                        quaternion={sampleQuat}
                    >
                        <group position={specimenOffset} rotation={specimenRot}>
                            {mickey.map((s, i) => (
                                <mesh key={i} position={[s.c.x, s.c.y, s.c.z]} renderOrder={1}>
                                    <sphereGeometry args={[s.r, 24, 24]} />
                                    <meshStandardMaterial
                                        color={MICKEY_COLORS[i] ?? '#888'}
                                        roughness={0.45}
                                        metalness={0.05}
                                        emissive={MICKEY_COLORS[i] ?? '#888'}
                                        emissiveIntensity={0.25}
                                        transparent
                                        opacity={0.45}
                                        depthWrite={false}
                                    />
                                </mesh>
                            ))}
                        </group>
                    </group>
                    {segments.map((seg, idx) => (
                        <Line
                            key={idx}
                            points={seg.points}
                            color={seg.color}
                            lineWidth={1.2}
                            transparent
                            opacity={0.95}
                        />
                    ))}
                </group>
                {orbit && (
                    <OrbitControls
                        makeDefault
                        enablePan={false}
                        enableZoom={false}
                        enableRotate
                        target={[0, 0, 0]}
                    />
                )}
            </Canvas>
            <div
                style={{
                    position: 'absolute',
                    top: 2,
                    left: 4,
                    fontSize: 9,
                    fontWeight: 700,
                    color: '#9aaab8',
                    pointerEvents: 'none',
                    fontFamily: 'monospace',
                    letterSpacing: 0.5,
                    textShadow: '0 0 3px #000',
                }}
            >
                {label}
            </div>
        </div>
    );
};

/**
 * Pinnable mini 3D viewer that frames the sample tightly so the user can see
 * how forward / reverse rays hit and exit the specimen in real time as they
 * adjust upstream optics.  The viewer reads the same `forwardRaysAtom`
 * snapshot that drives the main scene, plus any reverse paths cached on
 * Camera components, so it stays in sync without re-tracing.
 *
 * Layout: 2×2 grid — three orthogonal axis views (X, Y, Z) and one
 * perspective 3D view in the corner.  All four cells render the same
 * geometry at the same scale so cross-checking ray paths is easy.
 */
export const SampleZoomViewer: React.FC<SampleZoomViewerProps> = ({ sample, size = 240 }) => {
    const [forwardRays] = useAtom(forwardRaysAtom);
    const [components] = useAtom(componentsAtom);
    // Reverse paths live on Camera instances and are mutated in place when
    // camera-done messages arrive (the components atom isn't reassigned), so
    // the segments memo wouldn't otherwise re-run.  cameraImageTickAtom bumps
    // on every camera-done, which gives us the trigger we need.
    const [cameraImageTick] = useAtom(cameraImageTickAtom);

    // Mickey-only inline geometry — see note in earlier turn: the full
    // SampleVisualizer paints a 40 mm holder frame and tinted glass plate that
    // would sit between the zoom-camera and the specimen at our camera
    // distances.
    const mickey = useMemo(() => {
        const scale = 2 / 3;
        const center = new Vector3(0, 0.125, 0);
        return [
            { c: new Vector3(0, 0, 0).sub(center).multiplyScalar(scale), r: 0.5 * scale },
            { c: new Vector3(-0.5, 0.5, 0).sub(center).multiplyScalar(scale), r: 0.25 * scale },
            { c: new Vector3(0.5, 0.5, 0).sub(center).multiplyScalar(scale), r: 0.25 * scale },
        ];
    }, []);

    const focus = sample.position;

    // Forward + reverse ray segments in world coords.  No AABB pre-cull — the
    // tight camera frustum drops everything off-screen.
    const segments = useMemo(() => {
        type Seg = { points: [number, number, number][]; color: string };
        const out: Seg[] = [];
        const trace = (paths: Ray[][]) => {
            for (const path of paths) {
                if (path.length === 0) continue;
                const wl = path[0].wavelength * 1e9;
                const color = wavelengthToCSS(wl);
                let prev: Vector3 | null = null;
                for (let i = 0; i < path.length; i++) {
                    const r = path[i];
                    const here = new Vector3(r.origin.x, r.origin.y, r.origin.z);
                    if (prev) {
                        out.push({ points: [[prev.x, prev.y, prev.z], [here.x, here.y, here.z]], color });
                    }
                    prev = here;
                }
                const last = path[path.length - 1];
                const lastDist = last.interactionDistance ?? 0;
                if (lastDist > 0 && prev) {
                    const tip = prev.clone().add(
                        new Vector3(last.direction.x, last.direction.y, last.direction.z).multiplyScalar(lastDist),
                    );
                    out.push({ points: [[prev.x, prev.y, prev.z], [tip.x, tip.y, tip.z]], color });
                }
            }
        };
        trace(forwardRays);
        for (const c of components) {
            if (c instanceof OpticCamera && c.solver3Paths) trace(c.solver3Paths);
        }
        return out;
    }, [forwardRays, components, focus.x, focus.y, focus.z, cameraImageTick]);

    const tickRef = useRef(0);
    useEffect(() => { tickRef.current++; }, [sample.version]);

    // Cell sizing: outer container = `size`, divided into a 2×2 grid with a
    // small gutter between cells.
    const gutter = 2;
    const cellSize = (size - gutter) / 2;
    const camDist = 2.5;

    // Camera positions for the axis-locked panes.  All look at world origin
    // (after the outer -focus translate that centres the sample).  "X axis"
    // means looking along +X (so we see the YZ plane), and so on.
    const xAxisPos: [number, number, number] = [camDist, 0, 0];
    const yAxisPos: [number, number, number] = [0, camDist, 0];
    const zAxisPos: [number, number, number] = [0, 0, camDist];

    // 3D pose: align the camera so Mickey's ears point straight up in the
    // viewport, regardless of how the preset rotates the specimen (OpenSPIM
    // sets specimenRotation to (π/2, π/2, 0); brightfield leaves it at 0).
    // Ears in local space lie along +Y, so we transform that vector through
    // both the per-specimen Euler and the sample's world quaternion to get
    // the world-space ears direction, then build a perpendicular orbit
    // position from there.
    const { persPos, persUp } = useMemo(() => {
        const earsLocal = new Vector3(0, 1, 0);
        const specRotEuler = sample instanceof Sample
            ? new Euler(sample.specimenRotation.x, sample.specimenRotation.y, sample.specimenRotation.z)
            : new Euler(0, 0, 0);
        const earsWorld = earsLocal.clone().applyEuler(specRotEuler).applyQuaternion(sample.rotation).normalize();
        // Pick an auxiliary axis not parallel to ears, build an orthonormal
        // basis (right, ears, forward).  Camera position = 3/4 angle blend of
        // right and forward, lifted slightly along the ears axis.
        const aux = Math.abs(earsWorld.x) > 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
        const right = new Vector3().crossVectors(earsWorld, aux).normalize();
        const forward = new Vector3().crossVectors(right, earsWorld).normalize();
        const pos = right.clone().multiplyScalar(camDist * 0.7)
            .add(forward.multiplyScalar(camDist * 0.7))
            .add(earsWorld.clone().multiplyScalar(camDist * 0.35));
        return {
            persPos: [pos.x, pos.y, pos.z] as [number, number, number],
            persUp: [earsWorld.x, earsWorld.y, earsWorld.z] as [number, number, number],
        };
    }, [sample, sample.version, camDist]);

    return (
        <div
            style={{
                width: size,
                height: size,
                background: '#0c0e12',
                borderRadius: 4,
                display: 'grid',
                gridTemplateColumns: `${cellSize}px ${cellSize}px`,
                gridTemplateRows: `${cellSize}px ${cellSize}px`,
                gap: `${gutter}px`,
            }}
        >
            <MiniView
                label="X"
                cellSize={cellSize}
                cameraPos={xAxisPos}
                upVec={[0, 0, 1]}
                sample={sample}
                mickey={mickey}
                segments={segments}
                focus={focus}
            />
            <MiniView
                label="Y"
                cellSize={cellSize}
                cameraPos={yAxisPos}
                upVec={[0, 0, 1]}
                sample={sample}
                mickey={mickey}
                segments={segments}
                focus={focus}
            />
            <MiniView
                label="Z"
                cellSize={cellSize}
                cameraPos={zAxisPos}
                upVec={[0, 1, 0]}
                sample={sample}
                mickey={mickey}
                segments={segments}
                focus={focus}
            />
            <MiniView
                label="3D"
                cellSize={cellSize}
                cameraPos={persPos}
                upVec={persUp}
                orbit
                sample={sample}
                mickey={mickey}
                segments={segments}
                focus={focus}
            />
        </div>
    );
};
