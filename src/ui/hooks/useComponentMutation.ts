/**
 * useComponentMutation — eliminates the repetitive `components.map(c => { ... })` 
 * commit pattern used ~30 times in Inspector.tsx.
 *
 * Instead of:
 *   const newComponents = components.map(c => {
 *       if (c.id === selection[0] && c instanceof SomeType) {
 *           c.property = value;
 *           c.version++;
 *       }
 *       return c;
 *   });
 *   setComponents([...newComponents]);
 *
 * You write:
 *   mutate(c => { c.property = value; });
 */
import { useAtom } from 'jotai';
import { componentsAtom, selectionAtom, pushUndoAtom } from '../../state/store';
import { OpticalComponent } from '../../physics/Component';

/**
 * Returns a `mutate` function that applies a mutation to the currently selected
 * component, bumps its version, and triggers a React state update.
 *
 * @param withUndo  If true (default), pushes an undo snapshot before mutating.
 */
export function useComponentMutation(withUndo = true) {
    const [components, setComponents] = useAtom(componentsAtom);
    const [selection] = useAtom(selectionAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);

    /**
     * Mutate the currently selected component.
     * The mutator receives the component and should modify it in place.
     * Version is bumped automatically.
     */
    const mutate = (mutator: (c: OpticalComponent) => void) => {
        const id = selection[0];
        if (!id) return;

        if (withUndo) pushUndo();

        const newComponents = components.map(c => {
            if (c.id === id) {
                mutator(c);
                c.version++;
            }
            return c;
        });
        setComponents([...newComponents]);
    };

    /**
     * Mutate selected component only if it passes a type guard.
     * E.g.: mutateAs(Mirror, m => { m.diameter = 25; });
     */
    const mutateAs = <T extends OpticalComponent>(
        guard: new (...args: any[]) => T,
        mutator: (c: T) => void,
    ) => {
        const id = selection[0];
        if (!id) return;

        if (withUndo) pushUndo();

        const newComponents = components.map(c => {
            if (c.id === id && c instanceof guard) {
                mutator(c);
                c.version++;
            }
            return c;
        });
        setComponents([...newComponents]);
    };

    return { mutate, mutateAs, components, selection, selectedId: selection[0] };
}
