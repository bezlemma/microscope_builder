import React, { useEffect, useMemo, useRef } from 'react';
import { Line, Text } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useAtom, useSetAtom } from 'jotai';
import { Camera as ThreeCamera, DoubleSide, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { Rail } from '../physics/components/Rail';
import { SphericalLens } from '../physics/components/SphericalLens';
import { AsphericLens } from '../physics/components/AsphericLens';
import { Coherence, type Ray } from '../physics/types';
import {
    activeZLevelAtom,
    componentsAtom,
    measurementAtom,
    selectionAtom,
    type MeasurementDrawMode,
    type Measurement,
    type MeasurementPlaneMode,
    type MeasurementPoint,
    type MeasurementState,
} from '../state/store';

const MEASURE_COLOR = '#007fff';
const HANDLE_PICK_RADIUS_PX = 16;
const LINE_PICK_RADIUS_PX = 10;
const SNAP_RADIUS_PX = 28;
const LENS_PROFILE_SNAP_RADIUS_PX = 18;
const TABLE_HOLE_OFFSET = 12.5;
const TABLE_HOLE_SPACING = 25;

let nextMeasurementId = 1;

interface DragState {
    measurementId: string;
    pointIndex: number;
    planeZ: number;
    anchor: MeasurementPoint;
}

function createMeasurement(point: MeasurementPoint): Measurement {
    return { id: `measurement-${nextMeasurementId++}`, points: [point] };
}

function normalizeMeasurementState(state: MeasurementState): MeasurementState {
    const legacyPoints = (state as unknown as { points?: MeasurementPoint[] }).points;
    const measurements = Array.isArray(state.measurements)
        ? state.measurements
        : Array.isArray(legacyPoints) && legacyPoints.length > 0
            ? [{ id: 'measurement-legacy', points: legacyPoints }]
            : [];
    const rawSelectedId = (state as Partial<MeasurementState>).selectedId;
    const selectedId = rawSelectedId && measurements.some(measurement => measurement.id === rawSelectedId)
        ? rawSelectedId
        : rawSelectedId === undefined && measurements.length > 0 ? measurements[measurements.length - 1].id : null;
    return {
        active: Boolean(state.active),
        selectedId,
        measurements,
        drawMode: state.drawMode ?? 'line',
        planeMode: state.planeMode ?? 'free',
        showProjected: state.showProjected ?? true,
    };
}

function measurementPointLimit(mode: MeasurementDrawMode | undefined): number {
    return mode === 'angle' ? 3 : 2;
}

function toVector(point: MeasurementPoint): Vector3 {
    return new Vector3(point.x, point.y, point.z);
}

function toPoint(vector: Vector3): MeasurementPoint {
    return { x: vector.x, y: vector.y, z: vector.z };
}

function nearestTableHole(point: Vector3): Vector3 {
    return new Vector3(
        Math.round((point.x - TABLE_HOLE_OFFSET) / TABLE_HOLE_SPACING) * TABLE_HOLE_SPACING + TABLE_HOLE_OFFSET,
        Math.round((point.y - TABLE_HOLE_OFFSET) / TABLE_HOLE_SPACING) * TABLE_HOLE_SPACING + TABLE_HOLE_OFFSET,
        point.z,
    );
}

function tableHoleSnapRadiusPx(camera: ThreeCamera): number {
    const maybeOrtho = camera as ThreeCamera & { isOrthographicCamera?: boolean; zoom?: number };
    const zoom = maybeOrtho.isOrthographicCamera && typeof maybeOrtho.zoom === 'number'
        ? Math.max(0.1, maybeOrtho.zoom)
        : 1;
    return Math.max(7, Math.min(26, 22 / Math.sqrt(zoom)));
}

function screenDistanceSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

function screenPointToSegmentDistanceSq(
    point: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    if (lenSq < 1e-6) return screenDistanceSq(point, a);
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lenSq));
    const closest = { x: a.x + abx * t, y: a.y + aby * t };
    return screenDistanceSq(point, closest);
}

function closestPointOnSegment(a: Vector3, b: Vector3, t: number): Vector3 {
    return a.clone().lerp(b, Math.max(0, Math.min(1, t)));
}

function screenClosestT(
    point: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    if (lenSq < 1e-6) return 0;
    return Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lenSq));
}

function projectedDistance(a: Vector3, b: Vector3, mode: MeasurementPlaneMode | undefined): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    switch (mode) {
        case 'xy': return Math.hypot(dx, dy);
        case 'xz': return Math.hypot(dx, dz);
        case 'yz': return Math.hypot(dy, dz);
        default: return Math.hypot(dx, dy, dz);
    }
}

function addMeasurementPoint(state: MeasurementState, point: MeasurementPoint): MeasurementState {
    const normalized = normalizeMeasurementState(state);
    const selected = normalized.measurements.find(measurement => measurement.id === normalized.selectedId);
    if (selected && selected.points.length < measurementPointLimit(normalized.drawMode)) {
        return {
            ...normalized,
            selectedId: selected.id,
            measurements: normalized.measurements.map(measurement =>
                measurement.id === selected.id
                    ? { ...measurement, points: [...measurement.points, point] }
                    : measurement
            ),
        };
    }

    const measurement = createMeasurement(point);
    return {
        ...normalized,
        selectedId: measurement.id,
        measurements: [...normalized.measurements, measurement],
    };
}

function updateMeasurementPoint(
    state: MeasurementState,
    measurementId: string,
    pointIndex: number,
    point: MeasurementPoint,
): MeasurementState {
    const normalized = normalizeMeasurementState(state);
    return {
        ...normalized,
        selectedId: measurementId,
        measurements: normalized.measurements.map(measurement => {
            if (measurement.id !== measurementId) return measurement;
            return {
                ...measurement,
                points: measurement.points.map((current, index) => index === pointIndex ? point : current),
            };
        }),
    };
}

function deleteSelectedMeasurement(state: MeasurementState): MeasurementState {
    const normalized = normalizeMeasurementState(state);
    if (!normalized.selectedId) return normalized;
    const selectedIndex = normalized.measurements.findIndex(measurement => measurement.id === normalized.selectedId);
    const measurements = normalized.measurements.filter(measurement => measurement.id !== normalized.selectedId);
    const nextSelected = measurements[Math.min(Math.max(selectedIndex, 0), measurements.length - 1)]?.id ?? null;
    return {
        ...normalized,
        selectedId: nextSelected,
        measurements,
    };
}

function formatDistanceMm(distance: number): string {
    if (distance >= 100) return `${distance.toFixed(0)} mm`;
    if (distance >= 10) return `${distance.toFixed(1)} mm`;
    return `${distance.toFixed(2)} mm`;
}

function segmentAngle(a: Vector3, b: Vector3): number {
    return Math.atan2(b.y - a.y, b.x - a.x);
}

function shortestAngleDelta(start: number, end: number): number {
    let delta = end - start;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
}

function linePoints(a: Vector3, b: Vector3, zLift = 0.2): [number, number, number][] {
    return [[a.x, a.y, a.z + zLift], [b.x, b.y, b.z + zLift]];
}

function makeTicks(a: Vector3, b: Vector3): [number, number, number][][] {
    const length = a.distanceTo(b);
    if (length < 1) return [];
    const step = length > 300 ? 25 : length > 120 ? 10 : 5;
    const tickCount = Math.min(200, Math.floor(length / step));
    const dir = b.clone().sub(a).normalize();
    const xyLen = Math.hypot(dir.x, dir.y);
    if (xyLen < 1e-6) return [];
    const perp = new Vector3(-dir.y / xyLen, dir.x / xyLen, 0);
    const ticks: [number, number, number][][] = [];
    for (let i = 0; i <= tickCount; i++) {
        const d = i * step;
        if (d > length) break;
        const p = a.clone().addScaledVector(dir, d);
        const major = Math.round(d) % 10 === 0;
        const half = major ? 2.8 : 1.7;
        ticks.push([
            [p.x - perp.x * half, p.y - perp.y * half, p.z + 0.25],
            [p.x + perp.x * half, p.y + perp.y * half, p.z + 0.25],
        ]);
    }
    return ticks;
}

function makeArcPoints(a: Vector3, b: Vector3, c: Vector3): [number, number, number][] {
    const radius = Math.max(8, Math.min(28, Math.min(a.distanceTo(b), c.distanceTo(b)) * 0.28));
    const start = segmentAngle(b, a);
    const delta = shortestAngleDelta(start, segmentAngle(b, c));
    const steps = Math.max(10, Math.ceil(Math.abs(delta) / (Math.PI / 24)));
    const points: [number, number, number][] = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const angle = start + delta * t;
        points.push([
            b.x + Math.cos(angle) * radius,
            b.y + Math.sin(angle) * radius,
            b.z + 0.35,
        ]);
    }
    return points;
}

function projectToScreen(point: Vector3, camera: ThreeCamera, rect: DOMRect): { x: number; y: number } {
    const projected = point.clone().project(camera);
    return {
        x: (projected.x * 0.5 + 0.5) * rect.width,
        y: (-projected.y * 0.5 + 0.5) * rect.height,
    };
}

function MeasurementLabel({
    position,
    opacity,
    fontSize = 4.2,
    children,
}: {
    position: Vector3;
    opacity: number;
    fontSize?: number;
    children: React.ReactNode;
}) {
    return (
        <Text
            position={[position.x, position.y, position.z + 0.55]}
            fontSize={fontSize}
            color={MEASURE_COLOR}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.12}
            outlineColor="#001225"
            fillOpacity={opacity}
            font={undefined}
        >
            {children}
        </Text>
    );
}

function SegmentMeasurement({
    a,
    b,
    selected,
    planeMode,
    labelOffsetSign = 1,
}: {
    a: Vector3;
    b: Vector3;
    selected: boolean;
    planeMode?: MeasurementPlaneMode;
    labelOffsetSign?: 1 | -1;
}) {
    const ticks = useMemo(() => makeTicks(a, b), [a, b]);
    const distance = projectedDistance(a, b, planeMode);
    const dir = b.clone().sub(a);
    if (dir.lengthSq() < 1e-10) return null;
    dir.normalize();
    const xyLen = Math.hypot(dir.x, dir.y);
    const perp = xyLen > 1e-6
        ? new Vector3(-dir.y / xyLen, dir.x / xyLen, 0)
        : new Vector3(1, 0, 0);
    const labelPos = a.clone().lerp(b, 0.5).addScaledVector(perp, 8 * labelOffsetSign);
    const opacity = selected ? 0.78 : 0.38;

    return (
        <group>
            <Line points={linePoints(a, b)} color={MEASURE_COLOR} lineWidth={selected ? 3.5 : 2.4} transparent opacity={opacity} />
            {ticks.map((points, index) => (
                <Line key={index} points={points} color={MEASURE_COLOR} lineWidth={selected ? 1.7 : 1.1} transparent opacity={selected ? 0.58 : 0.28} />
            ))}
            <MeasurementLabel position={labelPos} opacity={selected ? 0.95 : 0.58} fontSize={selected ? 4.0 : 3.6}>
                {formatDistanceMm(distance)}
            </MeasurementLabel>
        </group>
    );
}

function measurementAngle(a: Vector3, b: Vector3, c: Vector3): number | null {
    const ba = a.clone().sub(b);
    const bc = c.clone().sub(b);
    if (ba.lengthSq() < 1e-10 || bc.lengthSq() < 1e-10) return null;
    return Math.acos(Math.max(-1, Math.min(1, ba.normalize().dot(bc.normalize()))));
}

function RenderedMeasurement({
    measurement,
    selected,
    planeMode,
}: {
    measurement: Measurement;
    selected: boolean;
    planeMode?: MeasurementPlaneMode;
}) {
    const points = measurement.points.map(toVector);
    const [a, b, c] = points;
    const angle = a && b && c ? measurementAngle(a, b, c) : null;
    const arcPoints = angle !== null && a && b && c ? makeArcPoints(a, b, c) : [];
    const angleLabelPosition = angle !== null && arcPoints.length > 0
        ? new Vector3(...arcPoints[Math.floor(arcPoints.length / 2)]).add(new Vector3(0, 0, 0.8))
        : null;
    const handleOpacity = selected ? 0.58 : 0.25;

    return (
        <group>
            {points.map((point, index) => (
                <mesh key={index} position={[point.x, point.y, point.z + 0.28]}>
                    <circleGeometry args={[selected ? 4 : 3.2, 32]} />
                    <meshBasicMaterial color={MEASURE_COLOR} transparent opacity={handleOpacity} side={DoubleSide} depthWrite={false} toneMapped={false} />
                </mesh>
            ))}
            {a && b && <SegmentMeasurement a={a} b={b} selected={selected} planeMode={planeMode} labelOffsetSign={1} />}
            {b && c && <SegmentMeasurement a={b} b={c} selected={selected} planeMode={planeMode} labelOffsetSign={-1} />}
            {arcPoints.length > 0 && (
                <Line points={arcPoints} color={MEASURE_COLOR} lineWidth={selected ? 3.5 : 2.4} transparent opacity={selected ? 0.78 : 0.38} />
            )}
            {angle !== null && angleLabelPosition && (
                <MeasurementLabel position={angleLabelPosition} opacity={selected ? 0.95 : 0.58}>{`${(angle * 180 / Math.PI).toFixed(1)}°`}</MeasurementLabel>
            )}
        </group>
    );
}

export const MeasureOverlay: React.FC = () => {
    const { camera, gl } = useThree();
    const [activeZ] = useAtom(activeZLevelAtom);
    const [components] = useAtom(componentsAtom);
    const [measurement, setMeasurement] = useAtom(measurementAtom);
    const setSelection = useSetAtom(selectionAtom);
    const normalizedMeasurement = useMemo(() => normalizeMeasurementState(measurement), [measurement]);
    const measurementRef = useRef(normalizedMeasurement);
    const dragRef = useRef<DragState | null>(null);

    useEffect(() => {
        measurementRef.current = normalizedMeasurement;
    }, [normalizedMeasurement]);

    useEffect(() => {
        const canvas = gl.domElement;

        const raycasterFromPointer = (event: PointerEvent): Raycaster => {
            const rect = canvas.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            const raycaster = new Raycaster();
            raycaster.setFromCamera(new Vector2(x, y), camera);
            return raycaster;
        };

        const pointerToWorld = (event: PointerEvent, planeZ: number): Vector3 | null => {
            const raycaster = raycasterFromPointer(event);
            const plane = new Plane(new Vector3(0, 0, 1), -planeZ);
            const hit = new Vector3();
            return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
        };

        const pointerToMeasurementPlane = (event: PointerEvent, planeZ: number, anchor?: MeasurementPoint): Vector3 | null => {
            const planeMode = measurementRef.current.planeMode ?? 'free';
            if ((planeMode === 'xz' || planeMode === 'yz') && anchor) {
                const raycaster = raycasterFromPointer(event);
                const normal = planeMode === 'xz' ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
                const fixed = planeMode === 'xz' ? anchor.y : anchor.x;
                const plane = new Plane(normal, -fixed);
                const hit = new Vector3();
                if (raycaster.ray.intersectPlane(plane, hit)) return hit;

                const fallback = pointerToWorld(event, planeZ);
                if (!fallback) return null;
                if (planeMode === 'xz') fallback.y = anchor.y;
                else fallback.x = anchor.x;
                return fallback;
            }
            return pointerToWorld(event, planeZ);
        };

        const findLensProfileSnap = (event: PointerEvent): Vector3 | null => {
            const rect = canvas.getBoundingClientRect();
            const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            let best: { point: Vector3; distanceSq: number } | null = null;

            const considerProfile = (profile: Vector2[], localToWorld: import('three').Matrix4) => {
                const right = profile.map(point => new Vector3(point.x, 0, point.y).applyMatrix4(localToWorld));
                const left = profile.map(point => new Vector3(-point.x, 0, point.y).applyMatrix4(localToWorld));
                const paths = [right, left];
                for (const path of paths) {
                    for (let i = 1; i < path.length; i++) {
                        const a = path[i - 1];
                        const b = path[i];
                        const aScreen = projectToScreen(a, camera, rect);
                        const bScreen = projectToScreen(b, camera, rect);
                        const t = screenClosestT(pointer, aScreen, bScreen);
                        const closestScreen = {
                            x: aScreen.x + (bScreen.x - aScreen.x) * t,
                            y: aScreen.y + (bScreen.y - aScreen.y) * t,
                        };
                        const distanceSq = screenDistanceSq(pointer, closestScreen);
                        if (distanceSq <= LENS_PROFILE_SNAP_RADIUS_PX * LENS_PROFILE_SNAP_RADIUS_PX && (!best || distanceSq < best.distanceSq)) {
                            best = { point: closestPointOnSegment(a, b, t), distanceSq };
                        }
                    }
                }
            };

            for (const component of components) {
                if (component.isGhost) continue;
                if (!(component instanceof SphericalLens) && !(component instanceof AsphericLens)) continue;
                component.updateMatrices();
                if (component instanceof SphericalLens) {
                    const { R1, R2 } = component.getRadii();
                    considerProfile(
                        SphericalLens.generateProfile(R1, R2, component.apertureRadius, component.thickness, 64),
                        component.localToWorld,
                    );
                } else {
                    considerProfile(
                        AsphericLens.generateProfile(component.frontSurface, component.backSurface, component.apertureRadius, component.thickness, 64),
                        component.localToWorld,
                    );
                }
            }

            const snap = best as { point: Vector3; distanceSq: number } | null;
            return snap ? snap.point.clone() : null;
        };

        const pointerToSurface = (event: PointerEvent): Vector3 | null => {
            const raycaster = raycasterFromPointer(event);
            const ray: Ray = {
                origin: raycaster.ray.origin.clone(),
                direction: raycaster.ray.direction.clone().normalize(),
                wavelength: 550e-9,
                intensity: 1,
                polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
                opticalPathLength: 0,
                footprintRadius: 0.1,
                coherenceMode: Coherence.Coherent,
            };

            let nearestT = Infinity;
            let nearestPoint: Vector3 | null = null;
            for (const component of components) {
                if (component.isGhost) continue;
                const hit = component.chkIntersection(ray, nearestT);
                if (hit && hit.t > 0.001 && hit.t < nearestT) {
                    nearestT = hit.t;
                    nearestPoint = hit.point.clone();
                }
            }

            return nearestPoint;
        };

        const collectSnapPoints = (): Vector3[] => {
            const points: Vector3[] = [];
            for (const component of components) {
                if (component instanceof Rail) {
                    points.push(component.holeA.clone(), component.holeB.clone(), component.position.clone());
                } else {
                    points.push(component.position.clone());
                }
            }
            return points;
        };

        const snapToComponent = (event: PointerEvent, fallback: Vector3): Vector3 => {
            if (!event.altKey) return fallback;
            const lensProfilePoint = findLensProfileSnap(event);
            if (lensProfilePoint) return lensProfilePoint;

            const surfacePoint = pointerToSurface(event);
            if (surfacePoint) return surfacePoint;

            const rect = canvas.getBoundingClientRect();
            const pointerX = event.clientX - rect.left;
            const pointerY = event.clientY - rect.top;
            let best: { point: Vector3; distanceSq: number } | null = null;

            const explicitSnapPoints = collectSnapPoints();
            for (const point of explicitSnapPoints) {
                const screen = projectToScreen(point, camera, rect);
                const dx = screen.x - pointerX;
                const dy = screen.y - pointerY;
                const distanceSq = dx * dx + dy * dy;
                if (distanceSq <= SNAP_RADIUS_PX * SNAP_RADIUS_PX && (!best || distanceSq < best.distanceSq)) {
                    best = { point, distanceSq };
                }
            }
            if (best) return best.point.clone();

            const hole = nearestTableHole(fallback);
            const holeScreen = projectToScreen(hole, camera, rect);
            const fallbackScreen = projectToScreen(fallback, camera, rect);
            const radius = tableHoleSnapRadiusPx(camera);
            return screenDistanceSq(holeScreen, fallbackScreen) <= radius * radius
                ? hole
                : fallback;
        };

        const findHandleAtPointer = (event: PointerEvent): DragState | null => {
            const rect = canvas.getBoundingClientRect();
            const pointerX = event.clientX - rect.left;
            const pointerY = event.clientY - rect.top;
            let best: { handle: DragState; distanceSq: number } | null = null;

            for (const current of measurementRef.current.measurements) {
                for (let pointIndex = 0; pointIndex < current.points.length; pointIndex++) {
                    const point = toVector(current.points[pointIndex]);
                    const screen = projectToScreen(point, camera, rect);
                    const dx = screen.x - pointerX;
                    const dy = screen.y - pointerY;
                    const distanceSq = dx * dx + dy * dy;
                    if (distanceSq <= HANDLE_PICK_RADIUS_PX * HANDLE_PICK_RADIUS_PX && (!best || distanceSq < best.distanceSq)) {
                        best = {
                            handle: { measurementId: current.id, pointIndex, planeZ: point.z, anchor: current.points[0] ?? current.points[pointIndex] ?? toPoint(point) },
                            distanceSq,
                        };
                    }
                }
            }

            return best?.handle ?? null;
        };

        const findMeasurementLineAtPointer = (event: PointerEvent): string | null => {
            const rect = canvas.getBoundingClientRect();
            const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            let best: { measurementId: string; distanceSq: number } | null = null;

            for (const current of measurementRef.current.measurements) {
                const points = current.points.map(point => projectToScreen(toVector(point), camera, rect));
                const segments: [number, number][] = [[0, 1], [1, 2]];
                for (const [start, end] of segments) {
                    if (!points[start] || !points[end]) continue;
                    const distanceSq = screenPointToSegmentDistanceSq(pointer, points[start], points[end]);
                    if (distanceSq <= LINE_PICK_RADIUS_PX * LINE_PICK_RADIUS_PX && (!best || distanceSq < best.distanceSq)) {
                        best = { measurementId: current.id, distanceSq };
                    }
                }
            }

            return best?.measurementId ?? null;
        };

        const consume = (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
        };

        const handlePointerDown = (event: PointerEvent) => {
            if (event.button !== 0) return;

            const handle = findHandleAtPointer(event);
            if (handle) {
                dragRef.current = handle;
                canvas.style.cursor = 'grabbing';
                setSelection([]);
                setMeasurement(state => ({ ...normalizeMeasurementState(state), selectedId: handle.measurementId }));
                consume(event);
                return;
            }

            const lineMeasurementId = findMeasurementLineAtPointer(event);
            if (lineMeasurementId) {
                setSelection([]);
                setMeasurement(state => ({ ...normalizeMeasurementState(state), selectedId: lineMeasurementId }));
                consume(event);
                return;
            }

            if (!measurementRef.current.active) return;
            const selected = measurementRef.current.measurements.find(current => current.id === measurementRef.current.selectedId);
            const anchor = selected && selected.points.length > 0 && selected.points.length < measurementPointLimit(measurementRef.current.drawMode)
                ? selected.points[0]
                : undefined;
            const hit = pointerToMeasurementPlane(event, activeZ, anchor);
            if (!hit) return;
            const point = snapToComponent(event, hit);
            setSelection([]);
            setMeasurement(state => addMeasurementPoint(state, toPoint(point)));
            consume(event);
        };

        const handlePointerMove = (event: PointerEvent) => {
            const drag = dragRef.current;
            if (drag) {
                const hit = pointerToMeasurementPlane(event, drag.planeZ, drag.anchor);
                if (!hit) return;
                const point = snapToComponent(event, hit);
                drag.planeZ = point.z;
                setMeasurement(state => updateMeasurementPoint(state, drag.measurementId, drag.pointIndex, toPoint(point)));
                consume(event);
                return;
            }

            const handle = findHandleAtPointer(event);
            const lineMeasurementId = handle ? null : findMeasurementLineAtPointer(event);
            canvas.style.cursor = handle ? 'grab' : (lineMeasurementId ? 'pointer' : (measurementRef.current.active ? 'crosshair' : ''));
        };

        const handlePointerUp = (event: PointerEvent) => {
            if (!dragRef.current) return;
            dragRef.current = null;
            canvas.style.cursor = measurementRef.current.active ? 'crosshair' : '';
            consume(event);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            const activeElement = document.activeElement;
            const tagName = activeElement instanceof HTMLElement ? activeElement.tagName : '';
            if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return;

            if (event.key === 'Escape') {
                if (measurementRef.current.active || measurementRef.current.selectedId) {
                    setMeasurement(state => ({ ...state, active: false, selectedId: null }));
                    consume(event);
                }
                return;
            }

            if ((event.key === 'Delete' || event.key === 'Backspace') && measurementRef.current.selectedId) {
                setMeasurement(deleteSelectedMeasurement);
                consume(event);
            }
        };

        canvas.addEventListener('pointerdown', handlePointerDown, true);
        window.addEventListener('pointermove', handlePointerMove, true);
        window.addEventListener('pointerup', handlePointerUp, true);
        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            canvas.style.cursor = '';
            canvas.removeEventListener('pointerdown', handlePointerDown, true);
            window.removeEventListener('pointermove', handlePointerMove, true);
            window.removeEventListener('pointerup', handlePointerUp, true);
            window.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [activeZ, camera, components, gl.domElement, setMeasurement, setSelection]);

    if (normalizedMeasurement.measurements.length === 0) return null;

    return (
        <group>
            {normalizedMeasurement.measurements.map(current => (
                <RenderedMeasurement
                    key={current.id}
                    measurement={current}
                    selected={current.id === normalizedMeasurement.selectedId}
                    planeMode={normalizedMeasurement.planeMode}
                />
            ))}
        </group>
    );
};
