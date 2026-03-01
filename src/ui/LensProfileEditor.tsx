/**
 * LensProfileEditor — Interactive 2D cross-section viewer for SphericalLens
 * and AchromaticDoublet components.
 *
 * Uses Konva.js to render a draggable lens profile with handles for:
 *   - R1 / R2 / R3 surface curvatures
 *   - Thickness
 *   - Aperture radius
 *
 * Appears as a floating panel when a lens or doublet is selected.
 */
import React, { useMemo, useCallback, useRef } from 'react';
import { Stage, Layer, Line, Circle, Text, Rect } from 'react-konva';
import { useAtom } from 'jotai';
import { componentsAtom, selectionAtom } from '../state/store';
import { SphericalLens } from '../parts/SphericalLens';
import { AchromaticDoublet } from '../parts/AchromaticDoublet';
import { AsphericLens, AsphericSurface } from '../parts/AsphericLens';
import { OpticalComponent } from '../physics/Component';

// ─── Constants ──────────────────────────────────────────────────────

const PANEL_W = 280;
const PANEL_H = 200;
const PADDING = 20;
const DRAW_H = PANEL_H - 2 * PADDING;
const CENTER_X = PANEL_W / 2;
const CENTER_Y = PANEL_H / 2;

const SURFACE_COLOR = '#007fff';
const SURFACE_COLOR_DIM = '#3d997e';
const RIM_COLOR = '#555';
const HANDLE_COLOR = '#ff6b9d';
const BG_COLOR = '#1a1a1a';
const GRID_COLOR = '#222';
const AXIS_COLOR = '#333';

// ─── Sag function ───────────────────────────────────────────────────

function sag(R: number, apex: number, r: number): number {
    if (Math.abs(R) > 1e8) return apex;
    const val = R * R - r * r;
    if (val < 0) return apex;
    return (apex + R) - (R > 0 ? 1 : -1) * Math.sqrt(val);
}

function asphericSagScreen(surf: AsphericSurface, apex: number, r: number): number {
    const c = Math.abs(surf.R) > 1e8 ? 0 : 1 / surf.R;
    const r2 = r * r;
    let z: number;
    if (Math.abs(c) < 1e-12) {
        z = 0;
    } else {
        const disc = 1 - (1 + surf.k) * c * c * r2;
        z = disc > 0 ? c * r2 / (1 + Math.sqrt(disc)) : c * r2 / 2;
    }
    const r4 = r2 * r2;
    z += surf.A4 * r4 + surf.A6 * r4 * r2 + surf.A8 * r4 * r4 + surf.A10 * r4 * r4 * r2;
    return apex + z;
}

// ─── Generate profile points for Konva ──────────────────────────────

function lensProfileToScreen(
    R1: number, R2: number, aperture: number, thickness: number,
    scale: number, segs: number = 40
): { front: number[]; back: number[]; rim: number[] } {
    const frontApex = -thickness / 2;
    const backApex = thickness / 2;

    const front: number[] = [];
    const back: number[] = [];

    for (let i = 0; i <= segs; i++) {
        const r = (i / segs) * aperture;
        const fz = sag(R1, frontApex, r);
        const bz = sag(R2, backApex, r);
        front.push(CENTER_X + fz * scale, CENTER_Y - r * scale);
        back.push(CENTER_X + bz * scale, CENTER_Y - r * scale);
    }
    // Mirror below axis
    for (let i = segs; i >= 0; i--) {
        const r = (i / segs) * aperture;
        const fz = sag(R1, frontApex, r);
        const bz = sag(R2, backApex, r);
        front.push(CENTER_X + fz * scale, CENTER_Y + r * scale);
        back.push(CENTER_X + bz * scale, CENTER_Y + r * scale);
    }

    // Rim: connect front edge to back edge (top and bottom)
    const rimTopFZ = sag(R1, frontApex, aperture);
    const rimTopBZ = sag(R2, backApex, aperture);
    const rimBotFZ = rimTopFZ;
    const rimBotBZ = rimTopBZ;
    const rim = [
        CENTER_X + rimTopFZ * scale, CENTER_Y - aperture * scale,
        CENTER_X + rimTopBZ * scale, CENTER_Y - aperture * scale,
        CENTER_X + rimBotBZ * scale, CENTER_Y + aperture * scale,
        CENTER_X + rimBotFZ * scale, CENTER_Y + aperture * scale,
    ];

    return { front, back, rim };
}

// ─── Component ──────────────────────────────────────────────────────

export const LensProfileEditor: React.FC = () => {
    const [components, setComponents] = useAtom(componentsAtom);
    const [selection] = useAtom(selectionAtom);
    const stageRef = useRef<any>(null);

    const selectedComp = useMemo(() => {
        if (selection.length === 0) return null;
        const c = components.find(c => c.id === selection[0]);
        if (!c) return null;
        if (c instanceof SphericalLens || c instanceof AchromaticDoublet || c instanceof AsphericLens) return c;
        return null;
    }, [components, selection]);

    // Auto-fit scale
    const scale = useMemo(() => {
        if (!selectedComp) return 3;
        if (selectedComp instanceof AchromaticDoublet) {
            const maxDim = Math.max(selectedComp.apertureRadius * 2, selectedComp.totalThickness);
            return (DRAW_H * 0.8) / Math.max(maxDim, 1);
        }
        if (selectedComp instanceof AsphericLens) {
            const maxDim = Math.max(selectedComp.apertureRadius * 2, selectedComp.thickness);
            return (DRAW_H * 0.8) / Math.max(maxDim, 1);
        }
        const lens = selectedComp as SphericalLens;
        const maxDim = Math.max(lens.apertureRadius * 2, lens.thickness);
        return (DRAW_H * 0.8) / Math.max(maxDim, 1);
    }, [selectedComp]);

    // Commit a geometry change
    const commitChange = useCallback((fn: (c: OpticalComponent) => void) => {
        const newComponents = components.map((c: OpticalComponent) => {
            if (c.id === selection[0]) {
                fn(c);
                if ('invalidateMesh' in c) (c as any).invalidateMesh();
            }
            return c;
        });
        setComponents([...newComponents]);
    }, [components, selection, setComponents]);

    if (!selectedComp) return null;

    const isDoublet = selectedComp instanceof AchromaticDoublet;
    const isLens = selectedComp instanceof SphericalLens;
    const isAspheric = selectedComp instanceof AsphericLens;

    // Generate profile points
    let profileData: { front: number[]; back: number[]; rim: number[] };
    let apertureR: number;
    let totalT: number;

    if (isAspheric) {
        const lens = selectedComp as AsphericLens;
        const frontApex = -lens.thickness / 2;
        const backApex = lens.thickness / 2;
        const front: number[] = [];
        const back: number[] = [];
        const segs = 40;
        for (let i = 0; i <= segs; i++) {
            const r = (i / segs) * lens.apertureRadius;
            const fz = asphericSagScreen(lens.front, frontApex, r);
            const bz = asphericSagScreen(lens.back, backApex, r);
            front.push(CENTER_X + fz * scale, CENTER_Y - r * scale);
            back.push(CENTER_X + bz * scale, CENTER_Y - r * scale);
        }
        for (let i = segs; i >= 0; i--) {
            const r = (i / segs) * lens.apertureRadius;
            const fz = asphericSagScreen(lens.front, frontApex, r);
            const bz = asphericSagScreen(lens.back, backApex, r);
            front.push(CENTER_X + fz * scale, CENTER_Y + r * scale);
            back.push(CENTER_X + bz * scale, CENTER_Y + r * scale);
        }
        const rimTopFZ = asphericSagScreen(lens.front, frontApex, lens.apertureRadius);
        const rimTopBZ = asphericSagScreen(lens.back, backApex, lens.apertureRadius);
        const rim = [
            CENTER_X + rimTopFZ * scale, CENTER_Y - lens.apertureRadius * scale,
            CENTER_X + rimTopBZ * scale, CENTER_Y - lens.apertureRadius * scale,
            CENTER_X + rimTopBZ * scale, CENTER_Y + lens.apertureRadius * scale,
            CENTER_X + rimTopFZ * scale, CENTER_Y + lens.apertureRadius * scale,
        ];
        profileData = { front, back, rim };
        apertureR = lens.apertureRadius;
        totalT = lens.thickness;
    } else if (isLens) {
        const lens = selectedComp as SphericalLens;
        const radii = lens.getRadii();
        profileData = lensProfileToScreen(radii.R1, radii.R2, lens.apertureRadius, lens.thickness, scale);
        apertureR = lens.apertureRadius;
        totalT = lens.thickness;
    } else {
        const d = selectedComp as AchromaticDoublet;
        // For doublet, just show outer profile (R1 front, R3 back)
        profileData = lensProfileToScreen(d.r1, d.r3, d.apertureRadius, d.totalThickness, scale);
        apertureR = d.apertureRadius;
        totalT = d.totalThickness;
    }

    // Handle positions (screen coords)
    const frontApexScreen = CENTER_X + (-totalT / 2) * scale;
    const topEdgeScreen = CENTER_Y - apertureR * scale;

    return (
        <div style={{
            position: 'absolute',
            bottom: 50,
            right: 10,
            width: PANEL_W,
            height: PANEL_H + 30,
            backgroundColor: BG_COLOR,
            border: '1px solid #333',
            borderRadius: 8,
            overflow: 'hidden',
            zIndex: 20,
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}>
            {/* Title bar */}
            <div style={{
                height: 26,
                display: 'flex',
                alignItems: 'center',
                padding: '0 8px',
                borderBottom: '1px solid #333',
                background: '#222',
            }}>
                <span style={{ fontSize: '10px', color: '#888', fontWeight: 600, letterSpacing: 0.5 }}>
                    LENS PROFILE
                </span>
                <span style={{ fontSize: '10px', color: '#555', marginLeft: 'auto' }}>
                    {isDoublet ? 'Achromatic Doublet' : isAspheric ? 'Aspheric' : 'Spherical'}
                </span>
            </div>

            {/* Konva canvas */}
            <Stage
                ref={stageRef}
                width={PANEL_W}
                height={PANEL_H}
                style={{ cursor: 'crosshair' }}
            >
                <Layer>
                    {/* Background */}
                    <Rect x={0} y={0} width={PANEL_W} height={PANEL_H} fill={BG_COLOR} />

                    {/* Grid lines */}
                    {[-2, -1, 0, 1, 2].map(i => (
                        <Line
                            key={`vgrid-${i}`}
                            points={[CENTER_X + i * 20, 0, CENTER_X + i * 20, PANEL_H]}
                            stroke={i === 0 ? AXIS_COLOR : GRID_COLOR}
                            strokeWidth={i === 0 ? 1 : 0.5}
                        />
                    ))}
                    {[-2, -1, 0, 1, 2].map(i => (
                        <Line
                            key={`hgrid-${i}`}
                            points={[0, CENTER_Y + i * 20, PANEL_W, CENTER_Y + i * 20]}
                            stroke={i === 0 ? AXIS_COLOR : GRID_COLOR}
                            strokeWidth={i === 0 ? 1 : 0.5}
                        />
                    ))}

                    {/* Front surface */}
                    <Line
                        points={profileData.front}
                        stroke={SURFACE_COLOR}
                        strokeWidth={2}
                        closed={false}
                    />

                    {/* Back surface */}
                    <Line
                        points={profileData.back}
                        stroke={SURFACE_COLOR_DIM}
                        strokeWidth={2}
                        closed={false}
                    />

                    {/* Rim lines */}
                    <Line
                        points={profileData.rim.slice(0, 4)}
                        stroke={RIM_COLOR}
                        strokeWidth={1}
                    />
                    <Line
                        points={profileData.rim.slice(4, 8)}
                        stroke={RIM_COLOR}
                        strokeWidth={1}
                    />

                    {/* Doublet cement line */}
                    {isDoublet && (() => {
                        const d = selectedComp as AchromaticDoublet;
                        const cementZ = -d.totalThickness / 2 + d.thickness1;
                        const cementPts: number[] = [];
                        for (let i = 0; i <= 20; i++) {
                            const r = (i / 20) * d.apertureRadius;
                            const z = sag(d.r2, cementZ, r);
                            cementPts.push(CENTER_X + z * scale, CENTER_Y - r * scale);
                        }
                        for (let i = 20; i >= 0; i--) {
                            const r = (i / 20) * d.apertureRadius;
                            const z = sag(d.r2, cementZ, r);
                            cementPts.push(CENTER_X + z * scale, CENTER_Y + r * scale);
                        }
                        return (
                            <Line
                                points={cementPts}
                                stroke="#ffaa33"
                                strokeWidth={1.5}
                                dash={[4, 3]}
                                closed={false}
                            />
                        );
                    })()}

                    {/* Draggable handle: Front apex (controls thickness) */}
                    <Circle
                        x={frontApexScreen}
                        y={CENTER_Y}
                        radius={5}
                        fill={HANDLE_COLOR}
                        stroke="#fff"
                        strokeWidth={1}
                        draggable
                        onDragMove={(e) => {
                            const dx = (e.target.x() - CENTER_X) / scale;
                            const newThickness = Math.max(1, (-dx) * 2);
                            commitChange(c => {
                                if (c instanceof SphericalLens) {
                                    c.thickness = newThickness;
                                } else if (c instanceof AchromaticDoublet) {
                                    const ratio = c.thickness1 / c.totalThickness;
                                    c.thickness1 = Math.max(0.5, newThickness * ratio);
                                    c.thickness2 = Math.max(0.5, newThickness * (1 - ratio));
                                }
                            });
                            // Constrain y
                            e.target.y(CENTER_Y);
                        }}
                    />

                    {/* Draggable handle: Top aperture edge */}
                    <Circle
                        x={CENTER_X}
                        y={topEdgeScreen}
                        radius={5}
                        fill={HANDLE_COLOR}
                        stroke="#fff"
                        strokeWidth={1}
                        draggable
                        onDragMove={(e) => {
                            const newRadius = Math.max(2, (CENTER_Y - e.target.y()) / scale);
                            commitChange(c => {
                                if (c instanceof SphericalLens) {
                                    c.apertureRadius = newRadius;
                                } else if (c instanceof AchromaticDoublet) {
                                    c.apertureRadius = newRadius;
                                }
                            });
                            // Constrain x
                            e.target.x(CENTER_X);
                        }}
                    />

                    {/* Labels */}
                    <Text
                        x={frontApexScreen - 2}
                        y={CENTER_Y + 8}
                        text="t"
                        fontSize={9}
                        fill="#888"
                        align="center"
                    />
                    <Text
                        x={CENTER_X + 4}
                        y={topEdgeScreen - 4}
                        text="R"
                        fontSize={9}
                        fill="#888"
                    />

                    {/* Info text */}
                    <Text
                        x={4}
                        y={PANEL_H - 14}
                        text={isDoublet
                            ? `f=${(selectedComp as AchromaticDoublet).focalLength.toFixed(1)}mm`
                            : isAspheric
                                ? `f=${(selectedComp as AsphericLens).focalLength.toFixed(1)}mm`
                                : `f=${(1 / ((selectedComp as SphericalLens).curvature || 0.001)).toFixed(1)}mm`}
                        fontSize={9}
                        fill="#555"
                    />
                </Layer>
            </Stage>
        </div>
    );
};
