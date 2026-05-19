import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function argValue(flag, fallback) {
    const index = process.argv.indexOf(flag);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(flag) {
    return process.argv.includes(flag);
}

function usage() {
    console.log(`Usage: bun scripts/catalog/extract-edrawings-objective-asset.mjs [options]

Extracts body-separated mesh geometry and display colors from a public
eDrawings/HOOPS HTML viewer into a browser-loadable JSON visual asset.

Options:
  --sku SKU       SKU label stored in the output (default: TL10X-2P)
  --url URL       eDrawings HTML URL
  --out PATH      Output JSON path
  --chrome PATH   Chrome executable path
  --help          Show this help
`);
}

const DEFAULT_URL = 'https://media.thorlabs.com/globalassets/items/t/tl/tl1/tl10x-2p/ttn142896-e0w.html?v=0501060152';
const DEFAULT_OUT = resolve(ROOT, 'public', 'catalog', 'mechanical', 'objectives', 'tl10x-2p.edrawings.json');
const DEFAULT_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function rounded(value) {
    return Math.round(value * 1e8) / 1e8;
}

async function main() {
    if (hasFlag('--help')) {
        usage();
        return;
    }

    const sku = argValue('--sku', 'TL10X-2P');
    const url = argValue('--url', DEFAULT_URL);
    const outPath = resolve(argValue('--out', DEFAULT_OUT));
    const chrome = argValue('--chrome', DEFAULT_CHROME);

    const browser = await puppeteer.launch({
        executablePath: chrome,
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--ignore-certificate-errors',
        ],
    });

    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(90_000);
        await page.evaluateOnNewDocument(() => {
            window.__edwFindViewer = function () {
                if (window.__edwViewer?.HCViewer?.model) return window.__edwViewer;
                for (const key of Object.getOwnPropertyNames(window)) {
                    try {
                        const value = window[key];
                        if (value?.HCViewer?.model) return value;
                    } catch {
                        // Some globals throw on access.
                    }
                }
                return null;
            };
            function installHook() {
                const jq = window.jQuery || window.$;
                if (!jq || !jq.fn || jq.__edwAssetCaptureInstalled) return;
                const originalTrigger = jq.fn.trigger;
                jq.fn.trigger = function (...args) {
                    const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
                    if (String(type).includes('ModelDataLoadComplete')) window.__edwViewer = args[1];
                    return originalTrigger.apply(this, args);
                };
                jq.__edwAssetCaptureInstalled = true;
            }
            window.__edwHookInterval = window.setInterval(installHook, 10);
            installHook();
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await page.waitForFunction(() => {
            window.__edwViewer = window.__edwFindViewer?.() ?? window.__edwViewer;
            return Boolean(window.__edwViewer?.HCViewer?.model);
        }, {
            timeout: 90_000,
            polling: 250,
        });
        await new Promise(resolve => setTimeout(resolve, 6_000));

        const asset = await page.evaluate(({ sku, sourceUrl }) => {
            const round = value => Math.round(value * 1e8) / 1e8;
            const serializeColor = color => {
                const value = typeof color?.toJson === 'function' ? color.toJson() : color;
                return {
                    r: Math.round(value?.r ?? 0),
                    g: Math.round(value?.g ?? 0),
                    b: Math.round(value?.b ?? 0),
                };
            };
            const safeColor = async (fallback, read) => {
                try {
                    return serializeColor(await read());
                } catch {
                    return fallback;
                }
            };
            const safeOpacity = async (read) => {
                try {
                    const opacity = await read();
                    return Number.isFinite(opacity) ? opacity : 1;
                } catch {
                    return 1;
                }
            };
            const serializeBox = box => {
                if (!box || typeof box.toJson !== 'function') return null;
                const json = box.toJson();
                return {
                    min: { x: round(json.min.x), y: round(json.min.y), z: round(json.min.z) },
                    max: { x: round(json.max.x), y: round(json.max.y), z: round(json.max.z) },
                };
            };
            const extractVertexPositions = stream => {
                const positions = [];
                if (!stream || typeof stream.iterate !== 'function') return positions;
                const iterator = stream.iterate(true);
                for (;;) {
                    const next = iterator.next();
                    if (next.done) break;
                    const vertex = next.value;
                    if (!vertex?.position) continue;
                    positions.push(round(vertex.position[0]), round(vertex.position[1]), round(vertex.position[2]));
                }
                return positions;
            };
            const extractGeometry = mesh => {
                const positions = [];
                const normals = [];
                const iterator = mesh.faces.iterate(true);
                for (;;) {
                    const next = iterator.next();
                    if (next.done) break;
                    const vertex = next.value;
                    if (!vertex?.position) continue;
                    positions.push(round(vertex.position[0]), round(vertex.position[1]), round(vertex.position[2]));
                    if (vertex.normal) {
                        normals.push(round(vertex.normal[0]), round(vertex.normal[1]), round(vertex.normal[2]));
                    }
                }
                return {
                    positions,
                    normals: normals.length === positions.length ? normals : undefined,
                    lines: extractVertexPositions(mesh.lines),
                };
            };

            const viewer = window.__edwViewer;
            const model = viewer.HCViewer.model;
            const root = model.getAbsoluteRootNode();
            const queue = [root];
            const seen = new Set();
            const nodes = [];
            while (queue.length && nodes.length < 5_000) {
                const id = queue.shift();
                if (seen.has(id)) continue;
                seen.add(id);
                const children = model.getNodeChildren(id) || [];
                nodes.push({
                    id,
                    name: model.getNodeName(id),
                    type: model.getNodeType(id),
                    childCount: children.length,
                });
                for (const child of children) queue.push(child);
            }

            return Promise.all(nodes.filter(node => node.type === 3 && node.childCount === 0).map(async node => {
                try {
                    const opacity = await safeOpacity(async () => (await model.getNodesEffectiveOpacity([node.id]))[0]);
                    if (opacity <= 0) return null;
                    const mesh = await model.getNodeMeshData(node.id);
                    if (!mesh?.faces?.vertexCount) return null;
                    const color = await safeColor({ r: 230, g: 235, b: 235 }, async () => await model.getNodeEffectiveFaceColor(node.id));
                    const lineColor = typeof model.getNodeEffectiveLineColor === 'function'
                        ? await safeColor({ r: 0, g: 0, b: 0 }, async () => await model.getNodeEffectiveLineColor(node.id))
                        : { r: 0, g: 0, b: 0 };
                    const bounding = serializeBox(await model.getNodesBounding([node.id]));
                    const geometry = extractGeometry(mesh);
                    if (geometry.positions.length < 9) return null;
                    return {
                        id: node.id,
                        name: node.name,
                        color,
                        lineColor,
                        sourceOpacity: opacity,
                        bounding,
                        vertexCount: geometry.positions.length / 3,
                        positions: geometry.positions,
                        normals: geometry.normals,
                        lines: geometry.lines.length >= 6 ? geometry.lines : undefined,
                    };
                } catch {
                    return null;
                }
            })).then(bodies => ({
                schema: 'edrawings-hoops-body-mesh-v1',
                sku,
                sourceUrl,
                sourceUnits: 'm',
                generatedAt: new Date().toISOString(),
                bodies: bodies.filter(Boolean),
            }));
        }, { sku, sourceUrl: url });

        for (const body of asset.bodies) {
            body.positions = body.positions.map(rounded);
            if (body.normals) body.normals = body.normals.map(rounded);
            if (body.lines) body.lines = body.lines.map(rounded);
        }

        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, `${JSON.stringify(asset)}\n`);
        console.log(`Wrote ${asset.bodies.length} body mesh(es) to ${outPath}`);
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
