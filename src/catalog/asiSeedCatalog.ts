import type { CatalogPart } from './types';

const AMS_AGY_PRODUCT_URL = 'https://www.asiimaging.com/products/light-sheet-microscopy/ams-agy-objective/';
const AMS_AGY_STEP_URL = 'https://www.asiimaging.com/technical-drawings/models/54-10-5%20Rev%20B%20%28AMS-AGY%20v1%29%20%28CATALOG%20MODEL%29.zip';
const AMS_AGY_DRAWING_URL = 'https://www.asiimaging.com/technical-drawings/pdf/54-10-5%20Rev%20B%20%28AMS-AGY%20v1%29.PDF';
const AMS_AGY_DATASHEET_URL = 'https://www.asiimaging.com/downloads/datasheets/AMS-AGY_objective-Digital.pdf';
const AMS_AGY_ZEMAX_REPO_URL = 'https://github.com/amsikking/AMS_AGY_v1_specifications/tree/main/Zemax';
const AMS_AGY_ZEMAX_FORWARD_ZAR_URL = 'https://raw.githubusercontent.com/amsikking/AMS_AGY_v1_specifications/main/Zemax/AMS-AGY_v1_54-10-5_RevB_forward.zar';
const AMS_AGY_ZEMAX_REVERSE_ZAR_URL = 'https://raw.githubusercontent.com/amsikking/AMS_AGY_v1_specifications/main/Zemax/AMS-AGY_v1_54-10-5_RevB_reverse.zar';
const AMS_AGY_ZEMAX_LAYOUT_URL = 'https://raw.githubusercontent.com/amsikking/AMS_AGY_v1_specifications/main/Zemax/AMS-AGY_v1_54-10-5_RevB_forward_layout.PNG';

export const ASI_SEED_CATALOG: CatalogPart[] = [
    {
        id: 'asi:54-10-5',
        vendor: 'asi',
        sku: '54-10-5',
        title: 'AMS-AGY v1 Objective, NA 1.0, EFL 5 mm, 45 deg grind',
        productUrl: AMS_AGY_PRODUCT_URL,
        categoryPath: ['Light Sheet Microscopy', 'AMS-AGY Objectives'],
        componentType: 'objective',
        specs: {
            magnification: { value: 40, unit: 'X', source: 'vendorPage' },
            numericalAperture: { value: 1.0, source: 'vendorPage' },
            effectiveFocalLength: { value: 5, unit: 'mm', source: 'vendorPage' },
            workingDistance: { value: 0.0, unit: 'mm', source: 'vendorPage' },
            grindAngle: { value: 45, unit: 'deg', source: 'vendorPage' },
            chromaticCorrection: { value: '450-700 nm', source: 'vendorPage' },
            internalArCoatings: { value: '450-700 nm', source: 'vendorPage' },
            fieldDiffractionLimited: { value: 0.150, unit: 'mm diameter', source: 'vendorPage' },
            fieldBevelLimited: { value: 0.250, unit: 'mm diameter', source: 'vendorPage' },
            threading: { value: 'M25 x 0.75', source: 'pdf' },
            diameter: { value: 26.0, unit: 'mm', source: 'pdf' },
            zemaxModel: { value: 'Forward/reverse Zemax black-box wrappers; hidden core is stored in .ZBB files.', source: 'zemax' },
            zemaxEntrancePupilDiameter: { value: 10.0, unit: 'mm', source: 'zemax' },
            zemaxBlackBoxCoreLength: { value: 25.322594113995482, unit: 'mm', source: 'zemax' },
            zemaxBlackBoxSemiDiameter: { value: 5.93755627355001, unit: 'mm', source: 'zemax' },
            zemaxStopSemiDiameter: { value: 5.0, unit: 'mm', source: 'zemax' },
            tipGlass: { value: 'S-LAM2', source: 'zemax' },
        },
        normalized: {
            kind: 'objective',
            magnification: 40,
            numericalAperture: 1.0,
            workingDistanceMm: 0.0,
            tubeLensFocalMm: 200,
            immersionIndex: 1.0,
            immersionMediumKind: 'air',
            diameterMm: 26.0,
            fieldNumberMm: 0.25,
            zemaxEnvelope: {
                model: 'zemaxBlackBoxEnvelope',
                forwardFileName: '54-10-5@450-700nm-tpf_BB.ZMX',
                reverseFileName: '54-10-5@450-700nm-tpf (Rev)_BB.ZMX',
                entrancePupilDiameterMm: 10.0,
                wavelengthRangeNm: [450, 700],
                sampledWavelengthsNm: [450, 486.1327, 532, 587.5618, 632.8, 656.2725, 700],
                fieldPointsMm: [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.075],
                explicitSurfaceCount: 6,
                blackBoxSurfaces: [
                    {
                        orientation: 'forward',
                        surfaceIndex: 2,
                        fileName: 'SOCC.ZBB',
                        thicknessToNextMm: 25.322594113995482,
                        semiDiameterMm: 5.93755627355001,
                    },
                    {
                        orientation: 'reverse',
                        surfaceIndex: 3,
                        fileName: 'Rev V.10.ZBB',
                        thicknessToNextMm: 25.322594113995482,
                        semiDiameterMm: 5.93755627355001,
                    },
                ],
                notes: [
                    'Extracted ZMX wrappers expose the S-LAM2 tip, stop, apertures, fields, wavelengths, and black-box envelope.',
                    'The objective core is a Zemax BLACKBOX .ZBB model; internal optical surfaces are not recoverable from the public archive.',
                ],
            },
        },
        files: [
            {
                kind: 'step',
                role: 'mechanicalModel',
                url: AMS_AGY_STEP_URL,
                localPath: '.cache/asi-ams-agy/54-10-5-ams-agy-v1/54-10-5 Rev B (AMS-AGY v1) (CATALOG MODEL).STEP',
            },
            { kind: 'pdf', role: 'drawing', url: AMS_AGY_DRAWING_URL },
            { kind: 'pdf', role: 'datasheet', url: AMS_AGY_DATASHEET_URL },
            { kind: 'opticStudio', role: 'opticalPrescription', url: AMS_AGY_ZEMAX_FORWARD_ZAR_URL },
            { kind: 'opticStudio', role: 'opticalPrescription', url: AMS_AGY_ZEMAX_REVERSE_ZAR_URL },
            { kind: 'image', role: 'image', url: AMS_AGY_ZEMAX_LAYOUT_URL },
        ],
        provenance: [
            {
                source: 'vendorPage',
                url: AMS_AGY_PRODUCT_URL,
                note: 'Seeded from ASI AMS-AGY public product specifications and linked technical drawings/STEP model. Optical behavior uses the simulator ideal aplanatic objective model with catalog NA, magnification, working distance, and tube lens focal length.',
                retrievedAt: '2026-05-20',
            },
            {
                source: 'pdf',
                url: AMS_AGY_DRAWING_URL,
                note: 'Mechanical drawing supplies M25 x 0.75 thread, 26 mm mechanical diameter, and 45 deg ground snout outline for the v1 objective.',
                retrievedAt: '2026-05-20',
            },
            {
                source: 'zemax',
                url: AMS_AGY_ZEMAX_REPO_URL,
                note: 'Forward and reverse ZAR archives were extracted to ZMX wrappers. The wrappers expose the stop, wavelengths, field points, S-LAM2 tip surfaces, and .ZBB black-box envelope; they do not expose the objective core internal surface prescription.',
                retrievedAt: '2026-05-20',
            },
        ],
        confidence: 'exact',
        lastIndexed: '2026-05-20',
    },
];
