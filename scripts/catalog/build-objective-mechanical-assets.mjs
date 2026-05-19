import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_OUT_DIR = join(ROOT, 'public', 'catalog', 'mechanical', 'objectives');
const DEFAULT_MANIFEST = join(ROOT, 'src', 'catalog', 'generatedMechanicalVisualAssets.ts');
const DEFAULT_CACHE_DIR = join(ROOT, '.cache', 'mechanical-step-source');

function argValue(flag, fallback) {
    const index = process.argv.indexOf(flag);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function argValues(flag) {
    const values = [];
    for (let i = 2; i < process.argv.length; i++) {
        if (process.argv[i] === flag && process.argv[i + 1]) values.push(process.argv[++i]);
    }
    return values;
}

function hasFlag(flag) {
    return process.argv.includes(flag);
}

function usage() {
    console.log(`Usage: bun scripts/catalog/build-objective-mechanical-assets.mjs [options]

Downloads objective STEP files from the catalog, converts them to WRL with
FreeCADCmd, and writes a static manifest used by the objective visualizer.

Options:
  --sku SKU           Limit to one or more objective SKUs, e.g. --sku TL10X-2P
  --limit N           Convert at most N matching objective parts
  --out-dir PATH      Output static mesh directory (default: public/catalog/mechanical/objectives)
  --cache-dir PATH    Download cache directory (default: .cache/mechanical-step-source)
  --manifest PATH     Generated TypeScript manifest path
  --freecad PATH      FreeCADCmd executable path
  --format FORMAT     Browser mesh format: wrl or stl (default: wrl)
  --force             Re-download and re-convert existing assets
  --help              Show this help
`);
}

function sanitizeSku(sku) {
    return sku.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function sourceExtension(url) {
    const clean = url.split('?')[0].split('#')[0];
    const ext = extname(clean).toLowerCase().replace('.', '');
    return ext || 'step';
}

function sourceCachePath(cacheDir, part, url) {
    const hash = createHash('sha256').update(url).digest('hex').slice(0, 12);
    return join(cacheDir, `${sanitizeSku(part.sku)}-${hash}.${sourceExtension(url)}`);
}

function outputAssetPath(outDir, part) {
    const format = outputFormat();
    return join(outDir, `${sanitizeSku(part.sku)}.${format}`);
}

function outputFormat() {
    const format = argValue('--format', 'wrl').toLowerCase();
    if (format !== 'wrl' && format !== 'stl') {
        throw new Error(`Unsupported --format "${format}". Use "wrl" or "stl".`);
    }
    return format;
}

function publicUrlForAsset(outDir, assetPath) {
    const publicRoot = join(ROOT, 'public');
    const relative = resolve(assetPath).slice(resolve(publicRoot).length).replace(/\\/g, '/');
    if (!relative.startsWith('/')) {
        throw new Error(`Asset output must be inside public/: ${outDir}`);
    }
    return relative;
}

function findStepFile(part) {
    return part.files.find(file => file.role === 'mechanicalModel' && file.kind === 'step') ?? null;
}

function findFreeCad(explicitPath) {
    if (explicitPath) return explicitPath;
    const candidates = [
        'FreeCADCmd.exe',
        'FreeCADCmd',
        'freecadcmd',
        'freecad',
        'C:\\Program Files\\FreeCAD 1.0\\bin\\FreeCADCmd.exe',
        'C:\\Program Files\\FreeCAD 0.21\\bin\\FreeCADCmd.exe',
        'C:\\Program Files\\FreeCAD 0.20\\bin\\FreeCADCmd.exe',
    ];
    for (const candidate of candidates) {
        const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', windowsHide: true });
        if (!result.error) return candidate;
    }
    return null;
}

async function downloadFile(url, destination, force) {
    if (!force && existsSync(destination)) return;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Download failed ${response.status} ${response.statusText}: ${url}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    writeFileSync(destination, bytes);
}

function writeFreeCadScript(scriptPath, stepPath, outPath) {
    const pyString = value => JSON.stringify(value.replace(/\\/g, '/'));
    writeFileSync(scriptPath, `
import FreeCAD
import Mesh
import Import

step_path = ${pyString(stepPath)}
out_path = ${pyString(outPath)}

doc = Import.open(step_path)
if doc is None:
    doc = FreeCAD.ActiveDocument
if doc is None:
    raise RuntimeError("FreeCAD did not create a document for the STEP file")
objects = list(doc.Objects)
if not objects:
    raise RuntimeError("No solids imported from STEP file")
Mesh.export(objects, out_path)
FreeCAD.closeDocument(doc.Name)
`);
}

function convertStepToMesh(freecadPath, stepPath, outPath) {
    const scriptPath = `${outPath}.freecad.py`;
    writeFreeCadScript(scriptPath, stepPath, outPath);
    const result = spawnSync(freecadPath, [scriptPath], {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 10,
    });
    if (result.status !== 0) {
        throw new Error(`FreeCAD failed for ${basename(stepPath)}:\n${result.stdout}\n${result.stderr}`);
    }
}

function manifestSource(assets) {
    const rows = Object.fromEntries(assets.map(asset => [asset.partId, asset]));
    return `import type { CatalogMechanicalVisualAsset } from './mechanicalVisualAssets';

// Generated by scripts/catalog/build-objective-mechanical-assets.mjs.
// The app only renders vendor mechanical assets listed here; STEP URLs in the
// catalog remain source CAD and are converted offline into browser-loadable meshes.
export const GENERATED_MECHANICAL_VISUAL_ASSETS: Record<string, CatalogMechanicalVisualAsset> = ${JSON.stringify(rows, null, 4)};
`;
}

async function loadCatalogParts() {
    if (!process.versions.bun) {
        throw new Error('This script imports TypeScript catalog modules; run it with bun.');
    }
    const modulePath = new URL('../../src/catalog/catalog.ts', import.meta.url).href;
    const { CATALOG_PARTS } = await import(modulePath);
    return CATALOG_PARTS;
}

async function main() {
    if (hasFlag('--help')) {
        usage();
        return;
    }

    const outDir = resolve(argValue('--out-dir', DEFAULT_OUT_DIR));
    const cacheDir = resolve(argValue('--cache-dir', DEFAULT_CACHE_DIR));
    const manifestPath = resolve(argValue('--manifest', DEFAULT_MANIFEST));
    const force = hasFlag('--force');
    const requestedSkus = new Set(argValues('--sku').map(sku => sku.toUpperCase()));
    const limitValue = Number.parseInt(argValue('--limit', '0'), 10);
    const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : Number.POSITIVE_INFINITY;
    const freecad = findFreeCad(argValue('--freecad', ''));
    const format = outputFormat();

    if (!freecad) {
        throw new Error('FreeCADCmd was not found. Install FreeCAD or pass --freecad "C:\\\\Path\\\\To\\\\FreeCADCmd.exe".');
    }

    mkdirSync(outDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
    mkdirSync(dirname(manifestPath), { recursive: true });

    const parts = await loadCatalogParts();
    const objectiveParts = parts
        .filter(part => part.componentType === 'objective')
        .filter(part => requestedSkus.size === 0 || requestedSkus.has(part.sku.toUpperCase()))
        .filter(part => findStepFile(part))
        .slice(0, limit);

    const assets = [];
    const generatedAt = new Date().toISOString();

    for (const part of objectiveParts) {
        const source = findStepFile(part);
        const sourcePath = sourceCachePath(cacheDir, part, source.url);
        const assetPath = outputAssetPath(outDir, part);
        console.log(`${part.sku}: ${source.url}`);
        await downloadFile(source.url, sourcePath, force);
        if (force || !existsSync(assetPath)) {
            convertStepToMesh(freecad, sourcePath, assetPath);
        }
        assets.push({
            partId: part.id,
            sku: part.sku,
            format,
            url: publicUrlForAsset(outDir, assetPath),
            sourceUrl: source.url,
            units: 'mm',
            generatedAt,
        });
    }

    const existingAssets = [];
    if (!force && existsSync(manifestPath)) {
        const text = readFileSync(manifestPath, 'utf8');
        const match = text.match(/=\s*(\{[\s\S]*\});?\s*$/);
        if (match) {
            try {
                const parsed = JSON.parse(match[1]);
                for (const asset of Object.values(parsed)) {
                    if (!assets.some(next => next.partId === asset.partId)) existingAssets.push(asset);
                }
            } catch {
                // Ignore an old hand-written manifest and replace it below.
            }
        }
    }

    const allAssets = [...existingAssets, ...assets].sort((a, b) => a.sku.localeCompare(b.sku));
    writeFileSync(manifestPath, manifestSource(allAssets));
    console.log(`Wrote ${assets.length} converted objective model(s), ${allAssets.length} total manifest entry(s).`);
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
