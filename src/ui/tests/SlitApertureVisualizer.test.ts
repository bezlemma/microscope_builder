import { describe, expect, test } from 'bun:test';
import { SlitAperture } from '../../physics/components/SlitAperture';
import { buildSlitApertureBarSpecs } from '../visualizers/ComponentVisualizers';

describe('Slit aperture visualizer geometry', () => {
    test('uses slitWidth along X and slitHeight along Y to match clipping axes', () => {
        const slit = new SlitAperture(4, 20, 25, 'Test Slit');
        const bars = buildSlitApertureBarSpecs(slit);

        const leftBar = bars.find((bar) => bar.position[0] < 0);
        const rightBar = bars.find((bar) => bar.position[0] > 0);
        const topBar = bars.find((bar) => bar.position[1] > 0);
        const bottomBar = bars.find((bar) => bar.position[1] < 0);

        expect(leftBar).toBeDefined();
        expect(rightBar).toBeDefined();
        expect(topBar).toBeDefined();
        expect(bottomBar).toBeDefined();

        expect(Math.abs(leftBar!.position[0])).toBeCloseTo((slit.housingDiameter / 2 + slit.slitWidth / 2) / 2, 6);
        expect(Math.abs(rightBar!.position[0])).toBeCloseTo((slit.housingDiameter / 2 + slit.slitWidth / 2) / 2, 6);
        expect(Math.abs(topBar!.position[1])).toBeCloseTo((slit.housingDiameter / 2 + slit.slitHeight / 2) / 2, 6);
        expect(Math.abs(bottomBar!.position[1])).toBeCloseTo((slit.housingDiameter / 2 + slit.slitHeight / 2) / 2, 6);

        expect(leftBar!.size[1]).toBeCloseTo(slit.slitHeight, 6);
        expect(rightBar!.size[1]).toBeCloseTo(slit.slitHeight, 6);
        expect(topBar!.size[0]).toBeCloseTo(slit.housingDiameter, 6);
        expect(bottomBar!.size[0]).toBeCloseTo(slit.housingDiameter, 6);
    });
});
