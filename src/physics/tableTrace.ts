import { Vector3 } from 'three';
import { OpticalComponent } from './Component';
import { TrappedBead } from './components/TrappedBead';
import { QPD } from './components/QPD';

type TrappedBeadTraceState = {
    bead: TrappedBead;
    specimenOffset: Vector3;
    forceAccumulator: Vector3;
    hitsThisFrame: number;
};

type QpdTraceState = {
    qpd: QPD;
    quadrants: [number, number, number, number];
    quadrantHits: [number, number, number, number];
    totalHits: number;
    gapPower: number;
    blockedPower: number;
    blockedHits: number;
    momentX: number;
    momentY: number;
    momentXX: number;
    momentYY: number;
};

function resetTrapBeadAccumulators(components: OpticalComponent[]): void {
    for (const component of components) {
        if (component instanceof TrappedBead) component.resetAccumulator();
    }
}

export function traceStableTableOverlay<T>(components: OpticalComponent[], trace: () => T): T {
    const beadStates: TrappedBeadTraceState[] = [];
    const qpdStates: QpdTraceState[] = [];
    for (const component of components) {
        if (component instanceof TrappedBead) {
            beadStates.push({
                bead: component,
                specimenOffset: component.specimenOffset.clone(),
                forceAccumulator: component.forceAccumulator.clone(),
                hitsThisFrame: component.hitsThisFrame,
            });
            component.specimenOffset.set(0, 0, 0);
        } else if (component instanceof QPD) {
            qpdStates.push({
                qpd: component,
                quadrants: component.quadrants.slice() as [number, number, number, number],
                quadrantHits: component.quadrantHits.slice() as [number, number, number, number],
                totalHits: component.totalHits,
                gapPower: component.gapPower,
                blockedPower: component.blockedPower,
                blockedHits: component.blockedHits,
                momentX: component.momentX,
                momentY: component.momentY,
                momentXX: component.momentXX,
                momentYY: component.momentYY,
            });
        }
    }

    resetTrapBeadAccumulators(components);
    try {
        return trace();
    } finally {
        for (const state of beadStates) {
            state.bead.specimenOffset.copy(state.specimenOffset);
            state.bead.forceAccumulator.copy(state.forceAccumulator);
            state.bead.hitsThisFrame = state.hitsThisFrame;
        }
        for (const state of qpdStates) {
            state.qpd.quadrants = state.quadrants.slice() as [number, number, number, number];
            state.qpd.quadrantHits = state.quadrantHits.slice() as [number, number, number, number];
            state.qpd.totalHits = state.totalHits;
            state.qpd.gapPower = state.gapPower;
            state.qpd.blockedPower = state.blockedPower;
            state.qpd.blockedHits = state.blockedHits;
            state.qpd.momentX = state.momentX;
            state.qpd.momentY = state.momentY;
            state.qpd.momentXX = state.momentXX;
            state.qpd.momentYY = state.momentYY;
        }
    }
}
