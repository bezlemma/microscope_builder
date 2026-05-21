import React, { useCallback, useEffect, useState } from 'react';
import { Vector3 } from 'three';
import { SphericalLens } from '../physics/components/SphericalLens';
import { AsphericLens, ASPHERE_MAX_TERMS } from '../physics/components/AsphericLens';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { AchromatDoublet } from '../physics/components/AchromatDoublet';
import { Objective, type ImmersionMediumKind } from '../physics/components/Objective';
import { PrismLens } from '../physics/components/PrismLens';
import { LensProfileEditorCore, type ProfileEditorMutate } from './LensProfileEditor';
import { SphericalLensDesigner } from './SphericalLensDesigner';
import { ScrubInput } from './ScrubInput';
import {
    clampRadiusOfCurvature,
    designerCompactGridStyle as compactGridStyle,
    designerGridStyle as gridStyle,
    designerOptionStyle as optionStyle,
    designerSelectStyle as selectStyle,
    formatLensNumber,
    parseLensNumber,
} from './lensDesignerShared';

export type LensFamilyComponent = SphericalLens | AsphericLens | CylindricalLens | AchromatDoublet | Objective | PrismLens;
export type LensFamilyMutate = (mutate: (component: LensFamilyComponent) => void) => void;

function updateCylindricalBounds(lens: CylindricalLens): void {
    lens.bounds.set(
        new Vector3(-lens.width / 2, -lens.apertureRadius, -lens.thickness / 2),
        new Vector3(lens.width / 2, lens.apertureRadius, lens.thickness / 2),
    );
}

function updateDoubletBounds(lens: AchromatDoublet): void {
    const total = lens.totalThickness;
    lens.bounds.set(
        new Vector3(-lens.apertureRadius, -lens.apertureRadius, -total / 2),
        new Vector3(lens.apertureRadius, lens.apertureRadius, total / 2),
    );
}

function setAsphericParaxialFocalLength(lens: AsphericLens, focalLength: number): void {
    if (!Number.isFinite(focalLength) || Math.abs(focalLength) < 1e-6) return;
    const n = lens.ior;
    const a = n - 1;
    if (Math.abs(a) < 1e-9) return;
    const invF = 1 / focalLength;
    const flatBack = Math.abs(lens.r2) >= 1e8;
    const invR2 = flatBack ? 0 : 1 / lens.r2;
    const thickTermScale = flatBack ? 0 : (a * a * lens.thickness) / (n * lens.r2);
    const denom = a + thickTermScale;
    if (Math.abs(denom) < 1e-12) return;
    lens.r1 = denom / (invF + a * invR2);
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

function setCylindricalParaxialFocalLength(lens: CylindricalLens, focalLength: number): void {
    if (!Number.isFinite(focalLength) || Math.abs(focalLength) < 1e-6) return;
    const n = lens.ior;
    const a = n - 1;
    if (Math.abs(a) < 1e-9) return;
    const invF = 1 / focalLength;
    const flatBack = Math.abs(lens.r2) >= 1e8;
    const invR2 = flatBack ? 0 : 1 / lens.r2;
    const thickTermScale = flatBack ? 0 : (a * a * lens.thickness) / (n * lens.r2);
    const denom = a + thickTermScale;
    if (Math.abs(denom) < 1e-12) return;
    lens.r1 = clampRadiusOfCurvature(denom / (invF + a * invR2), lens.apertureRadius);
}

const detailsStyle: React.CSSProperties = {
    borderTop: '1px solid rgba(255,255,255,0.1)',
    paddingTop: 7,
    marginTop: 8,
};

const coeffGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 6,
};

const ASPHERE_LABELS = ['A4', 'A6', 'A8', 'A10', 'A12', 'A14'];

function normalizeAsphereTerms(values: number[]): number[] {
    return Array.from({ length: ASPHERE_MAX_TERMS }, (_, index) => values[index] ?? 0);
}

const AsphericLensDesigner: React.FC<{
    lens: AsphericLens;
    onMutate: (mutate: (lens: AsphericLens) => void) => void;
    onEditStart?: () => void;
}> = ({ lens, onMutate, onEditStart }) => {
    const [localFocal, setLocalFocal] = useState('0');
    const [localDiameter, setLocalDiameter] = useState('0');
    const [localThickness, setLocalThickness] = useState('0');
    const [localIor, setLocalIor] = useState('1.5');
    const [localR1, setLocalR1] = useState('0');
    const [localR2, setLocalR2] = useState('0');
    const [localK1, setLocalK1] = useState('0');
    const [localK2, setLocalK2] = useState('0');
    const [localA1, setLocalA1] = useState<string[]>([]);
    const [localA2, setLocalA2] = useState<string[]>([]);

    useEffect(() => {
        setLocalFocal(formatLensNumber(lens.focalLength));
        setLocalDiameter(formatLensNumber(lens.apertureRadius * 2));
        setLocalThickness(formatLensNumber(lens.thickness));
        setLocalIor(String(lens.ior));
        setLocalR1(formatLensNumber(lens.r1));
        setLocalR2(formatLensNumber(lens.r2));
        setLocalK1(formatLensNumber(lens.k1, 4));
        setLocalK2(formatLensNumber(lens.k2, 4));
        setLocalA1(normalizeAsphereTerms(lens.A1).map(value => value.toExponential(3)));
        setLocalA2(normalizeAsphereTerms(lens.A2).map(value => value.toExponential(3)));
    }, [lens, lens.version, lens.apertureRadius, lens.thickness, lens.ior, lens.r1, lens.r2, lens.k1, lens.k2, lens.A1, lens.A2]);

    const mutateLens = useCallback((mutate: (target: AsphericLens) => void) => {
        onMutate((target) => {
            mutate(target);
            target.recomputeBounds();
            target.invalidateMesh();
        });
    }, [onMutate]);

    const commit = useCallback((param: 'focal' | 'diameter' | 'thickness' | 'ior' | 'r1' | 'r2' | 'k1' | 'k2', value: string) => {
        const val = parseLensNumber(value);
        if (!Number.isFinite(val)) return;
        mutateLens((target) => {
            if (param === 'focal') setAsphericParaxialFocalLength(target, val);
            else if (param === 'diameter') target.apertureRadius = Math.max(0.5, val / 2);
            else if (param === 'thickness') target.thickness = Math.max(0.1, val);
            else if (param === 'ior') target.ior = Math.max(1.0, Math.min(3.0, val));
            else if (param === 'r1') target.r1 = val;
            else if (param === 'r2') target.r2 = val;
            else if (param === 'k1') target.k1 = val;
            else if (param === 'k2') target.k2 = val;
        });
    }, [mutateLens]);

    const commitCoeff = useCallback((side: 1 | 2, index: number, value: string) => {
        const val = parseLensNumber(value);
        if (!Number.isFinite(val)) return;
        mutateLens((target) => {
            const terms = normalizeAsphereTerms(side === 1 ? target.A1 : target.A2);
            terms[index] = val;
            if (side === 1) target.A1 = terms;
            else target.A2 = terms;
        });
    }, [mutateLens]);

    const profileMutate: ProfileEditorMutate = useCallback((mutate) => {
        onMutate((target) => {
            const lensTarget = target as AsphericLens;
            mutate(lensTarget);
            lensTarget.recomputeBounds();
            lensTarget.invalidateMesh();
        });
    }, [onMutate]);

    const renderCoeffBlock = (
        side: 1 | 2,
        title: string,
        terms: string[],
        setTerms: React.Dispatch<React.SetStateAction<string[]>>,
    ) => (
        <div style={{ marginTop: 8 }}>
            <div style={{ color: '#8d9aa5', fontSize: 10, fontWeight: 800, marginBottom: 5 }}>{title}</div>
            <div style={coeffGridStyle}>
                {ASPHERE_LABELS.map((label, index) => (
                    <ScrubInput
                        key={`${side}:${label}`}
                        label={label}
                        value={terms[index] ?? '0'}
                        onChange={(value) => setTerms(current => {
                            const next = current.slice();
                            next[index] = value;
                            return next;
                        })}
                        onCommit={(value) => commitCoeff(side, index, value)}
                        speed={1e-8}
                        step={1e-12}
                    />
                ))}
            </div>
        </div>
    );

    return (
        <div>
            <div style={compactGridStyle}>
                <ScrubInput label="Focal Len" suffix="mm" value={localFocal} onChange={setLocalFocal} onCommit={(v) => commit('focal', v)} speed={1.0} />
                <ScrubInput label="Aperture" suffix="mm" value={localDiameter} onChange={setLocalDiameter} onCommit={(v) => commit('diameter', v)} speed={0.5} min={1} max={400} />
                <ScrubInput label="Thickness" suffix="mm" value={localThickness} onChange={setLocalThickness} onCommit={(v) => commit('thickness', v)} speed={0.2} min={0.1} max={100} />
                <ScrubInput label="IoR" value={localIor} onChange={setLocalIor} onCommit={(v) => commit('ior', v)} speed={0.005} min={1.0} max={3.0} step={0.001} />
            </div>
            <div style={compactGridStyle}>
                <ScrubInput label="R1" suffix="mm" value={localR1} onChange={setLocalR1} onCommit={(v) => commit('r1', v)} speed={2.0} allowInfinity />
                <ScrubInput label="R2" suffix="mm" value={localR2} onChange={setLocalR2} onCommit={(v) => commit('r2', v)} speed={2.0} allowInfinity />
                <ScrubInput label="K1" value={localK1} onChange={setLocalK1} onCommit={(v) => commit('k1', v)} speed={0.005} step={0.001} />
                <ScrubInput label="K2" value={localK2} onChange={setLocalK2} onCommit={(v) => commit('k2', v)} speed={0.005} step={0.001} />
            </div>
            <details style={detailsStyle}>
                <summary style={{ cursor: 'pointer', color: '#9aa7b2', fontSize: 11, fontWeight: 800, marginBottom: 6 }}>
                    Asphere Terms
                </summary>
                {renderCoeffBlock(1, 'FRONT', localA1, setLocalA1)}
                {renderCoeffBlock(2, 'BACK', localA2, setLocalA2)}
            </details>
            <LensProfileEditorCore component={lens} onMutate={profileMutate} onEditStart={onEditStart} title="" />
        </div>
    );
};

const CylindricalLensDesigner: React.FC<{
    lens: CylindricalLens;
    onMutate: (mutate: (lens: CylindricalLens) => void) => void;
    onEditStart?: () => void;
}> = ({ lens, onMutate, onEditStart }) => {
    const [localFocal, setLocalFocal] = useState('0');
    const [localR1, setLocalR1] = useState('0');
    const [localR2, setLocalR2] = useState('0');
    const [localHeight, setLocalHeight] = useState('0');
    const [localWidth, setLocalWidth] = useState('0');
    const [localThickness, setLocalThickness] = useState('0');
    const [localIor, setLocalIor] = useState('1.5');

    useEffect(() => {
        setLocalFocal(formatLensNumber(cylindricalParaxialFocalLength(lens)));
        setLocalR1(formatLensNumber(lens.r1));
        setLocalR2(formatLensNumber(lens.r2));
        setLocalHeight(formatLensNumber(lens.apertureRadius * 2));
        setLocalWidth(formatLensNumber(lens.width));
        setLocalThickness(formatLensNumber(lens.thickness));
        setLocalIor(String(lens.ior));
    }, [lens, lens.version, lens.r1, lens.r2, lens.apertureRadius, lens.width, lens.thickness, lens.ior]);

    const mutateLens = useCallback((mutate: (target: CylindricalLens) => void) => {
        onMutate((target) => {
            mutate(target);
            updateCylindricalBounds(target);
            target.invalidateMesh();
        });
    }, [onMutate]);

    const commit = useCallback((param: 'focal' | 'r1' | 'r2' | 'height' | 'width' | 'thickness' | 'ior', value: string) => {
        const val = parseLensNumber(value);
        if (!Number.isFinite(val)) return;
        mutateLens((target) => {
            if (param === 'focal') setCylindricalParaxialFocalLength(target, val);
            else if (param === 'r1') target.r1 = clampRadiusOfCurvature(val, target.apertureRadius);
            else if (param === 'r2') target.r2 = clampRadiusOfCurvature(val, target.apertureRadius);
            else if (param === 'height') target.apertureRadius = Math.max(1, val / 2);
            else if (param === 'width') target.width = Math.max(1, val);
            else if (param === 'thickness') target.thickness = Math.max(0.1, val);
            else if (param === 'ior') target.ior = Math.max(1.0, Math.min(3.0, val));
        });
    }, [mutateLens]);

    const profileMutate: ProfileEditorMutate = useCallback((mutate) => {
        onMutate((target) => mutate(target as CylindricalLens));
    }, [onMutate]);

    return (
        <div>
            <div style={gridStyle}>
                <ScrubInput label="Focal Len" suffix="mm" value={localFocal} onChange={setLocalFocal} onCommit={(v) => commit('focal', v)} speed={1.0} />
                <ScrubInput label="Height" suffix="mm" value={localHeight} onChange={setLocalHeight} onCommit={(v) => commit('height', v)} speed={0.5} min={2} max={400} />
                <ScrubInput label="Width" suffix="mm" value={localWidth} onChange={setLocalWidth} onCommit={(v) => commit('width', v)} speed={0.5} min={1} max={200} />
                <ScrubInput label="Thickness" suffix="mm" value={localThickness} onChange={setLocalThickness} onCommit={(v) => commit('thickness', v)} speed={0.2} min={0.1} max={100} />
                <ScrubInput label="IoR" value={localIor} onChange={setLocalIor} onCommit={(v) => commit('ior', v)} speed={0.005} min={1.0} max={3.0} step={0.001} />
                <ScrubInput label="R1" suffix="mm" value={localR1} onChange={setLocalR1} onCommit={(v) => commit('r1', v)} speed={2.0} allowInfinity />
                <ScrubInput label="R2" suffix="mm" value={localR2} onChange={setLocalR2} onCommit={(v) => commit('r2', v)} speed={2.0} allowInfinity />
            </div>
            <LensProfileEditorCore component={lens} onMutate={profileMutate} onEditStart={onEditStart} title="" />
        </div>
    );
};

const AchromatDoubletDesigner: React.FC<{
    lens: AchromatDoublet;
    onMutate: (mutate: (lens: AchromatDoublet) => void) => void;
    onEditStart?: () => void;
}> = ({ lens, onMutate, onEditStart }) => {
    const [localR1, setLocalR1] = useState('0');
    const [localR2, setLocalR2] = useState('0');
    const [localR3, setLocalR3] = useState('0');
    const [localT1, setLocalT1] = useState('0');
    const [localT2, setLocalT2] = useState('0');
    const [localAperture, setLocalAperture] = useState('0');
    const [localIor1, setLocalIor1] = useState('1.5');
    const [localIor2, setLocalIor2] = useState('1.7');

    useEffect(() => {
        setLocalR1(formatLensNumber(lens.r1));
        setLocalR2(formatLensNumber(lens.r2));
        setLocalR3(formatLensNumber(lens.r3));
        setLocalT1(formatLensNumber(lens.t1));
        setLocalT2(formatLensNumber(lens.t2));
        setLocalAperture(formatLensNumber(lens.apertureRadius));
        setLocalIor1(String(lens.ior1));
        setLocalIor2(String(lens.ior2));
    }, [lens, lens.version, lens.r1, lens.r2, lens.r3, lens.t1, lens.t2, lens.apertureRadius, lens.ior1, lens.ior2]);

    const mutateLens = useCallback((mutate: (target: AchromatDoublet) => void) => {
        onMutate((target) => {
            mutate(target);
            updateDoubletBounds(target);
            target.invalidateMesh();
        });
    }, [onMutate]);

    const commit = useCallback((param: 'r1' | 'r2' | 'r3' | 't1' | 't2' | 'aperture' | 'ior1' | 'ior2', value: string) => {
        const val = parseLensNumber(value);
        if (!Number.isFinite(val)) return;
        mutateLens((target) => {
            if (param === 'r1') target.r1 = clampRadiusOfCurvature(val, target.apertureRadius);
            else if (param === 'r2') target.r2 = clampRadiusOfCurvature(val, target.apertureRadius);
            else if (param === 'r3') target.r3 = clampRadiusOfCurvature(val, target.apertureRadius);
            else if (param === 't1') target.t1 = Math.max(0.1, val);
            else if (param === 't2') target.t2 = Math.max(0.1, val);
            else if (param === 'aperture') target.apertureRadius = Math.max(1, val);
            else if (param === 'ior1') target.ior1 = Math.max(1.0, Math.min(3.0, val));
            else if (param === 'ior2') target.ior2 = Math.max(1.0, Math.min(3.0, val));
        });
    }, [mutateLens]);

    const profileMutate: ProfileEditorMutate = useCallback((mutate) => {
        onMutate((target) => mutate(target as AchromatDoublet));
    }, [onMutate]);

    return (
        <div>
            <div style={gridStyle}>
                <ScrubInput label="R1" suffix="mm" value={localR1} onChange={setLocalR1} onCommit={(v) => commit('r1', v)} speed={2.0} allowInfinity />
                <ScrubInput label="R2" suffix="mm" value={localR2} onChange={setLocalR2} onCommit={(v) => commit('r2', v)} speed={2.0} allowInfinity />
                <ScrubInput label="R3" suffix="mm" value={localR3} onChange={setLocalR3} onCommit={(v) => commit('r3', v)} speed={2.0} allowInfinity />
                <ScrubInput label="t1" suffix="mm" value={localT1} onChange={setLocalT1} onCommit={(v) => commit('t1', v)} speed={0.2} min={0.1} max={100} />
                <ScrubInput label="t2" suffix="mm" value={localT2} onChange={setLocalT2} onCommit={(v) => commit('t2', v)} speed={0.2} min={0.1} max={100} />
                <ScrubInput label="Aperture" suffix="mm" value={localAperture} onChange={setLocalAperture} onCommit={(v) => commit('aperture', v)} speed={0.5} min={1} max={200} />
                <ScrubInput label="n1" value={localIor1} onChange={setLocalIor1} onCommit={(v) => commit('ior1', v)} speed={0.005} min={1.0} max={3.0} step={0.001} />
                <ScrubInput label="n2" value={localIor2} onChange={setLocalIor2} onCommit={(v) => commit('ior2', v)} speed={0.005} min={1.0} max={3.0} step={0.001} />
                <div />
            </div>
            <LensProfileEditorCore component={lens} onMutate={profileMutate} onEditStart={onEditStart} title="" />
        </div>
    );
};

function immersionIndexForKind(kind: ImmersionMediumKind, current: number): number {
    if (kind === 'oil') return 1.515;
    if (kind === 'water') return 1.33;
    if (kind === 'silicone') return 1.406;
    if (kind === 'custom') return current;
    return 1.0;
}

const ObjectiveDesigner: React.FC<{
    objective: Objective;
    onMutate: (mutate: (objective: Objective) => void) => void;
}> = ({ objective, onMutate }) => {
    const [localMag, setLocalMag] = useState('10');
    const [localNa, setLocalNa] = useState('0.25');
    const [localWd, setLocalWd] = useState('10');
    const [localTubeFocal, setLocalTubeFocal] = useState('200');
    const [localDiameter, setLocalDiameter] = useState('20');
    const [localImmersionIndex, setLocalImmersionIndex] = useState('1');

    useEffect(() => {
        setLocalMag(formatLensNumber(objective.magnification, 3));
        setLocalNa(formatLensNumber(objective.NA, 3));
        setLocalWd(formatLensNumber(objective.workingDistance, 3));
        setLocalTubeFocal(formatLensNumber(objective.tubeLensFocal, 3));
        setLocalDiameter(formatLensNumber(objective.diameter, 3));
        setLocalImmersionIndex(formatLensNumber(objective.immersionIndex, 4));
    }, [
        objective,
        objective.version,
        objective.magnification,
        objective.NA,
        objective.workingDistance,
        objective.tubeLensFocal,
        objective.diameter,
        objective.immersionIndex,
    ]);

    const mutateObjective = useCallback((mutate: (target: Objective) => void) => {
        onMutate((target) => {
            mutate(target);
            target.recalculate();
        });
    }, [onMutate]);

    const commit = useCallback((param: 'mag' | 'na' | 'wd' | 'tube' | 'diameter' | 'immersionIndex', value: string) => {
        const val = parseLensNumber(value);
        if (!Number.isFinite(val)) return;
        mutateObjective((target) => {
            if (param === 'mag') target.magnification = Math.max(0.1, val);
            else if (param === 'na') target.NA = Math.max(0.001, val);
            else if (param === 'wd') target.workingDistance = Math.max(0.01, val);
            else if (param === 'tube') target.tubeLensFocal = Math.max(1, val);
            else if (param === 'diameter') target.diameter = Math.max(1, val);
            else if (param === 'immersionIndex') {
                target.immersionMediumKind = 'custom';
                target.immersionIndex = Math.max(1, Math.min(2, val));
            }
            if (target.NA > target.immersionIndex) target.NA = target.immersionIndex;
        });
    }, [mutateObjective]);

    return (
        <div>
            <div style={gridStyle}>
                <ScrubInput label="Mag" suffix="X" value={localMag} onChange={setLocalMag} onCommit={(v) => commit('mag', v)} speed={0.2} min={0.1} max={200} step={0.1} />
                <ScrubInput label="NA" value={localNa} onChange={setLocalNa} onCommit={(v) => commit('na', v)} speed={0.005} min={0.001} max={2.0} step={0.001} />
                <ScrubInput label="WD" suffix="mm" value={localWd} onChange={setLocalWd} onCommit={(v) => commit('wd', v)} speed={0.1} min={0.01} max={200} step={0.01} />
                <ScrubInput label="Tube F" suffix="mm" value={localTubeFocal} onChange={setLocalTubeFocal} onCommit={(v) => commit('tube', v)} speed={0.5} min={1} max={400} step={0.1} />
                <ScrubInput label="Diameter" suffix="mm" value={localDiameter} onChange={setLocalDiameter} onCommit={(v) => commit('diameter', v)} speed={0.2} min={1} max={80} step={0.1} />
                <ScrubInput label="n Imm" value={localImmersionIndex} onChange={setLocalImmersionIndex} onCommit={(v) => commit('immersionIndex', v)} speed={0.002} min={1} max={2} step={0.001} />
            </div>
            <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 4 }}>Immersion</label>
                <select
                    value={objective.immersionMediumKind}
                    onChange={(event) => {
                        const kind = event.target.value as ImmersionMediumKind;
                        mutateObjective((target) => {
                            target.immersionMediumKind = kind;
                            target.immersionIndex = immersionIndexForKind(kind, target.immersionIndex);
                            if (target.NA > target.immersionIndex) target.NA = target.immersionIndex;
                        });
                    }}
                    style={selectStyle}
                >
                    <option style={optionStyle} value="air">Air</option>
                    <option style={optionStyle} value="water">Water</option>
                    <option style={optionStyle} value="oil">Oil</option>
                    <option style={optionStyle} value="silicone">Silicone</option>
                    <option style={optionStyle} value="custom">Custom</option>
                </select>
            </div>
        </div>
    );
};

type PrismDesignKind = 'rightAngle' | 'equilateral' | 'wedge';

function rightAngleVertices(leg: number): [number, number][] {
    return [[0, 0], [leg, 0], [0, leg]];
}

function equilateralVertices(side: number): [number, number][] {
    const h = Math.sqrt(3) * side / 2;
    return [[0, h], [-side / 2, 0], [side / 2, 0]];
}

function wedgeVertices(diameter: number, thinEdge: number, thickEdge: number): [number, number][] {
    return [
        [-diameter / 2, -thinEdge / 2],
        [diameter / 2, -thickEdge / 2],
        [diameter / 2, thickEdge / 2],
        [-diameter / 2, thinEdge / 2],
    ];
}

function internalAnglesDeg(vertices: [number, number][]): number[] {
    return vertices.map((current, index) => {
        const prev = vertices[(index - 1 + vertices.length) % vertices.length];
        const next = vertices[(index + 1) % vertices.length];
        const ax = prev[0] - current[0];
        const ay = prev[1] - current[1];
        const bx = next[0] - current[0];
        const by = next[1] - current[1];
        const dot = ax * bx + ay * by;
        const len = Math.hypot(ax, ay) * Math.hypot(bx, by) || 1;
        return Math.acos(Math.max(-1, Math.min(1, dot / len))) * 180 / Math.PI;
    }).sort((a, b) => a - b);
}

function inferPrismDesignKind(prism: PrismLens): PrismDesignKind {
    if (prism.numFaces === 4) return 'wedge';
    const angles = internalAnglesDeg(prism.vertices);
    const rightAngleError = Math.abs((angles[2] ?? 0) - 90) + Math.abs((angles[0] ?? 0) - 45) + Math.abs((angles[1] ?? 0) - 45);
    return rightAngleError < 18 ? 'rightAngle' : 'equilateral';
}

function prismNominalSize(prism: PrismLens): number {
    const vertices = prism.vertices;
    if (vertices.length === 0) return prism.width;
    const minX = Math.min(...vertices.map(vertex => vertex[0]));
    const maxX = Math.max(...vertices.map(vertex => vertex[0]));
    const minY = Math.min(...vertices.map(vertex => vertex[1]));
    const maxY = Math.max(...vertices.map(vertex => vertex[1]));
    return Math.max(maxX - minX, maxY - minY, prism.width);
}

const PrismDesigner: React.FC<{
    prism: PrismLens;
    onMutate: (mutate: (prism: PrismLens) => void) => void;
    onEditStart?: () => void;
}> = ({ prism, onMutate, onEditStart }) => {
    const [localKind, setLocalKind] = useState<PrismDesignKind>('equilateral');
    const [localSize, setLocalSize] = useState('20');
    const [localWidth, setLocalWidth] = useState('20');
    const [localIor, setLocalIor] = useState('1.5168');
    const [localThinEdge, setLocalThinEdge] = useState('3');
    const [localThickEdge, setLocalThickEdge] = useState('5');

    useEffect(() => {
        const kind = inferPrismDesignKind(prism);
        setLocalKind(kind);
        setLocalSize(formatLensNumber(prismNominalSize(prism), 3));
        setLocalWidth(formatLensNumber(prism.width, 3));
        setLocalIor(formatLensNumber(prism.ior, 4));
        if (kind === 'wedge' && prism.vertices.length >= 4) {
            const sorted = [...prism.vertices].sort((a, b) => a[0] - b[0]);
            const left = sorted.slice(0, 2);
            const right = sorted.slice(-2);
            setLocalThinEdge(formatLensNumber(Math.abs(left[0][1] - left[1][1]), 3));
            setLocalThickEdge(formatLensNumber(Math.abs(right[0][1] - right[1][1]), 3));
        }
    }, [prism, prism.version, prism.width, prism.ior, prism.vertices]);

    const mutatePrism = useCallback((mutate: (target: PrismLens) => void) => {
        onMutate((target) => {
            mutate(target);
            target.invalidateMesh();
        });
    }, [onMutate]);

    const setKindGeometry = useCallback((kind: PrismDesignKind, sizeValue = localSize, thinValue = localThinEdge, thickValue = localThickEdge) => {
        const parsedSize = parseLensNumber(sizeValue);
        const parsedThin = parseLensNumber(thinValue);
        const parsedThick = parseLensNumber(thickValue);
        const parsedWidth = parseLensNumber(localWidth);
        const size = Number.isFinite(parsedSize) ? Math.max(1, parsedSize) : prismNominalSize(prism);
        const thin = Number.isFinite(parsedThin) ? Math.max(0.1, parsedThin) : 3;
        const thick = Number.isFinite(parsedThick) ? Math.max(thin + 0.1, parsedThick) : Math.max(thin + 0.1, 5);
        const width = Number.isFinite(parsedWidth) ? Math.max(1, parsedWidth) : prism.width;
        mutatePrism((target) => {
            target.width = width;
            if (kind === 'rightAngle') target.setVertices(rightAngleVertices(size));
            else if (kind === 'equilateral') target.setVertices(equilateralVertices(size));
            else target.setVertices(wedgeVertices(size, thin, thick));
        });
    }, [localSize, localThinEdge, localThickEdge, localWidth, mutatePrism, prism]);

    const commit = useCallback((param: 'size' | 'width' | 'ior' | 'thin' | 'thick', value: string) => {
        const val = parseLensNumber(value);
        if (!Number.isFinite(val)) return;
        if (param === 'ior') {
            mutatePrism((target) => {
                target.ior = Math.max(1, Math.min(4, val));
            });
            return;
        }
        if (param === 'width') {
            mutatePrism((target) => {
                target.width = Math.max(1, val);
            });
            return;
        }
        const size = param === 'size' ? value : localSize;
        const thin = param === 'thin' ? value : localThinEdge;
        const thick = param === 'thick' ? value : localThickEdge;
        setKindGeometry(localKind, size, thin, thick);
    }, [localKind, localSize, localThinEdge, localThickEdge, mutatePrism, setKindGeometry]);

    const profileMutate: ProfileEditorMutate = useCallback((mutate) => {
        onMutate((target) => mutate(target as PrismLens));
    }, [onMutate]);

    return (
        <div>
            <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 4 }}>Prism Type</label>
                <select
                    value={localKind}
                    onChange={(event) => {
                        const kind = event.target.value as PrismDesignKind;
                        setLocalKind(kind);
                        setKindGeometry(kind);
                    }}
                    style={selectStyle}
                >
                    <option style={optionStyle} value="rightAngle">Right-Angle</option>
                    <option style={optionStyle} value="equilateral">Equilateral</option>
                    <option style={optionStyle} value="wedge">Wedge</option>
                </select>
            </div>
            <div style={localKind === 'wedge' ? compactGridStyle : gridStyle}>
                <ScrubInput label={localKind === 'wedge' ? 'Diameter' : 'Size'} suffix="mm" value={localSize} onChange={setLocalSize} onCommit={(v) => commit('size', v)} speed={0.3} min={1} max={100} step={0.1} />
                <ScrubInput label="Width" suffix="mm" value={localWidth} onChange={setLocalWidth} onCommit={(v) => commit('width', v)} speed={0.3} min={1} max={100} step={0.1} />
                <ScrubInput label="IoR" value={localIor} onChange={setLocalIor} onCommit={(v) => commit('ior', v)} speed={0.005} min={1.0} max={4.0} step={0.001} />
                {localKind === 'wedge' && (
                    <>
                        <ScrubInput label="Thin" suffix="mm" value={localThinEdge} onChange={setLocalThinEdge} onCommit={(v) => commit('thin', v)} speed={0.1} min={0.1} max={50} step={0.1} />
                        <ScrubInput label="Thick" suffix="mm" value={localThickEdge} onChange={setLocalThickEdge} onCommit={(v) => commit('thick', v)} speed={0.1} min={0.2} max={50} step={0.1} />
                    </>
                )}
            </div>
            <LensProfileEditorCore component={prism} onMutate={profileMutate} onEditStart={onEditStart} title="" />
        </div>
    );
};

export const LensFamilyDesigner: React.FC<{
    component: LensFamilyComponent;
    onMutate: LensFamilyMutate;
    onEditStart?: () => void;
}> = ({ component, onMutate, onEditStart }) => {
    if (component instanceof SphericalLens) {
        return (
            <SphericalLensDesigner
                lens={component}
                onMutate={(mutate) => onMutate((target) => {
                    if (target instanceof SphericalLens) mutate(target);
                })}
                onEditStart={onEditStart}
                profileTitle=""
            />
        );
    }
    if (component instanceof AsphericLens) {
        return <AsphericLensDesigner lens={component} onMutate={(mutate) => onMutate((target) => target instanceof AsphericLens && mutate(target))} onEditStart={onEditStart} />;
    }
    if (component instanceof CylindricalLens) {
        return <CylindricalLensDesigner lens={component} onMutate={(mutate) => onMutate((target) => target instanceof CylindricalLens && mutate(target))} onEditStart={onEditStart} />;
    }
    if (component instanceof AchromatDoublet) {
        return <AchromatDoubletDesigner lens={component} onMutate={(mutate) => onMutate((target) => target instanceof AchromatDoublet && mutate(target))} onEditStart={onEditStart} />;
    }
    if (component instanceof Objective) {
        return <ObjectiveDesigner objective={component} onMutate={(mutate) => onMutate((target) => target instanceof Objective && mutate(target))} />;
    }
    return <PrismDesigner prism={component as PrismLens} onMutate={(mutate) => onMutate((target) => target instanceof PrismLens && mutate(target))} onEditStart={onEditStart} />;
};
