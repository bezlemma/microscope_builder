import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { Annotation } from '../../physics/components/Annotation';
import { Aperture } from '../../physics/components/Aperture';
import { Card } from '../../physics/components/Card';
import { ConeSource3D } from '../../physics/components/ConeSource3D';
import { Lamp } from '../../physics/components/Lamp';
import { Laser } from '../../physics/components/Laser';
import { Objective } from '../../physics/components/Objective';
import { PointSource2D } from '../../physics/components/PointSource2D';
import { QPD } from '../../physics/components/QPD';
import { Sample } from '../../physics/components/Sample';
import { StructuredSource } from '../../physics/components/StructuredSource';
import { TrappedBead } from '../../physics/components/TrappedBead';
import { WedgeSource2D } from '../../physics/components/WedgeSource2D';
import { deserializeScene, serializeScene } from '../ubzSerializer';

describe('UBZ registered components', () => {
    test('round-trips laser emission toggle without losing configured power', () => {
        const laser = new Laser('Switchable laser');
        laser.wavelength = 780;
        laser.beamRadius = 0.75;
        laser.power = 120;
        laser.isOn = false;

        const scene = deserializeScene(serializeScene([laser]));
        expect(scene[0]).toBeInstanceOf(Laser);
        const loadedLaser = scene[0] as Laser;
        expect(loadedLaser.wavelength).toBeCloseTo(780, 6);
        expect(loadedLaser.beamRadius).toBeCloseTo(0.75, 6);
        expect(loadedLaser.power).toBeCloseTo(120, 6);
        expect(loadedLaser.isOn).toBe(false);
    });

    test('round-trips card detector opacity', () => {
        const card = new Card(12, 8, 'Detector card');
        card.opaque = true;

        const scene = deserializeScene(serializeScene([card]));
        expect(scene).toHaveLength(1);
        expect(scene[0]).toBeInstanceOf(Card);

        const loaded = scene[0] as Card;
        expect(loaded.width).toBeCloseTo(12, 6);
        expect(loaded.height).toBeCloseTo(8, 6);
        expect(loaded.opaque).toBe(true);
    });

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

    test('round-trips lamp extended source settings', () => {
        const lamp = new Lamp('Extended lamp');
        lamp.power = 4;
        lamp.beamRadius = 5;
        lamp.sourcePointCount = 7;
        lamp.emitterRadius = 1.25;
        lamp.spectralWavelengths = [450, 550, 650];

        const scene = deserializeScene(serializeScene([lamp]));
        expect(scene).toHaveLength(1);
        expect(scene[0]).toBeInstanceOf(Lamp);

        const loaded = scene[0] as Lamp;
        expect(loaded.power).toBeCloseTo(4, 6);
        expect(loaded.beamRadius).toBeCloseTo(5, 6);
        expect(loaded.sourcePointCount).toBe(7);
        expect(loaded.emitterRadius).toBeCloseTo(1.25, 6);
        expect(loaded.spectralWavelengths).toEqual([450, 550, 650]);
    });

    test('sanitizes non-finite lamp emission settings on load', () => {
        const scene = deserializeScene([
            '[Lamp]',
            'name = Bad lamp',
            'beamRadius = Infinity',
            'power = Infinity',
            'sourcePointCount = Infinity',
            'emitterRadius = Infinity',
            'spectralWavelengths = Infinity, NaN, -10, 550',
        ].join('\n'));

        expect(scene).toHaveLength(1);
        expect(scene[0]).toBeInstanceOf(Lamp);

        const loaded = scene[0] as Lamp;
        expect(Number.isFinite(loaded.beamRadius)).toBe(true);
        expect(Number.isFinite(loaded.power)).toBe(true);
        expect(Number.isFinite(loaded.sourcePointCount)).toBe(true);
        expect(Number.isFinite(loaded.emitterRadius)).toBe(true);
        expect(loaded.beamRadius).toBeCloseTo(3, 6);
        expect(loaded.power).toBeCloseTo(1, 6);
        expect(loaded.sourcePointCount).toBe(1);
        expect(loaded.emitterRadius).toBeCloseTo(0, 6);
        expect(loaded.spectralWavelengths).toEqual([550]);
    });

    test('round-trips trapped bead confinement and clamps stale offsets', () => {
        const bead = new TrappedBead(0.5, 1.59, 1.33, 'Confined bead');
        bead.confinementHalfSize = new Vector3(2, 3, 4);
        bead.specimenOffset.set(10, -10, 10);
        bead.surfaceReflectionScale = 0.7;
        bead.visualGlowRadius = 0.25;
        bead.trapCaptureRadius = 0.03;
        bead.trapAxialCaptureRange = 0.012;

        const scene = deserializeScene(serializeScene([bead]));
        expect(scene).toHaveLength(1);
        expect(scene[0]).toBeInstanceOf(TrappedBead);

        const loaded = scene[0] as TrappedBead;
        expect(loaded.confinementHalfSize?.toArray()).toEqual([2, 3, 4]);
        const limit = loaded.getConfinementLimit()!;
        expect(Math.abs(loaded.specimenOffset.x)).toBeLessThanOrEqual(limit.x);
        expect(Math.abs(loaded.specimenOffset.y)).toBeLessThanOrEqual(limit.y);
        expect(Math.abs(loaded.specimenOffset.z)).toBeLessThanOrEqual(limit.z);
        expect(loaded.surfaceReflectionScale).toBeCloseTo(0.7, 6);
        expect(loaded.visualGlowRadius).toBeCloseTo(0.25, 6);
        expect(loaded.trapCaptureRadius).toBeCloseTo(0.03, 6);
        expect(loaded.trapAxialCaptureRange).toBeCloseTo(0.012, 6);
    });

    test('round-trips thick aperture tube geometry', () => {
        const tube = new Aperture(6, 18, 'Tube Stop', 14);

        const scene = deserializeScene(serializeScene([tube]));
        expect(scene).toHaveLength(1);
        expect(scene[0]).toBeInstanceOf(Aperture);

        const loaded = scene[0] as Aperture;
        expect(loaded.openingDiameter).toBeCloseTo(6, 6);
        expect(loaded.housingDiameter).toBeCloseTo(18, 6);
        expect(loaded.thickness).toBeCloseTo(14, 6);
        expect(loaded.bounds.min.z).toBeCloseTo(-7, 6);
        expect(loaded.bounds.max.z).toBeCloseTo(7, 6);
    });

    test('round-trips colloid flow-cell sample variant and QPD backstop leakage', () => {
        const sample = new Sample('Colloid cell').configureColloidFlowCell({
            count: 10,
            radius: 0.0025,
            width: 4,
            height: 3,
            depth: 0.08,
            temperatureK: 310,
            viscosity: 0.0008,
            diffusionScale: 12,
        });
        const qpd = new QPD(20, 'QPD');
        qpd.backstopTransmission = 0.02;

        const scene = deserializeScene(serializeScene([sample, qpd]));
        expect(scene[0]).toBeInstanceOf(Sample);
        expect(scene[1]).toBeInstanceOf(QPD);

        const loadedSample = scene[0] as Sample;
        expect(loadedSample.specimenKind).toBe('colloids');
        expect(loadedSample.colloidSpheres).toHaveLength(10);
        expect(loadedSample.flowCellWidth).toBeCloseTo(4, 6);
        expect(loadedSample.flowCellDepth).toBeCloseTo(0.08, 6);
        expect(loadedSample.colloidTemperatureK).toBeCloseTo(310, 6);
        expect(loadedSample.colloidViscosity).toBeCloseTo(0.0008, 6);
        expect(loadedSample.colloidDiffusionScale).toBeCloseTo(12, 6);

        const loadedQpd = scene[1] as QPD;
        expect(loadedQpd.backstopTransmission).toBeCloseTo(0.02, 6);
    });

    test('persists a managed trapped bead as part of its flow-cell sample', () => {
        const sample = new Sample('Trap Flow Cell').configureColloidFlowCell({
            count: 12,
            width: 8,
            height: 8,
            depth: 0.0075,
        });
        const bead = new TrappedBead(0.005, 1.59, 1.33, 'Trapped Colloid');
        bead.parentSampleId = sample.id;
        bead.isSubComponent = true;
        bead.visualGlowRadius = 0.012;

        const scene = deserializeScene(serializeScene([sample, bead]));
        expect(scene).toHaveLength(2);
        expect(scene[0]).toBeInstanceOf(Sample);
        expect(scene[1]).toBeInstanceOf(TrappedBead);

        const loadedBead = scene[1] as TrappedBead;
        expect(loadedBead.parentSampleId).toBe(sample.id);
        expect(loadedBead.isSubComponent).toBe(true);
        expect(loadedBead.visualGlowRadius).toBeCloseTo(0.012, 6);
    });
});
