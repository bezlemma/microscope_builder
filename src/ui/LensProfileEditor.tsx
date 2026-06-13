import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { componentsAtom, pushUndoAtom } from '../state/store';
import { OpticalComponent } from '../physics/Component';
import { SphericalLens } from '../physics/components/SphericalLens';
import { AsphericLens, asphereSagDerivative, asphereSagFromApex, type AsphericSurfaceParams } from '../physics/components/AsphericLens';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { Mirror } from '../physics/components/Mirror';
import { CurvedMirror } from '../physics/components/CurvedMirror';
import { AbstractPolygonOptic } from '../physics/components/AbstractPolygonOptic';
import { AchromatDoublet } from '../physics/components/AchromatDoublet';

const PANEL_W = 280;
const PANEL_H = 200;
const DRAW_H = PANEL_H - 40;
const CENTER_X = PANEL_W / 2;
const CENTER_Y = PANEL_H / 2;

const SURFACE_COLOR = '#d9e8ef';
const SURFACE_COLOR_DIM = '#aebdc7';
const DOUBLET_SURFACE1 = '#ffb74d';   // Orange for surface labels
const MIRROR_SURFACE = '#cfd8dc';
const POLYGON_COLOR = '#ffd166';
const RIM_COLOR = '#5f6b72';
const HANDLE_COLOR = '#26313a';
const HANDLE_ACTIVE = '#e7f4ff';
const BG_COLOR = '#14181d';
const AXIS_COLOR = '#303940';
const TEXT_COLOR = '#7d8992';

export type EditableProfileComponent =
    | SphericalLens
    | AsphericLens
    | CylindricalLens
    | Mirror
    | CurvedMirror
    | AbstractPolygonOptic
    | AchromatDoublet;

export type ProfileEditorMutate = (mutate: (component: EditableProfileComponent) => void) => void;

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

export function radiusFromSagAtAperture(sagMm: number, apertureRadius: number): number {
    if (Math.abs(sagMm) < 0.02) return sagMm >= 0 ? 1e9 : -1e9;
    const radius = (apertureRadius * apertureRadius + sagMm * sagMm) / (2 * sagMm);
    const minRadius = apertureRadius * 1.05;
    if (Math.abs(radius) >= minRadius) return radius;
    return Math.sign(radius || sagMm || 1) * minRadius;
}

function radiusFromConicSagAtAperture(sagMm: number, apertureRadius: number, conic: number): number {
    if (Math.abs(sagMm) < 0.02) return sagMm >= 0 ? 1e9 : -1e9;
    const radius = (apertureRadius * apertureRadius + (1 + conic) * sagMm * sagMm) / (2 * sagMm);
    const minRadius = apertureRadius * 1.05;
    if (Math.abs(radius) >= minRadius) return radius;
    return Math.sign(radius || sagMm || 1) * minRadius;
}

function aspherePolynomialSag(surface: AsphericSurfaceParams, r: number): number {
    const r2 = r * r;
    let rp = r2 * r2;
    let z = 0;
    for (let i = 0; i < surface.A.length; i++) {
        z += surface.A[i] * rp;
        rp *= r2;
    }
    return z;
}

function lensSurfaceZ(R: number, apex: number, r: number): number {
    if (Math.abs(R) >= 1e8) return apex;
    const val = R * R - r * r;
    if (val < 0) return apex;
    return (apex + R) - Math.sign(R) * Math.sqrt(val);
}

interface Ray2D {
    z: number;
    r: number;
    dz: number;
    dr: number;
}

export interface LensPreviewRay2D {
    points: Array<{ z: number; r: number }>;
    transmitted: boolean;
}

function normalizeRay2D(ray: Ray2D): Ray2D {
    const len = Math.hypot(ray.dz, ray.dr) || 1;
    return { ...ray, dz: ray.dz / len, dr: ray.dr / len };
}

function dot2D(a: { dz: number; dr: number }, b: { dz: number; dr: number }): number {
    return a.dz * b.dz + a.dr * b.dr;
}

function intersectSphericalSurface2D(ray: Ray2D, apex: number, radius: number): { z: number; r: number } | null {
    const eps = 1e-5;
    if (Math.abs(radius) >= 1e8) {
        if (Math.abs(ray.dz) < 1e-8) return null;
        const t = (apex - ray.z) / ray.dz;
        if (t <= eps) return null;
        return { z: apex, r: ray.r + ray.dr * t };
    }

    const centerZ = apex + radius;
    const oz = ray.z - centerZ;
    const or = ray.r;
    const b = 2 * (oz * ray.dz + or * ray.dr);
    const c = oz * oz + or * or - radius * radius;
    const disc = b * b - 4 * c;
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    const hits = [(-b - root) / 2, (-b + root) / 2].filter(t => t > eps).sort((a, b) => a - b);
    const t = hits[0];
    return t === undefined ? null : { z: ray.z + ray.dz * t, r: ray.r + ray.dr * t };
}

function surfaceNormal2D(point: { z: number; r: number }, apex: number, radius: number): { dz: number; dr: number } {
    if (Math.abs(radius) >= 1e8) return { dz: 1, dr: 0 };
    const len = Math.abs(radius) || 1;
    return { dz: (point.z - (apex + radius)) / len, dr: point.r / len };
}

function asphereSurfaceZ(surface: AsphericSurfaceParams, apex: number, r: number): number {
    return apex + asphereSagFromApex(surface, Math.abs(r));
}

function intersectAsphericSurface2D(
    ray: Ray2D,
    apex: number,
    surface: AsphericSurfaceParams,
    maxT: number,
): { z: number; r: number } | null {
    const eps = 1e-5;
    const samples = 96;
    const valueAt = (t: number) => {
        const z = ray.z + ray.dz * t;
        const r = ray.r + ray.dr * t;
        return z - asphereSurfaceZ(surface, apex, r);
    };

    let prevT = eps;
    let prevV = valueAt(prevT);
    for (let i = 1; i <= samples; i++) {
        const t = eps + (maxT - eps) * i / samples;
        const v = valueAt(t);
        if (Math.abs(v) < 1e-7 || prevV * v <= 0) {
            let lo = prevT;
            let hi = t;
            for (let j = 0; j < 28; j++) {
                const mid = (lo + hi) / 2;
                const vm = valueAt(mid);
                if (prevV * vm <= 0) hi = mid;
                else {
                    lo = mid;
                    prevV = vm;
                }
            }
            const hitT = (lo + hi) / 2;
            return { z: ray.z + ray.dz * hitT, r: ray.r + ray.dr * hitT };
        }
        prevT = t;
        prevV = v;
    }
    return null;
}

function asphericSurfaceNormal2D(point: { z: number; r: number }, surface: AsphericSurfaceParams): { dz: number; dr: number } {
    const slope = asphereSagDerivative(surface, Math.abs(point.r)) * Math.sign(point.r || 1);
    const dz = 1;
    const dr = -slope;
    const len = Math.hypot(dz, dr) || 1;
    return { dz: dz / len, dr: dr / len };
}

function refract2D(direction: { dz: number; dr: number }, normal: { dz: number; dr: number }, nFrom: number, nTo: number): { dz: number; dr: number } | null {
    let n = normal;
    if (dot2D(direction, n) > 0) n = { dz: -n.dz, dr: -n.dr };
    const eta = nFrom / nTo;
    const cosI = -dot2D(n, direction);
    const k = 1 - eta * eta * (1 - cosI * cosI);
    if (k < 0) return null;
    const dz = eta * direction.dz + (eta * cosI - Math.sqrt(k)) * n.dz;
    const dr = eta * direction.dr + (eta * cosI - Math.sqrt(k)) * n.dr;
    const len = Math.hypot(dz, dr) || 1;
    return { dz: dz / len, dr: dr / len };
}

export function traceSphericalLensPreviewRays(
    lens: SphericalLens,
    count: number,
    leftZ: number,
    rightZ: number,
): LensPreviewRay2D[] {
    const { R1, R2 } = lens.getRadii();
    const frontApex = -lens.thickness / 2;
    const backApex = lens.thickness / 2;
    const rayCount = Math.max(2, count);
    const span = lens.apertureRadius * 1.7;
    const rays: LensPreviewRay2D[] = [];

    for (let i = 0; i < rayCount; i++) {
        const r0 = -span / 2 + (span * i) / (rayCount - 1);
        let ray = normalizeRay2D({ z: leftZ, r: r0, dz: 1, dr: 0 });
        const points: Array<{ z: number; r: number }> = [{ z: leftZ, r: r0 }];
        const front = intersectSphericalSurface2D(ray, frontApex, R1);
        if (!front || Math.abs(front.r) > lens.effectiveApertureRadius) {
            points.push({ z: rightZ, r: r0 });
            rays.push({ points, transmitted: false });
            continue;
        }
        points.push(front);

        const frontNormal = surfaceNormal2D(front, frontApex, R1);
        const insideDir = refract2D({ dz: ray.dz, dr: ray.dr }, frontNormal, 1, lens.ior);
        if (!insideDir) {
            rays.push({ points, transmitted: false });
            continue;
        }
        ray = normalizeRay2D({
            z: front.z + insideDir.dz * 1e-4,
            r: front.r + insideDir.dr * 1e-4,
            dz: insideDir.dz,
            dr: insideDir.dr,
        });

        const back = intersectSphericalSurface2D(ray, backApex, R2);
        if (!back || Math.abs(back.r) > lens.effectiveApertureRadius) {
            rays.push({ points, transmitted: false });
            continue;
        }
        points.push(back);

        const backNormal = surfaceNormal2D(back, backApex, R2);
        const exitDir = refract2D({ dz: ray.dz, dr: ray.dr }, backNormal, lens.ior, 1);
        if (!exitDir || Math.abs(exitDir.dz) < 1e-6) {
            rays.push({ points, transmitted: false });
            continue;
        }
        const tOut = (rightZ - back.z) / exitDir.dz;
        points.push({ z: rightZ, r: back.r + exitDir.dr * tOut });
        rays.push({ points, transmitted: true });
    }

    return rays;
}

export function traceCylindricalLensPreviewRays(
    lens: CylindricalLens,
    count: number,
    leftZ: number,
    rightZ: number,
): LensPreviewRay2D[] {
    const frontApex = -lens.thickness / 2;
    const backApex = lens.thickness / 2;
    const rayCount = Math.max(2, count);
    const span = lens.apertureRadius * 1.7;
    const rays: LensPreviewRay2D[] = [];

    for (let i = 0; i < rayCount; i++) {
        const r0 = -span / 2 + (span * i) / (rayCount - 1);
        let ray = normalizeRay2D({ z: leftZ, r: r0, dz: 1, dr: 0 });
        const points: Array<{ z: number; r: number }> = [{ z: leftZ, r: r0 }];
        const front = intersectSphericalSurface2D(ray, frontApex, lens.r1);
        if (!front || Math.abs(front.r) > lens.apertureRadius) {
            points.push({ z: rightZ, r: r0 });
            rays.push({ points, transmitted: false });
            continue;
        }
        points.push(front);

        const frontNormal = surfaceNormal2D(front, frontApex, lens.r1);
        const insideDir = refract2D({ dz: ray.dz, dr: ray.dr }, frontNormal, 1, lens.ior);
        if (!insideDir) {
            rays.push({ points, transmitted: false });
            continue;
        }
        ray = normalizeRay2D({
            z: front.z + insideDir.dz * 1e-4,
            r: front.r + insideDir.dr * 1e-4,
            dz: insideDir.dz,
            dr: insideDir.dr,
        });

        const back = intersectSphericalSurface2D(ray, backApex, lens.r2);
        if (!back || Math.abs(back.r) > lens.apertureRadius) {
            rays.push({ points, transmitted: false });
            continue;
        }
        points.push(back);

        const backNormal = surfaceNormal2D(back, backApex, lens.r2);
        const exitDir = refract2D({ dz: ray.dz, dr: ray.dr }, backNormal, lens.ior, 1);
        if (!exitDir || Math.abs(exitDir.dz) < 1e-6) {
            rays.push({ points, transmitted: false });
            continue;
        }
        const tOut = (rightZ - back.z) / exitDir.dz;
        points.push({ z: rightZ, r: back.r + exitDir.dr * tOut });
        rays.push({ points, transmitted: true });
    }

    return rays;
}

function cylindricalParaxialFocalLength(lens: CylindricalLens): number {
    const flat1 = Math.abs(lens.r1) >= 1e8;
    const flat2 = Math.abs(lens.r2) >= 1e8;
    const invR1 = flat1 ? 0 : 1 / lens.r1;
    const invR2 = flat2 ? 0 : 1 / lens.r2;
    const thickTerm = flat1 || flat2 ? 0 : ((lens.ior - 1) ** 2 * lens.thickness) / (lens.ior * lens.r1 * lens.r2);
    const invF = (lens.ior - 1) * (invR1 - invR2) + thickTerm;
    return Math.abs(invF) < 1e-12 ? 1e6 : 1 / invF;
}

export function traceAsphericLensPreviewRays(
    lens: AsphericLens,
    count: number,
    leftZ: number,
    rightZ: number,
): LensPreviewRay2D[] {
    const frontApex = -lens.thickness / 2;
    const backApex = lens.thickness / 2;
    const rayCount = Math.max(2, count);
    const span = lens.apertureRadius * 1.7;
    const rays: LensPreviewRay2D[] = [];
    const maxT = Math.max(1, (rightZ - leftZ) * 1.25);

    for (let i = 0; i < rayCount; i++) {
        const r0 = -span / 2 + (span * i) / (rayCount - 1);
        let ray = normalizeRay2D({ z: leftZ, r: r0, dz: 1, dr: 0 });
        const points: Array<{ z: number; r: number }> = [{ z: leftZ, r: r0 }];

        const front = intersectAsphericSurface2D(ray, frontApex, lens.frontSurface, maxT);
        if (!front || Math.abs(front.r) > lens.apertureRadius) {
            points.push({ z: rightZ, r: r0 });
            rays.push({ points, transmitted: false });
            continue;
        }
        points.push(front);

        const insideDir = refract2D(
            { dz: ray.dz, dr: ray.dr },
            asphericSurfaceNormal2D(front, lens.frontSurface),
            1,
            lens.ior,
        );
        if (!insideDir) {
            rays.push({ points, transmitted: false });
            continue;
        }
        ray = normalizeRay2D({
            z: front.z + insideDir.dz * 1e-4,
            r: front.r + insideDir.dr * 1e-4,
            dz: insideDir.dz,
            dr: insideDir.dr,
        });

        const back = intersectAsphericSurface2D(ray, backApex, lens.backSurface, maxT);
        if (!back || Math.abs(back.r) > lens.apertureRadius) {
            rays.push({ points, transmitted: false });
            continue;
        }
        points.push(back);

        const exitDir = refract2D(
            { dz: ray.dz, dr: ray.dr },
            asphericSurfaceNormal2D(back, lens.backSurface),
            lens.ior,
            1,
        );
        if (!exitDir || Math.abs(exitDir.dz) < 1e-6) {
            rays.push({ points, transmitted: false });
            continue;
        }
        const tOut = (rightZ - back.z) / exitDir.dz;
        points.push({ z: rightZ, r: back.r + exitDir.dr * tOut });
        rays.push({ points, transmitted: true });
    }

    return rays;
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

function lensBodyPolygon(profile: { front: number[]; back: number[] }): number[] {
    const frontPointCount = profile.front.length / 2;
    const half = frontPointCount / 2;
    const polygon: number[] = [];
    const pushPair = (points: number[], index: number) => {
        polygon.push(points[index * 2], points[index * 2 + 1]);
    };

    for (let i = half - 1; i >= 0; i--) pushPair(profile.front, i);
    for (let i = frontPointCount - 1; i >= half; i--) pushPair(profile.front, i);
    for (let i = half; i < frontPointCount; i++) pushPair(profile.back, i);
    for (let i = 0; i < half; i++) pushPair(profile.back, i);
    return polygon;
}

function splitLensSurface(points: number[]): { upper: number[]; lower: number[] } {
    const pointCount = points.length / 2;
    const half = pointCount / 2;
    const upper = points.slice(0, half * 2);
    const lower = points.slice(half * 2);
    return { upper, lower };
}

function isPolygonEditable(component: OpticalComponent): component is AbstractPolygonOptic {
    return component instanceof AbstractPolygonOptic;
}

function isEditableProfileComponent(component: OpticalComponent): component is EditableProfileComponent {
    return (
        component instanceof SphericalLens ||
        component instanceof AsphericLens ||
        component instanceof CylindricalLens ||
        component instanceof Mirror ||
        component instanceof CurvedMirror ||
        component instanceof AbstractPolygonOptic ||
        component instanceof AchromatDoublet
    );
}

export function supportsLensProfileEditor(component: OpticalComponent | null | undefined): boolean {
    return !!component && isEditableProfileComponent(component);
}

function ProfileHandle({
    id,
    x,
    y,
    label,
    activeHandle,
    startDrag,
}: {
    id: string;
    x: number;
    y: number;
    label?: string;
    activeHandle: HandleId;
    startDrag: (id: string) => void;
}) {
    const active = activeHandle === id;
    const width = label ? Math.max(24, label.length * 8 + 12) : 13;
    const height = label ? 17 : 13;
    return (
        <g
            style={{ cursor: 'grab' }}
            onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                startDrag(id);
            }}
        >
            {label ? (
                <>
                    <rect
                        x={x - width / 2}
                        y={y - height / 2}
                        width={width}
                        height={height}
                        rx={4}
                        fill={active ? HANDLE_ACTIVE : HANDLE_COLOR}
                        stroke={active ? '#ffffff' : '#98a8b2'}
                        strokeWidth={1}
                    />
                    <text
                        x={x}
                        y={y + 3}
                        fill={active ? '#071219' : '#d6e2e9'}
                        fontSize={9}
                        fontWeight={800}
                        textAnchor="middle"
                        pointerEvents="none"
                    >
                        {label}
                    </text>
                </>
            ) : (
                <circle
                    cx={x}
                    cy={y}
                    r={active ? 7 : 6}
                    fill={active ? HANDLE_ACTIVE : HANDLE_COLOR}
                    stroke={active ? '#ffffff' : '#98a8b2'}
                    strokeWidth={1}
                />
            )}
            <title>{label ?? id}</title>
            {!label && active && (
                <text
                    x={x + 8}
                    y={y - 8}
                    fill="#d6e2e9"
                    fontSize={9}
                    fontWeight={700}
                    pointerEvents="none"
                >
                    {id}
                </text>
            )}
        </g>
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
            <line
                x1={10}
                y1={CENTER_Y}
                x2={PANEL_W - 10}
                y2={CENTER_Y}
                stroke={AXIS_COLOR}
                strokeWidth={1}
                strokeDasharray="5 5"
                opacity={0.55}
            />
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
    const gradientId = `lens-profile-${useId().replace(/:/g, '')}`;
    const sphericalCurvature = isCylindrical ? 0 : component.curvature;
    const r1Value = component.r1;
    const r2Value = component.r2;
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
    }, [
        isCylindrical,
        activeHandle,
        component.apertureRadius,
        component.thickness,
        component.ior,
        sphericalCurvature,
        r1Value,
        r2Value,
    ]);

    const radii = isCylindrical ? { R1: component.r1, R2: component.r2 } : component.getRadii();
    const backApexX = CENTER_X + (component.thickness / 2) * scaleRef.current;
    const topEdgeY = CENTER_Y - component.apertureRadius * scaleRef.current;
    const frontEdgeZ = lensSurfaceZ(radii.R1, -component.thickness / 2, component.apertureRadius);
    const backEdgeZ = lensSurfaceZ(radii.R2, component.thickness / 2, component.apertureRadius);
    const frontRadiusX = CENTER_X + frontEdgeZ * scaleRef.current;
    const backRadiusX = CENTER_X + backEdgeZ * scaleRef.current;
    const profileFill = pointsToAttr(lensBodyPolygon(profile));
    const frontSurface = splitLensSurface(profile.front);
    const backSurface = splitLensSurface(profile.back);
    const topTrackY = 18;
    const secondTrackY = 38;
    const bottomTrackY = Math.min(PANEL_H - 18, CENTER_Y + component.apertureRadius * scaleRef.current + 22);
    const apertureHandleX = PANEL_W - 24;
    const apertureHandleY = Math.max(18, Math.min(PANEL_H - 18, topEdgeY));
    const previewRays = useMemo(() => {
        const leftZ = (12 - CENTER_X) / scaleRef.current;
        const rightZ = (PANEL_W - 12 - CENTER_X) / scaleRef.current;
        return isCylindrical
            ? traceCylindricalLensPreviewRays(component, 10, leftZ, rightZ)
            : traceSphericalLensPreviewRays(component, 10, leftZ, rightZ);
    }, [
        component,
        isCylindrical,
        activeHandle,
        component.apertureRadius,
        component.thickness,
        component.ior,
        sphericalCurvature,
        r1Value,
        r2Value,
    ]);

    const pointToScreen = (point: { z: number; r: number }) => `${CENTER_X + point.z * scaleRef.current},${CENTER_Y - point.r * scaleRef.current}`;

    return (
        <>
            <defs>
                <linearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="0%">
                    <stop offset="0%" stopColor="#dcecf2" stopOpacity="0.36" />
                    <stop offset="48%" stopColor="#8aa6b3" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#dcecf2" stopOpacity="0.36" />
                </linearGradient>
            </defs>

            {previewRays.map((ray, index) => (
                <polyline
                    key={`preview-ray-${index}`}
                    points={ray.points.map(pointToScreen).join(' ')}
                    fill="none"
                    stroke={ray.transmitted ? '#c49a63' : '#6f6254'}
                    strokeWidth={index === Math.floor(previewRays.length / 2) ? 1.1 : 0.7}
                    opacity={ray.transmitted ? 0.55 : 0.24}
                />
            ))}

            <polygon points={profileFill} fill={`url(#${gradientId})`} stroke="rgba(226, 248, 255, 0.08)" strokeWidth={1} />
            <polyline points={pointsToAttr(frontSurface.upper)} fill="none" stroke={SURFACE_COLOR} strokeWidth={2.4} />
            <polyline points={pointsToAttr(frontSurface.lower)} fill="none" stroke={SURFACE_COLOR} strokeWidth={2.4} />
            <polyline points={pointsToAttr(backSurface.upper)} fill="none" stroke={SURFACE_COLOR_DIM} strokeWidth={2.4} />
            <polyline points={pointsToAttr(backSurface.lower)} fill="none" stroke={SURFACE_COLOR_DIM} strokeWidth={2.4} />

            <ProfileHandle id="curvature:r1" label={isCylindrical ? 'Front' : 'R1'} x={frontRadiusX} y={topTrackY} activeHandle={activeHandle} startDrag={startDrag} />
            <ProfileHandle id="curvature:r2" label={isCylindrical ? 'Back' : 'R2'} x={backRadiusX} y={secondTrackY} activeHandle={activeHandle} startDrag={startDrag} />
            <ProfileHandle id="thickness:back" label="T" x={backApexX} y={bottomTrackY} activeHandle={activeHandle} startDrag={startDrag} />
            <ProfileHandle id="aperture" label="A" x={apertureHandleX} y={apertureHandleY} activeHandle={activeHandle} startDrag={startDrag} />

            <text x={4} y={PANEL_H - 10} fill={TEXT_COLOR} fontSize={9}>
                {isCylindrical ? `f=${cylindricalParaxialFocalLength(component).toFixed(1)}mm` : `f=${component.focalLength.toFixed(1)}mm`}
            </text>
        </>
    );
}

function asphericProfileToScreen(
    component: AsphericLens,
    scale: number,
    segments: number = 48,
): { front: number[]; back: number[]; rim: number[] } {
    const front = component.frontSurface;
    const back = component.backSurface;
    const apertureRadius = component.apertureRadius;
    const thickness = component.thickness;
    const frontApex = -thickness / 2;
    const backApex = thickness / 2;
    const frontPts: number[] = [];
    const backPts: number[] = [];

    for (let i = 0; i <= segments; i++) {
        const r = (i / segments) * apertureRadius;
        const fz = frontApex + asphereSagFromApex(front, r);
        const bz = backApex + asphereSagFromApex(back, r);
        frontPts.push(CENTER_X + fz * scale, CENTER_Y - r * scale);
        backPts.push(CENTER_X + bz * scale, CENTER_Y - r * scale);
    }
    for (let i = segments; i >= 0; i--) {
        const r = (i / segments) * apertureRadius;
        const fz = frontApex + asphereSagFromApex(front, r);
        const bz = backApex + asphereSagFromApex(back, r);
        frontPts.push(CENTER_X + fz * scale, CENTER_Y + r * scale);
        backPts.push(CENTER_X + bz * scale, CENTER_Y + r * scale);
    }

    const rimTopF = frontApex + asphereSagFromApex(front, apertureRadius);
    const rimTopB = backApex + asphereSagFromApex(back, apertureRadius);
    const rim = [
        CENTER_X + rimTopF * scale, CENTER_Y - apertureRadius * scale,
        CENTER_X + rimTopB * scale, CENTER_Y - apertureRadius * scale,
        CENTER_X + rimTopB * scale, CENTER_Y + apertureRadius * scale,
        CENTER_X + rimTopF * scale, CENTER_Y + apertureRadius * scale,
    ];
    return { front: frontPts, back: backPts, rim };
}

function AsphericLensProfilePanel({
    component,
    activeHandle,
    startDrag,
}: {
    component: AsphericLens;
    activeHandle: HandleId;
    startDrag: (id: string) => void;
}) {
    const gradientId = `asphere-profile-${useId().replace(/:/g, '')}`;
    const scale = useMemo(
        () => (DRAW_H * 0.8) / Math.max(component.apertureRadius * 2, component.thickness, 1),
        [component.apertureRadius, component.thickness],
    );
    const scaleRef = useRef(scale);
    if (!activeHandle) scaleRef.current = scale;

    const profile = useMemo(
        () => asphericProfileToScreen(component, scaleRef.current),
        [
            component,
            component.r1, component.r2, component.k1, component.k2,
            component.A1, component.A2, component.apertureRadius, component.thickness,
            activeHandle,
        ],
    );

    const profileFill = pointsToAttr(lensBodyPolygon(profile));
    const frontSurface = splitLensSurface(profile.front);
    const backSurface = splitLensSurface(profile.back);
    const frontApexX = CENTER_X + (-component.thickness / 2) * scaleRef.current;
    const backApexX = CENTER_X + (component.thickness / 2) * scaleRef.current;
    const topEdgeY = CENTER_Y - component.apertureRadius * scaleRef.current;
    const frontEdgeZ = -component.thickness / 2 + asphereSagFromApex(component.frontSurface, component.apertureRadius);
    const backEdgeZ = component.thickness / 2 + asphereSagFromApex(component.backSurface, component.apertureRadius);
    const frontRadiusX = CENTER_X + frontEdgeZ * scaleRef.current;
    const backRadiusX = CENTER_X + backEdgeZ * scaleRef.current;
    const apertureHandleY = Math.max(18, Math.min(PANEL_H - 18, topEdgeY));
    const bottomTrackY = Math.min(PANEL_H - 18, CENTER_Y + component.apertureRadius * scaleRef.current + 22);
    const fLabel = Math.abs(component.focalLength) < 1e5 ? `f=${component.focalLength.toFixed(1)}mm` : 'f=∞';
    const previewRays = useMemo(() => {
        const leftZ = (12 - CENTER_X) / scaleRef.current;
        const rightZ = (PANEL_W - 12 - CENTER_X) / scaleRef.current;
        return traceAsphericLensPreviewRays(component, 10, leftZ, rightZ);
    }, [
        component,
        activeHandle,
        component.r1,
        component.r2,
        component.k1,
        component.k2,
        component.A1,
        component.A2,
        component.apertureRadius,
        component.thickness,
        component.ior,
    ]);
    const pointToScreen = (point: { z: number; r: number }) => `${CENTER_X + point.z * scaleRef.current},${CENTER_Y - point.r * scaleRef.current}`;

    return (
        <>
            <defs>
                <linearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="0%">
                    <stop offset="0%" stopColor="#dcecf2" stopOpacity="0.36" />
                    <stop offset="48%" stopColor="#8aa6b3" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#dcecf2" stopOpacity="0.36" />
                </linearGradient>
            </defs>

            {previewRays.map((ray, index) => (
                <polyline
                    key={`asphere-preview-ray-${index}`}
                    points={ray.points.map(pointToScreen).join(' ')}
                    fill="none"
                    stroke={ray.transmitted ? '#c49a63' : '#6f6254'}
                    strokeWidth={index === Math.floor(previewRays.length / 2) ? 1.1 : 0.7}
                    opacity={ray.transmitted ? 0.55 : 0.24}
                />
            ))}

            <polygon points={profileFill} fill={`url(#${gradientId})`} stroke="rgba(226, 248, 255, 0.08)" strokeWidth={1} />
            <polyline points={pointsToAttr(frontSurface.upper)} fill="none" stroke={SURFACE_COLOR} strokeWidth={2.4} />
            <polyline points={pointsToAttr(frontSurface.lower)} fill="none" stroke={SURFACE_COLOR} strokeWidth={2.4} />
            <polyline points={pointsToAttr(backSurface.upper)} fill="none" stroke={SURFACE_COLOR_DIM} strokeWidth={2.4} />
            <polyline points={pointsToAttr(backSurface.lower)} fill="none" stroke={SURFACE_COLOR_DIM} strokeWidth={2.4} />

            <ProfileHandle id="curvature:r1" label="Front" x={frontRadiusX} y={18} activeHandle={activeHandle} startDrag={startDrag} />
            <ProfileHandle id="curvature:r2" label="Back" x={backRadiusX} y={38} activeHandle={activeHandle} startDrag={startDrag} />
            <ProfileHandle id="thickness:back" label="T" x={backApexX} y={bottomTrackY} activeHandle={activeHandle} startDrag={startDrag} />
            <ProfileHandle id="aperture" label="D" x={PANEL_W - 24} y={apertureHandleY} activeHandle={activeHandle} startDrag={startDrag} />

            <text x={frontApexX - 2} y={CENTER_Y + 18} fill="#888" fontSize={9}>front</text>
            <text x={4} y={PANEL_H - 10} fill={TEXT_COLOR} fontSize={9}>
                {`Asphere  ${fLabel}  k1=${component.k1.toFixed(2)}  k2=${component.k2.toFixed(2)}`}
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

    // CurvedMirror sag convention: concave (R > 0) bows toward the light
    // (-z), i.e. mirror sag = -sagFromZero(R, r).
    const frontPts: number[] = [];
    const segs = 40;
    for (let i = 0; i <= segs; i++) {
        const r = (i / segs) * radius;
        frontPts.push(CENTER_X + (-halfT - sagFromZero(component.radiusOfCurvature, r)) * scaleRef.current, CENTER_Y - r * scaleRef.current);
    }
    for (let i = segs; i >= 0; i--) {
        const r = (i / segs) * radius;
        frontPts.push(CENTER_X + (-halfT - sagFromZero(component.radiusOfCurvature, r)) * scaleRef.current, CENTER_Y + r * scaleRef.current);
    }

    const backX = CENTER_X + halfT * scaleRef.current;
    const frontEdgeX = CENTER_X + (-halfT - sagFromZero(component.radiusOfCurvature, radius)) * scaleRef.current;
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

function computePolygonFaceInfo(component: AbstractPolygonOptic): PolygonFaceInfo[] {
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
    component: AbstractPolygonOptic;
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

    const faceLabels = component.numFaces === 3
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
                {`${component.numFaces}-face polygon  r=${component.inscribedRadius.toFixed(1)}mm`}
            </text>
        </>
    );
}

function doubletSag(R: number, apex: number, r: number): number {
    if (Math.abs(R) >= 1e8) return apex;
    const val = R * R - r * r;
    if (val < 0) return apex;
    return (apex + R) - Math.sign(R) * Math.sqrt(val);
}

const DOUBLET_SELECTED = '#64b5f6';  // Blue for selected surface
const DOUBLET_DIM = '#444';          // Dim for unselected surfaces

function AchromatDoubletPanel({
    component,
    activeHandle,
    startDrag,
    selectedSurface,
    onSelectSurface,
}: {
    component: AchromatDoublet;
    activeHandle: HandleId;
    startDrag: (id: string) => void;
    selectedSurface: number;
    onSelectSurface: (s: number) => void;
}) {
    const totalT = component.totalThickness;
    const a = component.apertureRadius;
    const frontApex = -totalT / 2;
    const backApex = totalT / 2;
    const cZ = component.cementZ;

    // Vertical scale: fit aperture diameter to panel height.
    // Horizontal scale: exaggerate so curves are distinguishable, capped at 3x vertical.
    const { sx, sy } = useMemo(() => {
        const syVal = (DRAW_H * 0.8) / Math.max(a * 2, 1);
        let zMin = Infinity, zMax = -Infinity;
        for (let i = 0; i <= 32; i++) {
            const r = (i / 32) * a;
            const z1 = doubletSag(component.r1, frontApex, r);
            const z2 = doubletSag(component.r2, cZ, r);
            const z3 = doubletSag(component.r3, backApex, r);
            zMin = Math.min(zMin, z1, z2, z3);
            zMax = Math.max(zMax, z1, z2, z3);
        }
        const zExtent = Math.max(zMax - zMin, 0.1);
        const sxFromZ = (PANEL_W * 0.4) / zExtent;
        // Cap horizontal exaggeration at 3x vertical scale
        const sxVal = Math.min(sxFromZ, syVal * 3);
        return { sx: Math.max(sxVal, syVal), sy: syVal };
    }, [component.r1, component.r2, component.r3, a, frontApex, backApex, cZ]);

    const sxRef = useRef(sx);
    const syRef = useRef(sy);
    if (!activeHandle) { sxRef.current = sx; syRef.current = sy; }

    const segments = 40;

    // Surface definitions
    const surfaceDefs = [
        { R: component.r1, apex: frontApex, idx: 1 },
        { R: component.r2, apex: cZ, idx: 2 },
        { R: component.r3, apex: backApex, idx: 3 },
    ];

    const hx = sxRef.current;
    const hy = syRef.current;

    // Generate curve points for each surface (top-to-bottom)
    const surfaceCurves = surfaceDefs.map(sd => {
        const pts: number[] = [];
        for (let i = segments; i >= 0; i--) {
            const r = (i / segments) * a;
            pts.push(CENTER_X + doubletSag(sd.R, sd.apex, r) * hx, CENTER_Y + r * hy);
        }
        for (let i = 1; i <= segments; i++) {
            const r = (i / segments) * a;
            pts.push(CENTER_X + doubletSag(sd.R, sd.apex, r) * hx, CENTER_Y - r * hy);
        }
        return { ...sd, pts };
    });

    // Rim lines
    const frontEdgeZ = doubletSag(component.r1, frontApex, a);
    const backEdgeZ = doubletSag(component.r3, backApex, a);
    const topY = CENTER_Y - a * hy;
    const bottomY = CENTER_Y + a * hy;

    // Filled body outline
    const fillPts: number[] = [];
    for (let i = 0; i <= segments; i++) {
        const r = (i / segments) * a;
        fillPts.push(CENTER_X + doubletSag(component.r1, frontApex, r) * hx, CENTER_Y - r * hy);
    }
    fillPts.push(CENTER_X + backEdgeZ * hx, CENTER_Y - a * hy);
    for (let i = segments; i >= 0; i--) {
        const r = (i / segments) * a;
        fillPts.push(CENTER_X + doubletSag(component.r3, backApex, r) * hx, CENTER_Y + r * hy);
    }
    fillPts.push(CENTER_X + frontEdgeZ * hx, CENTER_Y + a * hy);

    // Handle position for selected surface at top edge
    const selSurface = surfaceCurves.find(sc => sc.idx === selectedSurface)!;
    const handleX = CENTER_X + doubletSag(selSurface.R, selSurface.apex, a) * hx;

    // Label X positions
    const labelPositions = surfaceDefs.map(sd => ({
        idx: sd.idx,
        x: CENTER_X + sd.apex * hx,
    }));
    const labelY = PANEL_H - 8;

    const surfaceColor = (idx: number) => idx === selectedSurface ? DOUBLET_SELECTED : DOUBLET_DIM;
    const surfaceWidth = (idx: number) => idx === selectedSurface ? 3 : 1.5;

    return (
        <>
            {/* Filled body */}
            <polygon points={pointsToAttr(fillPts)} fill="rgba(255, 183, 77, 0.06)" stroke="transparent" />
            {/* Optical axis dashed line */}
            <line x1={CENTER_X + frontApex * hx - 10} y1={CENTER_Y} x2={CENTER_X + backApex * hx + 10} y2={CENTER_Y}
                stroke={AXIS_COLOR} strokeWidth={1} strokeDasharray="4 3" />
            {/* Surface curves — click to select */}
            {surfaceCurves.map(sc => (
                <React.Fragment key={`surface-${sc.idx}`}>
                    <polyline
                        points={pointsToAttr(sc.pts)}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={12}
                        style={{ cursor: 'pointer' }}
                        onPointerDown={(e) => { e.stopPropagation(); onSelectSurface(sc.idx); }}
                    />
                    <polyline
                        points={pointsToAttr(sc.pts)}
                        fill="none"
                        stroke={surfaceColor(sc.idx)}
                        strokeWidth={surfaceWidth(sc.idx)}
                        style={{ cursor: 'pointer', pointerEvents: 'none' }}
                    />
                </React.Fragment>
            ))}
            {/* Rim lines */}
            <line x1={CENTER_X + frontEdgeZ * hx} y1={topY} x2={CENTER_X + backEdgeZ * hx} y2={topY} stroke={RIM_COLOR} strokeWidth={1} />
            <line x1={CENTER_X + frontEdgeZ * hx} y1={bottomY} x2={CENTER_X + backEdgeZ * hx} y2={bottomY} stroke={RIM_COLOR} strokeWidth={1} />
            {/* Curvature handle at top edge — drag left/right to change R */}
            <ProfileHandle id={`curvature:${selectedSurface}`} x={handleX} y={topY} activeHandle={activeHandle} startDrag={startDrag} />
            {/* Position handle on axis — drag left/right to move surface (changes t1/t2) */}
            <ProfileHandle id={`position:${selectedSurface}`} x={CENTER_X + selSurface.apex * hx} y={CENTER_Y} activeHandle={activeHandle} startDrag={startDrag} />
            {/* Surface labels — clickable */}
            {labelPositions.map(lp => (
                <text
                    key={`label-${lp.idx}`}
                    x={lp.x}
                    y={labelY}
                    fill={lp.idx === selectedSurface ? DOUBLET_SELECTED : DOUBLET_SURFACE1}
                    fontSize={11}
                    fontWeight="bold"
                    textAnchor="middle"
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => { e.stopPropagation(); onSelectSurface(lp.idx); }}
                >
                    {lp.idx}
                </text>
            ))}
            {/* Info text */}
            <text x={4} y={PANEL_H - 10} fill={TEXT_COLOR} fontSize={9}>
                {`S${selectedSurface}  R=${(selectedSurface === 1 ? component.r1 : selectedSurface === 2 ? component.r2 : component.r3).toFixed(1)}mm`}
            </text>
        </>
    );
}

export const LensProfileEditorCore: React.FC<{
    component: OpticalComponent;
    onMutate: ProfileEditorMutate;
    onEditStart?: () => void;
    title?: string;
}> = ({ component, onMutate, onEditStart, title = 'Profile Editor' }) => {
    const [activeHandle, setActiveHandle] = useState<HandleId>(null);
    const [doubletSelectedSurface, setDoubletSelectedSurface] = useState(1);
    const svgRef = useRef<SVGSVGElement | null>(null);

    const editable = supportsLensProfileEditor(component) ? component : null;
    const scaleStableRef = useRef(1);

    const commitChange = useCallback((mutate: (component: EditableProfileComponent) => void) => {
        onMutate(mutate);
    }, [onMutate]);

    useSvgPointerTracking(
        svgRef,
        activeHandle,
        (handle, x, y) => {
            if (!editable) return;

            if (editable instanceof AchromatDoublet) {
                const aR = editable.apertureRadius;
                const totalT = editable.totalThickness;
                const frontApex = -totalT / 2;
                const backApex = totalT / 2;
                const cZ = editable.cementZ;
                // Compute the same sx scale used by the panel rendering
                let zMin = Infinity, zMax = -Infinity;
                for (let i = 0; i <= 32; i++) {
                    const r = (i / 32) * aR;
                    const z1 = doubletSag(editable.r1, frontApex, r);
                    const z2 = doubletSag(editable.r2, cZ, r);
                    const z3 = doubletSag(editable.r3, backApex, r);
                    zMin = Math.min(zMin, z1, z2, z3);
                    zMax = Math.max(zMax, z1, z2, z3);
                }
                const zExtent = Math.max(zMax - zMin, 0.1);
                const syDrag = (DRAW_H * 0.8) / Math.max(aR * 2, 1);
                const sxFromZ = (PANEL_W * 0.4) / zExtent;
                const sxDrag = Math.min(sxFromZ, syDrag * 3);
                const sc = Math.max(sxDrag, syDrag);

                if (handle.startsWith('curvature:')) {
                    const surfaceIdx = parseInt(handle.split(':')[1], 10);
                    const apexZ = surfaceIdx === 1 ? frontApex
                        : surfaceIdx === 2 ? cZ
                        : backApex;
                    const apexScreenX = CENTER_X + apexZ * sc;
                    const sagMm = (x - apexScreenX) / sc;
                    // Convert sag to radius of curvature: R = (r² + sag²) / (2 * sag)
                    let newR = Math.abs(sagMm) < 0.3
                        ? 1e9
                        : (aR * aR + sagMm * sagMm) / (2 * sagMm);
                    // Clamp: |R| must be > apertureRadius to keep surface valid
                    const minR = aR * 1.1;
                    if (Math.abs(newR) < minR && Math.abs(newR) < 1e8) {
                        newR = newR > 0 ? minR : -minR;
                    }
                    commitChange((entry) => {
                        if (entry instanceof AchromatDoublet) {
                            if (surfaceIdx === 1) entry.r1 = newR;
                            else if (surfaceIdx === 2) entry.r2 = newR;
                            else entry.r3 = newR;
                            entry.invalidateMesh();
                        }
                    });
                } else if (handle.startsWith('position:')) {
                    const surfaceIdx = parseInt(handle.split(':')[1], 10);
                    const desiredZ = (x - CENTER_X) / sc;
                    const gap = 0.01; // AchromatDoublet.CEMENT_GAP
                    const minT = 0.5;
                    commitChange((entry) => {
                        if (!(entry instanceof AchromatDoublet)) return;
                        if (surfaceIdx === 1) {
                            // Front surface: frontApex = -(t1+t2+gap)/2
                            // new_t1 = -2*desiredZ - t2 - gap
                            const newT1 = Math.max(minT, -2 * desiredZ - entry.t2 - gap);
                            entry.t1 = newT1;
                        } else if (surfaceIdx === 2) {
                            // Cement: cementZ = -(t1+t2+gap)/2 + t1
                            // new_t1 = desiredZ + totalT/2, keep total t1+t2 constant
                            const sum = entry.t1 + entry.t2;
                            const curTotalT = sum + gap;
                            const newT1 = Math.max(minT, Math.min(sum - minT, desiredZ + curTotalT / 2));
                            entry.t1 = newT1;
                            entry.t2 = sum - newT1;
                        } else {
                            // Back surface: backApex = (t1+t2+gap)/2
                            // new_t2 = 2*desiredZ - t1 - gap
                            const newT2 = Math.max(minT, 2 * desiredZ - entry.t1 - gap);
                            entry.t2 = newT2;
                        }
                        entry.invalidateMesh();
                    });
                }
                return;
            }

            if (editable instanceof AsphericLens) {
                const s = scaleStableRef.current;
                if (handle === 'thickness' || handle.startsWith('thickness:')) {
                    const z = (x - CENTER_X) / s;
                    const newThickness = handle === 'thickness:back'
                        ? Math.max(0.1, z * 2)
                        : Math.max(0.1, -z * 2);
                    commitChange((entry) => {
                        if (entry instanceof AsphericLens) {
                            entry.thickness = newThickness;
                            entry.recomputeBounds();
                            entry.invalidateMesh();
                        }
                    });
                } else if (handle === 'aperture') {
                    const requestedRadius = Math.max(1, (CENTER_Y - y) / s);
                    commitChange((entry) => {
                        if (entry instanceof AsphericLens) {
                            entry.apertureRadius = requestedRadius;
                            entry.recomputeBounds();
                            entry.invalidateMesh();
                        }
                    });
                } else if (handle === 'curvature:r1' || handle === 'curvature:r2') {
                    const edgeZ = (x - CENTER_X) / s;
                    commitChange((entry) => {
                        if (!(entry instanceof AsphericLens)) return;
                        const frontApex = -entry.thickness / 2;
                        const backApex = entry.thickness / 2;
                        if (handle === 'curvature:r1') {
                            const polynomialSag = aspherePolynomialSag(entry.frontSurface, entry.apertureRadius);
                            entry.r1 = radiusFromConicSagAtAperture(edgeZ - frontApex - polynomialSag, entry.apertureRadius, entry.k1);
                        } else {
                            const polynomialSag = aspherePolynomialSag(entry.backSurface, entry.apertureRadius);
                            entry.r2 = radiusFromConicSagAtAperture(edgeZ - backApex - polynomialSag, entry.apertureRadius, entry.k2);
                        }
                        entry.recomputeBounds();
                        entry.invalidateMesh();
                    });
                }
                return;
            }

            if (editable instanceof SphericalLens || editable instanceof CylindricalLens) {
                const s = scaleStableRef.current;
                if (handle === 'thickness' || handle.startsWith('thickness:')) {
                    const z = (x - CENTER_X) / s;
                    const newThickness = handle === 'thickness:back'
                        ? Math.max(0.1, z * 2)
                        : Math.max(0.1, -z * 2);
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
                } else if (handle === 'curvature:r1' || handle === 'curvature:r2') {
                    const edgeZ = (x - CENTER_X) / s;
                    commitChange((entry) => {
                        if (entry instanceof SphericalLens) {
                            const old = entry.getRadii();
                            const frontApex = -entry.thickness / 2;
                            const backApex = entry.thickness / 2;
                            if (handle === 'curvature:r1') {
                                entry.r1 = radiusFromSagAtAperture(edgeZ - frontApex, entry.apertureRadius);
                                if (entry.r2 === undefined) entry.r2 = old.R2;
                            } else {
                                entry.r2 = radiusFromSagAtAperture(edgeZ - backApex, entry.apertureRadius);
                                if (entry.r1 === undefined) entry.r1 = old.R1;
                            }
                            entry.invalidateMesh();
                        } else if (entry instanceof CylindricalLens) {
                            const frontApex = -entry.thickness / 2;
                            const backApex = entry.thickness / 2;
                            if (handle === 'curvature:r1') {
                                entry.r1 = radiusFromSagAtAperture(edgeZ - frontApex, entry.apertureRadius);
                            } else {
                                entry.r2 = radiusFromSagAtAperture(edgeZ - backApex, entry.apertureRadius);
                            }
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
                        // Mirror sag is -r^2/(2R): dragging the surface toward
                        // the light (negative sag) means concave (R > 0).
                        entry.radiusOfCurvature = Math.abs(sagMm) < 0.5
                            ? 1e9
                            : -(radius * radius + sagMm * sagMm) / (2 * sagMm);
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
        onEditStart?.();
        setActiveHandle(handle);
    }, [onEditStart]);

    if (!editable) return null;

    const currentScale = (() => {
        if (editable instanceof AchromatDoublet) {
            // Return the vertical scale (for aperture); horizontal scale computed separately in drag handler
            return (DRAW_H * 0.8) / Math.max(editable.apertureRadius * 2, 1);
        }
        if (editable instanceof SphericalLens || editable instanceof CylindricalLens || editable instanceof AsphericLens) {
            return (DRAW_H * 0.8) / Math.max(editable.apertureRadius * 2, editable.thickness, 1);
        }
        if (editable instanceof CurvedMirror) {
            return (DRAW_H * 0.8) / Math.max(editable.diameter, editable.thickness * 2, 1);
        }
        if (editable instanceof Mirror) {
            return (DRAW_H * 0.8) / Math.max(editable.diameter, editable.thickness * 2, 1);
        }
        const polygonEditable = editable as AbstractPolygonOptic;
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
            {title && (
                <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>
                    {title}
                </label>
            )}
            <div style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid #333' }}>
                <ProfileFrame svgRef={svgRef} activeHandle={activeHandle}>
                    {editable instanceof AchromatDoublet ? (
                        <AchromatDoubletPanel
                            component={editable}
                            activeHandle={activeHandle}
                            startDrag={startDrag}
                            selectedSurface={doubletSelectedSurface}
                            onSelectSurface={setDoubletSelectedSurface}
                        />
                    ) : editable instanceof AsphericLens ? (
                        <AsphericLensProfilePanel component={editable} activeHandle={activeHandle} startDrag={startDrag} />
                    ) : editable instanceof SphericalLens || editable instanceof CylindricalLens ? (
                        <LensProfilePanel component={editable} activeHandle={activeHandle} startDrag={startDrag} />
                    ) : editable instanceof CurvedMirror ? (
                        <CurvedMirrorPanel component={editable} activeHandle={activeHandle} startDrag={startDrag} />
                    ) : editable instanceof Mirror && !(editable instanceof AbstractPolygonOptic) ? (
                        <FlatMirrorPanel component={editable} activeHandle={activeHandle} startDrag={startDrag} />
                    ) : (
                        <PolygonProfilePanel component={editable as AbstractPolygonOptic} activeHandle={activeHandle} startDrag={startDrag} />
                    )}
                </ProfileFrame>
            </div>
        </div>
    );
};

export const LensProfileEditor: React.FC<{ component: OpticalComponent }> = ({ component }) => {
    const [components, setComponents] = useAtom(componentsAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);

    const commitChange = useCallback((mutate: (component: EditableProfileComponent) => void) => {
        const nextComponents = components.map((entry) => {
            if (entry.id !== component.id || !isEditableProfileComponent(entry)) return entry;
            mutate(entry);
            return entry;
        });
        setComponents([...nextComponents]);
    }, [component.id, components, setComponents]);

    return (
        <LensProfileEditorCore
            component={component}
            onMutate={commitChange}
            onEditStart={pushUndo}
        />
    );
};
