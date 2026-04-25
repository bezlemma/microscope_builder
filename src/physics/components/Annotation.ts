import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';

export type AnnotationKind = 'text' | 'arrow' | 'curvedArrow';

/**
 * Annotation — non-physics overlay (text label, straight arrow, curved arrow).
 *
 * Never interacts with rays (intersect returns null).  Serves purely as a
 * user-authored visual marker on the optical table.
 *
 * Local axis convention:
 *   - For `arrow` / `curvedArrow`: the arrow points from local (-length/2, 0, 0)
 *     to local (+length/2, 0, 0), with the curvedArrow arching in +Y.
 *   - For `text`: renders at the origin in the local XY plane.
 */
export class Annotation extends OpticalComponent {
    kind: AnnotationKind;
    text: string;
    length: number;     // mm — tip-to-tail distance (arrows only)
    fontSize: number;   // CSS px — screen-space label size
    color: string;      // CSS color string

    constructor(
        kind: AnnotationKind,
        name: string,
        text: string = '',
        length: number = 60,
        fontSize: number = 12,
        color: string = '#007fff',
    ) {
        super(name);
        this.kind = kind;
        this.text = text;
        this.length = length;
        this.fontSize = fontSize;
        this.color = color;

        const half = length / 2;
        if (kind === 'text') {
            const pad = Math.max(fontSize * 2, 10);
            this.bounds.set(new Vector3(-pad, -pad, -0.5), new Vector3(pad, pad, 0.5));
        } else if (kind === 'curvedArrow') {
            this.bounds.set(new Vector3(-half, 0, -0.5), new Vector3(half, length * 0.5, 0.5));
        } else {
            this.bounds.set(new Vector3(-half, -2, -0.5), new Vector3(half, 2, 0.5));
        }
    }

    intersect(_rayLocal: Ray): HitRecord | null {
        return null;
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        return { rays: [] };
    }
}
