import React, { useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { useFrame } from '@react-three/fiber';
import { Text, Line } from '@react-three/drei';
import { Vector3, QuadraticBezierCurve3 } from 'three';
import { componentsAtom, activePresetAtom, isDraggingAtom, PresetName } from '../state/store';
import { CurvedMirror } from '../physics/components/CurvedMirror';

const FADE_DURATION_SEC = 0.6;

const EMPTY_POINTS: [number, number, number][] = [[0, 0, 0], [0, 0, 0]];

/**
 * Tutorial overlay rendered inside the 3D scene.
 *
 * Shows glowing "Drag mirror here" text and a curved arrow from the first real
 * mirror ("M1") to its ghost target ("M1 Target").  As soon as the user begins
 * dragging anything, the overlay fades out and is removed.
 */
export const TutorialOverlay: React.FC = () => {
    const [components] = useAtom(componentsAtom);
    const [activePreset] = useAtom(activePresetAtom);
    const [isDragging] = useAtom(isDraggingAtom);

    const [opacity, setOpacity] = useState(1);
    const fadingRef = useRef(false);
    const hasStartedDragRef = useRef(false);

    // Once the user starts dragging (ever), begin the fade-out.
    if (isDragging && !hasStartedDragRef.current) {
        hasStartedDragRef.current = true;
        fadingRef.current = true;
    }

    useFrame((_state, delta) => {
        if (!fadingRef.current) return;
        setOpacity(prev => {
            const next = prev - delta / FADE_DURATION_SEC;
            if (next <= 0) {
                fadingRef.current = false;
                return 0;
            }
            return next;
        });
    });

    // Find the first real mirror and its ghost target.
    const positions = useMemo(() => {
        if (activePreset !== PresetName.Tutorial) return null;
        let realM1: CurvedMirror | null = null;
        let ghostM1: CurvedMirror | null = null;
        for (const c of components) {
            if (!(c instanceof CurvedMirror)) continue;
            if (c.isGhost && !ghostM1 && c.name.includes('M1')) ghostM1 = c;
            else if (!c.isGhost && !realM1 && c.name === 'M1') realM1 = c;
        }
        if (!realM1 || !ghostM1) return null;
        return {
            from: realM1.position.clone(),
            to: ghostM1.position.clone(),
        };
    }, [components, activePreset]);

    // Curved arrow: quadratic Bézier arching upward, offset laterally.
    const arrowPoints = useMemo(() => {
        if (!positions) return EMPTY_POINTS;
        const { from, to } = positions;
        const mid = from.clone().add(to).multiplyScalar(0.5);
        const offset = to.clone().sub(from);
        const lateral = offset.lengthSq() > 1e-6
            ? new Vector3(-offset.y, offset.x, 0).normalize().multiplyScalar(offset.length() * 0.25)
            : new Vector3(0, 0, 0);
        const control = mid.clone().add(lateral).add(new Vector3(0, 0, 30));
        const curve = new QuadraticBezierCurve3(
            from.clone().add(new Vector3(0, 0, 10)),
            control,
            to.clone().add(new Vector3(0, 0, 10)),
        );
        return curve.getPoints(40).map(p => [p.x, p.y, p.z] as [number, number, number]);
    }, [positions]);

    // Arrowhead: small triangle at the tip of the curve.
    const arrowhead = useMemo(() => {
        if (!positions || arrowPoints.length < 3) return null;
        const tip = new Vector3(...arrowPoints[arrowPoints.length - 1]);
        const prev = new Vector3(...arrowPoints[arrowPoints.length - 3]);
        const dir = tip.clone().sub(prev);
        if (dir.lengthSq() < 1e-6) return null;
        dir.normalize();
        const up = new Vector3(0, 0, 1);
        const side = new Vector3().crossVectors(dir, up);
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        side.normalize().multiplyScalar(4);
        const back = dir.clone().multiplyScalar(-8);
        const a = tip.clone();
        const b = tip.clone().add(back).add(side);
        const c = tip.clone().add(back).sub(side);
        return [
            [a.x, a.y, a.z] as [number, number, number],
            [b.x, b.y, b.z] as [number, number, number],
            [c.x, c.y, c.z] as [number, number, number],
            [a.x, a.y, a.z] as [number, number, number],
        ];
    }, [arrowPoints, positions]);

    if (!positions) return null;
    if (opacity <= 0) return null;

    const { to } = positions;
    const textZ = 15;
    const textPos: [number, number, number] = [to.x, to.y + 25, textZ];
    const glowColor = '#007fff';

    return (
        <group>
            <Text
                position={textPos}
                fontSize={14}
                color={glowColor}
                anchorX="center"
                anchorY="middle"
                fillOpacity={opacity}
            >
                Drag mirror here
            </Text>

            <Line
                points={arrowPoints}
                color={glowColor}
                lineWidth={3}
                transparent
                opacity={opacity}
            />
            {arrowhead && (
                <Line
                    points={arrowhead}
                    color={glowColor}
                    lineWidth={3}
                    transparent
                    opacity={opacity}
                />
            )}
        </group>
    );
};
