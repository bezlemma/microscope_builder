// Load each preset in a real Chrome via puppeteer-core, wait for the R3F
// canvas to render, then grab the canvas region as a JPEG saved to
// public/presets/<name>.jpg. The splash gallery reads these files at runtime.
//
// Run while `npm run dev` is up in another terminal:
//   npm run capture-presets
// Or capture only specific presets:
//   npm run capture-presets -- brightfield confocal
//
// Requires preserveDrawingBuffer:true in App.tsx capture mode.

import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ORIGIN = 'http://localhost:5173/microscope/';
const OUT_DIR = join(process.cwd(), 'public', 'presets');

// (slug, filename) pairs — slug matches the URL hash route format.
// Filter via CLI args: `node ... -- optical-trap lens-zoo` only does those.
const ALL_PRESETS = [
    ['brightfield', 'brightfield'],
    ['epi-fluorescence', 'epi-fluorescence'],
    ['trans-fluorescence', 'trans-fluorescence'],
    ['openspim-lightsheet', 'openspim'],
    ['confocal-scanning', 'confocal'],
    ['beam-expander', 'beam-expander'],
    ['mz-interferometer', 'mz-interferometer'],
    ['optical-trap', 'optical-trap'],
    ['lens-zoo', 'lens-zoo'],
    ['polarization-zoo', 'polarization-zoo'],
    ['papers-yu-2026-nisam-2x', 'yu-2026'],
];
const filter = process.argv.slice(2);
const PRESETS = filter.length ? ALL_PRESETS.filter(p => filter.includes(p[1])) : ALL_PRESETS;

mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'],
    defaultViewport: { width: 1400, height: 900 },
});

try {
    for (const [slug, name] of PRESETS) {
        const page = await browser.newPage();
        // ?capture=1 puts App.tsx into capture mode: perspective 3/4 camera,
        // no table grid, no UI chrome — just the scene + ray paths.
        const url = `${ORIGIN}?capture=1#preset=${slug}`;
        console.log(`→ ${name} (${url})`);
        // domcontentloaded — some presets (Optical Trap, Confocal scan) run
        // continuous animation so the network never goes idle.
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Wait for canvas to be present and have non-default dimensions.
        await page.waitForSelector('canvas', { timeout: 10000 });
        // CaptureFramer waits ~2.2s for components, then positions the
        // perspective camera; give a bit more so rays trace and bloom settles.
        await new Promise(r => setTimeout(r, 4500));

        // Read canvas dimensions and bounding rect, then grab a PNG of just
        // the canvas via the DevTools clip option.
        const rect = await page.evaluate(() => {
            const c = document.querySelector('canvas');
            if (!c) return null;
            const r = c.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height, cw: c.width, ch: c.height };
        });
        if (!rect) {
            console.warn(`  ! no canvas for ${name}`);
            await page.close();
            continue;
        }
        console.log(`  canvas rect ${Math.round(rect.w)}x${Math.round(rect.h)} (backing ${rect.cw}x${rect.ch})`);

        // Force the canvas's drawing-buffer to be readable via toDataURL.
        // This works because capture mode enables preserveDrawingBuffer in App.tsx.
        const dataUrl = await page.evaluate(() => {
            const c = document.querySelector('canvas');
            try { return c.toDataURL('image/jpeg', 0.85); }
            catch (e) { return 'ERR: ' + e.message; }
        });
        if (!dataUrl?.startsWith('data:image/jpeg;base64,')) {
            console.warn(`  ! toDataURL failed: ${dataUrl?.slice(0, 80)}`);
            await page.close();
            continue;
        }
        const b64 = dataUrl.slice('data:image/jpeg;base64,'.length);
        const buf = Buffer.from(b64, 'base64');
        const path = join(OUT_DIR, `${name}.jpg`);
        writeFileSync(path, buf);
        console.log(`  wrote ${path} (${buf.length} bytes)`);

        await page.close();
    }
} finally {
    await browser.close();
}
console.log('done.');
