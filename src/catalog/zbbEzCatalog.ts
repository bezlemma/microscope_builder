export type ZbbEzOrientation = 'forward' | 'reverse';

export type ZbbEzPackageStatus = 'oracle-sampled' | 'analytic-surrogate';

export interface ZbbEzReferencePlane {
    label: string;
    zMm: number;
    radiusMm: number;
}

export interface ZbbEzSampleGridSummary {
    domain: 'field-pupil-wavelength';
    fieldSamples: number;
    pupilSamples: number;
    wavelengthSamples: number;
    note: string;
}

export interface ZbbEzAplanaticObjectiveTransfer {
    kind: 'aplanaticObjectiveSurrogate';
    focalLengthMm: number;
    magnification: number;
    numericalAperture: number;
    tubeLensFocalMm: number;
    workingDistanceMm: number;
    immersionIndex: number;
}

export type ZbbEzTransferModel = ZbbEzAplanaticObjectiveTransfer;

export interface ZbbEzDirectionModel {
    orientation: ZbbEzOrientation;
    wrapperFileName?: string;
    archiveUrl?: string;
    blackBoxFileName?: string;
    inputPlane: ZbbEzReferencePlane;
    outputPlane: ZbbEzReferencePlane;
    transfer: ZbbEzTransferModel;
    sampleGrid: ZbbEzSampleGridSummary;
}

export interface ZbbEzSnoutEnvelope {
    tipIndex: number;
    stopRadius: number;
    blackBoxRadius: number;
    blackBoxLength: number;
    imageSideStopOffset: number;
}

export interface ZbbEzPackage {
    format: 'ZBBez';
    version: 1;
    id: string;
    catalogPartId: string;
    title: string;
    status: ZbbEzPackageStatus;
    source: {
        kind: 'zemaxBlackBoxWrappers' | 'opticStudioArchives';
        note: string;
    };
    wavelengthsNm: number[];
    fieldPointsMm: number[];
    directions: Record<ZbbEzOrientation, ZbbEzDirectionModel>;
    snoutEnvelope?: ZbbEzSnoutEnvelope;
    limitations: string[];
}

const AMS_AGY_V1_TRANSFER: ZbbEzAplanaticObjectiveTransfer = {
    kind: 'aplanaticObjectiveSurrogate',
    focalLengthMm: 5,
    magnification: 40,
    numericalAperture: 1.0,
    tubeLensFocalMm: 200,
    workingDistanceMm: 0,
    immersionIndex: 1,
};

export const AMS_AGY_V1_ZBBEZ: ZbbEzPackage = {
    format: 'ZBBez',
    version: 1,
    id: 'zbbez:asi:54-10-5:ams-agy-v1',
    catalogPartId: 'asi:54-10-5',
    title: 'ASI AMS-AGY v1 objective ZBBez surrogate',
    status: 'analytic-surrogate',
    source: {
        kind: 'zemaxBlackBoxWrappers',
        note: 'Forward and reverse ZAR archives expose ZMX wrappers around encrypted ZBB cores. This package preserves both directions and uses the wrapper envelope plus a simulator-native aplanatic transfer until an OpticStudio ray-sampling pass replaces it.',
    },
    wavelengthsNm: [450, 486.1327, 532, 587.5618, 632.8, 656.2725, 700],
    fieldPointsMm: [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.075],
    directions: {
        forward: {
            orientation: 'forward',
            wrapperFileName: '54-10-5@450-700nm-tpf_BB.ZMX',
            archiveUrl: 'https://raw.githubusercontent.com/amsikking/AMS_AGY_v1_specifications/main/Zemax/AMS-AGY_v1_54-10-5_RevB_forward.zar',
            blackBoxFileName: 'SOCC.ZBB',
            inputPlane: { label: 'sample-side S-LAM2 tip / ground face', zMm: 0, radiusMm: 3.5245669128915624 },
            outputPlane: { label: 'image-side stop after black box', zMm: 26.872594113995482, radiusMm: 5.0 },
            transfer: AMS_AGY_V1_TRANSFER,
            sampleGrid: {
                domain: 'field-pupil-wavelength',
                fieldSamples: 8,
                pupilSamples: 0,
                wavelengthSamples: 7,
                note: 'Wrapper field/wavelength grid captured; pupil samples are pending OpticStudio ZBB oracle sampling.',
            },
        },
        reverse: {
            orientation: 'reverse',
            wrapperFileName: '54-10-5@450-700nm-tpf (Rev)_BB.ZMX',
            archiveUrl: 'https://raw.githubusercontent.com/amsikking/AMS_AGY_v1_specifications/main/Zemax/AMS-AGY_v1_54-10-5_RevB_reverse.zar',
            blackBoxFileName: 'Rev V.10.ZBB',
            inputPlane: { label: 'image-side stop before reverse black box', zMm: 26.872594113995482, radiusMm: 5.0 },
            outputPlane: { label: 'sample-side S-LAM2 tip / ground face', zMm: 0, radiusMm: 3.5245669128915624 },
            transfer: AMS_AGY_V1_TRANSFER,
            sampleGrid: {
                domain: 'field-pupil-wavelength',
                fieldSamples: 8,
                pupilSamples: 0,
                wavelengthSamples: 7,
                note: 'Reverse wrapper field/wavelength grid captured; pupil samples are pending OpticStudio ZBB oracle sampling.',
            },
        },
    },
    snoutEnvelope: {
        tipIndex: 1.743996848438,
        stopRadius: 5.0,
        blackBoxRadius: 5.93755627355001,
        blackBoxLength: 25.322594113995482,
        imageSideStopOffset: 1.55,
    },
    limitations: [
        'The internal encrypted ZBB surfaces are not decoded.',
        'Ray transfer currently uses the simulator aplanatic objective surrogate constrained by the exposed forward/reverse wrapper envelope.',
    ],
};

const TL10X_2P_TRANSFER: ZbbEzAplanaticObjectiveTransfer = {
    kind: 'aplanaticObjectiveSurrogate',
    focalLengthMm: 20,
    magnification: 10,
    numericalAperture: 0.5,
    tubeLensFocalMm: 200,
    workingDistanceMm: 7.77,
    immersionIndex: 1,
};

export const THORLABS_TL10X_2P_ZBBEZ: ZbbEzPackage = {
    format: 'ZBBez',
    version: 1,
    id: 'zbbez:thorlabs:tl10x-2p',
    catalogPartId: 'thorlabs:TL10X-2P',
    title: 'Thorlabs TL10X-2P objective ZBBez surrogate',
    status: 'analytic-surrogate',
    source: {
        kind: 'opticStudioArchives',
        note: 'The catalog exposes two OpticStudio archives for this objective. They are registered here as forward/reverse source archives so the same ZBBez path can be exercised before exact archive extraction and oracle sampling are added.',
    },
    wavelengthsNm: [400, 532, 700, 920, 1300],
    fieldPointsMm: [0],
    directions: {
        forward: {
            orientation: 'forward',
            archiveUrl: 'https://media.thorlabs.com/globalassets/items/t/tl/tl1/tl10x-2p/ttn142896-s02.zar?v=0501025432',
            inputPlane: { label: 'object-side focal plane', zMm: -20, radiusMm: 10 },
            outputPlane: { label: 'image-side pupil/principal plane', zMm: 0, radiusMm: 10 },
            transfer: TL10X_2P_TRANSFER,
            sampleGrid: {
                domain: 'field-pupil-wavelength',
                fieldSamples: 1,
                pupilSamples: 0,
                wavelengthSamples: 5,
                note: 'Catalog/specification surrogate; exact ZAR ray sampling is pending.',
            },
        },
        reverse: {
            orientation: 'reverse',
            archiveUrl: 'https://media.thorlabs.com/globalassets/items/t/tl/tl1/tl10x-2p/ttn142896-s04.zar?v=0501025432',
            inputPlane: { label: 'image-side pupil/principal plane', zMm: 0, radiusMm: 10 },
            outputPlane: { label: 'object-side focal plane', zMm: -20, radiusMm: 10 },
            transfer: TL10X_2P_TRANSFER,
            sampleGrid: {
                domain: 'field-pupil-wavelength',
                fieldSamples: 1,
                pupilSamples: 0,
                wavelengthSamples: 5,
                note: 'Catalog/specification surrogate; exact ZAR ray sampling is pending.',
            },
        },
    },
    limitations: [
        'The Thorlabs archives are registered as ZBBez sources but are not sampled by OpticStudio in this repository yet.',
        'Ray transfer currently uses the simulator aplanatic objective surrogate from catalog NA, magnification, working distance, and tube lens focal length.',
    ],
};

const BUILTIN_ZBBEZ_PACKAGES = new Map<string, ZbbEzPackage>([
    [AMS_AGY_V1_ZBBEZ.catalogPartId, AMS_AGY_V1_ZBBEZ],
    [THORLABS_TL10X_2P_ZBBEZ.catalogPartId, THORLABS_TL10X_2P_ZBBEZ],
]);

export function getBuiltinZbbEzPackage(catalogPartId: string | undefined | null): ZbbEzPackage | null {
    return catalogPartId ? BUILTIN_ZBBEZ_PACKAGES.get(catalogPartId) ?? null : null;
}

export function zbbEzDirectionForLocalRay(
    zbbEz: ZbbEzPackage,
    localDirectionZ: number,
): ZbbEzDirectionModel {
    return localDirectionZ < 0 ? zbbEz.directions.reverse : zbbEz.directions.forward;
}
