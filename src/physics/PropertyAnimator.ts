import { OpticalComponent } from './Component';
import { Euler } from 'three';
import { Sample } from './components/Sample';

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
    property: string;           // e.g. 'panAngle', 'tiltAngle', 'scanX', 'position.y'
    from: number;
    to: number;
    easing: EasingType;
    periodMs: number;           // ms per full cycle
    repeat: boolean;
    discreteSteps?: number;     // for filter wheels — snaps between N positions
    restoreValue?: number;      // if set, property snaps back to this value on channel removal
}

let _nextId = 1;
type Axis = 'x' | 'y' | 'z';
type DynamicOpticalComponent = OpticalComponent & Record<string, unknown> & {
    recalculate?: unknown;
    invalidateMesh?: unknown;
};

/** Generate a unique channel ID. */
export function generateChannelId(): string {
    return `anim_${_nextId++}`;
}

function pathAxis(property: string): Axis {
    return property.split('.')[1] as Axis;
}

function dynamicComponent(component: OpticalComponent): DynamicOpticalComponent {
    return component as DynamicOpticalComponent;
}

function readDynamicNumber(component: OpticalComponent, property: string): number {
    const value = dynamicComponent(component)[property];
    return typeof value === 'number' ? value : 0;
}

function setDynamicNumber(component: OpticalComponent, property: string, value: number): void {
    dynamicComponent(component)[property] = value;
}

function refreshDerivedState(component: OpticalComponent): void {
    const target = dynamicComponent(component);
    if (typeof target.recalculate === 'function') target.recalculate();
    if (typeof target.invalidateMesh === 'function') target.invalidateMesh();
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
 * Resolve a property path and set the value on a component.
 *
 * Rotation support:
 *   - 'panAngle'  → sets component.panAngle, calls recomputeRotation()
 *   - 'tiltAngle' → sets component.tiltAngle, calls recomputeRotation()
 *   These are the preferred way to animate rotation — no Euler decomposition.
 *
 *   - 'rotation.x/y/z' → legacy Euler-based (retained for backward compat)
 */
export function setProperty(
    component: OpticalComponent,
    property: string,
    value: number
): void {
    if (property === 'panAngle') {
        component.panAngle = value;
        component.recomputeRotation();
        component.version++;
        return;
    }
    if (property === 'tiltAngle') {
        component.tiltAngle = value;
        component.recomputeRotation();
        component.version++;
        return;
    }
    if (property === 'rollAngle') {
        component.rollAngle = value;
        component.recomputeRotation();
        component.version++;
        return;
    }
    if (property.startsWith('position.')) {
        component.position[pathAxis(property)] = value;
        component.updateMatrices();
        component.version++;
        return;
    }
    if (property.startsWith('rotation.')) {
        const euler = new Euler().setFromQuaternion(component.rotation, 'ZYX');
        euler[pathAxis(property)] = value;
        component.rotation.setFromEuler(euler);
        component.updateMatrices();
        component.version++;
        return;
    }
    if (property.startsWith('specimenOffset.') && component instanceof Sample) {
        component.specimenOffset[pathAxis(property)] = value;
        component.version++;
        return;
    }
    if (property.startsWith('specimenRotation.') && component instanceof Sample) {
        component.specimenRotation[pathAxis(property)] = value;
        component.version++;
        return;
    }
    if (property === 'scanX' || property === 'scanY') {
        setDynamicNumber(component, property, value);
        component.version++;
        return;
    }

    setDynamicNumber(component, property, value);
    refreshDerivedState(component);
    component.version++;
}

/**
 * Read the current value of a property from a component.
 */
export function getProperty(component: OpticalComponent, property: string): number {
    if (property === 'panAngle') {
        return component.panAngle;
    }
    if (property === 'tiltAngle') {
        return component.tiltAngle;
    }
    if (property === 'rollAngle') {
        return component.rollAngle;
    }
    if (property.startsWith('position.')) {
        return component.position[pathAxis(property)];
    }
    if (property.startsWith('rotation.')) {
        const euler = new Euler().setFromQuaternion(component.rotation, 'ZYX');
        return euler[pathAxis(property)];
    }
    if (property.startsWith('specimenOffset.') && component instanceof Sample) {
        return component.specimenOffset[pathAxis(property)];
    }
    if (property.startsWith('specimenRotation.') && component instanceof Sample) {
        return component.specimenRotation[pathAxis(property)];
    }
    return readDynamicNumber(component, property);
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

    /**
     * Evaluate all channels using a linear range [0, 1] mapping to each channel's [from, to].
     * Ignores the channel's easing and cycle time. Used for a single clean sweep from A to B.
     */
    evaluateLinearRange(fraction: number, components: OpticalComponent[]): void {
        if (this.channels.length === 0) return;

        const byId = new Map<string, OpticalComponent>();
        for (const c of components) byId.set(c.id, c);

        for (const ch of this.channels) {
            const target = byId.get(ch.targetId);
            if (!target) continue;

            const newValue = ch.from + (ch.to - ch.from) * fraction;
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

    clearAll(components?: OpticalComponent[]): void {
        if (components) {
            this.restoreAll(components);
        }
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

    /**
     * Snap all channels to their restoreValue without removing them.
     * Used on global pause to return mirrors to rest position.
     */
    restoreAll(components: OpticalComponent[]): void {
        const byId = new Map<string, OpticalComponent>();
        for (const c of components) byId.set(c.id, c);
        for (const ch of this.channels) {
            if (ch.restoreValue !== undefined) {
                const target = byId.get(ch.targetId);
                if (target) {
                    setProperty(target, ch.property, ch.restoreValue);
                }
            }
        }
    }

    toggle(): void {
        this.playing = !this.playing;
    }
}
