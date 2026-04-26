import React, { useEffect, useMemo, useRef } from 'react';
import { Html, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useAtom } from 'jotai';
import { DoubleSide, Mesh, MeshBasicMaterial, QuadraticBezierCurve3, Vector3 } from 'three';
import {
    activePresetAtom,
    cameraImageTickAtom,
    componentsAtom,
    forwardRaysAtom,
    pinnedViewersAtom,
    PresetName,
    solver3RenderTriggerAtom,
    startTutorialStage2Atom,
    tutorialStageAtom,
} from '../state/store';
import {
    copyTutorialCameraDetectorSettings,
    findNearestRealTutorialCamera,
    findTutorialCameraTarget,
    getTutorialMirrorStatus,
    isCameraOnTutorialTarget,
    isTutorialStageOneComplete,
} from './tutorialLogic';

const PULSE_Z_OFFSET = 12;
const EMPTY_ARROW_POINTS: [number, number, number][] = [[0, 0, 0], [0, 0, 0]];

const PulseRing: React.FC<{
    position: Vector3;
    radius: number;
    color?: string;
}> = ({ position, radius, color = '#007fff' }) => {
    const meshRef = useRef<Mesh>(null);
    const materialRef = useRef<MeshBasicMaterial>(null);

    useFrame(({ clock }) => {
        const t = clock.getElapsedTime();
        const phase = (Math.sin(t * 3.4) + 1) * 0.5;
        const scale = 1.0 + phase * 0.28;
        if (meshRef.current) meshRef.current.scale.setScalar(scale);
        if (materialRef.current) materialRef.current.opacity = 0.8 - phase * 0.35;
    });

    return (
        <mesh
            ref={meshRef}
            position={[position.x, position.y, position.z + PULSE_Z_OFFSET]}
            renderOrder={1000}
        >
            <ringGeometry args={[radius * 0.86, radius, 96]} />
            <meshBasicMaterial
                ref={materialRef}
                color={color}
                transparent
                opacity={0.8}
                side={DoubleSide}
                depthTest={false}
                depthWrite={false}
            />
        </mesh>
    );
};

const TutorialArrow: React.FC<{
    from: Vector3;
    to: Vector3;
    color?: string;
}> = ({ from, to, color = '#007fff' }) => {
    const points = useMemo(() => {
        const start = from.clone().add(new Vector3(0, 0, 18));
        const end = to.clone().add(new Vector3(0, 0, 18));
        const offset = end.clone().sub(start);
        if (offset.lengthSq() < 1e-6) return EMPTY_ARROW_POINTS;

        const mid = start.clone().add(end).multiplyScalar(0.5);
        const lateral = new Vector3(-offset.y, offset.x, 0)
            .normalize()
            .multiplyScalar(Math.min(Math.max(offset.length() * 0.22, 12), 42));
        const control = mid.add(lateral).add(new Vector3(0, 0, 18));
        return new QuadraticBezierCurve3(start, control, end)
            .getPoints(40)
            .map(p => [p.x, p.y, p.z] as [number, number, number]);
    }, [from, to]);

    const arrowhead = useMemo(() => {
        if (points.length < 3) return null;
        const tip = new Vector3(...points[points.length - 1]);
        const prev = new Vector3(...points[points.length - 3]);
        const dir = tip.clone().sub(prev);
        if (dir.lengthSq() < 1e-6) return null;
        dir.normalize();

        const side = new Vector3().crossVectors(dir, new Vector3(0, 0, 1));
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        side.normalize().multiplyScalar(4.5);

        const back = dir.clone().multiplyScalar(-9);
        const a = tip;
        const b = tip.clone().add(back).add(side);
        const c = tip.clone().add(back).sub(side);
        return [
            [a.x, a.y, a.z] as [number, number, number],
            [b.x, b.y, b.z] as [number, number, number],
            [c.x, c.y, c.z] as [number, number, number],
            [a.x, a.y, a.z] as [number, number, number],
        ];
    }, [points]);

    return (
        <group renderOrder={1001}>
            <Line
                points={points}
                color={color}
                lineWidth={4}
                transparent
                opacity={0.92}
            />
            {arrowhead && (
                <Line
                    points={arrowhead}
                    color={color}
                    lineWidth={4}
                    transparent
                    opacity={0.92}
                />
            )}
        </group>
    );
};

export const TutorialOverlay: React.FC = () => {
    const [components] = useAtom(componentsAtom);
    const [activePreset] = useAtom(activePresetAtom);
    const [tutorialStage] = useAtom(tutorialStageAtom);
    const [forwardRays] = useAtom(forwardRaysAtom);
    const [, startTutorialStage2] = useAtom(startTutorialStage2Atom);
    const [, setPinnedViewers] = useAtom(pinnedViewersAtom);
    const [, setSolver3Trigger] = useAtom(solver3RenderTriggerAtom);
    const [, setCameraImageTick] = useAtom(cameraImageTickAtom);
    const snappedCameraIds = useRef<Set<string>>(new Set());
    const isTutorialPreset = activePreset === PresetName.Tutorial || activePreset === PresetName.Tutorial2;

    const mirrorStatus = useMemo(
        () => getTutorialMirrorStatus(components),
        [components],
    );
    const stageOneComplete = useMemo(
        () => tutorialStage === 1 && isTutorialStageOneComplete(components, forwardRays),
        [components, forwardRays, tutorialStage],
    );
    const cameraTarget = useMemo(
        () => findTutorialCameraTarget(components),
        [components],
    );
    const realTutorialCamera = useMemo(
        () => cameraTarget ? findNearestRealTutorialCamera(components, cameraTarget) : null,
        [components, cameraTarget],
    );
    const cameraTargetVersion = cameraTarget?.version ?? -1;
    const realTutorialCameraVersion = realTutorialCamera?.version ?? -1;
    const cameraReady = useMemo(
        () => isCameraOnTutorialTarget(realTutorialCamera, cameraTarget),
        [cameraTarget, cameraTargetVersion, realTutorialCamera, realTutorialCameraVersion],
    );
    const completionButtonPosition = useMemo(() => {
        const prism = components.find(c => c.name === 'Dispersion Prism');
        const screen = components.find(c => c.name === 'Screen');
        if (!prism || !screen) return new Vector3(135, 72, 44);

        return prism.position.clone()
            .lerp(screen.position, 0.64)
            .add(new Vector3(0, -30, 44));
    }, [components]);

    useEffect(() => {
        if (!isTutorialPreset || tutorialStage !== 2 || !cameraTarget || !realTutorialCamera || !cameraReady) {
            return;
        }
        if (snappedCameraIds.current.has(realTutorialCamera.id)) return;

        snappedCameraIds.current.add(realTutorialCamera.id);
        copyTutorialCameraDetectorSettings(cameraTarget, realTutorialCamera);

        setPinnedViewers(prev => {
            const next = new Set(prev);
            next.add(realTutorialCamera.id);
            return next;
        });
        setCameraImageTick(tick => tick + 1);
        setSolver3Trigger(trigger => trigger + 1);
    }, [
        cameraReady,
        cameraTarget,
        isTutorialPreset,
        realTutorialCamera,
        setCameraImageTick,
        setPinnedViewers,
        setSolver3Trigger,
        tutorialStage,
    ]);

    if (!isTutorialPreset) return null;

    if (tutorialStage === 2) {
        const targetPosition = cameraTarget?.position;

        return (
            <group>
                {targetPosition && !cameraReady && (
                    <PulseRing position={targetPosition} radius={26} />
                )}
                {cameraTarget && !cameraReady && (
                    <Html
                        position={[
                            cameraTarget.position.x,
                            cameraTarget.position.y,
                            cameraTarget.position.z + 34,
                        ]}
                        center
                        zIndexRange={[30, 0]}
                        style={{ pointerEvents: 'none' }}
                    >
                        <div className="tutorial-target-pill">drag camera here</div>
                    </Html>
                )}
            </group>
        );
    }

    const cue = !mirrorStatus.m1Placed
        ? { mirror: mirrorStatus.realM1, target: mirrorStatus.ghostM1 }
        : (!mirrorStatus.m2Placed
            ? { mirror: mirrorStatus.realM2, target: mirrorStatus.ghostM2 }
            : null);

    return (
        <group>
            {cue?.mirror && !stageOneComplete && (
                <PulseRing position={cue.mirror.position} radius={18} />
            )}
            {cue?.mirror && cue.target && !stageOneComplete && (
                <TutorialArrow from={cue.mirror.position} to={cue.target.position} />
            )}
            {stageOneComplete && (
                <Html
                    position={[completionButtonPosition.x, completionButtonPosition.y, completionButtonPosition.z]}
                    center
                    zIndexRange={[30, 0]}
                    style={{ pointerEvents: 'none' }}
                >
                    <button
                        type="button"
                        className="tutorial-complete-button"
                        onClick={() => startTutorialStage2()}
                    >
                        Go to tutorial 2!
                    </button>
                </Html>
            )}
        </group>
    );
};
