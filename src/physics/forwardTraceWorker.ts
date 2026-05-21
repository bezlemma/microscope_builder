import { deserializeScene } from '../state/ubzSerializer';
import { createSourceRays, stablePreviewSourceRays } from './SourceRayFactory';
import { ForwardTracer } from './ForwardTracer';
import { traceStableTableOverlay } from './tableTrace';
import { serializePath, type SerializedPath } from './raySerialization';
import { serializeBeamSegment, type SerializedBeamSegment } from './beamSerialization';

export interface ForwardTraceRequest {
    type: 'trace-forward';
    jobId: number;
    sceneText: string;
    forwardRayCount: number;
    sourceRayLimit: number;
    includeBeamSegments?: boolean;
    returnPaths?: boolean;
}

export interface ForwardTraceDone {
    type: 'forward-done';
    jobId: number;
    paths?: SerializedPath[];
    beamSegments?: SerializedBeamSegment[][];
    sourceRayCount: number;
}

export interface ForwardTraceError {
    type: 'forward-error';
    jobId: number;
    message: string;
}

export type ForwardTraceWorkerRequest = ForwardTraceRequest;
export type ForwardTraceWorkerResponse = ForwardTraceDone | ForwardTraceError;

type ForwardWorkerScope = typeof self & {
    postMessage(message: ForwardTraceWorkerResponse): void;
    onmessage: ((event: MessageEvent<ForwardTraceWorkerRequest>) => void) | null;
};

const workerScope = self as ForwardWorkerScope;

function post(msg: ForwardTraceWorkerResponse) {
    workerScope.postMessage(msg);
}

workerScope.onmessage = (event: MessageEvent<ForwardTraceWorkerRequest>) => {
    const msg = event.data;
    if (msg.type !== 'trace-forward') return;

    try {
        const components = deserializeScene(msg.sceneText);
        const result = traceStableTableOverlay(components, () => {
            const fullSourceRays = createSourceRays(components, msg.forwardRayCount, 'full');
            const sourceRays = msg.sourceRayLimit < msg.forwardRayCount
                ? stablePreviewSourceRays(fullSourceRays, msg.sourceRayLimit)
                : fullSourceRays;
            const solver = new ForwardTracer(components);
            const traceResult = msg.includeBeamSegments
                ? solver.traceWithBeamSegments(sourceRays)
                : { paths: solver.trace(sourceRays), beamSegments: undefined };
            return { ...traceResult, sourceRayCount: sourceRays.length };
        });
        post({
            type: 'forward-done',
            jobId: msg.jobId,
            paths: msg.returnPaths === false ? undefined : result.paths.map(serializePath),
            beamSegments: result.beamSegments?.map(branch => branch.map(serializeBeamSegment)),
            sourceRayCount: result.sourceRayCount,
        });
    } catch (error) {
        post({
            type: 'forward-error',
            jobId: msg.jobId,
            message: error instanceof Error ? error.message : String(error),
        });
    }
};
