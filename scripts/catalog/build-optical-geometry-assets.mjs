#!/usr/bin/env bun

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CATALOG_PARTS } from '../../src/catalog/catalog.ts';

const OUT_DIR = 'public/catalog/optical/thorlabs';
const GEOMETRY_TYPES = new Set([
  'sphericalLens',
  'asphericLens',
  'cylindricalLens',
  'achromatDoublet',
  'prism',
]);

function provenanceForGeometry(part) {
  return part.provenance.find(entry => entry.source === 'zemax')
    ?? part.provenance.find(entry => entry.source === 'vendorPage')
    ?? part.provenance[0]
    ?? null;
}

function isWebsiteBackedGeometry(part) {
  if (part.vendor !== 'thorlabs') return false;
  if (!GEOMETRY_TYPES.has(part.componentType)) return false;
  if (part.normalized.kind !== part.componentType) return false;

  if (part.componentType === 'prism') {
    return part.provenance.some(entry => entry.source === 'vendorPage');
  }

  return part.confidence === 'exact'
    && part.provenance.some(entry => entry.source === 'zemax');
}

function geometryAssetForPart(part) {
  const provenance = provenanceForGeometry(part);
  return {
    partId: part.id,
    sku: part.sku,
    confidence: part.confidence,
    source: provenance?.source ?? 'vendorPage',
    ...(provenance?.url ? { sourceUrl: provenance.url } : {}),
    normalized: part.normalized,
  };
}

async function main() {
  const outDir = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : OUT_DIR;
  const generatedAt = new Date().toISOString();
  const byType = new Map([...GEOMETRY_TYPES].map(type => [type, {}]));

  for (const part of CATALOG_PARTS) {
    if (!isWebsiteBackedGeometry(part)) continue;
    byType.get(part.componentType)[part.id] = geometryAssetForPart(part);
  }

  await mkdir(outDir, { recursive: true });
  for (const [componentType, parts] of byType) {
    const pack = {
      version: 1,
      generatedAt,
      vendor: 'thorlabs',
      componentType,
      parts,
    };
    const outPath = path.join(outDir, `${componentType}.geometries.json`);
    await writeFile(outPath, `${JSON.stringify(pack)}\n`, 'utf8');
    console.log(`Wrote ${Object.keys(parts).length} ${componentType} geometries to ${outPath}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
