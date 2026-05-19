#!/usr/bin/env bun
/**
 * Bulk Thorlabs optics catalog importer.
 *
 * Thorlabs' current product pages are rendered by the new site frontend, so
 * direct HTML requests to legacy NewGroupPage9 endpoints no longer expose the
 * product tables reliably. This importer uses the same public GraphQL content
 * API that the Thorlabs site uses, crawls supported family pages, and parses
 * their product tables into the simulator's catalog schema.
 *
 * Usage:
 *   bun scripts/catalog/import-thorlabs-lenses.mjs
 *   bun scripts/catalog/import-thorlabs-lenses.mjs --with-support-files
 *   bun scripts/catalog/import-thorlabs-lenses.mjs --with-support-files --support-concurrency 8
 *   bun scripts/catalog/import-thorlabs-lenses.mjs --out public/catalog/thorlabs-lenses.json --format json
 *   bun scripts/catalog/import-thorlabs-lenses.mjs --slug n-bk7-plano-convex-lenses-ar-coating-350---700-nm
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  enrichCatalogPartWithPrescriptionBytes,
  isOpticalPrescriptionFileName,
} from '../../src/catalog/catalogPrescriptionEnrichment.ts';

const THORLABS = 'https://www.thorlabs.com';
const GRAPHQL = `${THORLABS}/graphql`;
const STORE_ID = 'Thorlabs-Website';
const CULTURE = 'en-US';
const USER_ID = 'Anonymous';
const COUNTRY = 'USA';
const INDEXED_AT = new Date().toISOString().slice(0, 10);
const ZEMAX_CATALOG_URL = 'https://www.thorlabs.com/software-pages/zemax';
const THORPRODUCT_URL = `${THORLABS}/thorproduct.cfm`;
const QUICKVIEW_URL = `${THORLABS}/_QLPopup.cfm`;

const SUPPORT_FILE_EXTENSIONS = new Set([
  'zmx',
  'zemax',
  'seq',
  'len',
  'dat',
  'txt',
  'csv',
  'tsv',
  'json',
  'zos',
  'zar',
  'zip',
  'step',
  'stp',
  'iges',
  'igs',
  'sat',
  'sldprt',
  'prt',
  'x_t',
  'zof',
  'pdf',
  'dxf',
]);

const DEFAULT_START_SLUGS = [
  'plano-convex-spherical-lenses',
  'bi-convex-spherical-lenses',
  'plano-concave-spherical-lenses',
  'bi-concave-spherical-lenses',
  'best-form-lenses',
  'positive-meniscus-lenses',
  'negative-meniscus-lenses',
  'unmounted-achromatic-doublets-ar-coated-400---700-nm',
  'mounted-achromatic-doublets-ar-coated-400---700-nm',
  'plano-convex-round-cylindrical-lenses-caf2-mounted',
  'molded-glass-aspheric-lenses-uncoated',
  'molded-glass-aspheric-lenses-350---700-nm-ar-coating',
  'molded-glass-aspheric-lenses-405-nm-or-1064-nm-ar-coating',
  'molded-glass-aspheric-lenses-finite-conjugate-uncoated',
  'aspheric-condenser-lenses',
  'thorlabs-microscope-objectives-for-life-sciences',
  'right-angle-prisms',
  'round-wedge-prisms',
  'equilateral-dispersive-prisms',
];

const NON_LENS_CATALOG_SLUGS = new Set([
  'thorlabs-microscope-objectives-for-life-sciences',
  'right-angle-prisms',
  'round-wedge-prisms',
  'equilateral-dispersive-prisms',
]);

const MATERIAL_IOR = [
  { pattern: /\bN-BK7\b/i, material: 'N-BK7', ior: 1.5168 },
  { pattern: /\bBK7\b/i, material: 'N-BK7', ior: 1.5168 },
  { pattern: /\bUV Fused Silica\b|\bUVFS\b|\bFused Silica\b/i, material: 'UV Fused Silica', ior: 1.4585 },
  { pattern: /\bN-SF11\b|\bSF11\b/i, material: 'N-SF11', ior: 1.7847 },
  { pattern: /\bN-F2\b/i, material: 'N-F2', ior: 1.6200 },
  { pattern: /\bF2\b/i, material: 'F2', ior: 1.6200 },
  { pattern: /\bZinc Selenide\b|\bZnSe\b/i, material: 'ZnSe', ior: 2.403 },
  { pattern: /\bCalcium Fluoride\b|\bCaF\s*2\b|\bCaF\b/i, material: 'CaF2', ior: 1.4338 },
  { pattern: /\bBarium Fluoride\b|\bBaF\s*2\b/i, material: 'BaF2', ior: 1.474 },
  { pattern: /\bMagnesium Fluoride\b|\bMgF\s*2\b/i, material: 'MgF2', ior: 1.378 },
  { pattern: /\bGermanium\b|\bGe\b/i, material: 'Germanium', ior: 4.003 },
  { pattern: /\bHRFZ-Si\b|\bSilicon\b|\bSi\b/i, material: 'Silicon', ior: 3.42 },
  { pattern: /\bPTFE\b/i, material: 'PTFE', ior: 1.43 },
];

const SHAPE_LABELS = {
  planoConvex: 'Plano-Convex',
  biConvex: 'Bi-Convex',
  planoConcave: 'Plano-Concave',
  biConcave: 'Bi-Concave',
  positiveMeniscus: 'Positive Meniscus',
  negativeMeniscus: 'Negative Meniscus',
  bestForm: 'Best Form',
  hemispherical: 'Hemispherical',
  unknown: 'Spherical Lens',
};

const GLASS_IOR = new Map([
  ['N-BK7', 1.5168],
  ['BK7', 1.5168],
  ['N-SSK5', 1.6584],
  ['LAFN7', 1.7335],
  ['N-LAF7', 1.7495],
  ['N-LAF21', 1.788],
  ['N-LAK22', 1.6511],
  ['N-LAK14', 1.6968],
  ['N-BAF10', 1.6700],
  ['BAFN6', 1.5891],
  ['N-SK11', 1.5638],
  ['N-SF5', 1.6727],
  ['SF5', 1.6727],
  ['N-SF6', 1.8052],
  ['N-SF10', 1.7283],
  ['N-SF11', 1.7847],
  ['SF11', 1.7847],
  ['N-LASF9', 1.8503],
  ['N-LASF44', 1.8042],
  ['F2', 1.6200],
  ['UV FUSED SILICA', 1.4585],
  ['UVFS', 1.4585],
  ['CAF2', 1.4338],
  ['BAF2', 1.474],
  ['MGF2', 1.378],
  ['ZNSE', 2.403],
  ['SILICON', 3.42],
  ['GERMANIUM', 4.003],
  ['ACRYLIC', 1.49],
  ['B270', 1.523],
]);

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

function decodeEntities(value) {
  return String(value)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&deg;|&#176;/gi, '°')
    .replace(/&micro;|&mu;/gi, 'µ')
    .replace(/&Oslash;|Ø/gi, 'Ø')
    .replace(/&#39;/gi, "'");
}

function cleanText(value) {
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<sup[\s\S]*?<\/sup>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHeader(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[_{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstNumber(value) {
  const match = String(value).replace(/,/g, '').match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function allNumbers(value) {
  return [...String(value).replace(/,/g, '').matchAll(/[+-]?\d+(?:\.\d+)?/g)]
    .map(match => Number(match[0]))
    .filter(Number.isFinite);
}

function parseAngleDegrees(value) {
  const text = cleanText(value);
  if (!text || /^(?:n\/a|na|-|—)$/i.test(text)) return undefined;
  const degreeMatch = text.match(/([+-]?\d+(?:\.\d+)?)\s*(?:°|deg|degree)/i);
  const minuteMatch = text.match(/(?:°|deg|degree)\s*([+-]?\d+(?:\.\d+)?)\s*(?:'|arcmin|min)/i)
    ?? text.match(/([+-]?\d+(?:\.\d+)?)\s*(?:'|arcmin|min)/i);
  if (degreeMatch) {
    const degrees = Number(degreeMatch[1]);
    const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
    return degrees + Math.sign(degrees || 1) * minutes / 60;
  }
  return firstNumber(text);
}

function parseMagnification(value) {
  return firstNumber(String(value ?? '').replace(/[×xX]/g, ''));
}

function parseRangeNumbers(value) {
  return allNumbers(value);
}

function parseNumber(value) {
  const text = cleanText(value);
  if (!text || /^(?:n\/a|na|-|—)$/i.test(text)) return undefined;
  if (/inf|∞/i.test(text)) return null;
  return firstNumber(text);
}

function parseDiameter(value, header = '') {
  const text = cleanText(value);
  if (!text) return undefined;
  const fraction = text.match(/(\d+)\s*\/\s*(\d+)\s*"/);
  if (fraction) return 25.4 * Number(fraction[1]) / Number(fraction[2]);
  const inch = text.match(/([+-]?\d+(?:\.\d+)?)\s*"/);
  if (inch) return Number(inch[1]) * 25.4;
  const number = firstNumber(text);
  if (number === undefined) return undefined;
  if (/"|inch/i.test(text) && !/mm/i.test(text)) return number * 25.4;
  if (!/\(mm\)|mm/i.test(header) && number > 0 && number <= 4 && /diameter/i.test(header)) return number * 25.4;
  return number;
}

function parseLength(value, header = '') {
  const text = cleanText(value);
  if (!text) return undefined;
  const measureText = text.replace(/\bS\s*[12]\s*:/gi, ' ');
  const fraction = measureText.match(/(\d+)\s*\/\s*(\d+)\s*"/);
  if (fraction) return 25.4 * Number(fraction[1]) / Number(fraction[2]);
  const inch = measureText.match(/([+-]?\d+(?:\.\d+)?)\s*"/);
  if (inch) return Number(inch[1]) * 25.4;
  const number = firstNumber(measureText);
  if (number === undefined) return undefined;
  if (/"|inch/i.test(measureText) && !/mm/i.test(measureText)) return number * 25.4;
  if (!/\(mm\)|mm/i.test(header) && number > 0 && number <= 4 && /(?:diameter|width|height|length|aperture)/i.test(header)) {
    return number * 25.4;
  }
  return number;
}

function parsePrismLengthCell(value) {
  const text = cleanText(value);
  if (!/(?:mm|"|inch)/i.test(text)) return undefined;
  return parseLength(text);
}

function parseLengthFrom(headers, row, patterns) {
  const cell = cellFor(headers, row, patterns);
  if (cell === undefined) return undefined;
  return parseLength(cell, headers[row.indexOf(cell)] ?? '');
}

function parseDimensionPair(value, header = '') {
  const text = cleanText(value);
  if (!text) return undefined;
  const measureText = text.replace(/\bS\s*[12]\s*:/gi, ' ');
  const values = allNumbers(measureText);
  if (values.length < 2) return undefined;
  const scale = /"|inch/i.test(measureText) && !/mm/i.test(measureText + header) ? 25.4 : 1;
  return [values[0] * scale, values[1] * scale];
}

function skuFromCell(value) {
  const text = cleanText(value);
  const match = text.match(/\b(?:[A-Z]{1,8}\d{2,6}[A-Z0-9]*(?:-[A-Z0-9]+)*|\d{5,6}(?:-[A-Z0-9]+)+)\b/);
  return match ? match[0].toUpperCase() : null;
}

function objectiveSkuFromCell(value) {
  const text = cleanText(value).replace(/\s+/g, '');
  const match = text.match(/\bTL\d+X-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/i);
  return match ? match[0].toUpperCase() : skuFromCell(value);
}

function htmlTables(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(match => match[0]);
}

function htmlRows(html) {
  return [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(match => match[0]);
}

function rowCells(rowHtml, tagPattern = 't[dh]') {
  return [...rowHtml.matchAll(new RegExp(`<${tagPattern}[^>]*>([\\s\\S]*?)<\\/${tagPattern}>`, 'gi'))]
    .map(match => cleanText(match[1]));
}

function tableHeaders(tableHtml) {
  const rows = htmlRows(tableHtml);
  const headerRows = rows
    .map(row => rowCells(row, 'th'))
    .filter(cells => cells.length > 0);
  return headerRows.at(-1) ?? [];
}

function tableDataRows(tableHtml) {
  return htmlRows(tableHtml)
    .map(row => rowCells(row, 't[dh]'))
    .filter(cells => cells.length > 0);
}

function tableHeaderAndRows(tableHtml) {
  const rows = tableDataRows(tableHtml);
  const headerIndex = rows.findIndex(cells => {
    const normalized = cells.map(normalizeHeader).join(' | ');
    return /(?:^| \| )(?:item|part)\s*#?(?: \||$)/.test(normalized)
      || (/(?:item|part)/.test(normalized) && /(?:focal|magnification|material|wedge|angle|thickness|aperture|radius)/.test(normalized));
  });
  if (headerIndex < 0) return { headers: tableHeaders(tableHtml), rows };
  return { headers: rows[headerIndex], rows: rows.slice(headerIndex + 1) };
}

function cellFor(headers, cells, patterns) {
  for (let i = 0; i < headers.length && i < cells.length; i++) {
    const header = normalizeHeader(headers[i]);
    if (patterns.some(pattern => pattern.test(header))) return cells[i];
  }
  return undefined;
}

function skuFromRow(headers, row) {
  const itemCell = cellFor(headers, row, [/item/, /part/]);
  const preferred = skuFromCell(itemCell);
  if (preferred) return preferred;
  for (const cell of row) {
    const sku = skuFromCell(cell);
    if (sku) return sku;
  }
  return null;
}

function inferShape(text) {
  const lower = text.toLowerCase();
  if (/best[-\s]?form/.test(lower)) return 'bestForm';
  if (/positive[-\s]?meniscus/.test(lower)) return 'positiveMeniscus';
  if (/negative[-\s]?meniscus/.test(lower)) return 'negativeMeniscus';
  if (/hyper[-\s]?hemispherical|hemispherical/.test(lower)) return 'hemispherical';
  if (/bi[-\s]?concave/.test(lower)) return 'biConcave';
  if (/bi[-\s]?convex/.test(lower)) return 'biConvex';
  if (/plano[-\s]?concave/.test(lower)) return 'planoConcave';
  if (/plano[-\s]?convex/.test(lower)) return 'planoConvex';
  return 'unknown';
}

function inferMaterial(text) {
  for (const entry of MATERIAL_IOR) {
    if (entry.pattern.test(text)) return { material: entry.material, ior: entry.ior };
  }
  return { material: 'Optical Glass', ior: 1.5168 };
}

function knownMaterialFromText(text) {
  for (const entry of MATERIAL_IOR) {
    if (entry.pattern.test(text)) return entry.material;
  }
  return undefined;
}

function materialFromPrismSku(sku, fallback) {
  if (/^PS9/i.test(sku)) return 'N-BK7';
  if (/^PS6/i.test(sku)) return 'UV Fused Silica';
  return fallback;
}

function normalizeGlassName(value) {
  const cleaned = cleanText(value)
    .replace(/calcium fluoride/ig, 'CaF2')
    .replace(/barium fluoride/ig, 'BaF2')
    .replace(/magnesium fluoride/ig, 'MgF2')
    .replace(/\bCaF\s*2\b/ig, 'CaF2')
    .replace(/\bBaF\s*2\b/ig, 'BaF2')
    .replace(/\bMgF\s*2\b/ig, 'MgF2')
    .replace(/zinc selenide/ig, 'ZnSe')
    .replace(/uv fused silica/ig, 'UV Fused Silica')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || undefined;
}

function iorForMaterial(value, fallback = 1.5168) {
  const text = normalizeGlassName(value);
  if (!text) return fallback;
  const upper = text.toUpperCase().replace(/[^A-Z0-9-]/g, ' ');
  for (const [name, ior] of GLASS_IOR.entries()) {
    const key = name.toUpperCase();
    if (upper.split(/\s+/).includes(key) || upper.includes(key)) return ior;
  }
  return inferMaterial(text).ior ?? fallback;
}

function parseGlassPair(value) {
  const text = normalizeGlassName(value);
  if (!text) return {};
  const tokens = text
    .replace(/\band\b/ig, '/')
    .split(/[\/,+;]/)
    .map(token => normalizeGlassName(token))
    .filter(Boolean);
  return {
    glass1: tokens[0],
    glass2: tokens[1],
    ior1: iorForMaterial(tokens[0], 1.658),
    ior2: iorForMaterial(tokens[1], 1.750),
  };
}

function inferCoating(text) {
  const clean = text.replace(/\s+/g, ' ');
  if (/uncoated/i.test(clean)) return 'Uncoated';
  const ar = clean.match(/(?:AR\s*)?(?:Coated|Coating|V-Coated|V Coated)?(?:\s*:)?\s*([0-9.]+\s*(?:-|to|\/)\s*[0-9.]+\s*(?:nm|µm|um|m)|[0-9.]+\s*nm)(?:\s*(?:and|\/)\s*[0-9.]+\s*nm)?/i);
  if (ar) return ar[0].trim().replace(/^:\s*/, 'AR Coating: ');
  const suffix = clean.match(/\b-([A-Z0-9]{1,3})\s*(?:Coating|Coated)\b/i);
  return suffix ? `${suffix[1].toUpperCase()} coating` : undefined;
}

function inferMounting(text) {
  if (/\bunmounted\b/i.test(text)) return 'Unmounted';
  if (/\bmounted\b/i.test(text)) return 'Mounted';
  return 'Unmounted';
}

function immersionFromText(text) {
  if (/^\s*dry\b/i.test(text)) return { kind: 'air', ior: 1.0 };
  if (/oil/i.test(text)) return { kind: 'oil', ior: 1.515 };
  if (/silicone/i.test(text)) return { kind: 'silicone', ior: 1.406 };
  if (/water|aqueous|salt/i.test(text)) return { kind: 'water', ior: 1.33 };
  return { kind: 'air', ior: 1.0 };
}

function equilateralVertices(side) {
  const h = Math.sqrt(3) * side / 2;
  return [[0, h], [-side / 2, 0], [side / 2, 0]];
}

function rightAngleVertices(leg) {
  return [[0, 0], [leg, 0], [0, leg]];
}

function wedgeVertices(diameter, thinEdge, thickEdge) {
  return [
    [-diameter / 2, -thinEdge / 2],
    [diameter / 2, -thickEdge / 2],
    [diameter / 2, thickEdge / 2],
    [-diameter / 2, thinEdge / 2],
  ];
}

function scalarValue(value, unit, source = 'vendorPage') {
  return value === undefined ? undefined : { value, ...(unit ? { unit } : {}), source };
}

function catalogFiles() {
  return [{ kind: 'zemax', role: 'opticalPrescription', url: ZEMAX_CATALOG_URL }];
}

function decodeUrlText(value) {
  return decodeEntities(String(value))
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .trim();
}

function extensionFromUrl(url) {
  try {
    const parsed = new URL(url, THORLABS);
    return parsed.pathname.toLowerCase().split('.').pop() ?? '';
  } catch {
    return String(url).split(/[?#]/)[0].toLowerCase().split('.').pop() ?? '';
  }
}

function supportFileKind(url) {
  const extension = extensionFromUrl(url);
  if (extension === 'zmx' || extension === 'zemax') return 'zemax';
  if (extension === 'zos' || extension === 'zar' || extension === 'zof' || extension === 'zip') return 'opticStudio';
  if (extension === 'seq') return 'codeV';
  if (extension === 'len' || extension === 'dat') return 'oslo';
  if (extension === 'step' || extension === 'stp' || extension === 'iges' || extension === 'igs' || extension === 'sat' || extension === 'x_t') return 'step';
  if (extension === 'sldprt' || extension === 'prt') return 'solidworks';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'dxf') return 'dxf';
  return 'opticStudio';
}

function supportFileRole(url, label = '') {
  const extension = extensionFromUrl(url);
  if (isOpticalPrescriptionFileName(url) || ['zar', 'zos', 'zof'].includes(extension) || /zemax|opticstudio|code\s*v|oslo/i.test(label)) {
    return 'opticalPrescription';
  }
  const kind = supportFileKind(url);
  if (kind === 'step' || kind === 'solidworks') return 'mechanicalModel';
  if (kind === 'pdf') return 'datasheet';
  if (kind === 'dxf') return 'drawing';
  return undefined;
}

function normalizeSupportUrl(raw, baseUrl) {
  const decoded = decodeUrlText(raw).replace(/^['"]|['"]$/g, '');
  if (!decoded || /^javascript:|^mailto:/i.test(decoded)) return null;
  try {
    const url = new URL(decoded, baseUrl);
    if (!/thorlabs\./i.test(url.hostname)) return null;
    const extension = extensionFromUrl(url.href);
    if (!SUPPORT_FILE_EXTENSIONS.has(extension)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function extractSupportFileUrls(content, baseUrl) {
  const urls = new Set();
  const text = String(content);
  const attrPattern = /(?:href|src|url|externalURL|downloadURL|fileURL|link)"?\s*[:=]\s*"?([^"',<>\s}]+)/gi;
  for (const match of text.matchAll(attrPattern)) {
    const url = normalizeSupportUrl(match[1], baseUrl);
    if (url) urls.add(url);
  }

  const directPattern = /(?:https?:\/\/[^"',<>\s}]+|\/[^"',<>\s}]+)\.(?:zmx|zemax|seq|len|dat|txt|csv|tsv|json|zos|zar|zip|step|stp|iges|igs|sat|sldprt|prt|x_t|zof|pdf|dxf)(?:\?[^"',<>\s}]*)?/gi;
  for (const match of text.matchAll(directPattern)) {
    const url = normalizeSupportUrl(match[0], baseUrl);
    if (url) urls.add(url);
  }

  return [...urls].map(url => ({
    url,
    kind: supportFileKind(url),
    role: supportFileRole(url),
  }));
}

function supportFileFromAsset(asset) {
  const url = asset.optiUrl || asset.url;
  if (!url) return null;
  const normalized = normalizeSupportUrl(url, THORLABS);
  if (!normalized) return null;
  const label = `${asset.group ?? ''} ${asset.description ?? ''} ${asset.name ?? ''}`;
  return {
    url: normalized,
    kind: supportFileKind(normalized),
    role: supportFileRole(normalized, label),
  };
}

function extractSupportPopupUrls(content, baseUrl, sku) {
  const urls = new Set();
  const text = String(content);
  for (const match of text.matchAll(/_SD-Popup\.cfm[^"',<>\s}]*/gi)) {
    const url = normalizeSupportPageUrl(match[0], baseUrl);
    if (url) urls.add(url);
  }
  for (const match of text.matchAll(/(?:pageId|pageid|PageID|ObjectGroup_ID|objectgroup_id)["'=:\s]+(\d+)/g)) {
    urls.add(`${THORLABS}/_SD-Popup.cfm?pageId=${match[1]}&partnumber=${encodeURIComponent(sku)}`);
  }
  return [...urls];
}

function normalizeSupportPageUrl(raw, baseUrl) {
  const decoded = decodeUrlText(raw).replace(/^['"]|['"]$/g, '');
  if (!decoded || !/_SD-Popup\.cfm/i.test(decoded)) return null;
  try {
    const url = new URL(decoded, baseUrl);
    if (!/thorlabs\./i.test(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function upsertFile(files, next) {
  const existingIndex = files.findIndex(file => file.url === next.url);
  if (existingIndex < 0) return [...files, next];
  return files.map((file, index) => index === existingIndex ? { ...file, ...next } : file);
}

function cachePathForUrl(cacheDir, url) {
  const parsed = new URL(url);
  const extension = extensionFromUrl(url);
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
  const base = path.basename(parsed.pathname).replace(/[^A-Za-z0-9._-]/g, '_') || `support.${extension}`;
  return path.join(cacheDir, `${hash}-${base}`);
}

async function fetchBytes(url, cacheDir) {
  if (cacheDir) {
    const cachePath = cachePathForUrl(cacheDir, url);
    try {
      return new Uint8Array(await readFile(cachePath));
    } catch {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      await mkdir(path.dirname(cachePath), { recursive: true });
      await writeFile(cachePath, bytes);
      return bytes;
    }
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function discoverProductSupportFiles(part) {
  const productUrls = [
    `${THORPRODUCT_URL}?partnumber=${encodeURIComponent(part.sku)}`,
    `${QUICKVIEW_URL}?PN=${encodeURIComponent(part.sku)}`,
    `${THORLABS}/_SD-Popup.cfm?partnumber=${encodeURIComponent(part.sku)}`,
    part.productUrl,
  ];
  const byUrl = new Map();
  const popupUrls = new Set();
  const diagnostics = [];

  try {
    for (const asset of await fetchProductAssets(part.sku)) {
      const file = supportFileFromAsset(asset);
      if (file) byUrl.set(file.url, file);
    }
  } catch (error) {
    diagnostics.push({ url: `graphql:item/${part.sku}`, error: error instanceof Error ? error.message : String(error) });
  }

  if (byUrl.size > 0) return { files: [...byUrl.values()], diagnostics };

  for (const url of productUrls) {
    try {
      const html = await fetchText(url);
      for (const file of extractSupportFileUrls(html, url)) {
        byUrl.set(file.url, file);
      }
      for (const popupUrl of extractSupportPopupUrls(html, url, part.sku)) {
        popupUrls.add(popupUrl);
      }
    } catch (error) {
      diagnostics.push({ url, error: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const url of popupUrls) {
    try {
      const html = await fetchText(url);
      for (const file of extractSupportFileUrls(html, url)) {
        byUrl.set(file.url, file);
      }
    } catch (error) {
      diagnostics.push({ url, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { files: [...byUrl.values()], diagnostics };
}

async function enrichPartWithSupportFiles(part, options) {
  const { files, diagnostics } = await discoverProductSupportFiles(part);
  let enriched = {
    ...part,
    files: files.reduce((current, file) => upsertFile(current, file), part.files),
  };

  const opticalFiles = files.filter(file => file.role === 'opticalPrescription');
  const importableOpticalFiles = opticalFiles.filter(file => isOpticalPrescriptionFileName(file.url));
  for (const file of importableOpticalFiles) {
    try {
      const bytes = await fetchBytes(file.url, options.cacheDir);
      enriched = enrichCatalogPartWithPrescriptionBytes(enriched, bytes, file.url, file.url, INDEXED_AT);
      return {
        part: enriched,
        diagnostic: {
          sku: part.sku,
          status: 'exact',
          file: file.url,
          candidates: files.length,
          opticalCandidates: opticalFiles.length,
          importableCandidates: importableOpticalFiles.length,
          diagnostics,
        },
      };
    } catch (error) {
      diagnostics.push({ url: file.url, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    part: enriched,
    diagnostic: {
      sku: part.sku,
      status: importableOpticalFiles.length ? 'not-imported' : opticalFiles.length ? 'archive-only' : 'no-prescription',
      candidates: files.length,
      opticalCandidates: opticalFiles.length,
      importableCandidates: importableOpticalFiles.length,
      diagnostics,
    },
  };
}

async function enrichPartsWithSupportFiles(parts, options) {
  const diagnostics = [];
  const enriched = [...parts];
  const candidateIndices = parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => !options.skus?.size || options.skus.has(part.sku.toUpperCase()))
    .map(({ index }) => index);
  const limit = options.limit > 0 ? Math.min(options.limit, candidateIndices.length) : candidateIndices.length;
  const indices = candidateIndices.slice(0, limit);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, indices.length || 1));
  let checked = 0;
  let next = 0;

  const worker = async () => {
    while (true) {
      const cursor = next++;
      if (cursor >= indices.length) return;
      const index = indices[cursor];
      const result = await enrichPartWithSupportFiles(parts[index], options);
      enriched[index] = result.part;
      diagnostics.push(result.diagnostic);
      checked++;
      if (checked % 25 === 0) {
        const exact = diagnostics.filter(item => item.status === 'exact').length;
        console.log(`Support files: checked ${checked}/${limit}, exact imports ${exact}`);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return { parts: enriched, diagnostics };
}

function orientRadii(shape, radius) {
  if (radius === undefined) return { r1: undefined, r2: undefined };
  if (radius === null) return { r1: null, r2: null };
  const r = Math.abs(radius);
  switch (shape) {
    case 'planoConvex': return { r1: r, r2: null };
    case 'planoConcave': return { r1: -r, r2: null };
    case 'biConvex': return { r1: r, r2: -r };
    case 'biConcave': return { r1: -r, r2: r };
    default: return { r1: radius, r2: undefined };
  }
}

function signCorrectMeniscus(shape, r1, r2) {
  if (r1 === undefined && r2 === undefined) return { r1, r2 };
  if (shape === 'positiveMeniscus' || shape === 'negativeMeniscus') {
    return {
      r1: typeof r1 === 'number' ? Math.abs(r1) : r1,
      r2: typeof r2 === 'number' ? Math.abs(r2) : r2,
    };
  }
  return { r1, r2 };
}

function inferComponentType(text) {
  const lower = text.toLowerCase();
  if (/objective/.test(lower)) return 'objective';
  if (/prism/.test(lower)) return 'prism';
  if (/achromat|achromatic|doublet/.test(lower)) return 'achromatDoublet';
  if (/cylindrical/.test(lower) && !/acylindrical/.test(lower)) return 'cylindricalLens';
  if (/aspheric|asphere|aspheric condenser/.test(lower)) return 'asphericLens';
  return 'sphericalLens';
}

function finiteRadius(radius) {
  return typeof radius === 'number' && Number.isFinite(radius) && Math.abs(radius) < 1e8;
}

function surfaceZ(radius, apex, radial) {
  if (!finiteRadius(radius)) return apex;
  const val = radius * radius - radial * radial;
  if (val < 0) return Number.NaN;
  return (apex + radius) - (radius > 0 ? 1 : -1) * Math.sqrt(val);
}

function thicknessAtRadius(r1, r2, centerThickness, radial) {
  const frontApex = -centerThickness / 2;
  const backApex = centerThickness / 2;
  const front = surfaceZ(r1, frontApex, radial);
  const back = surfaceZ(r2, backApex, radial);
  return Number.isFinite(front) && Number.isFinite(back) ? back - front : Number.NaN;
}

function radiusValidityLimit(diameter, r1, r2) {
  let limit = diameter / 2;
  if (finiteRadius(r1)) limit = Math.min(limit, Math.abs(r1) * (1 - 1e-6));
  if (finiteRadius(r2)) limit = Math.min(limit, Math.abs(r2) * (1 - 1e-6));
  return Math.max(0, limit);
}

function deriveOpticalApertureRadius(diameter, centerThickness, edgeThickness, r1, r2) {
  const nominal = diameter / 2;
  const high = radiusValidityLimit(diameter, r1, r2);
  const usableHigh = high > 0 ? high : nominal;

  if (edgeThickness === undefined || edgeThickness === null || !Number.isFinite(edgeThickness)) {
    return Math.min(nominal, usableHigh);
  }

  const center = centerThickness;
  const edgeAtHigh = thicknessAtRadius(r1, r2, centerThickness, usableHigh);
  if (!Number.isFinite(edgeAtHigh) || Math.abs(edgeAtHigh - center) < 1e-9) {
    return Math.min(nominal, usableHigh);
  }

  const targetIsBracketed =
    (edgeThickness >= Math.min(center, edgeAtHigh) - 1e-6) &&
    (edgeThickness <= Math.max(center, edgeAtHigh) + 1e-6);

  if (!targetIsBracketed) {
    return Math.min(nominal, usableHigh);
  }

  const increasing = edgeAtHigh > center;
  let lo = 0;
  let hi = usableHigh;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const thickness = thicknessAtRadius(r1, r2, centerThickness, mid);
    if (!Number.isFinite(thickness)) {
      hi = mid;
      continue;
    }
    if (increasing ? thickness < edgeThickness : thickness > edgeThickness) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

function makeCatalogPart({ sku, page, slug, shape, row, headers }) {
  const pageText = `${page.name ?? ''} ${page.permalink ?? ''} ${slug}`;
  const diameterCell = cellFor(headers, row, [/diameter/, /\bdia\b/]);
  const focalCell = cellFor(headers, row, [/focal length/, /\befl\b/, /^f\b/]);
  const diopterCell = cellFor(headers, row, [/diopter/]);
  const radiusCell = cellFor(headers, row, [/radius of curvature/, /\bradius\b/, /^r\b/]);
  const r1Cell = cellFor(headers, row, [/r\s*1\b/, /r1\b/, /radius.*1/]);
  const r2Cell = cellFor(headers, row, [/r\s*2\b/, /r2\b/, /radius.*2/]);
  const centerThicknessCell = cellFor(headers, row, [/center thickness/, /\bct\b/, /^tc\b/, /\btc\b/, /\bt\s*c\b/]);
  const edgeThicknessCell = cellFor(headers, row, [/edge thickness/, /\bet\b/, /^te\b/, /\bte\b/, /\bt\s*e\b/]);
  const backFocalCell = cellFor(headers, row, [/back focal/, /\bbfl\b/]);

  const diameter = parseDiameter(diameterCell, diameterCell ? headers[row.indexOf(diameterCell)] : '');
  const focalLength = parseNumber(focalCell);
  const diopter = parseNumber(diopterCell);
  const centerThickness = parseNumber(centerThicknessCell);
  const edgeThickness = parseNumber(edgeThicknessCell);
  const backFocalLength = parseNumber(backFocalCell);

  let r1 = parseNumber(r1Cell);
  let r2 = parseNumber(r2Cell);
  if (r1 === undefined && r2 === undefined) {
    const single = parseNumber(radiusCell);
    const oriented = orientRadii(shape, single);
    r1 = oriented.r1;
    r2 = oriented.r2;
  } else {
    ({ r1, r2 } = signCorrectMeniscus(shape, r1, r2));
  }

  if (!sku || diameter === undefined || typeof focalLength !== 'number') return null;
  if (centerThickness === undefined || (r1 === undefined && r2 === undefined)) return null;

  const { material, ior } = inferMaterial(pageText);
  const coating = inferCoating(pageText);
  const shapeLabel = SHAPE_LABELS[shape] ?? SHAPE_LABELS.unknown;
  const mounting = inferMounting(pageText);
  const productPath = page.permalink ?? `/${slug}`;
  const productUrl = `${THORLABS}${productPath.startsWith('/') ? productPath : `/${productPath}`}?pn=${encodeURIComponent(sku)}`;
  const apertureRadius = deriveOpticalApertureRadius(diameter, centerThickness, edgeThickness, r1, r2);
  const modeledDiameter = apertureRadius * 2;

  const specs = {
    diameter: scalarValue(diameter, 'mm'),
    ...(Math.abs(modeledDiameter - diameter) > 0.01 ? { modeledApertureDiameter: scalarValue(modeledDiameter, 'mm') } : {}),
    effectiveFocalLength: scalarValue(focalLength, 'mm'),
    ...(diopter !== undefined ? { diopter: scalarValue(diopter, undefined) } : {}),
    ...(backFocalLength !== undefined ? { backFocalLength: scalarValue(backFocalLength, 'mm') } : {}),
    ...(r1 !== undefined ? { r1: scalarValue(r1 === null ? 'Infinity' : r1, 'mm') } : {}),
    ...(r2 !== undefined ? { r2: scalarValue(r2 === null ? 'Infinity' : r2, 'mm') } : {}),
    centerThickness: scalarValue(centerThickness, 'mm'),
    ...(edgeThickness !== undefined ? { edgeThickness: scalarValue(edgeThickness, 'mm') } : {}),
    material: scalarValue(material, undefined),
    ...(coating ? { coating: scalarValue(coating, undefined) } : {}),
    shape: scalarValue(shapeLabel, undefined),
    mounting: scalarValue(mounting, undefined),
  };

  return {
    id: `thorlabs:${sku}`,
    vendor: 'thorlabs',
    sku,
    title: `${sku}: ${shapeLabel} ${material} Lens, Ø${Number(diameter.toFixed(3))} mm, f = ${focalLength} mm${coating ? `, ${coating}` : ''}`,
    productUrl,
    categoryPath: ['Optics', 'Lenses', 'Spherical Singlet Lenses', shapeLabel],
    componentType: 'sphericalLens',
    specs,
    normalized: {
      kind: 'sphericalLens',
      focalLengthMm: focalLength,
      apertureRadiusMm: apertureRadius,
      thicknessMm: centerThickness,
      ...(r1 !== undefined ? { r1Mm: r1 } : {}),
      ...(r2 !== undefined ? { r2Mm: r2 } : {}),
      ior,
      material,
    },
    files: catalogFiles(),
    provenance: [{
      source: 'vendorPage',
      url: `${THORLABS}${productPath.startsWith('/') ? productPath : `/${productPath}`}`,
      note: 'Parsed from public Thorlabs GraphQL family-page product tables. Product-level Zemax files are available through the linked Thorlabs Zemax catalog/page assets.',
      retrievedAt: INDEXED_AT,
    }],
    confidence: 'derived',
    lastIndexed: INDEXED_AT,
  };
}

function makeCylindricalLensPart({ sku, page, slug, shape, row, headers }) {
  const pageText = `${page.name ?? ''} ${page.permalink ?? ''} ${slug}`;
  const diameterCell = cellFor(headers, row, [/diameter/, /\bdia\b/, /\bod\b/]);
  const dimensionCell = cellFor(headers, row, [/dimension/, /size/]);
  const lengthCell = cellFor(headers, row, [/length/]);
  const heightCell = cellFor(headers, row, [/height/]);
  const focalCell = cellFor(headers, row, [/focal length/, /\befl\b/, /^f\b/]);
  const clearApertureCell = cellFor(headers, row, [/clear aperture/, /\bca\b/]);
  const radiusCell = cellFor(headers, row, [/radius of curvature/, /\bradius\b/, /^r\b/]);
  const r1Cell = cellFor(headers, row, [/r\s*1\b/, /r1\b/, /radius.*1/]);
  const r2Cell = cellFor(headers, row, [/r\s*2\b/, /r2\b/, /radius.*2/]);
  const centerThicknessCell = cellFor(headers, row, [/center thickness/, /\bct\b/, /^tc\b/, /\btc\b/, /\bt\s*c\b/]);
  const edgeThicknessCell = cellFor(headers, row, [/edge thickness/, /\bet\b/, /^te\b/, /\bte\b/, /\bt\s*e\b/]);
  const backFocalCell = cellFor(headers, row, [/back focal/, /\bbfl\b/]);

  const diameter = diameterCell !== undefined
    ? parseDiameter(diameterCell, headers[row.indexOf(diameterCell)] ?? '')
    : undefined;
  const dimensions = dimensionCell !== undefined
    ? parseDimensionPair(dimensionCell, headers[row.indexOf(dimensionCell)] ?? '')
    : undefined;
  const length = lengthCell !== undefined
    ? parseLength(lengthCell, headers[row.indexOf(lengthCell)] ?? '')
    : undefined;
  const height = heightCell !== undefined
    ? parseLength(heightCell, headers[row.indexOf(heightCell)] ?? '')
    : undefined;
  const focalLength = parseNumber(focalCell);
  const clearAperture = clearApertureCell !== undefined
    ? parseLength(clearApertureCell, headers[row.indexOf(clearApertureCell)] ?? '')
    : undefined;
  const centerThickness = parseNumber(centerThicknessCell);
  const edgeThickness = parseNumber(edgeThicknessCell);
  const backFocalLength = parseNumber(backFocalCell);

  let r1 = parseNumber(r1Cell);
  let r2 = parseNumber(r2Cell);
  if (r1 === undefined && r2 === undefined) {
    const single = parseNumber(radiusCell);
    const oriented = orientRadii(shape, single);
    r1 = oriented.r1;
    r2 = oriented.r2;
  }

  const diameterLike = diameter ?? clearAperture ?? height ?? dimensions?.[0];
  if (!sku || diameterLike === undefined || typeof focalLength !== 'number') return null;
  if (centerThickness === undefined || r1 === undefined) return null;

  const { material, ior } = inferMaterial(`${pageText} ${cellFor(headers, row, [/material/, /substrate/, /glass/]) ?? ''}`);
  const coating = inferCoating(pageText);
  const shapeLabel = SHAPE_LABELS[shape] ?? 'Cylindrical';
  const mounting = inferMounting(pageText);
  const productPath = page.permalink ?? `/${slug}`;
  const productUrl = `${THORLABS}${productPath.startsWith('/') ? productPath : `/${productPath}`}?pn=${encodeURIComponent(sku)}`;
  const apertureRadius = deriveOpticalApertureRadius(diameterLike, centerThickness, edgeThickness, r1, r2);
  const width = length ?? dimensions?.[1] ?? dimensions?.[0] ?? diameter ?? clearAperture ?? apertureRadius * 2;

  return {
    id: `thorlabs:${sku}`,
    vendor: 'thorlabs',
    sku,
    title: `${sku}: ${shapeLabel} ${material} Cylindrical Lens, ${diameter ? `Ø${Number(diameter.toFixed(3))} mm` : `${Number(width.toFixed(3))} mm wide`}, f = ${focalLength} mm${coating ? `, ${coating}` : ''}`,
    productUrl,
    categoryPath: ['Optics', 'Lenses', 'Cylindrical Lenses', shapeLabel],
    componentType: 'cylindricalLens',
    specs: {
      ...(diameter !== undefined ? { diameter: scalarValue(diameter, 'mm') } : {}),
      ...(clearAperture !== undefined ? { clearAperture: scalarValue(clearAperture, 'mm') } : {}),
      ...(length !== undefined ? { length: scalarValue(length, 'mm') } : {}),
      ...(height !== undefined ? { height: scalarValue(height, 'mm') } : {}),
      width: scalarValue(width, 'mm'),
      effectiveFocalLength: scalarValue(focalLength, 'mm'),
      ...(backFocalLength !== undefined ? { backFocalLength: scalarValue(backFocalLength, 'mm') } : {}),
      r1: scalarValue(r1 === null ? 'Infinity' : r1, 'mm'),
      r2: scalarValue(r2 === null || r2 === undefined ? 'Infinity' : r2, 'mm'),
      centerThickness: scalarValue(centerThickness, 'mm'),
      ...(edgeThickness !== undefined ? { edgeThickness: scalarValue(edgeThickness, 'mm') } : {}),
      material: scalarValue(material, undefined),
      ...(coating ? { coating: scalarValue(coating, undefined) } : {}),
      shape: scalarValue(shapeLabel, undefined),
      mounting: scalarValue(mounting, undefined),
    },
    normalized: {
      kind: 'cylindricalLens',
      focalLengthMm: focalLength,
      apertureRadiusMm: apertureRadius,
      widthMm: width,
      thicknessMm: centerThickness,
      r1Mm: r1 ?? 1e9,
      r2Mm: r2 ?? 1e9,
      ior,
      material,
    },
    files: catalogFiles(),
    provenance: [{
      source: 'vendorPage',
      url: `${THORLABS}${productPath.startsWith('/') ? productPath : `/${productPath}`}`,
      note: 'Parsed from public Thorlabs GraphQL family-page product tables. Product-level Zemax files are available through the linked Thorlabs Zemax catalog/page assets.',
      retrievedAt: INDEXED_AT,
    }],
    confidence: 'derived',
    lastIndexed: INDEXED_AT,
  };
}

function asphereCoefficient(headers, row, power) {
  const cell = cellFor(headers, row, [
    new RegExp(`\\ba\\s*${power}\\b`, 'i'),
    new RegExp(`\\b${power}(?:th)?\\s*order`, 'i'),
  ]);
  const value = parseNumber(cell);
  return typeof value === 'number' ? value : undefined;
}

function makeAsphericLensPart({ sku, page, slug, row, headers }) {
  const pageText = `${page.name ?? ''} ${page.permalink ?? ''} ${slug}`;
  const focalCell = cellFor(headers, row, [/focal length/, /\befl\b/, /^f\b/]);
  const naCell = cellFor(headers, row, [/numerical aperture/, /^na\b/, /\bna\b/]);
  const wdCell = cellFor(headers, row, [/working distance/, /^wd\b/, /\bwd\b/]);
  const diameterCell = cellFor(headers, row, [/diameter/, /\bod\b/, /outer diameter/]);
  const clearApertureCell = cellFor(headers, row, [/clear aperture/, /\bca\b/]);
  const thicknessCell = cellFor(headers, row, [/center thickness/, /\bct\b/, /^tc\b/, /\btc\b/, /\bt\s*c\b/, /thickness/]);
  const radiusCell = cellFor(headers, row, [/radius of curvature/, /\bradius\b/, /\broc\b/, /^r\b/]);
  const r1Cell = cellFor(headers, row, [/r\s*1\b/, /r1\b/]);
  const r2Cell = cellFor(headers, row, [/r\s*2\b/, /r2\b/]);
  const kCell = cellFor(headers, row, [/conic/, /\bk\b/]);
  const materialCell = cellFor(headers, row, [/material/, /substrate/, /glass/]);

  const focalLength = parseNumber(focalCell);
  const na = parseNumber(naCell);
  const workingDistance = parseNumber(wdCell);
  const diameter = diameterCell !== undefined
    ? parseDiameter(diameterCell, headers[row.indexOf(diameterCell)] ?? '')
    : undefined;
  const clearAperture = clearApertureCell !== undefined
    ? parseLength(clearApertureCell, headers[row.indexOf(clearApertureCell)] ?? '')
    : undefined;
  const thickness = parseNumber(thicknessCell);
  if (!sku || typeof focalLength !== 'number' || thickness === undefined) return null;

  const materialText = materialCell ? normalizeGlassName(materialCell) : undefined;
  const { material, ior } = inferMaterial(`${pageText} ${materialText ?? ''}`);
  const coating = inferCoating(pageText);
  const apertureDiameter = diameter ?? clearAperture;
  if (apertureDiameter === undefined) return null;

  let r1 = parseNumber(r1Cell);
  let r2 = parseNumber(r2Cell);
  if (r1 === undefined) r1 = parseNumber(radiusCell);
  const hasExactRadius = typeof r1 === 'number';
  if (r1 === undefined || r1 === null) r1 = (ior - 1) * focalLength;
  if (r2 === undefined || r2 === null) r2 = null;

  const k1 = parseNumber(kCell);
  const a1 = [4, 6, 8, 10, 12, 14]
    .map(power => asphereCoefficient(headers, row, power))
    .filter(value => value !== undefined);
  const hasExactAsphere = typeof k1 === 'number' || a1.length > 0;
  const productPath = page.permalink ?? `/${slug}`;
  const productUrl = `${THORLABS}${productPath.startsWith('/') ? productPath : `/${productPath}`}?pn=${encodeURIComponent(sku)}`;
  const apertureRadius = apertureDiameter / 2;

  return {
    id: `thorlabs:${sku}`,
    vendor: 'thorlabs',
    sku,
    title: `${sku}: ${material} Aspheric Lens, ${diameter ? `Ø${Number(diameter.toFixed(3))} mm` : `CA ${Number(apertureDiameter.toFixed(3))} mm`}, f = ${focalLength} mm${coating ? `, ${coating}` : ''}`,
    productUrl,
    categoryPath: ['Optics', 'Lenses', 'Aspheric Lenses'],
    componentType: 'asphericLens',
    specs: {
      ...(diameter !== undefined ? { diameter: scalarValue(diameter, 'mm') } : {}),
      ...(clearAperture !== undefined ? { clearAperture: scalarValue(clearAperture, 'mm') } : {}),
      effectiveFocalLength: scalarValue(focalLength, 'mm'),
      ...(na !== undefined ? { numericalAperture: scalarValue(na, undefined) } : {}),
      ...(workingDistance !== undefined ? { workingDistance: scalarValue(workingDistance, 'mm') } : {}),
      centerThickness: scalarValue(thickness, 'mm'),
      r1: scalarValue(hasExactRadius ? r1 : `${Number(r1.toFixed(4))} estimated`, 'mm'),
      r2: scalarValue(r2 === null ? 'Infinity' : r2, 'mm'),
      ...(typeof k1 === 'number' ? { k1: scalarValue(k1, undefined) } : {}),
      material: scalarValue(materialText ?? material, undefined),
      ...(coating ? { coating: scalarValue(coating, undefined) } : {}),
    },
    normalized: {
      kind: 'asphericLens',
      focalLengthMm: focalLength,
      apertureRadiusMm: apertureRadius,
      thicknessMm: thickness,
      r1Mm: r1,
      r2Mm: r2 ?? 1e9,
      k1: typeof k1 === 'number' ? k1 : -1,
      k2: 0,
      a1,
      a2: [],
      ior,
      material: materialText ?? material,
      surfaceSource: hasExactAsphere ? 'catalogRow' : 'estimatedFromFocalLength',
    },
    files: catalogFiles(),
    provenance: [{
      source: 'vendorPage',
      url: `${THORLABS}${productPath.startsWith('/') ? productPath : `/${productPath}`}`,
      note: hasExactAsphere
        ? 'Parsed from public Thorlabs GraphQL family-page product tables.'
        : 'Catalog row parsed from public Thorlabs GraphQL family-page product tables; asphere coefficients are not present in the row, so normalized optical geometry is approximate until product Zemax data is imported.',
      retrievedAt: INDEXED_AT,
    }],
    confidence: hasExactAsphere && hasExactRadius ? 'derived' : 'approximate',
    lastIndexed: INDEXED_AT,
  };
}

function makeAchromatPart({ sku, page, slug, row, headers }) {
  const pageText = `${page.name ?? ''} ${page.permalink ?? ''} ${slug}`;
  const diameterCell = cellFor(headers, row, [/diameter/, /\bdia\b/]);
  const focalCell = cellFor(headers, row, [/focal length/, /\befl\b/, /^f\b/]);
  const backFocalCell = cellFor(headers, row, [/back focal/, /\bbfl\b/]);
  const r1Cell = cellFor(headers, row, [/r\s*1\b/, /r1\b/, /radius.*1/]);
  const r2Cell = cellFor(headers, row, [/r\s*2\b/, /r2\b/, /radius.*2/]);
  const r3Cell = cellFor(headers, row, [/r\s*3\b/, /r3\b/, /radius.*3/]);
  const t1Cell = cellFor(headers, row, [/center thickness\s*1/, /\bct\s*1\b/, /\btc\s*1\b/, /\bt\s*c\s*1\b/, /\bt\s*1\b/, /thickness.*1/]);
  const t2Cell = cellFor(headers, row, [/center thickness\s*2/, /\bct\s*2\b/, /\btc\s*2\b/, /\bt\s*c\s*2\b/, /\bt\s*2\b/, /thickness.*2/]);
  const edgeThicknessCell = cellFor(headers, row, [/edge thickness/, /\bet\b/, /^te\b/, /\bte\b/, /\bt\s*e\b/]);
  const glassCell = cellFor(headers, row, [/glass/, /material/]);

  const diameter = diameterCell !== undefined
    ? parseDiameter(diameterCell, headers[row.indexOf(diameterCell)] ?? '')
    : undefined;
  const focalLength = parseNumber(focalCell);
  const backFocalLength = parseNumber(backFocalCell);
  const r1 = parseNumber(r1Cell);
  const r2 = parseNumber(r2Cell);
  const r3 = parseNumber(r3Cell);
  const t1 = parseNumber(t1Cell);
  const t2 = parseNumber(t2Cell);
  const edgeThickness = parseNumber(edgeThicknessCell);
  if (!sku || diameter === undefined || typeof focalLength !== 'number') return null;
  if (typeof r1 !== 'number' || typeof r2 !== 'number' || typeof r3 !== 'number' || t1 === undefined || t2 === undefined) return null;

  const glass = parseGlassPair(glassCell ?? pageText);
  const coating = inferCoating(pageText);
  const mounting = inferMounting(pageText);
  const productPath = page.permalink ?? `/${slug}`;
  const productUrl = `${THORLABS}${productPath.startsWith('/') ? productPath : `/${productPath}`}?pn=${encodeURIComponent(sku)}`;

  return {
    id: `thorlabs:${sku}`,
    vendor: 'thorlabs',
    sku,
    title: `${sku}: Achromatic Doublet, Ø${Number(diameter.toFixed(3))} mm, f = ${focalLength} mm${coating ? `, ${coating}` : ''}`,
    productUrl,
    categoryPath: ['Optics', 'Lenses', 'Achromatic Lenses'],
    componentType: 'achromatDoublet',
    specs: {
      diameter: scalarValue(diameter, 'mm'),
      effectiveFocalLength: scalarValue(focalLength, 'mm'),
      ...(backFocalLength !== undefined ? { backFocalLength: scalarValue(backFocalLength, 'mm') } : {}),
      r1: scalarValue(r1, 'mm'),
      r2: scalarValue(r2, 'mm'),
      r3: scalarValue(r3, 'mm'),
      centerThickness1: scalarValue(t1, 'mm'),
      centerThickness2: scalarValue(t2, 'mm'),
      ...(edgeThickness !== undefined ? { edgeThickness: scalarValue(edgeThickness, 'mm') } : {}),
      ...(glassCell ? { glass: scalarValue(normalizeGlassName(glassCell), undefined) } : {}),
      ...(coating ? { coating: scalarValue(coating, undefined) } : {}),
      mounting: scalarValue(mounting, undefined),
    },
    normalized: {
      kind: 'achromatDoublet',
      focalLengthMm: focalLength,
      apertureRadiusMm: diameter / 2,
      r1Mm: r1,
      r2Mm: r2,
      r3Mm: r3,
      t1Mm: t1,
      t2Mm: t2,
      ior1: glass.ior1 ?? 1.658,
      ior2: glass.ior2 ?? 1.750,
      ...(glass.glass1 ? { glass1: glass.glass1 } : {}),
      ...(glass.glass2 ? { glass2: glass.glass2 } : {}),
    },
    files: catalogFiles(),
    provenance: [{
      source: 'vendorPage',
      url: `${THORLABS}${productPath.startsWith('/') ? productPath : `/${productPath}`}`,
      note: 'Parsed from public Thorlabs GraphQL family-page product tables. Glass indices are reference approximations unless product Zemax data is imported.',
      retrievedAt: INDEXED_AT,
    }],
    confidence: 'derived',
    lastIndexed: INDEXED_AT,
  };
}

function makeObjectivePart({ sku, page, slug, values }) {
  const productPath = page.permalink ?? `/${slug}`;
  const productUrl = `${THORLABS}${productPath.startsWith('/') ? productPath : `/${productPath}`}?pn=${encodeURIComponent(sku)}`;
  const magnification = parseMagnification(values.magnification);
  const numericalAperture = parseNumber(values.numericalAperture);
  const workingDistance = parseNumber(values.workingDistance);
  const parfocalLength = parseNumber(values.parfocalLength);
  const coverGlassRange = parseRangeNumbers(values.coverGlassThickness);
  const coverGlassThickness = coverGlassRange.length === 1 ? coverGlassRange[0] : undefined;
  const coating = cleanText(values.coating);
  const threading = cleanText(values.threading);
  const immersion = immersionFromText(values.immersionMedium ?? '');
  const tubeLensFocal = 200;

  if (!sku || magnification === undefined || numericalAperture === undefined || workingDistance === undefined) return null;

  const specs = {
    magnification: scalarValue(magnification, 'X'),
    numericalAperture: scalarValue(numericalAperture, undefined),
    workingDistance: scalarValue(workingDistance, 'mm'),
    ...(parfocalLength !== undefined ? { parfocalLength: scalarValue(parfocalLength, 'mm') } : {}),
    ...(values.coverGlassThickness ? { coverGlassThickness: scalarValue(cleanText(values.coverGlassThickness), undefined) } : {}),
    ...(values.immersionMedium ? { immersionMedium: scalarValue(cleanText(values.immersionMedium), undefined) } : {}),
    ...(threading ? { threading: scalarValue(threading, undefined) } : {}),
    tubeLensFocal: scalarValue(tubeLensFocal, 'mm'),
    ...(coating ? { coating: scalarValue(coating, undefined) } : {}),
  };

  return {
    id: `thorlabs:${sku}`,
    vendor: 'thorlabs',
    sku,
    title: `${sku}: ${magnification}X Objective, NA ${numericalAperture}, WD ${workingDistance} mm${coating ? `, ${coating}` : ''}`,
    productUrl,
    categoryPath: ['Optics', 'Microscopy Objectives'],
    componentType: 'objective',
    specs,
    normalized: {
      kind: 'objective',
      magnification,
      numericalAperture,
      workingDistanceMm: workingDistance,
      tubeLensFocalMm: tubeLensFocal,
      immersionIndex: immersion.ior,
      immersionMediumKind: immersion.kind,
      ...(parfocalLength !== undefined ? { parfocalLengthMm: parfocalLength } : {}),
      ...(coverGlassThickness !== undefined ? { coverGlassThicknessMm: coverGlassThickness } : {}),
    },
    files: catalogFiles(),
    provenance: [{
      source: 'vendorPage',
      url: `${THORLABS}${productPath.startsWith('/') ? productPath : `/${productPath}`}`,
      note: 'Parsed from public Thorlabs GraphQL objective tables. Objective optical behavior uses the simulator ideal aplanatic objective model with the catalog NA, magnification, working distance, immersion, and tube lens focal length.',
      retrievedAt: INDEXED_AT,
    }],
    confidence: 'derived',
    lastIndexed: INDEXED_AT,
  };
}

function makePrismPart({ sku, page, slug, prismType, material, legLength, width, vertices, specs }) {
  if (!sku || !vertices?.length || width === undefined) return null;
  const productPath = page.permalink ?? `/${slug}`;
  const productUrl = `${THORLABS}${productPath.startsWith('/') ? productPath : `/${productPath}`}?pn=${encodeURIComponent(sku)}`;
  const materialInfo = inferMaterial(material ?? `${page.name ?? ''} ${slug}`);
  const prismTypeLabel = {
    rightAngle: 'Right-Angle Prism',
    wedge: 'Round Wedge Prism',
    equilateral: 'Equilateral Dispersive Prism',
    polygon: 'Prism',
  }[prismType] ?? 'Prism';

  return {
    id: `thorlabs:${sku}`,
    vendor: 'thorlabs',
    sku,
    title: `${sku}: ${materialInfo.material} ${prismTypeLabel}${legLength ? `, L = ${legLength} mm` : ''}`,
    productUrl,
    categoryPath: ['Optics', 'Prisms', prismTypeLabel],
    componentType: 'prism',
    specs: {
      prismType: scalarValue(prismTypeLabel, undefined),
      ...(legLength !== undefined ? { legLength: scalarValue(legLength, 'mm') } : {}),
      width: scalarValue(width, 'mm'),
      material: scalarValue(materialInfo.material, undefined),
      ...specs,
    },
    normalized: {
      kind: 'prism',
      prismType,
      widthMm: width,
      verticesMm: vertices,
      ior: materialInfo.ior,
      material: materialInfo.material,
      ...(legLength !== undefined ? { legLengthMm: legLength } : {}),
      ...(typeof specs.apexAngle?.value === 'number' ? { apexAngleDeg: specs.apexAngle.value } : {}),
      ...(typeof specs.wedgeAngle?.value === 'number' ? { wedgeAngleDeg: specs.wedgeAngle.value } : {}),
      ...(typeof specs.deviationAngle?.value === 'number' ? { deviationAngleDeg: specs.deviationAngle.value } : {}),
    },
    files: catalogFiles(),
    provenance: [{
      source: 'vendorPage',
      url: `${THORLABS}${productPath.startsWith('/') ? productPath : `/${productPath}`}`,
      note: 'Parsed from public Thorlabs GraphQL prism tables. Prism optical behavior uses the simulator polygon prism geometry with catalog dimensions and material index.',
      retrievedAt: INDEXED_AT,
    }],
    confidence: 'derived',
    lastIndexed: INDEXED_AT,
  };
}

function parseSphericalParts(page, slug) {
  const parts = [];
  const shape = inferShape(`${page.name ?? ''} ${page.permalink ?? ''} ${slug}`);
  for (const table of htmlTables(page.content ?? '')) {
    const headers = tableHeaders(table);
    if (!headers.length) continue;
    const normalizedHeaders = headers.map(normalizeHeader).join(' | ');
    if (!/item/.test(normalizedHeaders)) continue;
    if (!/(focal|efl|diopter|radius|r\s*1|r1)/.test(normalizedHeaders)) continue;

    for (const row of tableDataRows(table)) {
      const sku = skuFromRow(headers, row);
      if (!sku) continue;
      if (/^(?:LSB|LSS|LSP|LST)/.test(sku)) continue;
      const part = makeCatalogPart({ sku, page, slug, shape, row, headers });
      if (part) parts.push(part);
    }
  }
  return parts;
}

function parseCylindricalParts(page, slug) {
  const parts = [];
  const shape = inferShape(`${page.name ?? ''} ${page.permalink ?? ''} ${slug}`);
  for (const table of htmlTables(page.content ?? '')) {
    const headers = tableHeaders(table);
    if (!headers.length) continue;
    const normalizedHeaders = headers.map(normalizeHeader).join(' | ');
    if (!/item|part/.test(normalizedHeaders)) continue;
    if (!/(focal|efl|^f\b|\bf\b|radius|\br\b|r\s*1|r1|clear aperture|\bca\b|center thickness|ct|tc)/.test(normalizedHeaders)) continue;

    for (const row of tableDataRows(table)) {
      const sku = skuFromRow(headers, row);
      if (!sku) continue;
      const part = makeCylindricalLensPart({ sku, page, slug, shape, row, headers });
      if (part) parts.push(part);
    }
  }
  return parts;
}

function parseAsphericParts(page, slug) {
  const parts = [];
  for (const table of htmlTables(page.content ?? '')) {
    const headers = tableHeaders(table);
    if (!headers.length) continue;
    const normalizedHeaders = headers.map(normalizeHeader).join(' | ');
    if (!/item|part/.test(normalizedHeaders)) continue;
    if (!/(focal|efl|numerical aperture|\bna\b|working distance|clear aperture|center thickness|ct)/.test(normalizedHeaders)) continue;

    for (const row of tableDataRows(table)) {
      const sku = skuFromRow(headers, row);
      if (!sku) continue;
      const part = makeAsphericLensPart({ sku, page, slug, row, headers });
      if (part) parts.push(part);
    }
  }
  return parts;
}

function parseAchromatParts(page, slug) {
  const parts = [];
  for (const table of htmlTables(page.content ?? '')) {
    const headers = tableHeaders(table);
    if (!headers.length) continue;
    const normalizedHeaders = headers.map(normalizeHeader).join(' | ');
    if (!/item|part/.test(normalizedHeaders)) continue;
    if (!/(focal|efl|^f\b|\bf\b|r\s*1|r1|r\s*2|r2|r\s*3|r3|center thickness|ct|tc)/.test(normalizedHeaders)) continue;

    for (const row of tableDataRows(table)) {
      const sku = skuFromRow(headers, row);
      if (!sku) continue;
      const part = makeAchromatPart({ sku, page, slug, row, headers });
      if (part) parts.push(part);
    }
  }
  return parts;
}

function parseObjectiveParts(page, slug) {
  const parts = [];
  const tables = htmlTables(page.content ?? '');
  for (const table of tables) {
    const { rows } = tableHeaderAndRows(table);
    if (rows.length === 0) continue;
    let lastCoating;
    let lastThreading;

    for (const row of rows) {
      const skuIndex = row.findIndex(cell => /^TL/i.test(objectiveSkuFromCell(cell) ?? ''));
      if (skuIndex < 0) continue;
      const sku = objectiveSkuFromCell(row[skuIndex]);
      if (!sku || !/^TL/i.test(sku)) continue;

      const cells = row.slice(skuIndex + 1).map(cleanText).filter(Boolean);
      const magnificationIndex = cells.findIndex(cell => /\b\d+(?:\.\d+)?\s*(?:x|×)\b/i.test(cell) && !/^\s*M\d/i.test(cell));
      if (magnificationIndex < 0) continue;

      const coating = [...cells.slice(0, magnificationIndex)]
        .reverse()
        .find(cell => /(?:nm|µm|um|-)/i.test(cell)) ?? lastCoating;
      if (coating) lastCoating = coating;

      const magnification = cells[magnificationIndex];
      const numericalAperture = cells[magnificationIndex + 1];
      const workingDistance = cells[magnificationIndex + 2];
      const parfocalLength = cells[magnificationIndex + 3];
      const coverGlassThickness = cells[magnificationIndex + 4];
      const tail = cells.slice(magnificationIndex + 5);
      const immersionMedium = tail.find(cell => /dry|water|aqueous|oil|silicone|salt/i.test(cell));
      const threading = tail.find(cell => /(?:M\d|RMS|thread)/i.test(cell)) ?? lastThreading;
      if (threading) lastThreading = threading;

      const part = makeObjectivePart({
        sku,
        page,
        slug,
        values: {
          coating,
          magnification,
          numericalAperture,
          workingDistance,
          parfocalLength,
          coverGlassThickness,
          immersionMedium,
          threading,
        },
      });
      if (part) parts.push(part);
    }
  }

  const knownIds = new Set(parts.map(part => part.id));
  for (const table of tables) {
    for (const part of parseTransposedObjectiveParts(page, slug, table)) {
      if (!knownIds.has(part.id)) {
        knownIds.add(part.id);
        parts.push(part);
      }
    }
  }

  return parts;
}

function parseTransposedObjectiveParts(page, slug, table) {
  const parts = [];
  const rows = tableDataRows(table);
  const itemIndex = rows.findIndex(row => {
    const label = normalizeHeader(row[0] ?? '');
    return /item|part/.test(label) && row.slice(1).some(cell => /^TL/i.test(objectiveSkuFromCell(cell) ?? ''));
  });
  if (itemIndex < 0) return parts;

  const skus = rows[itemIndex].slice(1).map(cell => objectiveSkuFromCell(cell)).filter(Boolean);
  if (skus.length < 2) return parts;

  const valuesBySku = new Map(skus.map(sku => [sku, {}]));
  for (const row of rows.slice(itemIndex + 1)) {
    const label = normalizeHeader(row[0] ?? '');
    if (!label) continue;
    for (let i = 0; i < skus.length; i++) {
      const sku = skus[i];
      const values = valuesBySku.get(sku);
      const value = row[i + 1];
      if (!values || !value) continue;
      if (/magnification/.test(label)) values.magnification = value;
      else if (/numerical aperture|\bna\b/.test(label)) values.numericalAperture = value;
      else if (/working distance|\bwd\b/.test(label)) values.workingDistance = value;
      else if (/parfocal/.test(label)) values.parfocalLength = value;
      else if (/cover\s*glass|coverslip/.test(label)) values.coverGlassThickness = value;
      else if (/immersion/.test(label)) values.immersionMedium = value;
      else if (/thread/.test(label)) values.threading = value;
      else if (/coating/.test(label) && /(?:nm|µm|um|-)/i.test(value)) values.coating = value;
    }
  }

  for (const [sku, values] of valuesBySku.entries()) {
    const part = makeObjectivePart({ sku, page, slug, values });
    if (part) parts.push(part);
  }
  return parts;
}

function normalizeRightAnglePrismRow(row, state) {
  const sku = skuFromCell(row[0]);
  if (!sku) {
    const material = knownMaterialFromText(row.join(' '));
    if (material) state.material = material;
    return null;
  }
  let material = state.material;
  let legLength = state.legLength;
  let xLength = state.xLength;
  let angleTolerance;
  let dimensionalTolerance;
  let coating;

  const secondMaterial = knownMaterialFromText(row[1]);
  const secondLength = secondMaterial ? undefined : parsePrismLengthCell(row[1]);
  const thirdLength = parsePrismLengthCell(row[2]);
  if (row.length >= 6 && (secondMaterial || secondLength === undefined) && thirdLength !== undefined) {
    material = secondMaterial ?? row[1];
    legLength = thirdLength;
    xLength = parsePrismLengthCell(row[3]);
    angleTolerance = row[4];
    dimensionalTolerance = row[5];
    coating = row[6];
  } else if (row.length >= 5 && secondLength !== undefined) {
    legLength = secondLength;
    xLength = thirdLength;
    angleTolerance = row[3];
    dimensionalTolerance = row[4];
    coating = row[5];
  } else {
    angleTolerance = row[1];
    dimensionalTolerance = row[2];
    coating = row[3];
  }

  material = materialFromPrismSku(sku, knownMaterialFromText(material) ?? material);
  state.material = material;
  state.legLength = legLength;
  state.xLength = xLength;
  if (!material || legLength === undefined) return null;
  return { sku, material, legLength, xLength, angleTolerance, dimensionalTolerance, coating };
}

function parseRightAnglePrismParts(page, slug) {
  const parts = [];
  for (const table of htmlTables(page.content ?? '')) {
    const { rows } = tableHeaderAndRows(table);
    const state = {};
    for (const row of rows) {
      const parsed = normalizeRightAnglePrismRow(row, state);
      if (!parsed) continue;
      const vertices = rightAngleVertices(parsed.legLength);
      const part = makePrismPart({
        sku: parsed.sku,
        page,
        slug,
        prismType: 'rightAngle',
        material: parsed.material,
        legLength: parsed.legLength,
        width: parsed.legLength,
        vertices,
        specs: {
          ...(parsed.xLength !== undefined ? { hypotenuseLength: scalarValue(parsed.xLength, 'mm') } : {}),
          apexAngle: scalarValue(90, 'deg'),
          ...(parsed.angleTolerance ? { angleTolerance: scalarValue(cleanText(parsed.angleTolerance), undefined) } : {}),
          ...(parsed.dimensionalTolerance ? { dimensionalTolerance: scalarValue(cleanText(parsed.dimensionalTolerance), undefined) } : {}),
          ...(parsed.coating ? { coating: scalarValue(cleanText(parsed.coating), undefined) } : {}),
        },
      });
      if (part) parts.push(part);
    }
  }
  return parts;
}

function parseWedgePrismParts(page, slug) {
  const parts = [];
  const diameter = 25.4;
  const thinEdge = 3.0;
  for (const table of htmlTables(page.content ?? '')) {
    const { headers, rows } = tableHeaderAndRows(table);
    if (!headers.length) continue;
    const normalizedHeaders = headers.map(normalizeHeader).join(' | ');
    if (!/item/.test(normalizedHeaders) || !/wedge angle|angular deviation|thickness/.test(normalizedHeaders)) continue;

    for (const row of rows) {
      const sku = skuFromRow(headers, row);
      if (!sku) continue;
      const deviation = parseAngleDegrees(cellFor(headers, row, [/angular deviation/, /deviation/]));
      const thickness = parseNumber(cellFor(headers, row, [/thickness/]));
      const wedgeAngle = parseAngleDegrees(cellFor(headers, row, [/wedge angle/]));
      const power = parseNumber(cellFor(headers, row, [/power/]));
      if (thickness === undefined) continue;
      const part = makePrismPart({
        sku,
        page,
        slug,
        prismType: 'wedge',
        material: 'N-BK7',
        width: diameter,
        vertices: wedgeVertices(diameter, thinEdge, thickness),
        specs: {
          diameter: scalarValue(diameter, 'mm'),
          thinEdge: scalarValue(thinEdge, 'mm'),
          thickness: scalarValue(thickness, 'mm'),
          ...(wedgeAngle !== undefined ? { wedgeAngle: scalarValue(wedgeAngle, 'deg') } : {}),
          ...(deviation !== undefined ? { deviationAngle: scalarValue(deviation, 'deg') } : {}),
          ...(power !== undefined ? { power: scalarValue(power, 'diopter') } : {}),
        },
      });
      if (part) parts.push(part);
    }
  }
  return parts;
}

function parseEquilateralPrismParts(page, slug) {
  const parts = [];
  for (const table of htmlTables(page.content ?? '')) {
    const { headers, rows } = tableHeaderAndRows(table);
    if (!headers.length) continue;
    const normalizedHeaders = headers.map(normalizeHeader).join(' | ');
    if (!/item/.test(normalizedHeaders) || !/material/.test(normalizedHeaders) || !/minimum angle/.test(normalizedHeaders)) continue;

    let lastMaterial;
    let lastDeviation;
    let lastVd;
    for (const row of rows) {
      const sku = skuFromRow(headers, row);
      if (!sku) continue;
      const side = parseLength(row[1]);
      let material = row[2];
      let deviation = row[3];
      let vd = row[4];
      if (!material || parseAngleDegrees(material) !== undefined || /lambda|λ/i.test(material)) {
        material = lastMaterial;
        deviation = lastDeviation;
        vd = lastVd;
      } else {
        lastMaterial = material;
        lastDeviation = deviation;
        lastVd = vd;
      }
      if (side === undefined || !material) continue;
      const deviationAngle = parseAngleDegrees(deviation);
      const abbeNumber = parseNumber(vd);
      const part = makePrismPart({
        sku,
        page,
        slug,
        prismType: 'equilateral',
        material,
        legLength: side,
        width: side,
        vertices: equilateralVertices(side),
        specs: {
          apexAngle: scalarValue(60, 'deg'),
          ...(deviationAngle !== undefined ? { minimumDeviationAngle: scalarValue(deviationAngle, 'deg') } : {}),
          ...(abbeNumber !== undefined ? { abbeNumber: scalarValue(abbeNumber, undefined) } : {}),
        },
      });
      if (part) parts.push(part);
    }
  }
  return parts;
}

function parsePrismParts(page, slug) {
  if (/right-angle-prisms/.test(slug)) return parseRightAnglePrismParts(page, slug);
  if (/round-wedge-prisms/.test(slug)) return parseWedgePrismParts(page, slug);
  if (/equilateral-dispersive-prisms/.test(slug)) return parseEquilateralPrismParts(page, slug);
  return [];
}

function parsePageParts(page, slug) {
  const componentType = inferComponentType(`${page.name ?? ''} ${page.permalink ?? ''} ${slug}`);
  if (componentType === 'objective') return parseObjectiveParts(page, slug);
  if (componentType === 'prism') return parsePrismParts(page, slug);
  if (componentType === 'achromatDoublet') return parseAchromatParts(page, slug);
  if (componentType === 'cylindricalLens') return parseCylindricalParts(page, slug);
  if (componentType === 'asphericLens') return parseAsphericParts(page, slug);
  return parseSphericalParts(page, slug);
}

function normalizeSlug(raw) {
  if (!raw) return null;
  let value = decodeEntities(raw).trim();
  if (!value || value === '#') return null;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (!/thorlabs\./i.test(url.hostname)) return null;
      value = url.pathname;
    } catch {
      return null;
    }
  }
  value = value.replace(/^\/(?:en|zh|ja)\//i, '/');
  value = value.replace(/^\/+/, '').split(/[?#]/)[0].replace(/\/+$/, '');
  if (!value) return null;
  if (/\.(?:webp|png|jpg|jpeg|gif|svg|pdf|dxf|step|stp|sldprt|zar|zmx|zip)$/i.test(value)) return null;
  return value.toLowerCase();
}

function shouldCrawlSlug(slug) {
  if (!slug) return false;
  if (NON_LENS_CATALOG_SLUGS.has(slug)) return true;
  if (/^(?:optics|optical-elements|optical-lenses|main-visual-navigation)$/.test(slug)) return false;
  if (/globalassets|contentassets|catalogpages|software-pages|item\//.test(slug)) return false;
  if (/(?:objective|mirror|beamsplitter|polarizer|waveplate|filter|prism|cleaning|handling|adapter|retaining|lens-tube|acylindrical)/.test(slug)) return false;
  if (/(?:^|-)mounts?(?:-|$)/.test(slug)) return false;
  if (/(?:kit|kits)$/.test(slug)) return false;
  return /(?:spherical|singlet|plano-convex|bi-convex|plano-concave|bi-concave|meniscus|best-form|hemispherical|cylindrical|aspheric|asphere|achromatic|doublet|lens|lenses)/.test(slug);
}

function extractLinkedSlugs(content) {
  const slugs = new Set();
  for (const match of String(content).matchAll(/"(?:url|externalURL)"\s*:\s*"([^"]+)"/g)) {
    const slug = normalizeSlug(match[1]);
    if (shouldCrawlSlug(slug)) slugs.add(slug);
  }
  for (const match of String(content).matchAll(/href=\\"([^"]+)\\"|href="([^"]+)"/g)) {
    const slug = normalizeSlug(match[1] ?? match[2]);
    if (shouldCrawlSlug(slug)) slugs.add(slug);
  }
  return [...slugs];
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

async function fetchPage(slug) {
  const info = await slugInfo(slug);
  if (!info?.objectId || info.objectType !== 'ContentFile') return null;
  const data = await graphql(
    `query Page($id:String!,$cultureName:String,$storeId:String!){
      page(id:$id,cultureName:$cultureName,storeId:$storeId){ id name content permalink }
    }`,
    { id: info.objectId, cultureName: CULTURE, storeId: STORE_ID },
  );
  const page = data.page ?? null;
  if (!page?.content) return page;
  try {
    const content = JSON.parse(page.content);
    return {
      ...page,
      name: content.title || content.name || page.name,
      permalink: content.permalink || content.url || page.permalink,
    };
  } catch {
    return page;
  }
}

async function fetchProductAssets(sku) {
  const info = await slugInfo(`item/${sku}`);
  if (!info?.objectId || info.objectType !== 'CatalogProduct') return [];
  const data = await graphql(
    `query ProductAssets($storeId:String!,$currencyCode:String!,$cultureName:String,$id:String!){
      product(storeId:$storeId,id:$id,currencyCode:$currencyCode,cultureName:$cultureName){
        code
        id
        assets { id name url group description optiUrl mimeType }
      }
    }`,
    { storeId: STORE_ID, currencyCode: 'USD', cultureName: CULTURE, id: info.objectId },
  );
  return data.product?.assets ?? [];
}

async function crawlLensPages(startSlugs) {
  const maxDepth = Number(argValue('--max-depth', '4'));
  const queue = startSlugs.map(slug => ({ slug, depth: 0 }));
  const seen = new Set();
  const pages = new Map();
  const diagnostics = [];

  while (queue.length) {
    const { slug, depth } = queue.shift();
    if (seen.has(slug) || !shouldCrawlSlug(slug)) continue;
    seen.add(slug);

    try {
      const page = await fetchPage(slug);
      if (!page?.content) {
        diagnostics.push({ slug, depth, skipped: 'no page content' });
        continue;
      }
      pages.set(slug, page);
      const parts = parsePageParts(page, slug);
      diagnostics.push({ slug, depth, title: page.name, parts: parts.length });

      if (depth < maxDepth) {
        for (const linked of extractLinkedSlugs(page.content)) {
          if (!seen.has(linked)) queue.push({ slug: linked, depth: depth + 1 });
        }
      }
    } catch (error) {
      diagnostics.push({ slug, depth, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { pages, diagnostics };
}

function uniqueParts(parts) {
  const byId = new Map();
  for (const part of parts) {
    const existing = byId.get(part.id);
    if (!existing) {
      byId.set(part.id, part);
      continue;
    }
    const existingMounted = existing.provenance[0]?.url?.includes('/mounted-') ?? false;
    const nextMounted = part.provenance[0]?.url?.includes('/mounted-') ?? false;
    if (existingMounted && !nextMounted) byId.set(part.id, part);
  }
  return [...byId.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

async function main() {
  const startSlugs = argValues('--slug').map(normalizeSlug).filter(Boolean);
  const outPath = argValue('--out', 'src/catalog/thorlabsGeneratedCatalog.ts');
  const format = argValue('--format', outPath.endsWith('.json') ? 'json' : 'ts');
  const allowEmpty = hasFlag('--allow-empty');
  const withSupportFiles = hasFlag('--with-support-files') || hasFlag('--support-files');
  const supportCache = argValue('--support-cache', '.cache/thorlabs-support-cache');
  const supportLimit = Number(argValue('--support-limit', '0'));
  const supportConcurrency = Number(argValue('--support-concurrency', '8'));
  const supportSkus = new Set(argValues('--support-sku').map(value => value.toUpperCase()));
  const starts = startSlugs.length > 0 ? startSlugs : DEFAULT_START_SLUGS;

  const { pages, diagnostics } = await crawlLensPages(starts);
  let allParts = uniqueParts([...pages.entries()].flatMap(([slug, page]) => parsePageParts(page, slug)));
  let supportDiagnostics = [];

  if (allParts.length === 0 && !allowEmpty) {
    console.error(JSON.stringify({ diagnostics }, null, 2));
    throw new Error('Importer found 0 catalog parts; refusing to overwrite the generated catalog. Pass --allow-empty only when intentionally clearing it.');
  }

  if (withSupportFiles && allParts.length > 0) {
    const enriched = await enrichPartsWithSupportFiles(allParts, {
      cacheDir: supportCache,
      limit: supportLimit,
      concurrency: supportConcurrency,
      skus: supportSkus,
    });
    allParts = enriched.parts;
    supportDiagnostics = enriched.diagnostics;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    vendor: 'thorlabs',
    source: withSupportFiles
      ? 'public Thorlabs GraphQL family pages plus product support optical prescriptions'
      : 'public Thorlabs GraphQL family pages under supported optics categories',
    starts,
    diagnostics,
    supportDiagnostics,
    parts: allParts,
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  if (format === 'json') {
    await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } else {
    const catalogJson = JSON.stringify(allParts);
    const catalogChunks = catalogJson.match(/.{1,24000}/g) ?? [''];
    const moduleText = [
      "import type { CatalogPart } from './types';",
      '',
      '// Generated by scripts/catalog/import-thorlabs-lenses.mjs.',
      '// Source: public Thorlabs GraphQL family pages under supported optics categories.',
      '// Keep this as parsed JSON instead of an array literal so TypeScript does not infer',
      '// a giant union across every generated catalog row.',
      'const THORLABS_GENERATED_CATALOG_JSON = [',
      ...catalogChunks.map(chunk => `  ${JSON.stringify(chunk)},`),
      "].join('');",
      '',
      'export const THORLABS_GENERATED_CATALOG = JSON.parse(THORLABS_GENERATED_CATALOG_JSON) as CatalogPart[];',
      '',
    ].join('\n');
    await writeFile(outPath, moduleText, 'utf8');
  }

  console.log(`Visited ${pages.size} pages.`);
  if (withSupportFiles) {
    const exact = supportDiagnostics.filter(item => item.status === 'exact').length;
    console.log(`Imported exact prescriptions for ${exact}/${supportDiagnostics.length} checked catalog parts.`);
  }
  console.log(`Wrote ${allParts.length} optics catalog parts to ${outPath}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
