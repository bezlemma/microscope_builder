import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { componentsAtom, pushUndoAtom } from '../state/store';
import { OpticalComponent } from '../physics/Component';
import { SphericalLens } from '../physics/components/SphericalLens';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { Mirror } from '../physics/components/Mirror';
import { CurvedMirror } from '../physics/components/CurvedMirror';
import { PrismLens } from '../physics/components/PrismLens';
import { PolygonScanner } from '../physics/components/PolygonScanner';

const PANEL_W = 280;
const PANEL_H = 200;
const DRAW_H = PANEL_H - 40;
const CENTER_X = PANEL_W / 2;
const CENTER_Y = PANEL_H / 2;

const SURFACE_COLOR = '#64b5f6';
const SURFACE_COLOR_DIM = '#80cbc4';
const MIRROR_SURFACE = '#cfd8dc';
const POLYGON_COLOR = '#ffd166';
const RIM_COLOR = '#666';
const HANDLE_COLOR = '#ff6b9d';
const HANDLE_ACTIVE = '#ff3366';
const BG_COLOR = '#161616';
const GRID_COLOR = '#232323';
const AXIS_COLOR = '#383838';
const TEXT_COLOR = '#6f6f6f';

type EditableProfileComponent =
    | SphericalLens
    | CylindricalLens
    | Mirror
    | CurvedMirror
    | PrismLens
    | PolygonScanner;

type HandleId = string | null;

function sag(R: number, apex: number, r: number): number {
    if (Math.abs(R) >= 1e8) return apex;
    const val = R * R - r * r;
    if (val < 0) return apex;
    return (apex + R) - Math.sign(R) * Math.sqrt(val);
}

function sagFromZero(R: number, r: number): number {
    if (Math.abs(R) >= 1e8) return 0;
    const val = R * R - r * r;
    if (val < 0) return 0;
    return R - Math.sign(R) * Math.sqrt(val);
}

function pointsToAttr(points: number[]): string {
    const coords: string[] = [];
    for (let i = 0; i < points.length; i += 2) {
        coords.push(`${points[i]},${points[i + 1]}`);
    }
    return coords.join(' ');
}

function clampRadiusToLensBody(lens: SphericalLens, requestedRadius: number): number {
    const { R1, R2 } = lens.getRadii();
    let maxRadius = 200;
    if (Math.abs(R1) < 1e6) maxRadius = Math.min(maxRadius, Math.abs(R1) * 0.95);
    if (Math.abs(R2) < 1e6) maxRadius = Math.min(maxRadius, Math.abs(R2) * 0.95);
    return Math.max(1, Math.min(requestedRadius, maxRadius));
}

function lensProfileToScreen(
    R1: number,
    R2: number,
    apertureRadius: number,
    thickness: number,
    scale: number,
    segments: number = 40,
): { front: number[]; back: number[]; rim: number[] } {
    const frontApex = -thickness / 2;
    const backApex = thickness / 2;
    const front: number[] = [];
    const back: number[] = [];

    for (let i = 0; i <= segments; i++) {
        const r = (i / segments) * apertureRadius;
        const fz = sag(R1, frontApex, r);
        const bz = sag(R2, backApex, r);
        front.push(CENTER_X + fz * scale, CENTER_Y - r * scale);
        back.push(CENTER_X + bz * scale, CENTER_Y - r * scale);
    }
    for (let i = segments; i >= 0; i--) {
        const r = (i / segments) * apertureRadius;
        const fz = sag(R1, frontApex, r);
        const bz = sag(R2, backApex, r);
        front.push(CENTER_X + fz * scale, CENTER_Y + r * scale);
        back.push(CENTER_X + bz * scale, CENTER_Y + r * scale);
    }

    const rimTopF = sag(R1, frontApex, apertureRadius);
    const rimTopB = sag(R2, backApex, apertureRadius);
    const rim = [
        CENTER_X + rimTopF * scale, CENTER_Y - apertureRadius * scale,
        CENTER_X + rimTopB * scale, CENTER_Y - apertureRadius * scale,
        CENTER_X + rimTopB * scale, CENTER_Y + apertureRadius * scale,
        CENTER_X + rimTopF * scale, CENTER_Y + apertureRadius * scale,
    ];
    return { front, back, rim };
}

function isPolygonEditable(component: OpticalComponent): component is PrismLens | PolygonScanner {
    return component instanceof PrismLens || component instanceof PolygonScanner;
}

function isEditableProfileComponent(component: OpticalComponent): component is EditableProfileComponent {
    return (
        component instanceof SphericalLens ||
        component instanceof CylindricalLens ||
        component instanceof Mirror ||
        component instanceof CurvedMirror ||
        component instanceof PrismLens ||
        component instanceof PolygonScanner
    );
}

export function supportsLensProfileEditor(component: OpticalComponent | null | undefined): boolean {
    return !!component && isEditableProfileComponent(component);
}

function ProfileHandle({
    id,
    x,
    y,
    activeHandle,
    startDrag,
}: {
    id: string;
    x: number;
    y: number;
    activeHandle: HandleId;
    startDrag: (id: string) => void;
}) {
    return (
        <circle
            cx={x}
            cy={y}
            r={6}
            fill={activeHandle === id ? HANDLE_ACTIVE : HANDLE_COLOR}
            stroke="#fff"
            strokeWidth={1}
            style={{ cursor: 'grab' }}
            onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                startDrag(id);
            }}
        />
    );
}

function useSvgPointerTracking(
    svgRef: React.RefObject<SVGSVGElement | null>,
    activeHandle: HandleId,
    onDrag: (handle: string, x: number, y: number) => void,
    onRelease: () => void,
) {
    useEffect(() => {
        if (!activeHandle) return;

        const handleMove = (event: PointerEvent) => {
            const svg = svgRef.current;
            if (!svg) return;
            const rect = svg.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * PANEL_W;
            const y = ((event.clientY - rect.top) / rect.height) * PANEL_H;
            onDrag(activeHandle, x, y);
        };

        const handleUp = () => onRelease();

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';

        return () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
        };
    }, [activeHandle, onDrag, onRelease, svgRef]);
}

function ProfileFrame({
    svgRef,
    activeHandle,
    children,
}: {
    svgRef: React.RefObject<SVGSVGElement | null>;
    activeHandle: HandleId;
    children: React.ReactNode;
}) {
    return (
        <svg
            ref={svgRef}
            viewBox={`0 0 ${PANEL_W} ${PANEL_H}`}
            width="100%"
            height={PANEL_H}
            style={{
                display: 'block',
                background: BG_COLOR,
                cursor: activeHandle ? 'grabbing' : 'crosshair',
            }}
        >
            <rect x={0} y={0} width={PANEL_W} height={PANEL_H} fill={BG_COLOR} />
            {[-2, -1, 0, 1, 2].map((index) => (
                <line
                    key={`vx-${index}`}
                    x1={CENTER_X + index * 20}
                    y1={0}
                    x2={CENTER_X + index * 20}
                    y2={PANEL_H}
                    stroke={index === 0 ? AXIS_COLOR : GRID_COLOR}
                    strokeWidth={index === 0 ? 1 : 0.5}
                />
            ))}
            {[-2, -1, 0, 1, 2].map((index) => (
                <line
                    key={`hy-${index}`}
                    x1={0}
                    y1={CENTER_Y + index * 20}
                    x2={PANEL_W}
                    y2={CENTER_Y + index * 20}
                    stroke={index === 0 ? AXIS_COLOR : GRID_COLOR}
                    strokeWidth={index === 0 ? 1 : 0.5}
                />
            ))}
            {children}
        </svg>
    );
}

function LensProfilePanel({
    component,
    activeHandle,
    startDrag,
}: {
    component: SphericalLens | CylindricalLens;
    activeHandle: HandleId;
    startDrag: (id: string) => void;
}) {
    const isCylindrical = component instanceof CylindricalLens;
    const scale = useMemo(
        () => (DRAW_H * 0.8) / Math.max(component.apertureRadius * 2, component.thickness, 1),
        [component.apertureRadius, component.thickness],
    );
    const scaleRef = useRef(scale);
    if (!activeHandle) scaleRef.current = scale;

    const profile = useMemo(() => {
        if (isCylindrical) {
            return lensProfileToScreen(component.r1, component.r2, component.apertureRadius, component.thickness, scaleRef.current);
        }
        const radii = component.getRadii();
        return lensProfileToScreen(radii.R1, radii.R2, component.apertureRadius, component.thickness, scaleRef.current);
    }, [component, isCylindrical, activeHandle]);

    const frontApexX = CENTER_X + (-component.thickness / 2) * scaleRef.current;
    const topEdgeY = CENTER_Y - component.apertureRadius * scaleRef.current;

    return (
        <>
            <polyline points={pointsToAttr(profile.front)} fill="none" stroke={SURFACE_COLOR} strokeWidth={2} />
            <polyline points={pointsToAttr(profile.back)} fill="none" stroke={SURFACE_COLOR_DIM} strokeWidth={2} />
            <line x1={profile.rim[0]} y1={profile.rim[1]} x2={profile.rim[2]} y2={profile.rim[3]} stroke={RIM_COLOR} strokeWidth={1} />
            <line x1={profile.rim[4]} y1={profile.rim[5]} x2={profile.rim[6]} y2={profile.rim[7]} stroke={RIM_COLOR} strokeWidth={1} />

            <ProfileHandle id="thickness" x={frontApexX} y={CENTER_Y} activeHandle={activeHandle} startDrag={startDrag} />
            <ProfileHandle id="aperture" x={CENTER_X} y={topEdgeY} activeHandle={activeHandle} startDrag={startDrag} />

            <text x={frontApexX - 2} y={CENTER_Y + 18} fill="#888" fontSize={9}>t</text>
            <text x={CENTER_X + 4} y={topEdgeY - 4} fill="#888" fontSize={9}>R</text>
            <text x={4} y={PANEL_H - 10} fill={TEXT_COLOR} fontSize={9}>
                {isCylindrical ? 'Cylindrical lens profile' : `f=${component.focalLength.toFixed(1)}mm`}
            </text>
        </>
    );
}

function FlatMirrorPanel({
    component,
    activeHandle,
    startDrag,
}: {
    component: Mirror;
    activeHandle: HandleId;
    startDrag: (id: string) => void;
}) {
    const radius = component.diameter / 2;
    const halfT = component.thickness / 2;
    const scale = useMemo(
        () => (DRAW_H * 0.8) / Math.max(component.diameter, component.thickness * 2, 1),
        [component.diameter, component.thickness],
    );
    const scaleRef = useRef(scale);
    if (!activeHandle) scaleRef.current = scale;

    const backX = CENTER_X + halfT * scaleRef.current;
    const frontX = CENTER_X - halfT * scaleRef.current;
    const topY = CENTER_Y - radius * scaleRef.current;
    const bottomY = CENTER_Y + radius * scaleRef.current;

    const hatchLines = Array.from({ length: 8 }, (_, index) => {
        const y = topY + ((index + 0.5) / 8) * (bottomY - topY);
        return [backX, y, backX + 4, y - 3] as const;
    });

    return (
        <>
            <polygon
                points={pointsToAttr([frontX, topY, backX, topY, backX, bottomY, frontX, bottomY])}
                fill="rgba(207, 216, 220, 0.08)"
                stroke={MIRROR_SURFACE}
                strokeWidth={2}
            />
            <line x1={frontX} y1={topY} x2={frontX} y2={bottomY} stroke={SURFACE_COLOR} strokeWidth={3} />
            <line x1={backX} y1={topY} x2={backX} y2={bottomY} stroke={MIRROR_SURFACE} strokeWidth={1.5} />
            {hatchLines.map((line, index) => (
                <line key={index} x1={line[0]} y1={line[1]} x2={line[2]} y2={line[3]} stroke="#444" strokeWidth={0.5} />
            ))}

            <ProfileHandle id="thickness" x={frontX} y={CENTER_Y} activeHandle={activeHandle} startDrag={startDrag} />
            <ProfileHandle id="diameter" x={CENTER_X} y={topY} activeHandle={activeHandle} startDrag={startDrag} />

            <text x={frontX - 2} y={CENTER_Y + 18} fill="#888" fontSize={9}>t</text>
            <text x={CENTER_X + 4} y={topY - 4} fill="#888" fontSize={9}>d</text>
            <text x={4} y={PANEL_H - 10} fill={TEXT_COLOR} fontSize={9}>Flat mirror</text>
        </>
    );
}

function CurvedMirrorPanel({
    component,
    activeHandle,
    startDrag,
}: {
    component: CurvedMirror;
    activeHandle: HandleId;
    startDrag: (id: string) => void;
}) {
    const radius = component.diameter / 2;
    const halfT = component.thickness / 2;
    const scale = useMemo(
        () => (DRAW_H * 0.8) / Math.max(component.diameter, component.thickness * 2, 1),
        [component.diameter, component.thickness],
    );
    const scaleRef = useRef(scale);
    if (!activeHandle) scaleRef.current = scale;

    const frontPts: number[] = [];
    const segs = 40;
    for (let i = 0; i <= segs; i++) {
        const r = (i / segs) * radius;
        frontPts.push(CENTER_X + (-halfT + sagFromZero(component.radiusOfCurvature, r)) * scaleRef.current, CENTER_Y - r * scaleRef.current);
    }
    for (let i = segs; i >= 0; i--) {
        const r = (i / segs) * radius;
        frontPts.push(CENTER_X + (-halfT + sagFromZero(component.radiusOfCurvature, r)) * scaleRef.current, CENTER_Y + r * scaleRef.current);
    }

    const backX = CENTER_X + halfT * scaleRef.current;
    const frontEdgeX = CENTER_X + (-halfT + sagFromZero(component.radiusOfCurvature, radius)) * scaleRef.current;
    const topY = CENTER_Y - radius * scaleRef.current;
    const bottomY = CENTER_Y + radius * scaleRef.current;

    return (
        <>
            <polyline points={pointsToAttr(frontPts)} fill="none" stroke={SURFACE_COLOR} strokeWidth={3} />
            <line x1={backX} y1={topY} x2={backX} y2={bottomY} stroke={MIRROR_SURFACE} strokeWidth={1.5} />
            <line x1={frontEdgeX} y1={topY} x2={backX} y2={topY} stroke={RIM_COLOR} strokeWidth={1} />
            <line x1={frontEdgeX} y1={bottomY} x2={backX} y2={bottomY} stroke={RIM_COLOR} strokeWidth={1} />

            <ProfileHandle id="diameter" x={CENTER_X} y={topY} activeHandle={activeHandle} startDrag={startDrag} />
            <ProfileHandle id="curvature" x={frontEdgeX} y={topY} activeHandle={activeHandle} startDrag={startDrag} />

            <text x={CENTER_X + 4} y={topY - 4} fill="#888" fontSize={9}>d</text>
            <text x={frontEdgeX + 4} y={topY - 4} fill="#888" fontSize={9}>R</text>
            <text x={4} y={PANEL_H - 10} fill={TEXT_COLOR} fontSize={9}>
                {Math.abs(component.radiusOfCurvature) >= 1e6 ? 'Flat-limit mirror' : `f=${component.focalLength.toFixed(1)}mm`}
            </text>
        </>
    );
}

interface PolygonFaceInfo {
    midpoint: [number, number];
    outwardNormal: [number, number];
    edgeLen: number;
    sagAtMid: number;
    roc: number;
    start: [number, number];
    end: [number, number];
}

function computePolygonFaceInfo(component: PrismLens | PolygonScanner): PolygonFaceInfo[] {
    const vertices = component.getEditorProfileVertices();
    const cx = vertices.reduce((sum, vertex) => sum + vertex[0], 0) / vertices.length;
    const cy = vertices.reduce((sum, vertex) => sum + vertex[1], 0) / vertices.length;

    return vertices.map((vertex, index) => {
        const next = vertices[(index + 1) % vertices.length];
        const dx = next[0] - vertex[0];
        const dy = next[1] - vertex[1];
        const edgeLen = Math.hypot(dx, dy);
        let nx = edgeLen > 0 ? -dy / edgeLen : 0;
        let ny = edgeLen > 0 ? dx / edgeLen : 1;
        const midpoint: [number, number] = [(vertex[0] + next[0]) / 2, (vertex[1] + next[1]) / 2];
        if (nx * (midpoint[0] - cx) + ny * (midpoint[1] - cy) < 0) {
            nx = -nx;
            ny = -ny;
        }
        const roc = component.faceROC[index] ?? Infinity;
        const halfEdge = edgeLen / 2;
        const isCurved = Number.isFinite(roc) && Math.abs(roc) >= halfEdge && Math.abs(roc) < 1e8;
        const sagAtMid = isCurved
            ? Math.sign(roc) * (Math.abs(roc) - Math.sqrt(roc * roc - halfEdge * halfEdge))
            : 0;
        return {
            midpoint,
            outwardNormal: [nx, ny],
            edgeLen,
            sagAtMid,
            roc,
            start: vertex,
            end: next,
        };
    });
}

function polygonFacePath(
    face: PolygonFaceInfo,
    toScreenX: (value: number) => number,
    toScreenY: (value: number) => number,
): number[] {
    const absR = Math.abs(face.roc);
    const halfEdge = face.edgeLen / 2;
    const curved = Number.isFinite(face.roc) && absR >= halfEdge && absR < 1e8;
    if (!curved) {
        return [
            toScreenX(face.start[0]), toScreenY(face.start[1]),
            toScreenX(face.end[0]), toScreenY(face.end[1]),
        ];
    }

    const pts: number[] = [];
    const segs = 20;
    const chordToCenter = Math.sqrt(absR * absR - halfEdge * halfEdge);
    for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const px = face.start[0] + t * (face.end[0] - face.start[0]);
        const py = face.start[1] + t * (face.end[1] - face.start[1]);
        const radial = Math.hypot(px - face.midpoint[0], py - face.midpoint[1]);
        const sagSq = absR * absR - radial * radial;
        const sag = sagSq > 0 ? Math.sign(face.roc) * (Math.sqrt(sagSq) - chordToCenter) : 0;
        pts.push(
            toScreenX(px + face.outwardNormal[0] * sag),
            toScreenY(py + face.outwardNormal[1] * sag),
        );
    }
    return pts;
}

function PolygonProfilePanel({
    component,
    activeHandle,
    startDrag,
}: {
    component: PrismLens | PolygonScanner;
    activeHandle: HandleId;
    startDrag: (id: string) => void;
}) {
    const vertices = component.getEditorProfileVertices();
    const minX = Math.min(...vertices.map((vertex) => vertex[0]));
    const maxX = Math.max(...vertices.map((vertex) => vertex[0]));
    const minY = Math.min(...vertices.map((vertex) => vertex[1]));
    const maxY = Math.max(...vertices.map((vertex) => vertex[1]));
    const span = Math.max(maxX - minX, maxY - minY, 1);

    const scale = useMemo(() => (DRAW_H * 0.72) / span, [span]);
    const scaleRef = useRef(scale);
    if (!activeHandle) scaleRef.current = scale;

    const toScreenX = (value: number) => CENTER_X + value * scaleRef.current;
    const toScreenY = (value: number) => CENTER_Y - value * scaleRef.current;
    const faceInfo = computePolygonFaceInfo(component);

    const faceLabels = component instanceof PrismLens && !(component instanceof PolygonScanner) && component.numFaces === 3
        ? ['1', '2', '3']
        : Array.from({ length: component.numFaces }, (_, index) => String(index + 1));

    const outline = vertices.flatMap((vertex) => [toScreenX(vertex[0]), toScreenY(vertex[1])]);

    return (
        <>
            <polygon points={pointsToAttr(outline)} fill="rgba(255, 209, 102, 0.08)" stroke="transparent" />
            {faceInfo.map((face, index) => {
                const path = polygonFacePath(face, toScreenX, toScreenY);
                return (
                    <polyline
                        key={`face-${index}`}
                        points={pointsToAttr(path)}
                        fill="none"
                        stroke={POLYGON_COLOR}
                        strokeWidth={2}
                    />
                );
            })}

            {faceInfo.map((face, index) => {
                const labelX = toScreenX(face.midpoint[0] + face.outwardNormal[0] * 8 / scaleRef.current);
                const labelY = toScreenY(face.midpoint[1] + face.outwardNormal[1] * 8 / scaleRef.current);
                return (
                    <text key={`face-label-${index}`} x={labelX} y={labelY} fill="#888" fontSize={9}>
                        {faceLabels[index]}
                    </text>
                );
            })}

            {vertices.map((vertex, index) => (
                <ProfileHandle
                    key={`vertex-${index}`}
                    id={`vertex:${index}`}
                    x={toScreenX(vertex[0])}
                    y={toScreenY(vertex[1])}
                    activeHandle={activeHandle}
                    startDrag={startDrag}
                />
            ))}

            {faceInfo.map((face, index) => (
                <ProfileHandle
                    key={`curvature-${index}`}
                    id={`curvature:${index}`}
                    x={toScreenX(face.midpoint[0] + face.outwardNormal[0] * face.sagAtMid)}
                    y={toScreenY(face.midpoint[1] + face.outwardNormal[1] * face.sagAtMid)}
                    activeHandle={activeHandle}
                    startDrag={startDrag}
                />
            ))}

            <text x={4} y={PANEL_H - 10} fill={TEXT_COLOR} fontSize={9}>
                {component instanceof PolygonScanner
                    ? `${component.numFaces}-face polygon  r=${component.inscribedRadius.toFixed(1)}mm`
                    : `α=${(component.apexAngle * 180 / Math.PI).toFixed(1)}°  h=${component.height.toFixed(1)}mm`}
            </text>
        </>
    );
}

export const LensProfileEditor: React.FC<{ component: OpticalComponent }> = ({ component }) => {
    const [components, setComponents] = useAtom(componentsAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);
    const [activeHandle, setActiveHandle] = useState<HandleId>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);

    const editable = supportsLensProfileEditor(component) ? component : null;
    const scaleStableRef = useRef(1);

    const commitChange = useCallback((mutate: (component: EditableProfileComponent) => void) => {
        const nextComponents = components.map((entry) => {
            if (entry.id !== component.id || !isEditableProfileComponent(entry)) return entry;
            mutate(entry);
            return entry;
        });
        setComponents([...nextComponents]);
    }, [component.id, components, setComponents]);

    useSvgPointerTracking(
        svgRef,
        activeHandle,
        (handle, x, y) => {
            if (!editable) return;

            if (editable instanceof SphericalLens || editable instanceof CylindricalLens) {
                const s = scaleStableRef.current;
                if (handle === 'thickness') {
                    const newThickness = Math.max(0.1, (CENTER_X - x) * 2 / s);
                    commitChange((entry) => {
                        if (entry instanceof SphericalLens || entry instanceof CylindricalLens) {
                            entry.thickness = newThickness;
                            entry.invalidateMesh();
                        }
                    });
                } else if (handle === 'aperture') {
                    const requestedRadius = Math.max(1, (CENTER_Y - y) / s);
                    commitChange((entry) => {
                        if (entry instanceof SphericalLens) {
                            entry.apertureRadius = clampRadiusToLensBody(entry, requestedRadius);
                            entry.invalidateMesh();
                        } else if (entry instanceof CylindricalLens) {
                            let maxRadius = 100;
                            if (Math.abs(entry.r1) < 1e6) maxRadius = Math.min(maxRadius, Math.abs(entry.r1) * 0.95);
                            if (Math.abs(entry.r2) < 1e6) maxRadius = Math.min(maxRadius, Math.abs(entry.r2) * 0.95);
                            entry.apertureRadius = Math.min(requestedRadius, maxRadius);
                            entry.invalidateMesh();
                        }
                    });
                }
                return;
            }

            if (editable instanceof Mirror && !(editable instanceof CurvedMirror)) {
                const s = scaleStableRef.current;
                if (handle === 'thickness') {
                    const newThickness = Math.max(0.5, (CENTER_X - x) * 2 / s);
                    commitChange((entry) => {
                        if (entry instanceof Mirror && !(entry instanceof CurvedMirror)) {
                            entry.thickness = newThickness;
                            entry.version++;
                        }
                    });
                } else if (handle === 'diameter') {
                    const newDiameter = Math.max(2, (CENTER_Y - y) * 2 / s);
                    commitChange((entry) => {
                        if (entry instanceof Mirror && !(entry instanceof CurvedMirror)) {
                            entry.diameter = newDiameter;
                            entry.version++;
                        }
                    });
                }
                return;
            }

            if (editable instanceof CurvedMirror) {
                const s = scaleStableRef.current;
                if (handle === 'diameter') {
                    const newDiameter = Math.max(2, (CENTER_Y - y) * 2 / s);
                    commitChange((entry) => {
                        if (entry instanceof CurvedMirror) {
                            entry.diameter = newDiameter;
                            entry.invalidateMesh();
                        }
                    });
                } else if (handle === 'curvature') {
                    const radius = editable.diameter / 2;
                    const halfT = editable.thickness / 2;
                    const frontVertex = CENTER_X - halfT * s;
                    const sagMm = (x - frontVertex) / s;
                    commitChange((entry) => {
                        if (!(entry instanceof CurvedMirror)) return;
                        entry.radiusOfCurvature = Math.abs(sagMm) < 0.5
                            ? 1e9
                            : (radius * radius + sagMm * sagMm) / (2 * sagMm);
                        entry.invalidateMesh();
                    });
                }
                return;
            }

            if (isPolygonEditable(editable)) {
                const s = scaleStableRef.current;
                if (handle.startsWith('vertex:')) {
                    const index = parseInt(handle.split(':')[1], 10);
                    const profileX = (x - CENTER_X) / s;
                    const profileY = (CENTER_Y - y) / s;
                    commitChange((entry) => {
                        if (isPolygonEditable(entry)) {
                            entry.setEditorDisplayedVertex(index, [profileX, profileY]);
                        }
                    });
                    return;
                }

                if (handle.startsWith('curvature:')) {
                    const index = parseInt(handle.split(':')[1], 10);
                    const face = computePolygonFaceInfo(editable)[index];
                    if (!face) return;
                    const midX = CENTER_X + face.midpoint[0] * s;
                    const midY = CENTER_Y - face.midpoint[1] * s;
                    const normalScreenX = face.outwardNormal[0] * s;
                    const normalScreenY = -face.outwardNormal[1] * s;
                    const normalLen = Math.hypot(normalScreenX, normalScreenY);
                    const projectedPx = normalLen > 0
                        ? ((x - midX) * normalScreenX + (y - midY) * normalScreenY) / normalLen
                        : 0;
                    const sagMm = projectedPx / s;
                    const newRadius = Math.abs(sagMm) < 0.3
                        ? Infinity
                        : ((face.edgeLen / 2) ** 2 + sagMm * sagMm) / (2 * sagMm);
                    commitChange((entry) => {
                        if (isPolygonEditable(entry)) {
                            entry.setFaceCurvature(index, newRadius);
                        }
                    });
                }
            }
        },
        () => setActiveHandle(null),
    );

    const startDrag = useCallback((handle: string) => {
        pushUndo();
        setActiveHandle(handle);
    }, [pushUndo]);

    if (!editable) return null;

    const currentScale = (() => {
        if (editable instanceof SphericalLens || editable instanceof CylindricalLens) {
            return (DRAW_H * 0.8) / Math.max(editable.apertureRadius * 2, editable.thickness, 1);
        }
        if (editable instanceof CurvedMirror) {
            return (DRAW_H * 0.8) / Math.max(editable.diameter, editable.thickness * 2, 1);
        }
        if (editable instanceof Mirror) {
            return (DRAW_H * 0.8) / Math.max(editable.diameter, editable.thickness * 2, 1);
        }
        const polygonEditable = editable as PrismLens | PolygonScanner;
        const vertices = polygonEditable.getEditorProfileVertices();
        const minX = Math.min(...vertices.map((vertex: [number, number]) => vertex[0]));
        const maxX = Math.max(...vertices.map((vertex: [number, number]) => vertex[0]));
        const minY = Math.min(...vertices.map((vertex: [number, number]) => vertex[1]));
        const maxY = Math.max(...vertices.map((vertex: [number, number]) => vertex[1]));
        const span = Math.max(maxX - minX, maxY - minY, 1);
        return (DRAW_H * 0.72) / span;
    })();
    if (!activeHandle) scaleStableRef.current = currentScale;

    return (
        <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
            <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>
                Profile Editor
            </label>
            <div style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid #333' }}>
                <ProfileFrame svgRef={svgRef} activeHandle={activeHandle}>
                    {editable instanceof SphericalLens || editable instanceof CylindricalLens ? (
                        <LensProfilePanel component={editable} activeHandle={activeHandle} startDrag={startDrag} />
                    ) : editable instanceof CurvedMirror ? (
                        <CurvedMirrorPanel component={editable} activeHandle={activeHandle} startDrag={startDrag} />
                    ) : editable instanceof Mirror && !(editable instanceof PrismLens) ? (
                        <FlatMirrorPanel component={editable} activeHandle={activeHandle} startDrag={startDrag} />
                    ) : (
                        <PolygonProfilePanel component={editable as PrismLens | PolygonScanner} activeHandle={activeHandle} startDrag={startDrag} />
                    )}
                </ProfileFrame>
            </div>
            <div style={{ fontSize: '10px', color: '#555', marginTop: 6 }}>
                Drag the pink handles to edit the current cross-section.
            </div>
        </div>
    );
};
