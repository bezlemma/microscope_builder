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

function positiveNumberArg(flag, fallback) {
    const value = Number.parseFloat(argValue(flag, String(fallback)));
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${flag} must be a positive number.`);
    }
    return value;
}

function meshSettingsFromArgs() {
    const linearDeflectionMm = positiveNumberArg('--linear-deflection-mm', 0.05);
    const angularDeflectionDeg = positiveNumberArg('--angular-deflection-deg', 10);
    return {
        linearDeflectionMm,
        angularDeflectionRad: angularDeflectionDeg * Math.PI / 180,
    };
}

function usage() {
    console.log(`Usage: bun scripts/catalog/build-objective-mechanical-assets.mjs [options]

Downloads catalog STEP files, converts them to WRL with FreeCADCmd, and writes
a static manifest used by component visualizers.

Options:
  --sku SKU           Limit to one or more SKUs. When set, any catalog component type is eligible.
  --component-type TYPE
                      Limit to a catalog component type. Defaults to objective when no SKU is set.
  --limit N           Convert at most N matching catalog parts
  --out-dir PATH      Output static mesh directory (default: public/catalog/mechanical/objectives)
  --cache-dir PATH    Download cache directory (default: .cache/mechanical-step-source)
  --manifest PATH     Generated TypeScript manifest path
  --freecad PATH      FreeCADCmd executable path
  --format FORMAT     Browser mesh format: wrl or stl (default: wrl)
  --linear-deflection-mm N
                      FreeCAD mesh linear deflection in mm (default: 0.05)
  --angular-deflection-deg N
                      FreeCAD mesh angular deflection in degrees (default: 10)
  --batch-size N      Number of STEP files to convert per FreeCAD process (default: 1)
  --checkpoint-every N
                      Rewrite the manifest after every N processed parts (default: 25)
  --quiet             Only print progress and failures
  --fail-fast         Stop on the first download or conversion failure
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
        'C:\\Program Files\\FreeCAD 1.1\\bin\\FreeCADCmd.exe',
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

function writeFreeCadScript(scriptPath, jobs, meshSettings) {
    const jobsJson = JSON.stringify(jobs.map(job => ({
        sku: job.part.sku,
        stepPath: job.sourcePath.replace(/\\/g, '/'),
        outPath: job.assetPath.replace(/\\/g, '/'),
    })));
    const linearDeflection = JSON.stringify(meshSettings.linearDeflectionMm);
    const angularDeflection = JSON.stringify(meshSettings.angularDeflectionRad);
    writeFileSync(scriptPath, `
import json
import os
import traceback
import FreeCAD
import Mesh
import MeshPart
import Import

jobs = json.loads(${JSON.stringify(jobsJson)})

def export_objects_as_mesh(objects, out_path):
    flattened = []
    for obj in objects:
        if isinstance(obj, (list, tuple)):
            flattened.extend(obj)
        else:
            flattened.append(obj)
    objects = flattened

    combined = Mesh.Mesh()
    descriptions = []
    for obj in objects:
        descriptions.append(str(getattr(obj, "TypeId", type(obj).__name__)))
        shape = getattr(obj, "Shape", None)
        if shape is None:
            continue
        try:
            if shape.isNull():
                continue
        except Exception:
            pass
        mesh = MeshPart.meshFromShape(
            Shape=shape,
            LinearDeflection=${linearDeflection},
            AngularDeflection=${angularDeflection},
            Relative=False,
        )
        combined.addMesh(mesh)
    if combined.CountFacets == 0:
        raise RuntimeError("None of the imported STEP objects contained meshable shape geometry: " + ", ".join(descriptions[:12]))
    combined.write(out_path)

for job in jobs:
    doc = None
    try:
        imported = Import.open(job["stepPath"])
        if isinstance(imported, list):
            objects = list(imported)
            doc = FreeCAD.ActiveDocument
        else:
            doc = imported
            if doc is None:
                doc = FreeCAD.ActiveDocument
            if doc is None:
                raise RuntimeError("FreeCAD did not create a document for the STEP file")
            objects = list(doc.Objects)
        if not objects:
            raise RuntimeError("No solids imported from STEP file")
        export_objects_as_mesh(objects, job["outPath"])
        print("FREECAD_OK\\t" + job["sku"])
    except Exception as exc:
        print("FREECAD_ERR\\t" + job["sku"] + "\\t" + str(exc).replace("\\n", " "))
        traceback.print_exc()
    finally:
        if doc is not None:
            try:
                FreeCAD.closeDocument(doc.Name)
            except Exception:
                pass
`);
}

function convertStepsToMeshes(freecadPath, jobs, scriptPath, meshSettings) {
    if (jobs.length === 0) return { converted: new Map(), errors: new Map() };
    writeFreeCadScript(scriptPath, jobs, meshSettings);
    const result = spawnSync(freecadPath, [scriptPath], {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 100,
    });
    const converted = new Map(jobs.map(job => [job.part.id, false]));
    const errors = new Map();
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    for (const line of output.split(/\r?\n|\r/)) {
        const parts = line.split('\t');
        if (parts[0] === 'FREECAD_OK' && parts[1]) {
            const job = jobs.find(candidate => candidate.part.sku === parts[1]);
            if (job) converted.set(job.part.id, true);
        } else if (parts[0] === 'FREECAD_ERR' && parts[1]) {
            const job = jobs.find(candidate => candidate.part.sku === parts[1]);
            if (job) errors.set(job.part.id, parts.slice(2).join('\t') || 'FreeCAD conversion failed');
        }
    }
    if (result.status !== 0) {
        throw new Error(`FreeCAD failed for ${jobs.length} STEP file(s):\n${output}`);
    }
    return { converted, errors };
}

function manifestSource(assets) {
    const rows = Object.fromEntries(assets.map(asset => [asset.partId, asset]));
    return `import type { CatalogMechanicalVisualAsset } from './mechanicalVisualAssets';

// Generated by scripts/catalog/build-objective-mechanical-assets.mjs.
// The app renders vendor mechanical assets listed here; STEP URLs in the
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

function readExistingAssets(manifestPath) {
    if (!existsSync(manifestPath)) return [];
    const text = readFileSync(manifestPath, 'utf8');
    const match = text.match(/=\s*(\{[\s\S]*\});?\s*$/);
    if (!match) return [];
    try {
        return Object.values(JSON.parse(match[1]));
    } catch {
        return [];
    }
}

function writeManifest(manifestPath, assetsByPartId) {
    const allAssets = [...assetsByPartId.values()].sort((a, b) => a.sku.localeCompare(b.sku));
    writeFileSync(manifestPath, manifestSource(allAssets));
    return allAssets.length;
}

function chunkArray(values, chunkSize) {
    const chunks = [];
    for (let index = 0; index < values.length; index += chunkSize) {
        chunks.push(values.slice(index, index + chunkSize));
    }
    return chunks;
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
    const requestedTypes = new Set(argValues('--component-type'));
    const limitValue = Number.parseInt(argValue('--limit', '0'), 10);
    const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : Number.POSITIVE_INFINITY;
    const batchSizeValue = Number.parseInt(argValue('--batch-size', '1'), 10);
    const batchSize = Number.isFinite(batchSizeValue) && batchSizeValue > 0 ? batchSizeValue : 1;
    const checkpointEveryValue = Number.parseInt(argValue('--checkpoint-every', '25'), 10);
    const checkpointEvery = Number.isFinite(checkpointEveryValue) && checkpointEveryValue > 0 ? checkpointEveryValue : Number.POSITIVE_INFINITY;
    const quiet = hasFlag('--quiet');
    const failFast = hasFlag('--fail-fast');
    const freecad = findFreeCad(argValue('--freecad', ''));
    const format = outputFormat();
    const meshSettings = meshSettingsFromArgs();

    if (!freecad) {
        throw new Error('FreeCADCmd was not found. Install FreeCAD or pass --freecad "C:\\\\Path\\\\To\\\\FreeCADCmd.exe".');
    }

    mkdirSync(outDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
    mkdirSync(dirname(manifestPath), { recursive: true });

    const parts = await loadCatalogParts();
    const catalogParts = parts
        .filter(part => requestedSkus.size > 0
            ? requestedSkus.has(part.sku.toUpperCase())
            : (requestedTypes.size > 0 ? requestedTypes.has(part.componentType) : part.componentType === 'objective'))
        .filter(part => findStepFile(part))
        .slice(0, limit);

    const generatedAt = new Date().toISOString();
    const existingAssets = readExistingAssets(manifestPath);
    const assetsByPartId = new Map(existingAssets.map(asset => [asset.partId, asset]));
    const conversionJobs = [];
    const failures = [];
    let processed = 0;

    for (const part of catalogParts) {
        const source = findStepFile(part);
        const sourcePath = sourceCachePath(cacheDir, part, source.url);
        const assetPath = outputAssetPath(outDir, part);
        if (!quiet) console.log(`${part.sku}: ${source.url}`);
        try {
            await downloadFile(source.url, sourcePath, force);
            if (force || !existsSync(assetPath)) {
                conversionJobs.push({ part, source, sourcePath, assetPath });
            } else {
                const existingAsset = assetsByPartId.get(part.id);
                assetsByPartId.set(part.id, {
                    partId: part.id,
                    sku: part.sku,
                    format,
                    url: publicUrlForAsset(outDir, assetPath),
                    sourceUrl: source.url,
                    units: 'mm',
                    generatedAt: existingAsset?.generatedAt ?? generatedAt,
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failures.push({ sku: part.sku, stage: 'download', message });
            console.warn(`${part.sku}: download failed: ${message}`);
            if (failFast) throw error;
        }
        processed++;
        if (processed % checkpointEvery === 0) {
            writeManifest(manifestPath, assetsByPartId);
        }
    }

    let convertedCount = 0;
    let completedJobs = 0;
    for (const [chunkIndex, jobs] of chunkArray(conversionJobs, batchSize).entries()) {
        if (!quiet) {
            console.log(`Converting ${completedJobs + 1}-${completedJobs + jobs.length} of ${conversionJobs.length}`);
        } else if (chunkIndex === 0 || completedJobs % Math.max(checkpointEvery, 1) === 0) {
            console.log(`Converting ${completedJobs}/${conversionJobs.length}`);
        }
        let converted;
        let conversionErrors;
        try {
            const scriptPath = join(cacheDir, `mechanical-convert-${Date.now()}-${chunkIndex}.freecad.py`);
            const result = convertStepsToMeshes(freecad, jobs, scriptPath, meshSettings);
            converted = result.converted;
            conversionErrors = result.errors;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            for (const job of jobs) failures.push({ sku: job.part.sku, stage: 'convert', message });
            console.warn(`FreeCAD batch failed: ${message}`);
            if (failFast) throw error;
            converted = new Map();
            conversionErrors = new Map();
        }

        for (const job of jobs) {
            const ok = converted.get(job.part.id) === true || existsSync(job.assetPath);
            if (!ok) {
                const message = conversionErrors.get(job.part.id) ?? 'No mesh file was produced';
                failures.push({ sku: job.part.sku, stage: 'convert', message });
                if (failFast) throw new Error(`${job.part.sku}: ${message}`);
                continue;
            }
            convertedCount++;
            assetsByPartId.set(job.part.id, {
                partId: job.part.id,
                sku: job.part.sku,
                format,
                url: publicUrlForAsset(outDir, job.assetPath),
                sourceUrl: job.source.url,
                units: 'mm',
                generatedAt,
            });
        }
        completedJobs += jobs.length;
        if (completedJobs % checkpointEvery === 0 || completedJobs === conversionJobs.length) {
            writeManifest(manifestPath, assetsByPartId);
        }
    }

    const totalAssets = writeManifest(manifestPath, assetsByPartId);
    const reusedCount = catalogParts.length - conversionJobs.length - failures.filter(failure => failure.stage === 'download').length;
    console.log(`Wrote/reused ${reusedCount + convertedCount}/${catalogParts.length} mechanical model(s), ${totalAssets} total manifest entry(s).`);
    if (failures.length > 0) {
        console.log(`Failed ${failures.length} catalog part(s):`);
        for (const failure of failures) {
            console.log(`- ${failure.sku} (${failure.stage}): ${failure.message}`);
        }
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
