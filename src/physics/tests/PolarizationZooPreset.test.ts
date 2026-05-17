import { describe, expect, test } from 'bun:test';
import { Laser } from '../components/Laser';
import { Waveplate } from '../components/Waveplate';
import { Card } from '../components/Card';
import { Solver1 } from '../Solver1';
import { createSourceRays } from '../SourceRayFactory';
import { createPolarizationZooScene } from '../../presets/polarizationZoo';

describe('Polarization Zoo preset', () => {
    test('lasers are polarized to pass the first polarizer in each row', () => {
        const scene = createPolarizationZooScene();
        const lasers = scene.filter(component => component instanceof Laser) as Laser[];
        expect(lasers).toHaveLength(3);
        expect(lasers.every(laser => laser.polarizationAngle === Math.PI / 2)).toBe(true);
        const firstPolarizers = scene
            .filter(component => component instanceof Waveplate && component.name === 'Pol @ 0°') as Waveplate[];
        const analyzers = scene
            .filter(component => component instanceof Waveplate && component.name === 'Pol @ 90°') as Waveplate[];
        expect(firstPolarizers).toHaveLength(3);
        expect(analyzers).toHaveLength(3);
        expect(firstPolarizers.every(polarizer => polarizer.fastAxisAngle === 0)).toBe(true);
        expect(analyzers.every(polarizer => polarizer.fastAxisAngle === Math.PI / 2)).toBe(true);
        const cards = scene.filter(component => component instanceof Card) as Card[];
        expect(cards).toHaveLength(3);
        expect(cards.every(card => card.opaque)).toBe(true);

        const sourceRays = createSourceRays(scene, 1, 'center');
        const paths = new Solver1(scene).trace(sourceRays);

        expect(paths).toHaveLength(3);
        for (const path of paths) {
            expect(path.length).toBeGreaterThanOrEqual(2);
            expect(path[1].intensity).toBeGreaterThan(0.95);
            expect(path[path.length - 1].intensity).toBeGreaterThan(0.2);
        }
    });
});
