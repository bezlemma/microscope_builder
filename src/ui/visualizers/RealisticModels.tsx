/**
 * RealisticModels — GLB-based 3D model components for "Realistic View" mode.
 *
 * Each component loads a pre-converted GLB model and renders it with PBR
 * materials, aligned to the optical component's position and rotation.
 *
 * Models are stored in public/models/ and served by Vite as static assets.
 * The conversion pipeline lives in scripts/step_to_glb.py.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import type { OpticalComponent } from '../../physics/Component';

// ── Material palette ─────────────────────────────────────────────────
// Using metalness: 0 because the scene has no environment map — high
// metalness with no env map → pure black reflection.

const MAT_BODY     = new THREE.MeshStandardMaterial({ color: 0x3a3c44, metalness: 0, roughness: 0.7 });
const MAT_FRONT    = new THREE.MeshStandardMaterial({ color: 0x404550, metalness: 0, roughness: 0.6 });
const MAT_BASE     = new THREE.MeshStandardMaterial({ color: 0x606670, metalness: 0, roughness: 0.5 });
const MAT_SM1      = new THREE.MeshStandardMaterial({ color: 0x555a65, metalness: 0, roughness: 0.5 });
const MAT_BOLT     = new THREE.MeshStandardMaterial({ color: 0x808890, metalness: 0, roughness: 0.4 });
const MAT_DARK     = new THREE.MeshStandardMaterial({ color: 0x252528, metalness: 0, roughness: 0.8 });
const MAT_LABEL    = new THREE.MeshStandardMaterial({ color: 0x4a5068, metalness: 0, roughness: 0.6 });
const MAT_FALLBACK = new THREE.MeshStandardMaterial({ color: 0x454850, metalness: 0, roughness: 0.6 });

function applyLaserMaterials(object: THREE.Object3D): void {
    object.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) return;
        const mesh = child as THREE.Mesh;
        const name = (mesh.name || mesh.parent?.name || '').toLowerCase();

        if (name.includes('body'))                        mesh.material = MAT_BODY;
        else if (name.includes('front'))                  mesh.material = MAT_FRONT;
        else if (name.includes('base'))                   mesh.material = MAT_BASE;
        else if (name.includes('sm1') || name.includes('aperture')) mesh.material = MAT_SM1;
        else if (name.includes('bolt') || name.includes('screw') || name.includes('adj')) mesh.material = MAT_BOLT;
        else if (name.includes('cage'))                   mesh.material = MAT_BOLT;
        else if (name.includes('connector') || name.includes('hole')) mesh.material = MAT_DARK;
        else if (name.includes('label'))                  mesh.material = MAT_LABEL;
        else                                              mesh.material = MAT_FALLBACK;
    });
}

// ── Model path helper (respects Vite base path) ──────────────────────

function modelPath(filename: string): string {
    return `${import.meta.env.BASE_URL}models/${filename}`;
}

// ── Realistic Laser ──────────────────────────────────────────────────

const LASER_MODEL_PATH = modelPath('laser.glb');

export const RealisticLaser = ({ component }: { component: OpticalComponent }) => {
    const { scene } = useGLTF(LASER_MODEL_PATH);

    const clone = useMemo(() => {
        const c = scene.clone(true);
        applyLaserMaterials(c);
        return c;
    }, [scene]);

    // The component origin = beam emission point (local Z=0).
    // The GLB is built with the SM1 aperture at Z≈0 and body behind in -Z.
    // We shift so the front-most point (SM1 tip) aligns with Z=0.
    const offset = useMemo(() => {
        const box = new THREE.Box3().setFromObject(clone);
        const center = box.getCenter(new THREE.Vector3());
        return new THREE.Vector3(
            -center.x,   // center X on origin
            -center.y,   // center Y on origin
            -box.max.z,  // front face → Z=0, body extends into -Z
        );
    }, [clone]);

    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
        >
            <primitive object={clone} position={[offset.x, offset.y, offset.z]} />
        </group>
    );
};

// Preload at module level so model is ready before first render
useGLTF.preload(LASER_MODEL_PATH);
