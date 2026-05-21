import React, { useCallback, useEffect, useState } from 'react';
import { Vector3 } from 'three';
import { SphericalLens } from '../physics/components/SphericalLens';
import { LensProfileEditorCore, type ProfileEditorMutate } from './LensProfileEditor';
import { ScrubInput } from './ScrubInput';
import {
    clampRadiusOfCurvature,
    designerGridStyle as gridStyle,
    designerOptionStyle as optionStyle,
    designerSelectStyle as selectStyle,
    formatLensNumber,
    parseLensNumber,
} from './lensDesignerShared';

export type SphericalLensMutate = (mutate: (lens: SphericalLens) => void) => void;

export const SphericalLensDesigner: React.FC<{
    lens: SphericalLens;
    onMutate: SphericalLensMutate;
    showProfileEditor?: boolean;
    profileTitle?: string;
    onEditStart?: () => void;
}> = ({ lens, onMutate, showProfileEditor = true, profileTitle = 'Profile Editor', onEditStart }) => {
    const [localLensType, setLocalLensType] = useState<string>('biconvex');
    const [localFocal, setLocalFocal] = useState<string>('0');
    const [localRadius, setLocalRadius] = useState<string>('0');
    const [localThickness, setLocalThickness] = useState<string>('0');
    const [localIor, setLocalIor] = useState<string>('1.5');
    const [localR1, setLocalR1] = useState<string>('0');
    const [localR2, setLocalR2] = useState<string>('0');

    useEffect(() => {
        const radii = lens.getRadii();
        setLocalLensType(lens.getLensType());
        setLocalFocal(formatLensNumber(lens.focalLength));
        setLocalRadius(formatLensNumber(lens.apertureRadius));
        setLocalThickness(formatLensNumber(lens.thickness));
        setLocalIor(String(lens.ior));
        setLocalR1(formatLensNumber(radii.R1));
        setLocalR2(formatLensNumber(radii.R2));
    }, [lens, lens.version, lens.apertureRadius, lens.thickness, lens.ior, lens.curvature, lens.r1, lens.r2]);

    const mutateLens = useCallback((mutate: (target: SphericalLens) => void, invalidate = true) => {
        onMutate((target) => {
            mutate(target);
            if (invalidate) target.invalidateMesh();
        });
    }, [onMutate]);

    const commit = useCallback((param: 'focal' | 'radius' | 'thickness' | 'ior' | 'r1' | 'r2', value: string) => {
        const val = parseLensNumber(value);
        if (!Number.isFinite(val)) return;

        mutateLens((target) => {
            if (param === 'focal') {
                if (Math.abs(val) > 0.001) target.curvature = 1 / val;
                else target.curvature = 0;
                target.r1 = undefined;
                target.r2 = undefined;
            } else if (param === 'radius') {
                target.apertureRadius = Math.max(1, val);
            } else if (param === 'thickness') {
                target.thickness = Math.max(0.1, val);
            } else if (param === 'ior') {
                target.ior = Math.max(1.0, Math.min(3.0, val));
            } else if (param === 'r1') {
                const old = target.getRadii();
                target.r1 = clampRadiusOfCurvature(val, target.apertureRadius);
                if (target.r2 === undefined) target.r2 = old.R2;
            } else if (param === 'r2') {
                const old = target.getRadii();
                target.r2 = clampRadiusOfCurvature(val, target.apertureRadius);
                if (target.r1 === undefined) target.r1 = old.R1;
            }
            target.bounds.set(
                new Vector3(-target.apertureRadius, -target.apertureRadius, -target.thickness / 2),
                new Vector3(target.apertureRadius, target.apertureRadius, target.thickness / 2),
            );
        });
    }, [mutateLens]);

    const profileMutate: ProfileEditorMutate = useCallback((mutate) => {
        onMutate((target) => {
            mutate(target);
        });
    }, [onMutate]);

    return (
        <div>
            <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 4 }}>Lens Type</label>
                <select
                    value={localLensType}
                    onChange={(event) => {
                        const type = event.target.value;
                        setLocalLensType(type);
                        mutateLens((target) => {
                            target.setFromLensType(type);
                        }, false);
                    }}
                    style={selectStyle}
                >
                    <option style={optionStyle} value="biconvex">Biconvex</option>
                    <option style={optionStyle} value="plano-convex">Plano-Convex</option>
                    <option style={optionStyle} value="convex-plano">Convex-Plano</option>
                    <option style={optionStyle} value="meniscus-pos">Meniscus (+)</option>
                    <option style={optionStyle} value="plano-concave">Plano-Concave</option>
                    <option style={optionStyle} value="concave-plano">Concave-Plano</option>
                    <option style={optionStyle} value="biconcave">Biconcave</option>
                    <option style={optionStyle} value="meniscus-neg">Meniscus (-)</option>
                </select>
            </div>

            <div style={gridStyle}>
                <ScrubInput label="Focal Len" suffix="mm" value={localFocal} onChange={setLocalFocal} onCommit={(v) => commit('focal', v)} speed={1.0} />
                <ScrubInput label="Aperture" suffix="mm" value={localRadius} onChange={setLocalRadius} onCommit={(v) => commit('radius', v)} speed={0.5} min={1} max={200} />
                <ScrubInput label="Thickness" suffix="mm" value={localThickness} onChange={setLocalThickness} onCommit={(v) => commit('thickness', v)} speed={0.2} min={0.1} max={100} />
                <ScrubInput
                    label="IoR"
                    value={localIor}
                    onChange={setLocalIor}
                    onCommit={(v) => commit('ior', v)}
                    speed={0.005}
                    min={1.0}
                    max={3.0}
                    step={0.001}
                    title="Index of Refraction (1.0 = air, 1.5 = BK7, 1.7 = Lanthanum Crown)"
                />
                <ScrubInput
                    label="R1"
                    suffix="mm"
                    value={localR1}
                    onChange={setLocalR1}
                    onCommit={(v) => commit('r1', v)}
                    speed={2.0}
                    allowInfinity
                    title="+ = Convex, - = Concave, 'Infinity' = Flat"
                />
                <ScrubInput
                    label="R2"
                    suffix="mm"
                    value={localR2}
                    onChange={setLocalR2}
                    onCommit={(v) => commit('r2', v)}
                    speed={2.0}
                    allowInfinity
                    title="- = Convex, + = Concave, 'Infinity' = Flat"
                />
            </div>

            {showProfileEditor && (
                <LensProfileEditorCore
                    component={lens}
                    onMutate={profileMutate}
                    onEditStart={onEditStart}
                    title={profileTitle}
                />
            )}
        </div>
    );
};
