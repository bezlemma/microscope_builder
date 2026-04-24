import React, { useMemo } from 'react';
import { Text, Line } from '@react-three/drei';
import { Vector3, QuadraticBezierCurve3 } from 'three';
import { Annotation } from '../../physics/components/Annotation';

/**
 * Draws user-placed text / arrow / curved-arrow annotations.
 *
 * The annotation is authored in its local frame (arrows along +X, text at
 * origin, curved arrow arches in +Y).  The parent <Draggable> applies the
 * component's position and rotation, so this visualizer only needs to render
 * the local geometry.
 */
export const AnnotationVisualizer: React.FC<{ component: Annotation }> = ({ component }) => {
    const { kind, text, length, fontSize, color } = component;

    const straightPoints = useMemo<[number, number, number][]>(() => {
        const half = length / 2;
        return [
            [-half, 0, 0],
            [half, 0, 0],
        ];
    }, [length]);

    const curvedPoints = useMemo<[number, number, number][]>(() => {
        const half = length / 2;
        const start = new Vector3(-half, 0, 0);
        const end = new Vector3(half, 0, 0);
        const control = new Vector3(0, length * 0.45, 0);
        const curve = new QuadraticBezierCurve3(start, control, end);
        return curve.getPoints(32).map(p => [p.x, p.y, p.z] as [number, number, number]);
    }, [length]);

    const arrowheadStraight = useMemo<[number, number, number][]>(() => {
        const half = length / 2;
        const headLen = Math.min(8, length * 0.15);
        const headWid = headLen * 0.6;
        return [
            [half, 0, 0],
            [half - headLen, headWid, 0],
            [half - headLen, -headWid, 0],
            [half, 0, 0],
        ];
    }, [length]);

    const arrowheadCurved = useMemo<[number, number, number][] | null>(() => {
        if (curvedPoints.length < 3) return null;
        const tip = new Vector3(...curvedPoints[curvedPoints.length - 1]);
        const prev = new Vector3(...curvedPoints[curvedPoints.length - 3]);
        const dir = tip.clone().sub(prev);
        if (dir.lengthSq() < 1e-6) return null;
        dir.normalize();
        const perp = new Vector3(-dir.y, dir.x, 0);
        const headLen = Math.min(8, length * 0.15);
        const headWid = headLen * 0.6;
        const a = tip.clone();
        const b = tip.clone().sub(dir.clone().multiplyScalar(headLen)).add(perp.clone().multiplyScalar(headWid));
        const c = tip.clone().sub(dir.clone().multiplyScalar(headLen)).sub(perp.clone().multiplyScalar(headWid));
        return [
            [a.x, a.y, a.z],
            [b.x, b.y, b.z],
            [c.x, c.y, c.z],
            [a.x, a.y, a.z],
        ];
    }, [curvedPoints, length]);

    if (kind === 'text') {
        return (
            <group
                position={[component.position.x, component.position.y, component.position.z]}
                quaternion={component.rotation.clone()}
                onClick={(e) => { e.stopPropagation(); }}
            >
                <Text
                    fontSize={fontSize}
                    color={color}
                    anchorX="center"
                    anchorY="middle"
                >
                    {text || 'Label'}
                </Text>
            </group>
        );
    }

    const points = kind === 'curvedArrow' ? curvedPoints : straightPoints;
    const head = kind === 'curvedArrow' ? arrowheadCurved : arrowheadStraight;

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <Line points={points} color={color} lineWidth={3} />
            {head && <Line points={head} color={color} lineWidth={3} />}
            {text && (
                <Text
                    position={[0, kind === 'curvedArrow' ? length * 0.55 : 6, 0]}
                    fontSize={fontSize}
                    color={color}
                    anchorX="center"
                    anchorY="middle"
                >
                    {text}
                </Text>
            )}
        </group>
    );
};
