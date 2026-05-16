import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import { useAtomValue, useStore } from 'jotai';
import { Vector3, Euler } from 'three';
import { defaultColloidColor, Sample } from '../physics/components/Sample';
import { SampleChamber } from '../physics/components/SampleChamber';
import { Camera as OpticCamera } from '../physics/components/Camera';
import { TrappedBead } from '../physics/components/TrappedBead';
import { cameraImageTickAtom, componentsAtom, forwardRaysAtom, forwardRaysRevisionAtom } from '../state/store';
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
    specimenSpheres: RenderSphere[];
    flowCell: FlowCellRender | null;
    trapBeads: RenderSphere[];
    segments: { points: [number, number, number][]; color: string }[];
    focus: { x: number; y: number; z: number };
}

interface RenderSphere {
    id?: string;
    c: Vector3;
    r: number;
    color: string;
    opacity?: number;
    emissive?: string;
    emissiveIntensity?: number;
    glowRadius?: number;
    glowColor?: string;
    trapCaptureRadius?: number;
    trapAxialCaptureRange?: number;
}

interface FlowCellRender {
    width: number;
    height: number;
    depth: number;
    glassThickness: number;
}

const MICKEY_COLORS = ['#ffd0aa', '#3a2a22', '#3a2a22'];
function colloidColor(index: number, fallback?: string): string {
    return fallback && fallback !== '#007fff'
        ? fallback
        : defaultColloidColor(index);
}

const MiniView: React.FC<MiniViewProps> = ({
    label,
    cellSize,
    cameraPos,
    upVec,
    orbit,
    sample,
    specimenSpheres,
    flowCell,
    trapBeads,
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
                dpr={[1, 1.5]}
                gl={{ antialias: true, powerPreference: 'low-power' }}
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
                        {flowCell && (
                            <>
                                <mesh>
                                    <boxGeometry args={[flowCell.width, flowCell.height, flowCell.depth]} />
                                    <meshPhysicalMaterial
                                        color="#7fd8ff"
                                        transmission={0.85}
                                        transparent
                                        opacity={0.16}
                                        roughness={0.05}
                                        depthWrite={false}
                                    />
                                </mesh>
                                <mesh position={[0, 0, -flowCell.depth / 2 - flowCell.glassThickness / 2]}>
                                    <boxGeometry args={[flowCell.width, flowCell.height, flowCell.glassThickness]} />
                                    <meshPhysicalMaterial color="#d8f3ff" transmission={0.92} transparent opacity={0.24} roughness={0.02} depthWrite={false} />
                                </mesh>
                                <mesh position={[0, 0, flowCell.depth / 2 + flowCell.glassThickness / 2]}>
                                    <boxGeometry args={[flowCell.width, flowCell.height, flowCell.glassThickness]} />
                                    <meshPhysicalMaterial color="#d8f3ff" transmission={0.92} transparent opacity={0.24} roughness={0.02} depthWrite={false} />
                                </mesh>
                            </>
                        )}
                        <group position={specimenOffset} rotation={specimenRot}>
                            {specimenSpheres.map((s, i) => (
                                <group key={i} position={[s.c.x, s.c.y, s.c.z]}>
                                    {s.glowRadius && (
                                        <mesh renderOrder={1}>
                                            <sphereGeometry args={[s.glowRadius, 24, 12]} />
                                            <meshBasicMaterial
                                                color={s.glowColor ?? s.emissive ?? s.color}
                                                transparent
                                                opacity={0.22}
                                                depthWrite={false}
                                            />
                                        </mesh>
                                    )}
                                    <mesh renderOrder={2}>
                                        <sphereGeometry args={[Math.max(s.r, 0.006), 24, 18]} />
                                        <meshStandardMaterial
                                            color={s.color}
                                            roughness={0.35}
                                            metalness={0.05}
                                            emissive={s.emissive ?? s.color}
                                            emissiveIntensity={s.emissiveIntensity ?? 0.25}
                                            transparent
                                            opacity={s.opacity ?? 0.5}
                                            depthWrite={false}
                                        />
                                    </mesh>
                                </group>
                            ))}
                        </group>
                    </group>
                    {trapBeads.map((bead, i) => (
                        <group key={`trap-${i}`} position={[bead.c.x, bead.c.y, bead.c.z]}>
                            <mesh renderOrder={2}>
                                <sphereGeometry args={[bead.glowRadius ?? 0.16, 32, 16]} />
                                <meshBasicMaterial color={bead.glowColor ?? '#007fff'} transparent opacity={0.26} depthWrite={false} />
                            </mesh>
                            <mesh renderOrder={3}>
                                <sphereGeometry args={[Math.max(bead.r, 0.006), 24, 16]} />
                                <meshStandardMaterial color={bead.color} emissive={bead.emissive ?? '#007fff'} emissiveIntensity={0.65} roughness={0.2} transparent opacity={0.9} />
                            </mesh>
                        </group>
                    ))}
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

const BLUE = '#007fff';

const TrapCloseupViewer: React.FC<{
    sample: Sample;
    size: number;
    flowCell: FlowCellRender | null;
    specimenSpheres: RenderSphere[];
    trapBeads: RenderSphere[];
}> = ({ sample, size, flowCell, specimenSpheres, trapBeads }) => {
    const historyRef = useRef<Map<string, Vector3[]>>(new Map());
    const trapFocus = useMemo(() => {
        sample.updateMatrices();
        let best: (RenderSphere & { local: Vector3 }) | null = null;
        let bestDistanceSq = Infinity;
        for (const bead of trapBeads) {
            const local = bead.c.clone().applyMatrix4(sample.worldToLocal);
            const distanceSq = local.lengthSq();
            if (distanceSq < bestDistanceSq) {
                bestDistanceSq = distanceSq;
                best = { ...bead, local };
            }
        }
        return best;
    }, [sample, sample.version, trapBeads]);

    useEffect(() => {
        historyRef.current.clear();
    }, [sample.id]);

    const gutter = 2;
    const sideHeight = Math.max(36, Math.min(72, Math.round(size * 0.28)));
    const xyHeight = Math.max(1, size - sideHeight - gutter);
    const halfSpan = 0.06; // 120 um full window around the trap focus.
    const halfDepth = Math.max(0.006, flowCell?.depth ?? 0.08) / 2;
    const zSpan = Math.max(0.1, halfDepth * 1.25);
    const cx = size / 2;
    const cy = xyHeight / 2;
    const toX = (x: number) => cx + (x / halfSpan) * (size / 2);
    const toY = (y: number) => cy - (y / halfSpan) * (xyHeight / 2);
    const toSideX = (x: number) => cx + (x / halfSpan) * (size / 2);
    const toSideY = (z: number) => sideHeight / 2 - (z / zSpan) * (sideHeight / 2);
    const inXY = (p: Vector3, margin = 0) =>
        Math.abs(p.x) <= halfSpan + margin && Math.abs(p.y) <= halfSpan + margin;
    const inSide = (p: Vector3, margin = 0) =>
        Math.abs(p.x) <= halfSpan + margin && Math.abs(p.z) <= zSpan + margin;
    const visiblePassive = specimenSpheres.filter(s => inXY(s.c, s.r));
    const visibleSide = specimenSpheres.filter(s => inSide(s.c, s.r));

    useEffect(() => {
        const liveIds = new Set<string>();
        specimenSpheres.forEach((sphere, index) => {
            const id = sphere.id ?? `colloid-${index}`;
            liveIds.add(id);
            if (!inXY(sphere.c, sphere.r) && !inSide(sphere.c, sphere.r)) return;
            let history = historyRef.current.get(id);
            if (!history) {
                history = [];
                historyRef.current.set(id, history);
            }
            const p = sphere.c.clone();
            const last = history[history.length - 1];
            if (!last || last.distanceToSquared(p) > 1e-12 || history.length < 2) {
                history.push(p);
                if (history.length > 160) history.splice(0, history.length - 160);
            }
        });
        for (const id of historyRef.current.keys()) {
            if (!liveIds.has(id)) historyRef.current.delete(id);
        }
    }, [specimenSpheres, halfSpan, zSpan]);

    const trails = specimenSpheres.map((sphere, index) => {
        const id = sphere.id ?? `colloid-${index}`;
        const history = historyRef.current.get(id) ?? [];
        return {
            id,
            color: sphere.glowColor ?? sphere.color,
            xy: history
                .filter(p => inXY(p, sphere.r))
                .map(p => `${toX(p.x).toFixed(1)},${toY(p.y).toFixed(1)}`)
                .join(' '),
            side: history
                .filter(p => inSide(p, sphere.r))
                .map(p => `${toSideX(p.x).toFixed(1)},${toSideY(p.z).toFixed(1)}`)
                .join(' '),
        };
    });

    const capturePx = trapFocus?.trapCaptureRadius
        ? Math.max(4, trapFocus.trapCaptureRadius / halfSpan * (size / 2))
        : Math.max(18, Math.min(size, xyHeight) * 0.16);
    const axialCapture = trapFocus?.trapAxialCaptureRange ?? 0;
    const scaleBarMm = 0.02;
    const scaleBarPx = scaleBarMm / halfSpan * (size / 2);

    return (
        <div
            style={{
                width: size,
                height: size,
                background: '#0c0e12',
                borderRadius: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: gutter,
                overflow: 'hidden',
                color: '#c7d3df',
                fontFamily: 'inherit',
            }}
        >
            <svg width={size} height={xyHeight} viewBox={`0 0 ${size} ${xyHeight}`} style={{ background: '#171c22' }}>
                <circle cx={cx} cy={cy} r={capturePx} fill="none" stroke={BLUE} strokeOpacity="0.26" strokeWidth="1.25" strokeDasharray="4 4" />
                <line x1={cx - 8} y1={cy} x2={cx + 8} y2={cy} stroke={BLUE} strokeOpacity="0.42" strokeWidth="1" />
                <line x1={cx} y1={cy - 8} x2={cx} y2={cy + 8} stroke={BLUE} strokeOpacity="0.42" strokeWidth="1" />
                {trails.map(trail => trail.xy.length > 0 && (
                    <polyline key={`xy-trail-${trail.id}`} points={trail.xy} fill="none" stroke={trail.color} strokeOpacity="0.48" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" />
                ))}
                {visiblePassive.map((s, i) => {
                    const r = Math.max(2, s.r / halfSpan * (size / 2));
                    const color = s.glowColor ?? s.color;
                    return (
                        <g key={s.id ?? i}>
                            <circle cx={toX(s.c.x)} cy={toY(s.c.y)} r={r + 2} fill={color} opacity="0.16" />
                            <circle cx={toX(s.c.x)} cy={toY(s.c.y)} r={r} fill={s.color} opacity={s.opacity ?? 0.8} />
                            <circle cx={toX(s.c.x)} cy={toY(s.c.y)} r={r} fill="none" stroke={color} strokeOpacity="0.72" strokeWidth="0.8" />
                        </g>
                    );
                })}
                <line x1={size - scaleBarPx - 12} y1={xyHeight - 14} x2={size - 12} y2={xyHeight - 14} stroke="#c7d3df" strokeOpacity="0.85" strokeWidth="2" />
                <text x={size - 12} y={xyHeight - 18} textAnchor="end" fill="#c7d3df" opacity="0.85" fontSize="9">20 um</text>
                <text x="6" y="13" fill="#9aaab8" fontSize="9" fontWeight="700">Trap XY</text>
            </svg>
            <svg width={size} height={sideHeight} viewBox={`0 0 ${size} ${sideHeight}`} style={{ background: '#12161c' }}>
                <line x1="0" y1={toSideY(-halfDepth)} x2={size} y2={toSideY(-halfDepth)} stroke="#d8f3ff" strokeOpacity="0.3" strokeWidth="1" />
                <line x1="0" y1={toSideY(halfDepth)} x2={size} y2={toSideY(halfDepth)} stroke="#d8f3ff" strokeOpacity="0.3" strokeWidth="1" />
                {axialCapture > 0 && (
                    <>
                        <line x1="0" y1={toSideY(-axialCapture)} x2={size} y2={toSideY(-axialCapture)} stroke={BLUE} strokeOpacity="0.28" strokeWidth="1" strokeDasharray="4 4" />
                        <line x1="0" y1={toSideY(axialCapture)} x2={size} y2={toSideY(axialCapture)} stroke={BLUE} strokeOpacity="0.28" strokeWidth="1" strokeDasharray="4 4" />
                    </>
                )}
                <line x1="0" y1={toSideY(0)} x2={size} y2={toSideY(0)} stroke={BLUE} strokeOpacity="0.18" strokeWidth="1" strokeDasharray="3 4" />
                <line x1={cx} y1="0" x2={cx} y2={sideHeight} stroke={BLUE} strokeOpacity="0.18" strokeWidth="1" strokeDasharray="3 4" />
                {trails.map(trail => trail.side.length > 0 && (
                    <polyline key={`side-trail-${trail.id}`} points={trail.side} fill="none" stroke={trail.color} strokeOpacity="0.42" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                ))}
                {visibleSide.map((s, i) => {
                    const r = Math.max(1.5, s.r / halfSpan * (size / 2) * 0.55);
                    const color = s.glowColor ?? s.color;
                    return (
                        <g key={s.id ?? i}>
                            <circle cx={toSideX(s.c.x)} cy={toSideY(s.c.z)} r={r + 1.5} fill={color} opacity="0.15" />
                            <circle cx={toSideX(s.c.x)} cy={toSideY(s.c.z)} r={r} fill={s.color} opacity={s.opacity ?? 0.85} />
                        </g>
                    );
                })}
                <text x="6" y="13" fill="#9aaab8" fontSize="9" fontWeight="700">Axial gap</text>
            </svg>
        </div>
    );
};

/**
 * Pinnable mini 3D viewer that frames the sample tightly so the user can see
 * how forward / reverse rays hit and exit the specimen in real time as they
 * adjust upstream optics.  The viewer reads the same `forwardRaysAtom`
 * snapshot that drives the main scene when its lightweight revision counter
 * changes, plus any reverse paths cached on Camera components, so it stays in
 * sync without re-tracing or subscribing to full Ray[][] payloads.
 *
 * Layout: 2×2 grid — three orthogonal axis views (X, Y, Z) and one
 * perspective 3D view in the corner.  All four cells render the same
 * geometry at the same scale so cross-checking ray paths is easy.
 */
export const SampleZoomViewer: React.FC<SampleZoomViewerProps> = ({ sample, size = 240 }) => {
    const components = useAtomValue(componentsAtom);
    const forwardRaysRevision = useAtomValue(forwardRaysRevisionAtom);
    // Reverse paths live on Camera instances and are mutated in place when
    // camera-done messages arrive (the components atom isn't reassigned), so
    // the segments memo wouldn't otherwise re-run.  cameraImageTickAtom bumps
    // on every camera-done, which gives us the trigger we need.
    const cameraImageTick = useAtomValue(cameraImageTickAtom);
    const store = useStore();
    const hasTrapBeads = components.some(c => c instanceof TrappedBead);
    const [trapViewerTick, setTrapViewerTick] = React.useState(0);

    useEffect(() => {
        if (!hasTrapBeads) return;
        let raf = 0;
        let lastTick = 0;
        const tick = () => {
            const now = performance.now();
            if (now - lastTick > 66) {
                lastTick = now;
                setTrapViewerTick(t => (t + 1) % 1_000_000);
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [hasTrapBeads]);

    const specimenSpheres = useMemo<RenderSphere[]>(() => {
        if (sample instanceof Sample && sample.specimenKind === 'colloids') {
            return sample.colloidSpheres.map((colloid, index) => {
                const color = colloidColor(index, colloid.glowColor);
                return {
                    id: `colloid-${index}`,
                    c: colloid.center.clone(),
                    r: colloid.radius,
                    color,
                    opacity: 0.9,
                    emissive: color,
                    emissiveIntensity: 0.75,
                    glowRadius: Math.max(0.006, colloid.radius * 2.5),
                    glowColor: color,
                };
            });
        }

        const scale = 2 / 3;
        const center = new Vector3(0, 0.125, 0);
        return [
            { c: new Vector3(0, 0, 0).sub(center).multiplyScalar(scale), r: 0.5 * scale, color: MICKEY_COLORS[0], opacity: 0.45 },
            { c: new Vector3(-0.5, 0.5, 0).sub(center).multiplyScalar(scale), r: 0.25 * scale, color: MICKEY_COLORS[1], opacity: 0.45 },
            { c: new Vector3(0.5, 0.5, 0).sub(center).multiplyScalar(scale), r: 0.25 * scale, color: MICKEY_COLORS[2], opacity: 0.45 },
        ];
    }, [sample, sample.version, trapViewerTick]);

    const flowCell = useMemo<FlowCellRender | null>(() => {
        if (!(sample instanceof Sample) || sample.specimenKind !== 'colloids') return null;
        return {
            width: sample.flowCellWidth,
            height: sample.flowCellHeight,
            depth: sample.flowCellDepth,
            glassThickness: sample.flowCellGlassThickness,
        };
    }, [sample, sample.version]);

    const trapBeads = useMemo<RenderSphere[]>(() => {
        return components
            .filter((c): c is TrappedBead => c instanceof TrappedBead)
            .map(bead => {
                const center = bead.getConfinedSpecimenOffset().clone()
                    .applyQuaternion(bead.rotation)
                    .add(bead.position);
                return {
                    id: bead.id,
                    c: center,
                    r: bead.radius,
                    color: '#dcecff',
                    opacity: 0.95,
                    emissive: bead.glowColor,
                    emissiveIntensity: 0.8,
                    glowRadius: Math.max(bead.radius * 1.4, bead.visualGlowRadius),
                    glowColor: bead.glowColor,
                    trapCaptureRadius: bead.trapCaptureRadius,
                    trapAxialCaptureRange: bead.trapAxialCaptureRange,
                };
            });
    }, [components, cameraImageTick, sample.version, trapViewerTick]);

    const showTrapCloseup = sample instanceof Sample && sample.specimenKind === 'colloids' && trapBeads.length > 0;
    const focus = sample.position;

    // Forward + reverse ray segments in world coords.  No AABB pre-cull — the
    // tight camera frustum drops everything off-screen.
    const segments = useMemo(() => {
        type Seg = { points: [number, number, number][]; color: string };
        const out: Seg[] = [];
        if (showTrapCloseup) return out;
        const forwardRays = store.get(forwardRaysAtom);

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
    }, [components, focus.x, focus.y, focus.z, cameraImageTick, forwardRaysRevision, showTrapCloseup, store]);

    const tickRef = useRef(0);
    useEffect(() => { tickRef.current++; }, [sample.version]);

    // Cell sizing: outer container = `size`, divided into a 2×2 grid with a
    // small gutter between cells.
    const gutter = 2;
    const cellSize = (size - gutter) / 2;
    const camDist = flowCell
        ? Math.max(3.5, Math.max(flowCell.width, flowCell.height) * 1.35)
        : 2.5;

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

    if (showTrapCloseup && sample instanceof Sample) {
        return (
            <TrapCloseupViewer
                sample={sample}
                size={size}
                flowCell={flowCell}
                specimenSpheres={specimenSpheres}
                trapBeads={trapBeads}
            />
        );
    }

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
                specimenSpheres={specimenSpheres}
                flowCell={flowCell}
                trapBeads={trapBeads}
                segments={segments}
                focus={focus}
            />
            <MiniView
                label="Y"
                cellSize={cellSize}
                cameraPos={yAxisPos}
                upVec={[0, 0, 1]}
                sample={sample}
                specimenSpheres={specimenSpheres}
                flowCell={flowCell}
                trapBeads={trapBeads}
                segments={segments}
                focus={focus}
            />
            <MiniView
                label="Z"
                cellSize={cellSize}
                cameraPos={zAxisPos}
                upVec={[0, 1, 0]}
                sample={sample}
                specimenSpheres={specimenSpheres}
                flowCell={flowCell}
                trapBeads={trapBeads}
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
                specimenSpheres={specimenSpheres}
                flowCell={flowCell}
                trapBeads={trapBeads}
                segments={segments}
                focus={focus}
            />
        </div>
    );
};
