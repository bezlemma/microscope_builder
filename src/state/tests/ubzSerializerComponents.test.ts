import { describe, expect, test } from 'bun:test';
import { Annotation } from '../../physics/components/Annotation';
import { ConeSource3D } from '../../physics/components/ConeSource3D';
import { Objective } from '../../physics/components/Objective';
import { PointSource2D } from '../../physics/components/PointSource2D';
import { StructuredSource } from '../../physics/components/StructuredSource';
import { WedgeSource2D } from '../../physics/components/WedgeSource2D';
import { deserializeScene, serializeScene } from '../ubzSerializer';

describe('UBZ registered components', () => {
    test('round-trips point, cone, wedge, structured source, and annotation fields', () => {
        const point = new PointSource2D('Point fan');
        point.wavelength = 460;
        point.beamRadius = 0.4;
        point.power = 0.25;

        const cone = new ConeSource3D('Cone');
        cone.halfAngle = 0.42;
        cone.power = 0.5;

        const wedge = new WedgeSource2D('Wedge');
        wedge.subtendedAngle = 1.1;
        wedge.wavelength = 635;

        const structured = new StructuredSource('Pattern');
        structured.diameter = 12.5;
        structured.asciiChar = 'M';

        const annotation = new Annotation('text', 'Note', 'line 1\nline 2', 42, 7, '#abc123');

        const scene = deserializeScene(serializeScene([point, cone, wedge, structured, annotation]));
        expect(scene).toHaveLength(5);

        expect(scene[0]).toBeInstanceOf(PointSource2D);
        expect((scene[0] as PointSource2D).wavelength).toBeCloseTo(460, 6);
        expect((scene[0] as PointSource2D).beamRadius).toBeCloseTo(0.4, 6);
        expect((scene[0] as PointSource2D).power).toBeCloseTo(0.25, 6);

        expect(scene[1]).toBeInstanceOf(ConeSource3D);
        expect((scene[1] as ConeSource3D).halfAngle).toBeCloseTo(0.42, 6);
        expect((scene[1] as ConeSource3D).power).toBeCloseTo(0.5, 6);

        expect(scene[2]).toBeInstanceOf(WedgeSource2D);
        expect((scene[2] as WedgeSource2D).subtendedAngle).toBeCloseTo(1.1, 6);
        expect((scene[2] as WedgeSource2D).wavelength).toBeCloseTo(635, 6);

        expect(scene[3]).toBeInstanceOf(StructuredSource);
        expect((scene[3] as StructuredSource).diameter).toBeCloseTo(12.5, 6);
        expect((scene[3] as StructuredSource).asciiChar).toBe('M');

        expect(scene[4]).toBeInstanceOf(Annotation);
        const loadedAnnotation = scene[4] as Annotation;
        expect(loadedAnnotation.kind).toBe('text');
        expect(loadedAnnotation.text).toBe('line 1\nline 2');
        expect(loadedAnnotation.length).toBeCloseTo(42, 6);
        expect(loadedAnnotation.fontSize).toBeCloseTo(7, 6);
        expect(loadedAnnotation.color).toBe('#abc123');
    });

    test('round-trips objective editor-only fields and derived pupil radius', () => {
        const objective = new Objective({
            NA: 1.4,
            magnification: 60,
            immersionIndex: 1.515,
            workingDistance: 0.13,
            tubeLensFocal: 200,
            diameter: 20,
            name: 'Oil objective',
        });
        objective.immersionMediumKind = 'oil';
        objective.coverslipThickness = 0.13;
        objective.fieldNumber = 26.5;
        objective.pupil = {
            aberrations: {
                referenceWavelengthNm: 550,
                coefficients: [
                    { index: 4, coefficient: 0.12 },
                    { index: 11, coefficient: -0.03 },
                ],
            },
            apodization: null,
        };

        const scene = deserializeScene(serializeScene([objective]));
        expect(scene).toHaveLength(1);
        expect(scene[0]).toBeInstanceOf(Objective);

        const loaded = scene[0] as Objective;
        expect(loaded.immersionMediumKind).toBe('oil');
        expect(loaded.coverslipThickness).toBeCloseTo(0.13, 6);
        expect(loaded.fieldNumber).toBeCloseTo(26.5, 6);
        expect(loaded.pupilRadius).toBeCloseTo(loaded.apertureRadius, 6);
        expect(loaded.pupil?.aberrations?.referenceWavelengthNm).toBeCloseTo(550, 6);
        expect(loaded.pupil?.aberrations?.coefficients).toEqual([
            { index: 4, coefficient: 0.12 },
            { index: 11, coefficient: -0.03 },
        ]);
    });
});
