import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC_ROOT = resolve(ROOT, 'public');
const DEFAULT_MANIFEST = resolve(ROOT, 'src', 'catalog', 'generatedMechanicalVisualAssets.ts');
const DEFAULT_CACHE_DIR = resolve(ROOT, '.cache', 'mechanical-step-source');
const DEFAULT_WORK_DIR = resolve(ROOT, '.tmp', 'mechanical-mesh-compaction');

function argValue(flag, fallback) {
    const index = process.argv.indexOf(flag);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function argValues(flag) {
    const values = [];
    for (let index = 2; index < process.argv.length; index++) {
        if (process.argv[index] === flag && process.argv[index + 1]) values.push(process.argv[++index]);
    }
    return values;
}

function hasFlag(flag) {
    return process.argv.includes(flag);
}

function numberArg(flag, fallback) {
    const value = Number.parseFloat(argValue(flag, String(fallback)));
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${flag} must be a positive number.`);
    return value;
}

function intArg(flag, fallback) {
    const value = Number.parseInt(argValue(flag, String(fallback)), 10);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${flag} must be a positive integer.`);
    return value;
}

function usage() {
    console.log(`Usage: bun scripts/catalog/compact-mechanical-visual-assets.mjs [options]

Regenerates non-objective catalog WRL meshes from cached STEP files with a
coarser FreeCAD mesh tolerance. A candidate replaces the current mesh only when
the requested linear deflection is within the geometry-loss budget and the
candidate bounding box still matches the current mesh within that same budget.

Options:
  --apply                 Replace accepted meshes. Omit for dry run.
  --sku SKU               Limit to one or more SKUs.
  --component-type TYPE   Limit to one or more component types.
  --limit N               Process at most N matching assets.
  --batch-size N          FreeCAD conversion batch size (default: 12)
  --loss-ratio N          Max linear deflection and bbox drift ratio (default: 0.01)
  --min-deflection-mm N   Minimum linear deflection used when compacting (default: 0.08)
  --max-deflection-mm N   Maximum linear deflection used when compacting (default: 0.75)
  --angular-deflection-deg N
                          FreeCAD angular deflection (default: 20)
  --manifest PATH         Generated mechanical asset manifest
  --cache-dir PATH        Cached STEP source directory
  --work-dir PATH         Temporary candidate mesh directory
  --freecad PATH          FreeCADCmd executable path
  --keep-work-dir         Leave candidate files in --work-dir
  --help                  Show this help
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

function parseManifest(manifestPath) {
    const text = readFileSync(manifestPath, 'utf8');
    const match = text.match(/=\s*(\{[\s\S]*\});?\s*$/);
    if (!match) throw new Error(`Could not parse manifest: ${manifestPath}`);
    return Object.values(JSON.parse(match[1]));
}

function assertInside(path, root, label) {
    const resolvedPath = resolve(path);
    const resolvedRoot = resolve(root);
    if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}\\`) && !resolvedPath.startsWith(`${resolvedRoot}/`)) {
        throw new Error(`Refusing to touch ${label} outside ${resolvedRoot}: ${resolvedPath}`);
    }
    return resolvedPath;
}

function assetPath(asset) {
    if (!asset.url.startsWith('/')) throw new Error(`Mechanical asset URL must be root-relative: ${asset.url}`);
    return assertInside(resolve(PUBLIC_ROOT, `.${asset.url}`), PUBLIC_ROOT, 'asset');
}

function parseWrlStats(path) {
    const text = readFileSync(path, 'utf8');
    const pointBlocks = [...text.matchAll(/\bpoint\s*\[([\s\S]*?)\]/g)];
    const points = [];
    for (const block of pointBlocks) {
        const values = block[1].match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
        for (let index = 0; index + 2 < values.length; index += 3) {
            const x = Number(values[index]);
            const y = Number(values[index + 1]);
            const z = Number(values[index + 2]);
            if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) points.push([x, y, z]);
        }
    }
    if (points.length === 0) throw new Error(`No WRL coordinate points found in ${path}`);

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const point of points) {
        for (let axis = 0; axis < 3; axis++) {
            if (point[axis] < min[axis]) min[axis] = point[axis];
            if (point[axis] > max[axis]) max[axis] = point[axis];
        }
    }
    const dims = max.map((value, axis) => value - min[axis]);
    const characteristicMm = Math.max(...dims);
    if (!Number.isFinite(characteristicMm) || characteristicMm <= 0) {
        throw new Error(`Invalid WRL bounds in ${path}`);
    }
    const faceCount = [...text.matchAll(/\bcoordIndex\s*\[([\s\S]*?)\]/g)]
        .reduce((sum, block) => sum + (block[1].match(/-1/g)?.length ?? 0), 0);
    return {
        pointCount: points.length,
        faceCount,
        bounds: { min, max, dims },
        characteristicMm,
        bytes: statSync(path).size,
    };
}

function bboxDriftRatio(reference, candidate) {
    const characteristic = reference.characteristicMm;
    let maxDrift = 0;
    for (let axis = 0; axis < 3; axis++) {
        maxDrift = Math.max(
            maxDrift,
            Math.abs(reference.bounds.min[axis] - candidate.bounds.min[axis]),
            Math.abs(reference.bounds.max[axis] - candidate.bounds.max[axis]),
        );
    }
    return maxDrift / characteristic;
}

function targetDeflectionMm(stats, options) {
    const raw = stats.characteristicMm * options.lossRatio;
    return Math.max(options.minDeflectionMm, Math.min(options.maxDeflectionMm, raw));
}

async function loadCatalogParts() {
    if (!process.versions.bun) throw new Error('This script imports TypeScript catalog modules; run it with bun.');
    const modulePath = new URL('../../src/catalog/catalog.ts', import.meta.url).href;
    const { CATALOG_PARTS } = await import(modulePath);
    return CATALOG_PARTS;
}

function writeFreeCadScript(scriptPath, jobs, angularDeflectionRad) {
    const jobsJson = JSON.stringify(jobs.map(job => ({
        sku: job.part.sku,
        sourcePath: job.sourcePath.replace(/\\/g, '/'),
        candidatePath: job.candidatePath.replace(/\\/g, '/'),
        linearDeflectionMm: job.linearDeflectionMm,
    })));
    writeFileSync(scriptPath, `
import json
import os
import traceback
import FreeCAD
import Mesh
import MeshPart
import Import

jobs = json.loads(${JSON.stringify(jobsJson)})
angular_deflection = ${JSON.stringify(angularDeflectionRad)}

def flatten_objects(objects):
    flattened = []
    for obj in objects:
        if isinstance(obj, (list, tuple)):
            flattened.extend(obj)
        else:
            flattened.append(obj)
    return flattened

def export_objects_as_mesh(objects, out_path, linear_deflection):
    combined = Mesh.Mesh()
    descriptions = []
    for obj in flatten_objects(objects):
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
            LinearDeflection=linear_deflection,
            AngularDeflection=angular_deflection,
            Relative=False,
        )
        combined.addMesh(mesh)
    if combined.CountFacets == 0:
        raise RuntimeError("No meshable shape geometry: " + ", ".join(descriptions[:12]))
    combined.write(out_path)

for job in jobs:
    doc = None
    try:
        imported = Import.open(job["sourcePath"])
        if isinstance(imported, list):
            objects = list(imported)
            doc = FreeCAD.ActiveDocument
        else:
            doc = imported
            if doc is None:
                doc = FreeCAD.ActiveDocument
            if doc is None:
                raise RuntimeError("FreeCAD did not create a document")
            objects = list(doc.Objects)
        if not objects:
            raise RuntimeError("No solids imported from STEP file")
        export_objects_as_mesh(objects, job["candidatePath"], job["linearDeflectionMm"])
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

function convertBatch(freecad, jobs, workDir, batchIndex, angularDeflectionRad) {
    const scriptPath = join(workDir, `compact-batch-${batchIndex}.freecad.py`);
    writeFreeCadScript(scriptPath, jobs, angularDeflectionRad);
    const result = spawnSync(freecad, [scriptPath], {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 100,
    });
    const converted = new Set();
    const errors = new Map();
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    writeFileSync(join(workDir, `compact-batch-${batchIndex}.log`), output);
    for (const line of output.split(/\r?\n|\r/)) {
        const parts = line.split('\t');
        if (parts[0] === 'FREECAD_OK' && parts[1]) converted.add(parts[1]);
        if (parts[0] === 'FREECAD_ERR' && parts[1]) errors.set(parts[1], parts.slice(2).join('\t') || 'FreeCAD conversion failed');
    }
    if (result.status !== 0) {
        for (const job of jobs) {
            if (!converted.has(job.part.sku) && !errors.has(job.part.sku)) {
                errors.set(job.part.sku, 'FreeCAD process failed');
            }
        }
    }
    return { converted, errors, output };
}

function formatMb(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
    if (hasFlag('--help')) {
        usage();
        return;
    }

    const apply = hasFlag('--apply');
    const manifestPath = resolve(argValue('--manifest', DEFAULT_MANIFEST));
    const cacheDir = resolve(argValue('--cache-dir', DEFAULT_CACHE_DIR));
    const workDir = assertInside(resolve(argValue('--work-dir', DEFAULT_WORK_DIR)), resolve(ROOT, '.tmp'), 'work dir');
    const freecad = findFreeCad(argValue('--freecad', ''));
    const batchSize = intArg('--batch-size', 12);
    const limitValue = Number.parseInt(argValue('--limit', '0'), 10);
    const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : Number.POSITIVE_INFINITY;
    const requestedSkus = new Set(argValues('--sku').map(sku => sku.toUpperCase()));
    const requestedTypes = new Set(argValues('--component-type'));
    const options = {
        lossRatio: numberArg('--loss-ratio', 0.01),
        minDeflectionMm: numberArg('--min-deflection-mm', 0.08),
        maxDeflectionMm: numberArg('--max-deflection-mm', 0.75),
        angularDeflectionRad: numberArg('--angular-deflection-deg', 20) * Math.PI / 180,
    };

    if (!freecad) throw new Error('FreeCADCmd was not found. Install FreeCAD or pass --freecad "C:\\\\Path\\\\To\\\\FreeCADCmd.exe".');
    mkdirSync(workDir, { recursive: true });

    const assets = parseManifest(manifestPath);
    const parts = await loadCatalogParts();
    const partsById = new Map(parts.map(part => [part.id, part]));
    const jobs = [];
    const skipped = [];

    for (const asset of assets) {
        const part = partsById.get(asset.partId);
        if (!part) {
            skipped.push({ sku: asset.sku, reason: 'catalog part missing' });
            continue;
        }
        if (asset.format !== 'wrl') continue;
        if (part.componentType === 'objective') continue;
        if (requestedSkus.size > 0 && !requestedSkus.has(part.sku.toUpperCase())) continue;
        if (requestedTypes.size > 0 && !requestedTypes.has(part.componentType)) continue;

        const source = findStepFile(part);
        if (!source) {
            skipped.push({ sku: part.sku, reason: 'no STEP source' });
            continue;
        }
        const sourcePath = sourceCachePath(cacheDir, part, source.url);
        if (!existsSync(sourcePath)) {
            skipped.push({ sku: part.sku, reason: 'STEP source not cached' });
            continue;
        }
        const currentPath = assetPath(asset);
        if (!existsSync(currentPath)) {
            skipped.push({ sku: part.sku, reason: 'current WRL missing' });
            continue;
        }

        const currentStats = parseWrlStats(currentPath);
        const linearDeflectionMm = targetDeflectionMm(currentStats, options);
        if ((linearDeflectionMm / currentStats.characteristicMm) > options.lossRatio + 1e-9) {
            skipped.push({ sku: part.sku, reason: 'part too small for requested minimum deflection' });
            continue;
        }

        jobs.push({
            asset,
            part,
            sourcePath,
            currentPath,
            currentStats,
            linearDeflectionMm,
            candidatePath: join(workDir, `${sanitizeSku(part.sku)}.candidate.wrl`),
        });
        if (jobs.length >= limit) break;
    }

    let accepted = 0;
    let rejected = 0;
    let failed = 0;
    let originalBytes = 0;
    let candidateBytes = 0;
    let replacedBytes = 0;
    const failures = [];
    const rejections = [];

    console.log(`${apply ? 'Compacting' : 'Dry run compacting'} ${jobs.length} non-objective WRL asset(s).`);
    console.log(`Loss budget: ${(options.lossRatio * 100).toFixed(2)}%, deflection ${options.minDeflectionMm}-${options.maxDeflectionMm} mm, angular ${(options.angularDeflectionRad * 180 / Math.PI).toFixed(1)} deg.`);

    for (let offset = 0, batchIndex = 0; offset < jobs.length; offset += batchSize, batchIndex++) {
        const batch = jobs.slice(offset, offset + batchSize);
        console.log(`Converting ${offset + 1}-${offset + batch.length} of ${jobs.length}`);
        const result = convertBatch(freecad, batch, workDir, batchIndex, options.angularDeflectionRad);

        for (const job of batch) {
            if (!result.converted.has(job.part.sku) || !existsSync(job.candidatePath)) {
                failed++;
                failures.push(`${job.part.sku}: ${result.errors.get(job.part.sku) ?? 'no candidate mesh produced'}`);
                continue;
            }

            let candidateStats;
            try {
                candidateStats = parseWrlStats(job.candidatePath);
            } catch (error) {
                failed++;
                failures.push(`${job.part.sku}: ${error instanceof Error ? error.message : String(error)}`);
                continue;
            }

            const drift = bboxDriftRatio(job.currentStats, candidateStats);
            const smaller = candidateStats.bytes < job.currentStats.bytes;
            const withinBudget = drift <= options.lossRatio + 1e-9;
            if (!withinBudget || !smaller) {
                rejected++;
                rejections.push(`${job.part.sku}: ${formatMb(job.currentStats.bytes)} -> ${formatMb(candidateStats.bytes)}, bbox drift ${(drift * 100).toFixed(3)}%`);
                continue;
            }

            accepted++;
            originalBytes += job.currentStats.bytes;
            candidateBytes += candidateStats.bytes;
            replacedBytes += job.currentStats.bytes - candidateStats.bytes;

            if (apply) {
                copyFileSync(job.candidatePath, job.currentPath);
            }
        }
    }

    const report = {
        applied: apply,
        processed: jobs.length,
        accepted,
        rejected,
        failed,
        skipped: skipped.length,
        originalBytes,
        candidateBytes,
        savedBytes: replacedBytes,
        options: {
            lossRatio: options.lossRatio,
            minDeflectionMm: options.minDeflectionMm,
            maxDeflectionMm: options.maxDeflectionMm,
            angularDeflectionDeg: options.angularDeflectionRad * 180 / Math.PI,
        },
        failures: failures.slice(0, 50),
        rejections: rejections.slice(0, 50),
        generatedAt: new Date().toISOString(),
    };
    writeFileSync(join(workDir, 'compaction-report.json'), `${JSON.stringify(report, null, 2)}\n`);

    console.log(`Accepted ${accepted}, rejected ${rejected}, failed ${failed}, skipped ${skipped.length}.`);
    console.log(`Accepted size: ${formatMb(originalBytes)} -> ${formatMb(candidateBytes)}; saved ${formatMb(replacedBytes)}.`);
    if (failures.length > 0) {
        console.log('Failures:');
        for (const failure of failures.slice(0, 12)) console.log(`- ${failure}`);
    }
    if (rejections.length > 0) {
        console.log('Rejections:');
        for (const rejection of rejections.slice(0, 12)) console.log(`- ${rejection}`);
    }
    console.log(`Report: ${join(workDir, 'compaction-report.json')}`);

    if (!hasFlag('--keep-work-dir')) {
        for (const job of jobs) {
            if (existsSync(job.candidatePath)) rmSync(job.candidatePath, { force: true });
        }
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
