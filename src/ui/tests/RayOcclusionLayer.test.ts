import { describe, expect, test } from 'bun:test';
import { MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial } from 'three';
import { rayOcclusionOpacityForMaterial } from '../RayOcclusionLayer';
import { RAY_OCCLUSION_RENDER_ORDER, RAY_RENDER_ORDER } from '../renderOrder';

describe('RayOcclusionLayer', () => {
    test('renders the occlusion veil after ray lines', () => {
        expect(RAY_OCCLUSION_RENDER_ORDER).toBeGreaterThan(RAY_RENDER_ORDER);
    });

    test('adds a veil for transmissive low-opacity glass', () => {
        const material = new MeshPhysicalMaterial({
            transparent: true,
            opacity: 0.1,
            transmission: 0.99,
        });

        expect(rayOcclusionOpacityForMaterial(material)).toBeGreaterThan(0.04);
    });

    test('adds a stronger veil for visible translucent component bodies', () => {
        const material = new MeshStandardMaterial({
            transparent: true,
            opacity: 0.6,
        });

        expect(rayOcclusionOpacityForMaterial(material)).toBeGreaterThan(0.08);
    });

    test('ignores invisible, decorative, and wireframe helper materials', () => {
        expect(rayOcclusionOpacityForMaterial(new MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            colorWrite: false,
        }))).toBeNull();

        expect(rayOcclusionOpacityForMaterial(new MeshBasicMaterial({
            transparent: true,
            opacity: 0.08,
        }))).toBeNull();

        expect(rayOcclusionOpacityForMaterial(new MeshBasicMaterial({
            transparent: true,
            opacity: 0.5,
            wireframe: true,
        }))).toBeNull();
    });
});
