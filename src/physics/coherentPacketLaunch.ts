import { GaussianPacketQ, gaussianPacketQFromAxisStates } from './gaussianPacketState';

const MIN_PHYSICAL_PACKET_RADIUS_MM = 0.001;
const HEX_CELL_AREA_FACTOR = Math.sqrt(3) / 2;

export const BROAD_COHERENT_PACKET_SIGMA_RATIO = 0.7;

export function hexLatticeSpacingFromCellArea(sourceCellArea: number): number {
    const safeArea = Math.max(sourceCellArea, 1e-12);
    return Math.sqrt(safeArea / HEX_CELL_AREA_FACTOR);
}

export function coherentLaunchSigmaFromCellArea(sourceCellArea: number): number {
    return Math.max(
        BROAD_COHERENT_PACKET_SIGMA_RATIO * hexLatticeSpacingFromCellArea(sourceCellArea),
        MIN_PHYSICAL_PACKET_RADIUS_MM / 3,
    );
}

export function coherentLaunchSupportRadiusFromCellArea(sourceCellArea: number): number {
    return Math.max(3 * coherentLaunchSigmaFromCellArea(sourceCellArea), MIN_PHYSICAL_PACKET_RADIUS_MM);
}

export function collimatedPacketQFromSourceCellArea(
    wavelengthMeters: number,
    refractiveIndex: number,
    sourceCellArea: number,
): GaussianPacketQ {
    const sigma = coherentLaunchSigmaFromCellArea(sourceCellArea);
    return gaussianPacketQFromAxisStates(
        {
            sigma,
            curvatureRadius: Number.POSITIVE_INFINITY,
        },
        {
            sigma,
            curvatureRadius: Number.POSITIVE_INFINITY,
        },
        wavelengthMeters * 1e3,
        refractiveIndex,
    );
}
