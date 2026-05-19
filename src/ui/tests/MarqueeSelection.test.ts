import { describe, expect, test } from 'bun:test';

import { Mirror } from '../../physics/components/Mirror';
import {
    componentIntersectsTableSelectionRect,
    selectedComponentIdsInTableRect,
    tableSelectionRectFromPoints,
} from '../marqueeSelection';

describe('table marquee selection helpers', () => {
    test('normalizes drag direction into a table rectangle', () => {
        expect(tableSelectionRectFromPoints({ x: 30, y: -10 }, { x: -5, y: 25 })).toEqual({
            minX: -5,
            maxX: 30,
            minY: -10,
            maxY: 25,
        });
    });

    test('selects components whose table bounds overlap the rectangle', () => {
        const inside = new Mirror(10, 4, 'Inside');
        inside.setPosition(10, 10, 0);

        const partiallyInside = new Mirror(20, 4, 'Partial');
        partiallyInside.setPosition(30, 10, 0);

        const outside = new Mirror(10, 4, 'Outside');
        outside.setPosition(70, 10, 0);

        const rect = tableSelectionRectFromPoints({ x: 0, y: 0 }, { x: 25, y: 25 });

        expect(componentIntersectsTableSelectionRect(inside, rect)).toBe(true);
        expect(componentIntersectsTableSelectionRect(partiallyInside, rect)).toBe(true);
        expect(componentIntersectsTableSelectionRect(outside, rect)).toBe(false);
        expect(selectedComponentIdsInTableRect([inside, partiallyInside, outside], rect)).toEqual([
            inside.id,
            partiallyInside.id,
        ]);
    });

    test('does not select ghost or managed sub-components', () => {
        const ghost = new Mirror(10, 4, 'Ghost');
        ghost.isGhost = true;
        ghost.setPosition(10, 10, 0);

        const subComponent = new Mirror(10, 4, 'Subcomponent');
        subComponent.isSubComponent = true;
        subComponent.setPosition(12, 12, 0);

        const rect = tableSelectionRectFromPoints({ x: 0, y: 0 }, { x: 25, y: 25 });
        expect(selectedComponentIdsInTableRect([ghost, subComponent], rect)).toEqual([]);
    });
});
