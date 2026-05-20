#!/usr/bin/env bun
/**
 * Add cached Thorlabs price snapshots to generated catalog modules.
 *
 * Prices are intentionally snapshots: the BoM can total known costs without
 * pretending vendor prices are immutable.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const THORLABS = 'https://www.thorlabs.com';
const GRAPHQL = `${THORLABS}/graphql`;
const STORE_ID = 'Thorlabs-Website';
const CULTURE = 'en-US';
const USER_ID = 'Anonymous';
const COUNTRY = 'USA';
const CURRENCY = 'USD';
const CHECKED_AT = new Date().toISOString().slice(0, 10);

const DEFAULT_TARGETS = [
  'src/catalog/thorlabsGeneratedCatalog.ts',
  'src/catalog/thorlabsGeneratedFoldOpticsCatalog.ts',
  'src/catalog/thorlabsGeneratedFiltersCatalog.ts',
];

function argValues(flag) {
  const values = [];
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === flag && process.argv[i + 1]) values.push(process.argv[++i]);
  }
  return values;
}

function argValue(flag, fallback) {
  return argValues(flag).at(-1) ?? fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function graphql(query, variables) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  const payload = await res.json();
  if (payload.errors?.length) throw new Error(JSON.stringify(payload.errors));
  return payload.data;
}

async function slugInfo(slug) {
  const data = await graphql(
    `query SlugInfo($slug:String,$storeId:String,$userId:String,$cultureName:String,$country:String){
      slugInfo(slug:$slug,storeId:$storeId,userId:$userId,cultureName:$cultureName,country:$country){
        entityInfo { objectId objectType semanticUrl }
      }
    }`,
    { slug, storeId: STORE_ID, userId: USER_ID, cultureName: CULTURE, country: COUNTRY },
  );
  return data.slugInfo?.entityInfo ?? null;
}

async function fetchProductPrice(sku) {
  const info = await slugInfo(`item/${sku}`);
  if (!info?.objectId || info.objectType !== 'CatalogProduct') return null;

  const data = await graphql(
    `query ProductPrice($storeId:String!,$currencyCode:String!,$cultureName:String!,$id:String!){
      product(storeId:$storeId,id:$id,currencyCode:$currencyCode,cultureName:$cultureName){
        code
        price {
          actual { amount formattedAmount }
          list { amount formattedAmount }
          currency
        }
        minVariationPrice {
          actual { amount formattedAmount }
          list { amount formattedAmount }
          currency
        }
      }
    }`,
    { storeId: STORE_ID, currencyCode: CURRENCY, cultureName: CULTURE, id: info.objectId },
  );
  const product = data.product;
  const price = product?.price?.actual?.amount !== undefined
    ? product.price
    : product?.minVariationPrice?.actual?.amount !== undefined
      ? product.minVariationPrice
      : null;
  const amount = price?.actual?.amount;
  if (!Number.isFinite(amount) || amount < 0) return null;
  return {
    amount,
    currency: price.currency || CURRENCY,
    quantity: 1,
    region: COUNTRY,
    checkedAt: CHECKED_AT,
  };
}

async function importCatalogModule(filePath) {
  const url = pathToFileURL(path.resolve(filePath)).href;
  const module = await import(`${url}?priceRefresh=${Date.now()}-${Math.random()}`);
  const entry = Object.entries(module).find(([name, value]) => (
    /^THORLABS_.*CATALOG$/.test(name) && Array.isArray(value)
  ));
  if (!entry) throw new Error(`No THORLABS_*_CATALOG export found in ${filePath}`);
  return { exportName: entry[0], parts: entry[1] };
}

async function enrichParts(parts, { concurrency, limit, force }) {
  const enriched = parts.map(part => ({ ...part }));
  const diagnostics = [];
  const indices = enriched
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.vendor === 'thorlabs')
    .filter(({ part }) => force || !part.price)
    .slice(0, limit > 0 ? limit : undefined);

  const cache = new Map();
  let next = 0;

  const worker = async () => {
    while (true) {
      const current = indices[next++];
      if (!current) return;
      const { part, index } = current;
      try {
        let price = cache.get(part.sku);
        if (price === undefined) {
          price = await fetchProductPrice(part.sku);
          cache.set(part.sku, price);
        }
        if (price) {
          enriched[index] = {
            ...part,
            price: {
              ...price,
              sourceUrl: part.productUrl || `${THORLABS}/thorproduct.cfm?partnumber=${encodeURIComponent(part.sku)}`,
            },
          };
          diagnostics.push({ sku: part.sku, price: price.amount, currency: price.currency });
        } else {
          diagnostics.push({ sku: part.sku, skipped: 'no public price' });
        }
      } catch (error) {
        diagnostics.push({ sku: part.sku, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, indices.length || 1)) }, () => worker()));
  return { parts: enriched, diagnostics };
}

function generatedModuleText(exportName, parts) {
  const jsonName = `${exportName}_JSON`;
  const catalogJson = JSON.stringify(parts);
  const catalogChunks = catalogJson.match(/.{1,24000}/g) ?? [''];
  return [
    "import type { CatalogPart } from './types';",
    '',
    '// Generated by scripts/catalog/enrich-thorlabs-prices.mjs.',
    '// Prices are cached vendor snapshots and may change at the source.',
    `const ${jsonName} = [`,
    ...catalogChunks.map(chunk => `  ${JSON.stringify(chunk)},`),
    "].join('');",
    '',
    `export const ${exportName} = JSON.parse(${jsonName}) as CatalogPart[];`,
    '',
  ].join('\n');
}

async function processTarget(filePath, options) {
  const before = await readFile(filePath, 'utf8');
  const { exportName, parts } = await importCatalogModule(filePath);
  const enriched = await enrichParts(parts, options);
  const withPrices = enriched.parts.filter(part => part.price).length;
  if (!options.dryRun) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, generatedModuleText(exportName, enriched.parts), 'utf8');
  }
  return {
    filePath,
    exportName,
    partCount: parts.length,
    pricedCount: withPrices,
    fetchedCount: enriched.diagnostics.filter(entry => entry.price !== undefined).length,
    skippedCount: enriched.diagnostics.filter(entry => entry.skipped).length,
    errorCount: enriched.diagnostics.filter(entry => entry.error).length,
    changed: before !== generatedModuleText(exportName, enriched.parts),
    diagnostics: enriched.diagnostics,
  };
}

async function main() {
  const targets = argValues('--file');
  const files = targets.length > 0 ? targets : DEFAULT_TARGETS;
  const options = {
    concurrency: Math.max(1, Number(argValue('--concurrency', '8'))),
    limit: Math.max(0, Number(argValue('--limit', '0'))),
    force: hasFlag('--force'),
    dryRun: hasFlag('--dry-run'),
  };

  const summaries = [];
  for (const file of files) {
    summaries.push(await processTarget(file, options));
  }

  for (const summary of summaries) {
    console.log(`${summary.filePath}: ${summary.pricedCount}/${summary.partCount} priced (${summary.fetchedCount} fetched, ${summary.skippedCount} skipped, ${summary.errorCount} errors)`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
