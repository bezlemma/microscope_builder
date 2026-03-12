import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
    BufferGeometry,
    Color,
    DoubleSide,
    Float32BufferAttribute,
    Vector3,
} from 'three';
import { wavelengthToRGB as wavelengthToRGBnm } from '../physics/spectral';
import { GaussianBeamSegment } from '../physics/Solver2';
import { Coherence, Ray } from '../physics/types';
import {
    buildBundleWavePaths,
    buildBundleWaveSegments,
    buildBundleWaveSegmentsFromRayPaths,
    BundleWavePath,
    BundleWaveSegment,
} from './bundleView';
import { buildWavePathRenderData, WaveRenderSample } from './bundleWaveRender';

const REFERENCE_WAVELENGTH = 550e-9;
const DISPLAY_WAVELENGTH_BASE = 5.0;
const ANIM_SPEED = 3.0;

function wavelengthToRGB(wavelengthMeters: number): { r: number; g: number; b: number } {
    const { r, g, b } = wavelengthToRGBnm(wavelengthMeters * 1e9);
    return { r, g, b };
}

function envelopeDisplayColor(wavelengthMeters: number, coherenceMode: Coherence): Color {
    if (coherenceMode === Coherence.Incoherent) {
        return new Color(0.94, 0.95, 0.9);
    }
    const rgb = wavelengthToRGB(wavelengthMeters);
    return new Color(rgb.r, rgb.g, rgb.b);
}

function waveDisplayColor(wavelengthMeters: number): Color {
    const rgb = wavelengthToRGB(wavelengthMeters);
    return new Color(rgb.r, rgb.g, rgb.b);
}

function fieldVectorForSample(
    sample: WaveRenderSample,
    time: number
): Vector3 {
    const pol = sample.polarization;
    const axAmp = Math.hypot(pol.x.re, pol.x.im);
    const ayAmp = Math.hypot(pol.y.re, pol.y.im);
    const phiX = Math.atan2(pol.x.im, pol.x.re);
    const phiY = Math.atan2(pol.y.im, pol.y.re);

    const displayLambda = DISPLAY_WAVELENGTH_BASE * (sample.wavelength / REFERENCE_WAVELENGTH);
    const k = (2 * Math.PI) / displayLambda;
    const phase = k * sample.opticalDistance - ANIM_SPEED * time;

    const ex = axAmp * Math.cos(phase + phiX);
    const ey = ayAmp * Math.cos(phase + phiY);
    const amplitudeNorm = Math.hypot(axAmp, ayAmp) || 1;
    const amplitudeScale = sample.radius / amplitudeNorm;

    return new Vector3()
        .addScaledVector(sample.right, ex * amplitudeScale)
        .addScaledVector(sample.up, ey * amplitudeScale);
}

const BundleEnvelopeView: React.FC<{ bundle: BundleWaveSegment }> = ({ bundle }) => {
    const color = useMemo(
        () => envelopeDisplayColor(bundle.wavelength, bundle.coherenceMode),
        [bundle.coherenceMode, bundle.wavelength]
    );
    const envelopeOpacity = bundle.coherenceMode === 0 ? 0.14 : 0.1;
    const geometry = useMemo(() => {
        const profile = bundle.profile;
        if (profile.length < 2) return null;

        const positions = new Float32Array(profile.length * 2 * 3);
        const indices = new Uint16Array((profile.length - 1) * 6);

        profile.forEach((sample, index) => {
            const minOffset = index * 6;
            positions[minOffset] = sample.edgeMin.x;
            positions[minOffset + 1] = sample.edgeMin.y;
            positions[minOffset + 2] = sample.edgeMin.z;
            positions[minOffset + 3] = sample.edgeMax.x;
            positions[minOffset + 4] = sample.edgeMax.y;
            positions[minOffset + 5] = sample.edgeMax.z;
        });

        let indexOffset = 0;
        for (let sampleIndex = 0; sampleIndex < profile.length - 1; sampleIndex++) {
            const current = sampleIndex * 2;
            const next = current + 2;
            indices[indexOffset++] = current;
            indices[indexOffset++] = current + 1;
            indices[indexOffset++] = next;
            indices[indexOffset++] = current + 1;
            indices[indexOffset++] = next + 1;
            indices[indexOffset++] = next;
        }

        const nextGeometry = new BufferGeometry();
        nextGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        nextGeometry.setIndex(Array.from(indices));
        nextGeometry.computeVertexNormals();
        return nextGeometry;
    }, [bundle.profile]);

    if (!geometry) return null;

    return (
        <mesh geometry={geometry} frustumCulled={false}>
            <meshBasicMaterial
                color={color}
                transparent
                opacity={envelopeOpacity}
                depthWrite={false}
                toneMapped={false}
                side={DoubleSide}
            />
        </mesh>
    );
};

const BundleWavePathView: React.FC<{ path: BundleWavePath }> = ({ path }) => {
    const lineGeometryRef = useRef<BufferGeometry>(null);
    const tickGeometryRef = useRef<BufferGeometry>(null);
    const color = useMemo(
        () => waveDisplayColor(path.segments[0]?.wavelength ?? 550e-9),
        [path.segments]
    );
    const renderData = useMemo(() => buildWavePathRenderData(path), [path]);
    const totalWavePoints = renderData.waveSamples.length;
    const totalTickSamples = renderData.tickSamples.length;

    const linePositions = useMemo(
        () => new Float32Array(Math.max(0, totalWavePoints - 1) * 2 * 3),
        [totalWavePoints]
    );
    const tickPositions = useMemo(
        () => new Float32Array(totalTickSamples * 2 * 3),
        [totalTickSamples]
    );

    useFrame(({ clock }) => {
        const time = clock.getElapsedTime();
        const points: Vector3[] = [];
        let tickIndex = 0;

        for (const sample of renderData.waveSamples) {
            const field = fieldVectorForSample(sample, time);
            points.push(sample.axisPoint.clone().add(field));
        }

        for (const sample of renderData.tickSamples) {
            const field = fieldVectorForSample(sample, time);
            const tip = sample.axisPoint.clone().add(field);

            tickPositions[tickIndex++] = sample.axisPoint.x;
            tickPositions[tickIndex++] = sample.axisPoint.y;
            tickPositions[tickIndex++] = sample.axisPoint.z;
            tickPositions[tickIndex++] = tip.x;
            tickPositions[tickIndex++] = tip.y;
            tickPositions[tickIndex++] = tip.z;
        }

        let lineIndex = 0;
        for (let i = 0; i < points.length - 1; i++) {
            linePositions[lineIndex++] = points[i].x;
            linePositions[lineIndex++] = points[i].y;
            linePositions[lineIndex++] = points[i].z;
            linePositions[lineIndex++] = points[i + 1].x;
            linePositions[lineIndex++] = points[i + 1].y;
            linePositions[lineIndex++] = points[i + 1].z;
        }

        if (lineGeometryRef.current) {
            const attr = lineGeometryRef.current.getAttribute('position') as Float32BufferAttribute;
            attr.set(linePositions);
            attr.needsUpdate = true;
        }

        if (tickGeometryRef.current) {
            const attr = tickGeometryRef.current.getAttribute('position') as Float32BufferAttribute;
            attr.set(tickPositions);
            attr.needsUpdate = true;
        }
    });

    return (
        <group>
            <lineSegments frustumCulled={false}>
                <bufferGeometry ref={tickGeometryRef}>
                    <bufferAttribute attach="attributes-position" args={[tickPositions, 3]} />
                </bufferGeometry>
                <lineBasicMaterial
                    color={color}
                    transparent
                    opacity={0.55}
                    depthTest={true}
                    toneMapped={false}
                />
            </lineSegments>

            <lineSegments frustumCulled={false}>
                <bufferGeometry ref={lineGeometryRef}>
                    <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
                </bufferGeometry>
                <lineBasicMaterial
                    color={color}
                    transparent
                    opacity={0.95}
                    depthTest={true}
                    toneMapped={false}
                />
            </lineSegments>
        </group>
    );
};

interface BundleWaveVisualizerProps {
    beamSegments: GaussianBeamSegment[][];
    reversePaths?: Ray[][];
}

export const BundleWaveVisualizer: React.FC<BundleWaveVisualizerProps> = ({ beamSegments, reversePaths = [] }) => {
    const bundles = useMemo(() => {
        const forwardBundles = buildBundleWaveSegments(beamSegments);
        const reverseBundles = reversePaths.length > 0
            ? buildBundleWaveSegmentsFromRayPaths(reversePaths)
            : [];
        return [...forwardBundles, ...reverseBundles];
    }, [beamSegments, reversePaths]);
    const paths = useMemo(() => buildBundleWavePaths(bundles), [bundles]);

    return (
        <group>
            {bundles.map(bundle => (
                <BundleEnvelopeView key={bundle.key} bundle={bundle} />
            ))}
            {paths.map(path => (
                <BundleWavePathView key={path.key} path={path} />
            ))}
        </group>
    );
};
