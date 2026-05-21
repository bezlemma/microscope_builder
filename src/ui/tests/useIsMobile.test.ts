import { describe, expect, test } from 'bun:test';
import { mobileMediaQuery } from '../useIsMobile';

describe('mobile media query', () => {
    test('keeps touch phones in mobile layout after rotating wider than the breakpoint', () => {
        const query = mobileMediaQuery(768);

        expect(query).toContain('(pointer: coarse) and (hover: none)');
        expect(query).toContain('(orientation: landscape) and (max-width: 1024px) and (max-height: 600px)');
    });
});
