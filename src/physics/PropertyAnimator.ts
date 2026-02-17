import { OpticalComponent } from './Component';
import { Euler } from 'three';

/**
 * PropertyAnimator — generic animation system for optical components.
 *
 * Per PhysicsPlan §4: "Time Is a Scene Graph Mutation, Not Physics."
 * The solvers compute a frozen snapshot. Animation = mutating a property
 * at 60fps and re-evaluating the solvers.
 *
 * The animator lives OUTSIDE the physics layer. On each frame:
 *   1. Compute new property values from the clock.
 *   2. Mutate the scene graph (component.property = newValue).
 *   3. Return true so the caller can trigger solver re-evaluation.
 */

export type EasingType = 'linear' | 'sinusoidal' | 'discrete';

export interface AnimationChannel {
    id: string;
    targetId: string;           // component.id
    property: string;           // e.g. 'scanAngle', 'position.y', 'rotation.z'
    from: number;
    to: number;
    easing: EasingType;
    periodMs: number;           // ms per full cycle
    repeat: boolean;
    discreteSteps?: number;     // for filter wheels — snaps between N positions
    restoreValue?: number;      // if set, property snaps back to this value on channel removal
}

let _nextId = 1;

/** Generate a unique channel ID. */
export function generateChannelId(): string {
    return `anim_${_nextId++}`;
}

/**
 * Evaluate a single easing function at time t (milliseconds).
 * Returns a value in the [from, to] range.
 */
function evaluateEasing(
    ch: AnimationChannel,
    clockMs: number
): number {
    const { from, to, periodMs, easing, repeat, discreteSteps } = ch;
    const range = to - from;

    // Normalised progress within the current cycle [0, 1)
    let t: number;
    if (repeat) {
        t = (clockMs % periodMs) / periodMs;
    } else {
        t = Math.min(clockMs / periodMs, 1.0);
    }

    switch (easing) {
        case 'linear':
            return from + range * t;

        case 'sinusoidal':
            // Oscillates: midpoint ± half-range
            return (from + to) / 2 + (range / 2) * Math.sin(2 * Math.PI * t);

        case 'discrete': {
            const N = discreteSteps ?? 4;
            const step = Math.floor(t * N) % N;
            return from + step * (range / Math.max(N - 1, 1));
        }

        default:
            return from + range * t;
    }
}

/**
 * Resolve a dot-notation property path and set the value on a component.
 *
 * Supported patterns:
 *   - 'scanAngle'          → component.scanAngle = value
 *   - 'position.x'         → component.position.x = value; updateMatrices()
 *   - 'position.y'         → component.position.y = value; updateMatrices()
 *   - 'rotation.z'         → decompose quaternion, set euler Z, recompose
 *   - any scalar property  → (component as any)[property] = value
 */
export function setProperty(
    component: OpticalComponent,
    property: string,
    value: number
): void {
    if (property.startsWith('position.')) {
        const axis = property.split('.')[1] as 'x' | 'y' | 'z';
        component.position[axis] = value;
        component.updateMatrices();
    } else if (property.startsWith('rotation.')) {
        const axis = property.split('.')[1] as 'x' | 'y' | 'z';
        const euler = new Euler().setFromQuaternion(component.rotation);
        euler[axis] = value;
        component.rotation.setFromEuler(euler);
        component.updateMatrices();
    } else {
        // Direct scalar property (e.g. scanAngle, aperture, focalLength)
        (component as any)[property] = value;
        // Call recalculate if available (updates bounds, geometry, etc.)
        if (typeof (component as any).recalculate === 'function') {
            (component as any).recalculate();
        }
    }
    // Bump version so fingerprint detects the change
    component.version++;
}

/**
 * Read the current value of a property from a component.
 */
export function getProperty(component: OpticalComponent, property: string): number {
    if (property.startsWith('position.')) {
        const axis = property.split('.')[1] as 'x' | 'y' | 'z';
        return component.position[axis];
    } else if (property.startsWith('rotation.')) {
        const axis = property.split('.')[1] as 'x' | 'y' | 'z';
        const euler = new Euler().setFromQuaternion(component.rotation);
        return euler[axis];
    } else {
        return (component as any)[property] ?? 0;
    }
}

export class PropertyAnimator {
    channels: AnimationChannel[] = [];
    playing = false;
    clockMs = 0;

    /**
     * Advance the clock and mutate component properties.
     * @returns true if any property was mutated (caller should trigger solver re-eval)
     */
    tick(deltaMs: number, components: OpticalComponent[]): boolean {
        if (!this.playing || this.channels.length === 0) return false;

        this.clockMs += deltaMs;
        let mutated = false;

        // Build a lookup map for fast component resolution
        const byId = new Map<string, OpticalComponent>();
        for (const c of components) byId.set(c.id, c);

        for (const ch of this.channels) {
            const target = byId.get(ch.targetId);
            if (!target) continue;

            const newValue = evaluateEasing(ch, this.clockMs);
            const currentValue = getProperty(target, ch.property);

            // Only mutate if the value actually changed (avoids unnecessary version bumps)
            if (Math.abs(newValue - currentValue) > 1e-10) {
                setProperty(target, ch.property, newValue);
                mutated = true;
            }
        }

        return mutated;
    }

    /**
     * Evaluate all channels at a specific clock time and apply to components.
     * Does NOT modify this.clockMs — used by scan accumulation to "jump" to
     * discrete time points without disturbing the animation state.
     */
    evaluateAt(clockMs: number, components: OpticalComponent[]): void {
        if (this.channels.length === 0) return;

        const byId = new Map<string, OpticalComponent>();
        for (const c of components) byId.set(c.id, c);

        for (const ch of this.channels) {
            const target = byId.get(ch.targetId);
            if (!target) continue;

            const newValue = evaluateEasing(ch, clockMs);
            setProperty(target, ch.property, newValue);
        }
    }

    addChannel(channel: AnimationChannel): void {
        // Remove any existing channel on the same target+property
        this.channels = this.channels.filter(
            c => !(c.targetId === channel.targetId && c.property === channel.property)
        );
        this.channels.push(channel);
    }

    removeChannel(id: string, components?: OpticalComponent[]): void {
        const ch = this.channels.find(c => c.id === id);
        if (ch && ch.restoreValue !== undefined && components) {
            const byId = new Map<string, OpticalComponent>();
            for (const c of components) byId.set(c.id, c);
            const target = byId.get(ch.targetId);
            if (target) {
                setProperty(target, ch.property, ch.restoreValue);
            }
        }
        this.channels = this.channels.filter(c => c.id !== id);
    }

    clearAll(): void {
        this.channels = [];
    }

    reset(): void {
        this.clockMs = 0;
    }

    play(): void {
        this.playing = true;
    }

    pause(): void {
        this.playing = false;
    }

    toggle(): void {
        this.playing = !this.playing;
    }
}
