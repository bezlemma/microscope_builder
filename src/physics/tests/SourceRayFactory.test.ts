import { describe, expect, test } from 'bun:test';
import { ConeSource3D } from '../components/ConeSource3D';
import { PointSource2D } from '../components/PointSource2D';
import { PointSource3D } from '../components/PointSource3D';
import { WedgeSource2D } from '../components/WedgeSource2D';
import { createSourceRays } from '../SourceRayFactory';

function totalIntensityFor(component: { id: string }, rayCount: number): number {
    return createSourceRays([component as any], rayCount, 'full')
        .reduce((sum, ray) => sum + ray.intensity, 0);
}

describe('SourceRayFactory', () => {
    test('conserves point and angular source power including the main ray', () => {
        const sources = [
            new PointSource2D('Point 2D'),
            new PointSource3D('Point 3D'),
            new ConeSource3D('Cone 3D'),
            new WedgeSource2D('Wedge 2D'),
        ];

        for (const source of sources) {
            source.power = 2.5;
            expect(totalIntensityFor(source, 4)).toBeCloseTo(2.5, 6);
        }
    });

    test('zero-power point source emits zero-intensity rays', () => {
        const source = new PointSource3D('Dark point');
        source.power = 0;
        const rays = createSourceRays([source], 4, 'full');
        expect(rays.length).toBeGreaterThan(0);
        expect(rays.reduce((sum, ray) => sum + ray.intensity, 0)).toBe(0);
    });
});
