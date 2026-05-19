import { describe, expect, test } from 'bun:test';
import { SphericalLens } from '../../physics/components/SphericalLens';
import { AsphericLens } from '../../physics/components/AsphericLens';
import { AchromatDoublet } from '../../physics/components/AchromatDoublet';
import { CylindricalLens } from '../../physics/components/CylindricalLens';
import {
    decodePrescriptionBytes,
    importOpticFromText,
    normalizedParamsFromPrescription,
    parseOpticalPrescription,
    UnsupportedOpticImportError,
} from '../opticsImporter';

describe('optics prescription importer', () => {
    test('imports a Zemax sequential singlet as a spherical lens', () => {
        const zmx = `
UNIT MM
SURF 0
  CURV 0
  DISZ INFINITY
SURF 1
  TYPE STANDARD
  CURV 0.0194174757
  DISZ 3.6
  GLAS N-BK7
  DIAM 12.7
SURF 2
  TYPE STANDARD
  CURV 0
  DISZ 50
  DIAM 12.7
SURF 3
  CURV 0
`;
        const imported = importOpticFromText(zmx, 'LA1509-A.zmx');

        expect(imported.component).toBeInstanceOf(SphericalLens);
        const lens = imported.component as SphericalLens;
        expect(lens.name).toBe('LA1509-A');
        expect(lens.r1).toBeCloseTo(51.5, 3);
        expect(lens.r2).toBeCloseTo(1e9, 3);
        expect(lens.apertureRadius).toBeCloseTo(12.7, 6);
        expect(lens.thickness).toBeCloseTo(3.6, 6);
        expect(lens.ior).toBeCloseTo(1.5168, 4);
    });

    test('imports a Zemax toroidal singlet as a cylindrical lens', () => {
        const zmx = `
UNIT MM
SURF 0
  CURV 0
  DISZ INFINITY
SURF 1
  TYPE TOROIDAL
  CURV 3.869969040247679700E-002
  DISZ 4.01
  GLAS N-BK7
  DIAM 10
SURF 2
  TYPE TOROIDAL
  CURV 0
  DISZ 46.54466311091
  DIAM 10
`;
        const imported = importOpticFromText(zmx, 'LJ1821L1.zmx');

        expect(imported.component).toBeInstanceOf(CylindricalLens);
        expect(imported.normalized.kind).toBe('cylindricalLens');
        if (imported.normalized.kind !== 'cylindricalLens') return;
        expect(imported.normalized.r1Mm).toBeCloseTo(25.84, 2);
        expect(imported.normalized.r2Mm).toBeGreaterThan(1e8);
        expect(imported.normalized.thicknessMm).toBeCloseTo(4.01, 6);
        expect(imported.normalized.apertureRadiusMm).toBeCloseTo(10, 6);
        expect(imported.normalized.material).toBe('N-BK7');
    });

    test('imports exact even-asphere surface fields into an aspheric lens', () => {
        const zmx = `
UNIT MM
SURF 1
  TYPE EVENASPH
  CURV 0.2
  DISZ 2.5
  GLAS N-BK7
  DIAM 3
  CONI -1
  PARM 1 1.25E-5
  PARM 2 -2.5E-8
SURF 2
  TYPE STANDARD
  CURV 0
  DISZ 20
  DIAM 3
`;
        const imported = importOpticFromText(zmx, 'asphere.zmx');

        expect(imported.component).toBeInstanceOf(AsphericLens);
        const lens = imported.component as AsphericLens;
        expect(lens.r1).toBeCloseTo(5, 6);
        expect(lens.r2).toBeGreaterThan(1e8);
        expect(lens.k1).toBeCloseTo(-1, 6);
        expect(lens.A1[0]).toBeCloseTo(1.25e-5, 12);
        expect(lens.A1[1]).toBeCloseTo(-2.5e-8, 14);
        expect(imported.normalized.kind).toBe('asphericLens');
        if (imported.normalized.kind === 'asphericLens') {
            expect(imported.normalized.surfaceSource).toBe('exactPrescription');
        }
    });

    test('normalizes a three-surface prescription as an achromatic doublet', () => {
        const prescription = parseOpticalPrescription(JSON.stringify({
            name: 'exact doublet',
            surfaces: [
                { index: 1, radiusMm: 77.4, thicknessToNextMm: 4, glass: 'N-BK7', ior: 1.658, semiDiameterMm: 12.7 },
                { index: 2, radiusMm: -87.6, thicknessToNextMm: 2.5, glass: 'N-SF11', ior: 1.75, semiDiameterMm: 12.7 },
                { index: 3, radiusMm: 291.1, semiDiameterMm: 12.7 },
            ],
        }), 'doublet.json');

        const normalized = normalizedParamsFromPrescription(prescription);
        expect(normalized.kind).toBe('achromatDoublet');
        if (normalized.kind !== 'achromatDoublet') return;
        expect(normalized.r1Mm).toBeCloseTo(77.4, 6);
        expect(normalized.r2Mm).toBeCloseTo(-87.6, 6);
        expect(normalized.r3Mm).toBeCloseTo(291.1, 6);

        const imported = importOpticFromText(JSON.stringify(prescription), 'doublet.json');
        expect(imported.component).toBeInstanceOf(AchromatDoublet);
    });

    test('imports Thorlabs negative achromat ZMX glass names without falling back to BK7', () => {
        const zmx = `
UNIT MM
SURF 0
  CURV 0
  DISZ INFINITY
SURF 1
  TYPE STANDARD
  CURV -2.944640753828030000E-002
  DISZ 2
  GLAS N-BAF10 0 0 0 0 0 0 0 0 0 0
  DIAM 12.7
SURF 2
  TYPE STANDARD
  CURV 3.075976622577670000E-002
  DISZ 4.5
  GLAS N-SF6HT 0 0 0 0 0 0 0 0 0 0
  DIAM 12.7
SURF 3
  TYPE STANDARD
  CURV 5.284574327537899800E-003
  DISZ -52.88445773232
  DIAM 12.7
`;
        const imported = importOpticFromText(zmx, 'ACN254-050-A.zmx');

        expect(imported.component).toBeInstanceOf(AchromatDoublet);
        expect(imported.normalized.kind).toBe('achromatDoublet');
        if (imported.normalized.kind !== 'achromatDoublet') return;
        expect(imported.normalized.r1Mm).toBeCloseTo(-33.96, 3);
        expect(imported.normalized.r2Mm).toBeCloseTo(32.51, 3);
        expect(imported.normalized.r3Mm).toBeCloseTo(189.23, 3);
        expect(imported.normalized.glass1).toBe('N-BAF10');
        expect(imported.normalized.glass2).toBe('N-SF6HT');
        expect(imported.normalized.ior1).toBeCloseTo(1.67, 4);
        expect(imported.normalized.ior2).toBeCloseTo(1.8052, 4);
    });

    test('imports a CSV surface table as a spherical lens', () => {
        const csv = `Surface,Radius (mm),Thickness (mm),Glass,Diameter (mm),Conic
1,51.5,3.6,N-BK7,25.4,0
2,Infinity,50,,25.4,0
`;
        const imported = importOpticFromText(csv, 'surface-table.csv');

        expect(imported.component).toBeInstanceOf(SphericalLens);
        const lens = imported.component as SphericalLens;
        expect(lens.r1).toBeCloseTo(51.5, 6);
        expect(lens.r2).toBeGreaterThan(1e8);
        expect(lens.apertureRadius).toBeCloseTo(12.7, 6);
        expect(imported.prescription.format).toBe('csvSurfaceTable');
    });

    test('imports a Code V-style sequence as a spherical lens', () => {
        const sequence = `
TIT "Code V Singlet"
S 1
RDY 51.5
THI 3.6
GLA N-BK7
SDY 12.7
S 2
RDY Infinity
THI 50
SDY 12.7
`;
        const imported = importOpticFromText(sequence, 'codev.seq');

        expect(imported.component).toBeInstanceOf(SphericalLens);
        const lens = imported.component as SphericalLens;
        expect(lens.name).toBe('Code V Singlet');
        expect(lens.r1).toBeCloseTo(51.5, 6);
        expect(lens.r2).toBeGreaterThan(1e8);
        expect(imported.prescription.format).toBe('codeVSequence');
    });

    test('decodes UTF-16 text prescriptions before parsing', () => {
        const text = `Surface Radius Thickness Glass Diameter
1 51.5 3.6 N-BK7 25.4
2 Infinity 50 AIR 25.4
`;
        const bytes = new Uint8Array(2 + text.length * 2);
        bytes[0] = 0xff;
        bytes[1] = 0xfe;
        for (let i = 0; i < text.length; i++) {
            const code = text.charCodeAt(i);
            bytes[2 + i * 2] = code & 0xff;
            bytes[3 + i * 2] = code >> 8;
        }

        const decoded = decodePrescriptionBytes(bytes, 'utf16-table.txt');
        const imported = importOpticFromText(decoded, 'utf16-table.txt');
        expect(imported.component).toBeInstanceOf(SphericalLens);
        expect((imported.component as SphericalLens).r1).toBeCloseTo(51.5, 6);
    });

    test('rejects binary and mechanical files instead of guessing at geometry', () => {
        expect(() => decodePrescriptionBytes(new Uint8Array([1, 2, 3, 4]), 'lens.zos')).toThrow(UnsupportedOpticImportError);
        expect(() => decodePrescriptionBytes(new Uint8Array([1, 2, 3, 4]), 'https://media.thorlabs.com/lens.zar?v=1')).toThrow(UnsupportedOpticImportError);
        expect(() => parseOpticalPrescription('', 'housing.step')).toThrow(UnsupportedOpticImportError);
    });
});
