import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

function argValue(flag, fallback) {
    const index = process.argv.indexOf(flag);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(flag) {
    return process.argv.includes(flag);
}

function usage() {
    console.log(`Usage: bun scripts/catalog/inspect-edrawings-model.mjs [options]

Loads a public eDrawings/HOOPS HTML viewer and writes a JSON inspection dump.
This is diagnostic only; it does not modify catalog assets.

Options:
  --url URL       eDrawings HTML URL
  --out PATH      Output JSON path
  --chrome PATH   Chrome executable path
  --help          Show this help
`);
}

const DEFAULT_URL = 'https://media.thorlabs.com/globalassets/items/t/tl/tl1/tl10x-2p/ttn142896-e0w.html?v=0501060152';
const DEFAULT_OUT = 'C:/tmp/tl10x-2p-edrawings-inspection.json';
const DEFAULT_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function main() {
    if (hasFlag('--help')) {
        usage();
        return;
    }

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
                if (!jq || !jq.fn || jq.__edwInspectionHookInstalled) return;
                const originalTrigger = jq.fn.trigger;
                jq.fn.trigger = function (...args) {
                    const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
                    if (String(type).includes('ModelDataLoadComplete')) window.__edwViewer = args[1];
                    return originalTrigger.apply(this, args);
                };
                jq.__edwInspectionHookInstalled = true;
            }
            window.__edwInspectionHookInterval = window.setInterval(installHook, 10);
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

        const report = await page.evaluate(async ({ sourceUrl }) => {
            const round = value => Math.round(value * 1e8) / 1e8;
            const unique = values => [...new Set(values)].sort();
            const ownKeys = value => {
                try {
                    return Object.getOwnPropertyNames(value).sort();
                } catch {
                    return [];
                }
            };
            const methodNames = value => {
                const names = [];
                let current = value;
                let depth = 0;
                while (current && current !== Object.prototype && depth < 8) {
                    for (const key of Object.getOwnPropertyNames(current)) {
                        try {
                            if (typeof value[key] === 'function') names.push(key);
                        } catch {
                            // Some properties throw on access.
                        }
                    }
                    current = Object.getPrototypeOf(current);
                    depth++;
                }
                return unique(names);
            };
            const interestingMethods = names => names.filter(name =>
                /annot|appear|color|curve|edge|face|geom|line|mark|material|mesh|node|poly|prop|text|texture|transp|vis/i.test(name)
            );
            const describeValue = value => {
                if (value == null) return { type: String(value) };
                return {
                    type: typeof value,
                    constructor: value.constructor?.name ?? null,
                    ownKeys: ownKeys(value).slice(0, 80),
                    methods: methodNames(value).slice(0, 160),
                    interestingMethods: interestingMethods(methodNames(value)).slice(0, 160),
                };
            };
            const serializeColor = color => {
                const value = typeof color?.toJson === 'function' ? color.toJson() : color;
                return value ? {
                    r: Math.round(value.r ?? 0),
                    g: Math.round(value.g ?? 0),
                    b: Math.round(value.b ?? 0),
                } : null;
            };
            const serializeRGBA = color => {
                if (!color) return null;
                if (Array.isArray(color)) {
                    return {
                        r: Math.round(color[0] ?? 0),
                        g: Math.round(color[1] ?? 0),
                        b: Math.round(color[2] ?? 0),
                        a: Math.round(color[3] ?? 255),
                    };
                }
                const value = typeof color.toJson === 'function' ? color.toJson() : color;
                return {
                    r: Math.round(value.r ?? 0),
                    g: Math.round(value.g ?? 0),
                    b: Math.round(value.b ?? 0),
                    a: Math.round(value.a ?? value.alpha ?? 255),
                };
            };
            const rgbaKey = color => color ? `${color.r},${color.g},${color.b},${color.a}` : '<none>';
            const meshStreamStats = stream => {
                const stats = {
                    exists: Boolean(stream),
                    vertexCount: stream?.vertexCount ?? null,
                    elementCount: stream?.elementCount ?? null,
                    hasNormals: stream?.hasNormals ?? null,
                    hasRGBAs: stream?.hasRGBAs ?? null,
                    hasUVs: stream?.hasUVs ?? null,
                    rgbaHistogram: {},
                    rgbaSamples: [],
                };
                if (!stream || typeof stream.iterate !== 'function') return stats;
                try {
                    const iterator = stream.iterate(true);
                    for (;;) {
                        const next = iterator.next();
                        if (next.done) break;
                        const rgba = serializeRGBA(next.value?.RGBA);
                        const key = rgbaKey(rgba);
                        stats.rgbaHistogram[key] = (stats.rgbaHistogram[key] ?? 0) + 1;
                        if (rgba && stats.rgbaSamples.length < 12 && !stats.rgbaSamples.some(sample => rgbaKey(sample) === key)) {
                            stats.rgbaSamples.push(rgba);
                        }
                    }
                } catch (error) {
                    stats.error = error instanceof Error ? error.message : String(error);
                }
                stats.rgbaHistogram = Object.fromEntries(
                    Object.entries(stats.rgbaHistogram).sort((a, b) => b[1] - a[1]).slice(0, 24)
                );
                return stats;
            };
            const serializeBox = box => {
                if (!box || typeof box.toJson !== 'function') return null;
                const json = box.toJson();
                return {
                    min: { x: round(json.min.x), y: round(json.min.y), z: round(json.min.z) },
                    max: { x: round(json.max.x), y: round(json.max.y), z: round(json.max.z) },
                };
            };
            const safeCall = async (name, fn) => {
                try {
                    return { ok: true, value: await fn() };
                } catch (error) {
                    return { ok: false, error: error instanceof Error ? error.message : String(error) };
                }
            };
            const sampleIterator = iteratorOwner => {
                const result = {
                    owner: describeValue(iteratorOwner),
                    samples: [],
                };
                if (!iteratorOwner || typeof iteratorOwner.iterate !== 'function') return result;
                for (const triangulate of [false, true]) {
                    const entry = { triangulate, values: [] };
                    try {
                        const iterator = iteratorOwner.iterate(triangulate);
                        for (let index = 0; index < 5; index++) {
                            const next = iterator.next();
                            if (next.done) break;
                            const value = next.value;
                            entry.values.push({
                                description: describeValue(value),
                                ownKeys: ownKeys(value),
                                json: typeof value?.toJson === 'function' ? value.toJson() : null,
                                position: value?.position ?? null,
                                normal: value?.normal ?? null,
                                color: serializeColor(value?.color),
                                RGBA: serializeRGBA(value?.RGBA),
                            });
                        }
                    } catch (error) {
                        entry.error = error instanceof Error ? error.message : String(error);
                    }
                    result.samples.push(entry);
                }
                return result;
            };

            const viewer = window.__edwViewer;
            const hcViewer = viewer.HCViewer;
            const model = hcViewer.model;
            const root = model.getAbsoluteRootNode();
            const queue = [root];
            const seen = new Set();
            const nodes = [];
            while (queue.length && nodes.length < 10_000) {
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

            const typeHistogram = {};
            const nameHistogram = {};
            for (const node of nodes) {
                typeHistogram[node.type] = (typeHistogram[node.type] ?? 0) + 1;
                nameHistogram[node.name ?? '<null>'] = (nameHistogram[node.name ?? '<null>'] ?? 0) + 1;
            }

            const leafBodies = nodes.filter(node => node.type === 3 && node.childCount === 0);
            const bodySummaries = [];
            let firstMesh = null;
            let firstMeshNode = null;
            for (const node of leafBodies) {
                const summary = {
                    id: node.id,
                    name: node.name,
                    type: node.type,
                    faceColor: null,
                    lineColor: null,
                    opacity: null,
                    visibility: null,
                    bounding: null,
                    mesh: null,
                    apiResults: {},
                };
                summary.apiResults.effectiveFaceColor = await safeCall('getNodeEffectiveFaceColor', async () => serializeColor(await model.getNodeEffectiveFaceColor(node.id)));
                summary.faceColor = summary.apiResults.effectiveFaceColor.ok ? summary.apiResults.effectiveFaceColor.value : null;
                if (typeof model.getNodeEffectiveLineColor === 'function') {
                    summary.apiResults.effectiveLineColor = await safeCall('getNodeEffectiveLineColor', async () => serializeColor(await model.getNodeEffectiveLineColor(node.id)));
                    summary.lineColor = summary.apiResults.effectiveLineColor.ok ? summary.apiResults.effectiveLineColor.value : null;
                }
                if (typeof model.getNodesEffectiveOpacity === 'function') {
                    summary.apiResults.effectiveOpacity = await safeCall('getNodesEffectiveOpacity', async () => (await model.getNodesEffectiveOpacity([node.id]))[0]);
                    summary.opacity = summary.apiResults.effectiveOpacity.ok ? summary.apiResults.effectiveOpacity.value : null;
                }
                if (typeof model.getNodeVisibility === 'function') {
                    summary.apiResults.visibility = await safeCall('getNodeVisibility', async () => await model.getNodeVisibility(node.id));
                    summary.visibility = summary.apiResults.visibility.ok ? summary.apiResults.visibility.value : null;
                }
                if (typeof model.getNodesBounding === 'function') {
                    summary.apiResults.bounding = await safeCall('getNodesBounding', async () => serializeBox(await model.getNodesBounding([node.id])));
                    summary.bounding = summary.apiResults.bounding.ok ? summary.apiResults.bounding.value : null;
                }
                if (typeof model.getNodeProperties === 'function') {
                    summary.apiResults.properties = await safeCall('getNodeProperties', async () => await model.getNodeProperties(node.id));
                }
                if (typeof model.getNodeMeshData === 'function') {
                    summary.apiResults.meshData = await safeCall('getNodeMeshData', async () => {
                        const mesh = await model.getNodeMeshData(node.id);
                        if (!firstMesh && mesh) {
                            firstMesh = mesh;
                            firstMeshNode = node;
                        }
                        return {
                            description: describeValue(mesh),
                            ownKeys: ownKeys(mesh),
                            faces: mesh?.faces ? {
                                description: describeValue(mesh.faces),
                                vertexCount: mesh.faces.vertexCount ?? null,
                                faceCount: mesh.faces.faceCount ?? null,
                                stats: meshStreamStats(mesh.faces),
                            } : null,
                            lines: mesh?.lines ? meshStreamStats(mesh.lines) : null,
                            points: mesh?.points ? meshStreamStats(mesh.points) : null,
                        };
                    });
                    summary.mesh = summary.apiResults.meshData.ok ? summary.apiResults.meshData.value : null;
                }
                bodySummaries.push(summary);
            }

            const meshSamples = firstMesh ? {
                node: firstMeshNode,
                mesh: describeValue(firstMesh),
                faces: sampleIterator(firstMesh.faces),
                lines: sampleIterator(firstMesh.lines),
                points: sampleIterator(firstMesh.points),
            } : null;

            const globalKeys = Object.getOwnPropertyNames(window)
                .filter(key => /communicator|edw|hoops|hps|markup|text|cad|model/i.test(key))
                .sort();
            const communicator = window.Communicator ?? null;
            const edwViewerKeys = ownKeys(viewer);
            const edwViewerDescriptions = {};
            for (const key of edwViewerKeys) {
                try {
                    const value = viewer[key];
                    if (value && typeof value === 'object') edwViewerDescriptions[key] = describeValue(value);
                } catch {
                    // Ignore getters that fail.
                }
            }

            const managers = {};
            for (const [name, value] of Object.entries({
                hcViewer,
                model,
                view: hcViewer.view,
                selectionManager: hcViewer.selectionManager,
                markupManager: hcViewer.markupManager,
                operatorManager: hcViewer.operatorManager,
            })) {
                managers[name] = describeValue(value);
            }

            return {
                sourceUrl,
                inspectedAt: new Date().toISOString(),
                locationHref: window.location.href,
                title: document.title,
                bodyTextSnippets: document.body.innerText
                    .split(/\n+/)
                    .map(line => line.trim())
                    .filter(line => line.length > 0 && /THOR|TL10|WD|OPTICAL|GLASS|THICKNESS/i.test(line))
                    .slice(0, 80),
                globalKeys,
                communicator: describeValue(communicator),
                communicatorInterestingMethods: communicator ? interestingMethods(methodNames(communicator)).slice(0, 200) : [],
                viewer: describeValue(viewer),
                hcViewer: describeValue(hcViewer),
                managers,
                edwViewerKeys,
                edwViewerDescriptions,
                modelMethods: methodNames(model),
                modelInterestingMethods: interestingMethods(methodNames(model)),
                nodeCount: nodes.length,
                typeHistogram,
                nameHistogram,
                nodes: nodes.slice(0, 200),
                bodyCount: bodySummaries.length,
                bodySummaries,
                meshSamples,
            };
        }, { sourceUrl: url });

        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
        console.log(`Wrote eDrawing inspection report to ${outPath}`);
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
