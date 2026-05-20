import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { DichroicMirror } from '../../physics/components/DichroicMirror';
import { Mirror } from '../../physics/components/Mirror';
import { SpectralProfile } from '../../physics/SpectralProfile';
import { Coherence, createRay, defaultTransversePolarization } from '../../physics/types';
import {
    getFoldOpticPreviewRayCount,
    getFoldOpticPreviewRayOffsets,
    getFoldOpticPreviewWavelengthNm,
} from '../FoldOpticDesigner';

function horizontalRay(y: number) {
    const direction = new Vector3(1, 0, 0);
    return createRay({
        origin: new Vector3(-100, y, 0),
        direction,
        wavelength: 550e-9,
        intensity: 1,
        polarization: defaultTransversePolarization(direction),
        opticalPathLength: 0,
        footprintRadius: 0.05,
        coherenceMode: Coherence.Coherent,
    });
}

describe('Fold optic catalog preview', () => {
    test('dichroic preview ray offsets stay inside the real tilted aperture', () => {
        const dichroic = new DichroicMirror(25.4, 2, new SpectralProfile('longpass', 505));
        dichroic.pointAlong(-Math.SQRT1_2, Math.SQRT1_2, 0);

        const offsets = getFoldOpticPreviewRayOffsets(dichroic);

        expect(offsets).toHaveLength(15);
        for (const offset of offsets) {
            expect(dichroic.chkIntersection(horizontalRay(offset))).not.toBeNull();
        }
    });

    test('dichroic preview samples the spectrum through 800 nm', () => {
        const dichroic = new DichroicMirror();
        const count = getFoldOpticPreviewRayCount(dichroic);
        const wavelengths = Array.from({ length: count }, (_, index) => (
            getFoldOpticPreviewWavelengthNm(dichroic, index, count)
        ));

        expect(count).toBe(15);
        expect(wavelengths[0]).toBeCloseTo(380, 6);
        expect(wavelengths[wavelengths.length - 1]).toBeCloseTo(800, 6);
        expect(wavelengths.every((nm, index) => index === 0 || nm > wavelengths[index - 1]!)).toBe(true);
    });

    test('non-dichroic fold optics keep the compact ten-ray preview', () => {
        const mirror = new Mirror();

        expect(getFoldOpticPreviewRayCount(mirror)).toBe(10);
        expect(getFoldOpticPreviewRayOffsets(mirror)).toHaveLength(10);
        expect(getFoldOpticPreviewWavelengthNm(mirror, 0, 10)).toBe(550);
    });
});
