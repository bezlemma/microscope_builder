import { describe, expect, test } from 'bun:test';
import {
    CONTEXT_MENU_Z_INDEX,
    MODAL_Z_INDEX,
    TABLE_ANNOTATION_Z_INDEX,
    TABLE_POPOVER_Z_INDEX,
} from '../zLayers';

describe('UI z-layer ordering', () => {
    test('modal selectors stay above table annotations, popovers, and context menus', () => {
        expect(MODAL_Z_INDEX).toBeGreaterThan(TABLE_ANNOTATION_Z_INDEX);
        expect(MODAL_Z_INDEX).toBeGreaterThan(TABLE_POPOVER_Z_INDEX);
        expect(MODAL_Z_INDEX).toBeGreaterThan(CONTEXT_MENU_Z_INDEX);
    });
});
