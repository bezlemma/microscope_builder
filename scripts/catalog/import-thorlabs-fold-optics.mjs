#!/usr/bin/env bun
/**
 * Bulk Thorlabs fold-optics catalog importer.
 *
 * Parses mirror, curved mirror, beamsplitter, polarizing beamsplitter,
 * dichroic, and spectral filter family pages from the same public GraphQL API
 * and public family pages used by thorlabs.com.
 * Product assets are optional but recommended because they attach STEP/CAD
 * files that the mechanical visual-asset pipeline can convert lazily/offline.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const THORLABS = 'https://www.thorlabs.com';
const GRAPHQL = `${THORLABS}/graphql`;
const STORE_ID = 'Thorlabs-Website';
const CULTURE = 'en-US';
const USER_ID = 'Anonymous';
const COUNTRY = 'USA';
const INDEXED_AT = new Date().toISOString().slice(0, 10);

const SUPPORT_FILE_EXTENSIONS = new Set([
  'zmx', 'zemax', 'seq', 'len', 'dat', 'txt', 'csv', 'tsv', 'json',
  'zos', 'zar', 'zip', 'step', 'stp', 'iges', 'igs', 'sat', 'sldprt',
  'prt', 'x_t', 'zof', 'pdf', 'dxf',
]);

const DEFAULT_START_SLUGS = [
  'economy-front-surface-mirrors',
  'protected-silver-mirrors',
  'fused-silica-broadband-dielectric-mirrors',
  '30-mm-cage-cube-mounted-turning-prism-mirrors',
  '16-mm-cage-cube-mounted-turning-prism-mirrors',
  'concave-mirrors-protected-silver-450-nm---20-m',
  'concave-mirrors-protected-gold-800-nm---20-m',
  'concave-mirrors-nir-dielectric-coating-750---1100-nm-back-side-polished',
  'broadband-polarizing-beamsplitter-cubes',
  'high-power-laser-line-polarizing-beamsplitter-cubes',
  'high-power-laser-line-polarizing-beamsplitter-cubes-mounted',
  'non-polarizing-plate-beamsplitters',
  'non-polarizing-beamsplitter-cubes',
  'non-polarizing-beamsplitter-cubes-in-30-mm-cage-cubes',
  'shortpass-dichroic-mirrors-beamsplitters',
  'longpass-dichroic-mirrorsbeamsplitters',
  'hot-and-cold-mirrors-uv-fused-silica-substrate',
];

const DEFAULT_FILTER_PAGE_URLS = [
  'hard-coated-uvvis-bandpass-filters',
  'hard-coated-nir-bandpass-filters',
  'hard-coated-edgepass-filters',
  'ir-bandpass-filters-1.75---12.00-m-central-wavelength',
  'wedged-hard-coated-bandpass-filters',
  'hard-coated-bandpass-filters-for-machine-vision-lenses',
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
  return cleanText(value).toLowerCase().replace(/[_{}]/g, '').replace(/\s+/g, ' ').trim();
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

function parseNumber(value) {
  const text = cleanText(value);
  if (!text || /^(?:n\/a|na|-|—)$/i.test(text)) return undefined;
  if (/inf|∞/i.test(text)) return undefined;
  return firstNumber(text);
}

function parseLength(value, header = '') {
  const text = cleanText(value);
  if (!text) return undefined;
  const metric = text.match(/([+-]?\d+(?:\.\d+)?)\s*mm\b/i);
  if (metric) return Number(metric[1]);
  const measureText = text.replace(/\bS\s*[12]\s*:/gi, ' ');
  const fraction = measureText.match(/(\d+)\s*\/\s*(\d+)\s*"/);
  if (fraction) return 25.4 * Number(fraction[1]) / Number(fraction[2]);
  const inch = measureText.match(/([+-]?\d+(?:\.\d+)?)\s*"/);
  if (inch) return Number(inch[1]) * 25.4;
  const number = firstNumber(measureText);
  if (number === undefined) return undefined;
  if (/"|inch/i.test(measureText) && !/mm/i.test(measureText)) return number * 25.4;
  if (!/\(mm\)|mm/i.test(header) && number > 0 && number <= 4 && /(?:diameter|width|height|length|aperture|size)/i.test(header)) {
    return number * 25.4;
  }
  return number;
}

function parseDimensionSet(value, header = '') {
  const text = cleanText(value);
  if (!text) return {};
  const metricValues = [...text.matchAll(/([+-]?\d+(?:\.\d+)?)\s*mm\b/gi)]
    .map(match => Number(match[1]))
    .filter(value => Number.isFinite(value) && value > 0);
  if (metricValues.length > 0) {
    if (/ø|diameter|dia\b/i.test(text + header) && metricValues[0]) return { diameter: metricValues[0] };
    if (metricValues.length >= 2 && /[x×]/i.test(text)) return { width: metricValues[0], height: metricValues[1], depth: metricValues[2] };
    return { diameter: metricValues[0], width: metricValues[0], height: metricValues[0] };
  }
  const fraction = text.match(/(\d+)\s*\/\s*(\d+)\s*"/);
  if (fraction && !/[x×]/i.test(text)) {
    const length = 25.4 * Number(fraction[1]) / Number(fraction[2]);
    return { diameter: length, width: length, height: length };
  }
  const numbers = allNumbers(text);
  if (numbers.length === 0) return {};
  const scale = /"|inch/i.test(text) && !/mm/i.test(text + header) ? 25.4 : 1;
  const values = numbers.map(value => value * scale);
  if (values.some(value => value <= 0)) return {};
  if (/ø|diameter|dia\b/i.test(text + header) && values[0]) return { diameter: values[0] };
  if (values.length >= 2 && /[x×]/i.test(text)) {
    return { width: values[0], height: values[1], depth: values[2] };
  }
  return { diameter: values[0], width: values[0], height: values[0] };
}

function parseDiameter(value, header = '') {
  const dims = parseDimensionSet(value, header);
  return dims.diameter ?? dims.width ?? dims.height;
}

function parseWavelengthNm(value) {
  const text = cleanText(value);
  if (!text) return undefined;
  const explicit = text.match(/([+-]?\d+(?:\.\d+)?)\s*(nm|µm|um)\b/i);
  if (explicit) {
    const number = Number(explicit[1]);
    if (!Number.isFinite(number)) return undefined;
    return /^(?:µm|um)$/i.test(explicit[2]) ? number * 1000 : number;
  }
  return parseNumber(text);
}

function skuFromCell(value) {
  const text = cleanText(value).replace(/\s+/g, '');
  const match = text.match(/\b(?:[A-Z]{1,8}\d[A-Z0-9]*(?:-[A-Z0-9]+)+|[A-Z]{1,8}\d{2,6}[A-Z0-9]*(?:-[A-Z0-9]+)*|CM1-BS\d{3,4}|CM1-PBS\d{2,4}(?:-[A-Z0-9]+)*|DMSP\d{3,4}[A-Z]?|DMLP\d{3,4}[A-Z]?|DMBP\d{3,4}[A-Z]?|PBS\d{2,4}(?:-[A-Z0-9]+)*|BS[A-Z0-9-]{2,})\b/i);
  return match ? match[0].toUpperCase() : null;
}

function htmlTables(html) {
  return [...String(html).matchAll(/<table[\s\S]*?<\/table>/gi)].map(match => match[0]);
}

function htmlRows(html) {
  return [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(match => match[0]);
}

function parseCellSpan(attributes, name) {
  const match = String(attributes).match(new RegExp(`\\b${name}\\s*=\\s*\\\\?["']?(\\d+)`, 'i'));
  const span = match ? Number(match[1]) : 1;
  return Number.isFinite(span) && span > 0 ? span : 1;
}

function rowCellEntries(rowHtml, tagPattern = 't[dh]') {
  return [...rowHtml.matchAll(new RegExp(`<(${tagPattern})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`, 'gi'))]
    .map(match => ({
      text: cleanText(match[3]),
      rowspan: parseCellSpan(match[2], 'rowspan'),
      colspan: parseCellSpan(match[2], 'colspan'),
    }))
    .filter(entry => entry.text);
}

function rowCells(rowHtml, tagPattern = 't[dh]') {
  return rowCellEntries(rowHtml, tagPattern).map(entry => entry.text);
}

function tableDataRows(tableHtml) {
  const active = [];
  const rows = [];

  for (const rowHtml of htmlRows(tableHtml)) {
    const cells = rowCellEntries(rowHtml, 't[dh]');
    if (cells.length === 0) continue;

    const row = [];
    let column = 0;
    const fillActiveAtCurrentColumn = () => {
      while (active[column]) {
        row[column] = active[column].text;
        active[column].remaining--;
        if (active[column].remaining <= 0) delete active[column];
        column++;
      }
    };

    for (const cell of cells) {
      fillActiveAtCurrentColumn();
      for (let offset = 0; offset < cell.colspan; offset++) {
        row[column + offset] = cell.text;
        if (cell.rowspan > 1) active[column + offset] = { text: cell.text, remaining: cell.rowspan - 1 };
      }
      column += cell.colspan;
    }

    while (column < active.length) {
      if (active[column]) {
        row[column] = active[column].text;
        active[column].remaining--;
        if (active[column].remaining <= 0) delete active[column];
      }
      column++;
    }

    rows.push(row.map(cell => cell ?? '').filter(Boolean));
  }

  return rows.filter(cells => cells.length > 0);
}

function tableHeaderAndRows(tableHtml) {
  const rows = tableDataRows(tableHtml);
  const headerIndex = rows.findIndex(cells => {
    const normalized = cells.map(normalizeHeader).join(' | ');
    return /(?:^| \| )(?:item|part)\s*#?(?: \||$)/.test(normalized)
      || (/(?:item|part)/.test(normalized) && /(?:diameter|size|thickness|wavelength|ratio|reflect|transmission|focal|radius)/.test(normalized));
  });
  if (headerIndex < 0) return { headers: rows[0] ?? [], rows: rows.slice(1), common: {} };
  const common = {};
  for (const row of rows.slice(0, headerIndex)) {
    if (row.length < 2) continue;
    const key = normalizeHeader(row[0]);
    if (!key || /^(?:specifications|table|image|click)/.test(key)) continue;
    common[key] = row[1];
  }
  return { headers: rows[headerIndex], rows: rows.slice(headerIndex + 1), common };
}

function rowObject(headers, row) {
  const values = {};
  for (let index = 0; index < Math.min(headers.length, row.length); index++) {
    const header = normalizeHeader(headers[index]);
    if (header) values[header] = row[index];
  }
  return values;
}

function transposedTableRows(tableHtml) {
  const rows = tableDataRows(tableHtml);
  if (rows.length < 2) return [];
  const first = rows[0].map(cleanText);
  if (!/(?:item|part)\s*#?/i.test(first[0] ?? '')) return [];
  const skus = first.slice(1).map(skuFromCell);
  if (skus.filter(Boolean).length === 0) return [];

  return skus.map((sku, offset) => {
    if (!sku) return null;
    const values = { 'item #': sku };
    for (const row of rows.slice(1)) {
      const key = normalizeHeader(row[0] ?? '');
      if (!key) continue;
      values[key] = row[offset + 1] ?? row[1] ?? '';
    }
    return values;
  }).filter(Boolean);
}

function tableRowsAsObjects(tableHtml) {
  const transposed = transposedTableRows(tableHtml);
  if (transposed.length > 0) return transposed;
  const { headers, rows, common } = tableHeaderAndRows(tableHtml);
  if (headers.length === 0) return [];
  return rows
    .map(row => ({ ...common, ...rowObject(headers, row) }))
    .filter(values => skuFromCell(values['item #'] ?? values['part #'] ?? values.item ?? values.part));
}

function findValue(values, patterns) {
  for (const [key, value] of Object.entries(values)) {
    if (patterns.some(pattern => pattern.test(key))) return value;
  }
  return undefined;
}

function scalarValue(value, unit, source = 'vendorPage') {
  return value === undefined ? undefined : { value, ...(unit ? { unit } : {}), source };
}

function inferCoating(text) {
  const clean = text.replace(/\s+/g, ' ');
  if (/protected silver|silver-coated/i.test(clean)) return 'Protected Silver';
  if (/protected gold|gold-coated/i.test(clean)) return 'Protected Gold';
  if (/protected aluminum|aluminum-coated/i.test(clean)) return 'Protected Aluminum';
  if (/uv[-\s]?enhanced aluminum/i.test(clean)) return 'UV-Enhanced Aluminum';
  if (/broadband dielectric|dielectric/i.test(clean)) return 'Dielectric';
  const range = clean.match(/\b(?:[0-9.]+\s*(?:-|to)\s*[0-9.]+\s*(?:nm|µm|um))\b/i);
  return range ? range[0].trim() : undefined;
}

function inferMounting(text) {
  if (/\bunmounted\b/i.test(text)) return 'Unmounted';
  if (/\bmounted|cage cube|housing|threaded|sm1|cased\b/i.test(text)) return 'Mounted';
  return 'Unmounted';
}

function inferSubstrate(text) {
  if (/n[-\s]?bk7|bk7/i.test(text)) return 'N-BK7';
  if (/uv fused silica|uvfs|fused silica/i.test(text)) return 'UV Fused Silica';
  if (/n[-\s]?sf1|sf1/i.test(text)) return 'N-SF1';
  if (/n[-\s]?sf2|sf2/i.test(text)) return 'N-SF2';
  if (/caf\s*2|calcium fluoride/i.test(text)) return 'CaF2';
  if (/znse|zinc selenide/i.test(text)) return 'ZnSe';
  return undefined;
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
  if (['zmx', 'zemax', 'zar', 'zos', 'zof', 'seq', 'len', 'dat'].includes(extension) || /zemax|opticstudio|code\s*v|oslo/i.test(label)) {
    return 'opticalPrescription';
  }
  const kind = supportFileKind(url);
  if (kind === 'step' || kind === 'solidworks') return 'mechanicalModel';
  if (kind === 'pdf') return 'datasheet';
  if (kind === 'dxf') return 'drawing';
  return undefined;
}

function normalizeSupportUrl(raw, baseUrl = THORLABS) {
  const decoded = decodeEntities(String(raw)).replace(/\\u0026/gi, '&').replace(/\\\//g, '/').replace(/^['"]|['"]$/g, '');
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

function supportFileFromAsset(asset) {
  const url = asset.optiUrl || asset.url;
  if (!url) return null;
  const normalized = normalizeSupportUrl(url);
  if (!normalized) return null;
  const label = `${asset.group ?? ''} ${asset.description ?? ''} ${asset.name ?? ''}`;
  return {
    url: normalized,
    kind: supportFileKind(normalized),
    role: supportFileRole(normalized, label),
  };
}

function dedupeFiles(files) {
  const byKey = new Map();
  for (const file of files.filter(Boolean)) {
    byKey.set(`${file.kind}:${file.role ?? ''}:${file.url}`, file);
  }
  return [...byKey.values()];
}

function normalizeSlug(raw) {
  if (!raw) return null;
  let value = decodeEntities(raw).trim();
  if (!value || value === '#') return null;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (!/thorlabs\./i.test(url.hostname)) return null;
      if (/\/newgrouppage9\.cfm$/i.test(url.pathname) && url.searchParams.get('objectgroup_id')) {
        value = `${url.pathname}?objectgroup_id=${url.searchParams.get('objectgroup_id')}`;
      } else {
        value = url.pathname;
      }
    } catch {
      return null;
    }
  }
  value = value.replace(/^\/(?:en|zh|ja)\//i, '/');
  if (/newgrouppage9\.cfm\?objectgroup_id=\d+/i.test(value)) {
    value = value.replace(/^\/+/, '');
  } else {
    value = value.replace(/^\/+/, '').split(/[?#]/)[0].replace(/\/+$/, '');
  }
  if (!value) return null;
  if (/\.(?:webp|png|jpg|jpeg|gif|svg|pdf|dxf|step|stp|sldprt|zar|zmx|zip)$/i.test(value)) return null;
  return value.toLowerCase();
}

function shouldCrawlSlug(slug) {
  if (!slug) return false;
  if (/newgrouppage9\.cfm\?objectgroup_id=\d+/i.test(slug)) return true;
  if (/globalassets|contentassets|catalogpages|software-pages|item\//.test(slug)) return false;
  if (/(?:cleaning|handling|adapter|retaining|lens-tube|mounts?|software|guide|kit|kits)(?:-|$)/.test(slug)) return false;
  if (/fluorescence-imaging-filters|dichroic-color-filters/.test(slug)) return false;
  return /(?:mirror|beamsplitter|beam-splitter|dichroic|filter|edgepass|bandpass|longpass|shortpass)/.test(slug);
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
  if (/newgrouppage9\.cfm\?objectgroup_id=\d+/i.test(slug)) {
    const url = `${THORLABS}/${slug.replace(/^\/+/, '')}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
    const html = await response.text();
    const title = cleanText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? slug);
    return {
      id: slug,
      name: title,
      content: html,
      permalink: `/${slug}`,
    };
  }

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
    `query ProductAssets($storeId:String!,$currencyCode:String!,$cultureName:String!,$id:String!){
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

function inferType(sku, pageText, values) {
  const text = `${sku} ${pageText} ${Object.values(values).join(' ')}`.toLowerCase();
  if (
    /^f(?:bh|lh|esh|elh)/i.test(sku)
    || /^mvf/i.test(sku)
    || /fluorescence imaging filters/.test(text)
    || /bandpass filter|edgepass filter|longpass filter|shortpass filter|spectral filter/.test(text)
  ) return 'filter';
  if (/^dm(?:sp|lp|bp)/i.test(sku) || /dichroic|hot and cold mirror/.test(text)) return 'dichroic';
  if (/non[-\s]?polarizing/.test(text)) return 'beamSplitter';
  if (/^pbs/i.test(sku) || /polarizing beamsplitter/.test(text) || /^cm1-pbs/i.test(sku)) return 'polarizingBeamSplitter';
  if (/beamsplitter|beam splitter|^bs/i.test(text) || /^cm1-bs/i.test(sku)) return 'beamSplitter';
  if (/^cm\d/i.test(sku) || /concave mirror|radius of curvature|focal length/.test(text)) return 'curvedMirror';
  return 'mirror';
}

function filterKindFor(sku, pageText, values) {
  const text = `${sku} ${pageText} ${Object.values(values).join(' ')}`.toLowerCase();
  if (/^fesh/i.test(sku) || /shortpass/.test(text)) return 'shortpass';
  if (/^felh/i.test(sku) || /longpass/.test(text)) return 'longpass';
  if (/bandpass|center wavelength|cwl|fwhm/i.test(text)) return 'bandpass';
  return 'bandpass';
}

function parseCenterWavelength(value) {
  return parseWavelengthNm(value);
}

function parseBandwidth(value) {
  return parseWavelengthNm(value);
}

function parseFilterCutoff(values, kind) {
  const cutOn = parseWavelengthNm(findValue(values, [/cut[-\s]?on/, /edge wavelength/, /cutoff wavelength/]));
  const cutOff = parseWavelengthNm(findValue(values, [/cut[-\s]?off/, /cutoff wavelength/]));
  if (kind === 'longpass') return cutOn ?? cutOff;
  if (kind === 'shortpass') return cutOff ?? cutOn;
  return undefined;
}

function parseOpticalDensity(values) {
  const text = cleanText(findValue(values, [/optical density/, /^od\b/, /blocking/]) ?? '');
  const explicit = text.match(/\bOD(?:abs|avg)?\s*(?:>|≥|>=|=)?\s*([0-9.]+)/i);
  if (explicit) return Number(explicit[1]);
  return undefined;
}

function filterDimensionsFromSku(sku) {
  const upper = sku.toUpperCase();
  if (/^MVF/.test(upper)) return { diameter: 29, clearAperture: 23, thickness: 8.1 };
  if (/^(?:FBH|FLH)/.test(upper)) {
    const halfInch = /^(?:FBH|FLH)0\d/.test(upper);
    return {
      diameter: halfInch ? 12.5 : 25,
      clearAperture: halfInch ? 10 : 21.1,
      thickness: 3.5,
    };
  }
  if (/^(?:FELH|FESH)/.test(upper)) return { diameter: 25, clearAperture: 21, thickness: 3.5 };
  if (/^FBW/.test(upper)) return { diameter: 25, clearAperture: 21, thickness: 3.5 };
  if (/^FB\d/.test(upper)) return { diameter: 25, clearAperture: 21, thickness: 2 };
  return {};
}

function filterMountingFromSku(sku, text) {
  if (/^(?:FBH|FLH|FELH|FESH|MVF|FBW)/i.test(sku)) return 'Mounted';
  return inferMounting(text);
}

function plausibleLength(value, max = 100) {
  return value !== undefined && Number.isFinite(value) && value > 0 && value <= max ? value : undefined;
}

function filterDimensions(values, pageText, sku) {
  const fallback = filterDimensionsFromSku(sku);
  const parsedDiameter =
    parseDiameter(findValue(values, [/outer diameter/, /^diameter$/, /^dia\b/, /^od$/]), 'diameter') ??
    parseDiameter(findValue(values, [/filter size/, /^size$/, /dimension/]), 'diameter');
  const parsedClearAperture = parseDiameter(findValue(values, [/clear aperture/]), 'clear aperture');
  const parsedWidth = parseLength(findValue(values, [/^width$/, /^length$/]), 'width');
  const parsedHeight = parseLength(findValue(values, [/^height$/]), 'height');
  const parsedThickness =
    parseLength(findValue(values, [/mounted thickness/, /^thickness$/, /\bct\b/]), 'thickness') ??
    (/\bmounted\b/i.test(`${pageText} ${Object.values(values).join(' ')}`) ? 3.5 : 2);
  const diameter = fallback.diameter ?? plausibleLength(parsedDiameter);
  const clearAperture = fallback.clearAperture ?? plausibleLength(parsedClearAperture);
  const width = fallback.width ?? plausibleLength(parsedWidth);
  const height = fallback.height ?? plausibleLength(parsedHeight);
  const thickness = fallback.thickness !== undefined
    ? fallback.thickness
    : plausibleLength(parsedThickness, 15) ?? 2;
  return { diameter, clearAperture, width, height, thickness };
}

function titleForFilter(sku, values, dims, filterKind, center, bandwidth, cutoff, coating) {
  const size = dims.diameter
    ? `Ø${Number(dims.diameter.toFixed(3))} mm`
    : dims.width && dims.height
      ? `${Number(dims.width.toFixed(3))} x ${Number(dims.height.toFixed(3))} mm`
      : '';
  const typeLabel = filterKind === 'bandpass'
    ? 'Bandpass Filter'
    : filterKind === 'longpass'
      ? 'Longpass Filter'
      : 'Shortpass Filter';
  return [
    `${sku}: ${typeLabel}`,
    size,
    center !== undefined ? `CWL = ${center} nm` : null,
    bandwidth !== undefined ? `FWHM = ${bandwidth} nm` : null,
    cutoff !== undefined && filterKind !== 'bandpass' ? `${cutoff} nm` : null,
    coating,
  ].filter(Boolean).join(', ');
}

function isUnsupportedMirrorGeometry(sku, pageText, values) {
  const text = `${sku} ${pageText} ${Object.values(values).join(' ')}`.toLowerCase();
  return /^mpd/i.test(sku) || /off[-\s]?axis parabolic|parabolic mirror/.test(text);
}

function valueDimensions(values) {
  const dimensionText =
    findValue(values, [/cube size/, /mirror size/, /optic size/, /^size$/, /dimension/, /substrate dimensions/]) ??
    findValue(values, [/^diameter$/, /^dia\b/, /^od$/]);
  const header = Object.keys(values).find(key => values[key] === dimensionText) ?? '';
  const dims = parseDimensionSet(dimensionText, header);
  const diameter = dims.diameter ?? parseLength(findValue(values, [/^diameter$/, /^dia\b/, /^od$/]), 'diameter');
  const width = dims.width ?? parseLength(findValue(values, [/^width$/, /^length$/]), 'width');
  const height = dims.height ?? parseLength(findValue(values, [/^height$/]), 'height');
  const depth = dims.depth;
  return { diameter, width, height, depth };
}

function shapeForDimensions({ diameter, width, height, depth }, type) {
  if (type === 'beamSplitter' || type === 'polarizingBeamSplitter') {
    if (depth !== undefined || (width !== undefined && height !== undefined && Math.abs(width - height) < 0.01)) return 'cube';
  }
  if (diameter !== undefined) return 'round';
  if (width !== undefined && height !== undefined && Math.abs(width - height) < 0.01) return 'square';
  if (width !== undefined || height !== undefined) return 'rectangular';
  return 'unknown';
}

function parseSplitRatio(text) {
  const clean = cleanText(text);
  const ratio = clean.match(/\b(\d{1,2})\s*[:/]\s*(\d{1,2})\b/);
  if (ratio) {
    const r = Number(ratio[1]);
    const t = Number(ratio[2]);
    if (r + t > 0) return r / (r + t);
  }
  const reflectance = clean.match(/\bR\s*=\s*(\d{1,3})\s*%|\b(\d{1,3})\s*%\s*R\b/i);
  const value = reflectance ? Number(reflectance[1] ?? reflectance[2]) : undefined;
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value / 100)) : undefined;
}

function dichroicSizeFromSku(sku) {
  if (/[TRLB]$/i.test(sku)) {
    const suffix = sku.at(-1).toUpperCase();
    if (suffix === 'T') return { diameter: 12.7, shape: 'round' };
    if (suffix === 'L') return { diameter: 50.8, shape: 'round' };
    if (suffix === 'R') return { width: 25, height: 36, shape: 'rectangular' };
    if (suffix === 'B') return { width: 35, height: 52, shape: 'rectangular' };
  }
  return { diameter: 25.4, shape: 'round' };
}

function curvedMirrorSizeFromSku(sku) {
  const match = sku.match(/^CM(\d{3})-/i);
  if (!match) return {};
  return { diameter: Number(match[1]) / 10, shape: 'round' };
}

function mountedPrismMirrorSize(sku, values, pageText) {
  const text = `${sku} ${pageText} ${Object.values(values).join(' ')}`;
  const prism = text.match(/\bMRA(\d+(?:\.\d+)?)/i);
  if (prism) {
    const size = Number(prism[1]);
    if (Number.isFinite(size) && size > 0) return { width: size, height: size, shape: 'square' };
  }
  if (/^CCM5-/i.test(sku)) return { width: 20, height: 20, shape: 'square' };
  if (/^CCM1-/i.test(sku)) return { width: 25, height: 25, shape: 'square' };
  return {};
}

function titleFor(type, sku, values, pageText, dims, coating) {
  const size = dims.diameter
    ? `Ø${Number(dims.diameter.toFixed(3))} mm`
    : dims.width && dims.height
      ? `${Number(dims.width.toFixed(3))} x ${Number(dims.height.toFixed(3))} mm`
      : '';
  const typeLabel = {
    mirror: 'Mirror',
    curvedMirror: 'Curved Mirror',
    beamSplitter: 'Beam Splitter',
    polarizingBeamSplitter: 'Polarizing Beam Splitter',
    dichroic: 'Dichroic Mirror',
    filter: 'Filter',
  }[type] ?? 'Fold Optic';
  const range = findValue(values, [/wavelength range/, /coating range/]);
  const f = parseNumber(findValue(values, [/focal length/]));
  const cutoff = parseNumber(findValue(values, [/cutoff wavelength/, /cut[-\s]?on wavelength/]));
  return [
    `${sku}: ${typeLabel}`,
    size,
    f !== undefined ? `f = ${f} mm` : null,
    cutoff !== undefined ? `${cutoff} nm` : null,
    cleanText(range ?? coating ?? inferCoating(pageText) ?? ''),
  ].filter(Boolean).join(', ');
}

function makePart({ sku, page, slug, values }) {
  const pageText = `${page.name ?? ''} ${page.permalink ?? ''} ${slug}`;
  const componentType = inferType(sku, pageText, values);
  if (componentType === 'mirror' && isUnsupportedMirrorGeometry(sku, pageText, values)) return null;
  const dimsFromRow = valueDimensions(values);
  const dichroicFallback = componentType === 'dichroic' ? dichroicSizeFromSku(sku) : {};
  const curvedMirrorFallback = componentType === 'curvedMirror' ? curvedMirrorSizeFromSku(sku) : {};
  const mountedMirrorFallback = componentType === 'mirror' ? mountedPrismMirrorSize(sku, values, pageText) : {};
  const dims = {
    diameter: dimsFromRow.diameter ?? dichroicFallback.diameter ?? curvedMirrorFallback.diameter,
    width: dimsFromRow.width ?? dichroicFallback.width ?? mountedMirrorFallback.width,
    height: dimsFromRow.height ?? dichroicFallback.height ?? mountedMirrorFallback.height,
    depth: dimsFromRow.depth,
  };
  const shape = shapeForDimensions({ ...dims, depth: dims.depth }, componentType) === 'unknown'
    ? dichroicFallback.shape ?? curvedMirrorFallback.shape ?? mountedMirrorFallback.shape ?? 'unknown'
    : shapeForDimensions({ ...dims, depth: dims.depth }, componentType);
  const thickness =
    parseLength(findValue(values, [/center thickness/, /^thickness$/, /\bct\b/]), 'thickness') ??
    dims.depth ??
    (componentType === 'mirror' ? 6.35 : componentType === 'dichroic' ? 1.1 : 2);
  const coating = cleanText(findValue(values, [/coating/]) ?? '') || inferCoating(`${pageText} ${Object.values(values).join(' ')}`);
  const substrate = inferSubstrate(`${pageText} ${Object.values(values).join(' ')}`);
  const mounting = inferMounting(`${pageText} ${Object.values(values).join(' ')}`);
  const wavelengthRange = cleanText(findValue(values, [/wavelength range/, /coating range/]) ?? '') || undefined;
  const focalLength = parseNumber(findValue(values, [/focal length/]));
  const radiusOfCurvature = parseNumber(findValue(values, [/radius of curvature/, /\broc\b/])) ?? (typeof focalLength === 'number' ? 2 * focalLength : undefined);
  const cutoff = parseNumber(findValue(values, [/cutoff wavelength/, /cut[-\s]?on wavelength/]));
  const transmissionBand = cleanText(findValue(values, [/transmission band/]) ?? '') || undefined;
  const reflectionBand = cleanText(findValue(values, [/reflection band/]) ?? '') || undefined;
  const splitRatio = parseSplitRatio(`${Object.values(values).join(' ')} ${pageText}`);
  const productPath = page.permalink ?? `/${slug}`;
  const familyUrl = `${THORLABS}${productPath.startsWith('/') ? productPath : `/${productPath}`}`;
  const productUrl = `${familyUrl}${familyUrl.includes('?') ? '&' : '?'}pn=${encodeURIComponent(sku)}`;

  if (componentType === 'filter') {
    const filterKind = filterKindFor(sku, pageText, values);
    const filterDims = filterDimensions(values, pageText, sku);
    const center = parseCenterWavelength(findValue(values, [/center wavelength/, /\bcwl\b/]));
    const bandwidth = parseBandwidth(findValue(values, [/fwhm/, /bandwidth/]));
    const cutoffFilter = parseFilterCutoff(values, filterKind);
    if (filterKind === 'bandpass' && center === undefined) return null;
    if ((filterKind === 'longpass' || filterKind === 'shortpass') && cutoffFilter === undefined) return null;
    const opticalDensity = parseOpticalDensity(values);
    const blockingBand = cleanText(findValue(values, [/blocking/]) ?? '') || undefined;
    const filterCoating = cleanText(findValue(values, [/coating/]) ?? '') || coating;
    const filterMounting = filterMountingFromSku(sku, `${pageText} ${Object.values(values).join(' ')}`);
    const filterShape = filterDims.diameter !== undefined
      ? 'round'
      : filterDims.width !== undefined && filterDims.height !== undefined && Math.abs(filterDims.width - filterDims.height) < 0.01
        ? 'square'
        : filterDims.width !== undefined || filterDims.height !== undefined
          ? 'rectangular'
          : 'unknown';
    const specs = {
      ...(filterDims.diameter !== undefined ? { diameter: scalarValue(filterDims.diameter, 'mm') } : {}),
      ...(filterDims.clearAperture !== undefined ? { clearAperture: scalarValue(filterDims.clearAperture, 'mm') } : {}),
      ...(filterDims.width !== undefined ? { width: scalarValue(filterDims.width, 'mm') } : {}),
      ...(filterDims.height !== undefined ? { height: scalarValue(filterDims.height, 'mm') } : {}),
      thickness: scalarValue(filterDims.thickness, 'mm'),
      ...(center !== undefined ? { centerWavelength: scalarValue(center, 'nm') } : {}),
      ...(bandwidth !== undefined ? { bandwidth: scalarValue(bandwidth, 'nm') } : {}),
      ...(cutoffFilter !== undefined ? { cutoffWavelength: scalarValue(cutoffFilter, 'nm') } : {}),
      ...(blockingBand ? { blockingBand: scalarValue(blockingBand) } : {}),
      ...(opticalDensity !== undefined ? { opticalDensity: scalarValue(opticalDensity) } : {}),
      ...(filterCoating ? { coating: scalarValue(filterCoating) } : {}),
      ...(substrate ? { substrate: scalarValue(substrate) } : {}),
      mounting: scalarValue(filterMounting),
      shape: scalarValue(filterShape),
    };
    return {
      id: `thorlabs:${sku}`,
      vendor: 'thorlabs',
      sku,
      title: titleForFilter(sku, values, filterDims, filterKind, center, bandwidth, cutoffFilter, filterCoating),
      productUrl,
      categoryPath: ['Optics', 'Filters', filterKind],
      componentType,
      specs,
      normalized: {
        kind: 'filter',
        ...(filterDims.diameter !== undefined ? { diameterMm: filterDims.diameter } : {}),
        ...(filterDims.width !== undefined ? { widthMm: filterDims.width } : {}),
        ...(filterDims.height !== undefined ? { heightMm: filterDims.height } : {}),
        thicknessMm: filterDims.thickness,
        filterKind,
        ...(cutoffFilter !== undefined ? { cutoffWavelengthNm: cutoffFilter } : {}),
        ...(center !== undefined ? { centerWavelengthNm: center } : {}),
        ...(bandwidth !== undefined ? { bandwidthNm: bandwidth } : {}),
        ...(blockingBand ? { blockingBand } : {}),
        ...(opticalDensity !== undefined ? { opticalDensity } : {}),
        ...(filterCoating ? { coating: filterCoating } : {}),
        ...(substrate ? { substrate } : {}),
        shape: filterShape,
      },
      files: [],
      provenance: [{
        source: 'vendorPage',
        url: familyUrl,
        note: 'Parsed from public Thorlabs filter family-page product tables.',
        retrievedAt: INDEXED_AT,
      }],
      confidence: 'derived',
      lastIndexed: INDEXED_AT,
    };
  }

  const specs = {
    ...(dims.diameter !== undefined ? { diameter: scalarValue(dims.diameter, 'mm') } : {}),
    ...(dims.width !== undefined ? { width: scalarValue(dims.width, 'mm') } : {}),
    ...(dims.height !== undefined ? { height: scalarValue(dims.height, 'mm') } : {}),
    thickness: scalarValue(thickness, 'mm'),
    ...(focalLength !== undefined ? { focalLength: scalarValue(focalLength, 'mm') } : {}),
    ...(radiusOfCurvature !== undefined ? { radiusOfCurvature: scalarValue(radiusOfCurvature, 'mm') } : {}),
    ...(componentType === 'beamSplitter' && splitRatio !== undefined ? { splitRatio: scalarValue(splitRatio) } : {}),
    ...(cutoff !== undefined ? { cutoffWavelength: scalarValue(cutoff, 'nm') } : {}),
    ...(wavelengthRange ? { wavelengthRange: scalarValue(wavelengthRange) } : {}),
    ...(transmissionBand ? { transmissionBand: scalarValue(transmissionBand) } : {}),
    ...(reflectionBand ? { reflectionBand: scalarValue(reflectionBand) } : {}),
    ...(coating ? { coating: scalarValue(coating) } : {}),
    ...(substrate ? { substrate: scalarValue(substrate) } : {}),
    mounting: scalarValue(mounting),
    shape: scalarValue(shape),
  };

  let normalized;
  if (componentType === 'curvedMirror') {
    if (!dims.diameter || !radiusOfCurvature) return null;
    normalized = {
      kind: 'curvedMirror',
      diameterMm: dims.diameter,
      thicknessMm: thickness,
      radiusOfCurvatureMm: radiusOfCurvature,
      ...(focalLength !== undefined ? { focalLengthMm: focalLength } : {}),
      ...(coating ? { coating } : {}),
      ...(substrate ? { substrate } : {}),
    };
  } else if (componentType === 'beamSplitter') {
    normalized = {
      kind: 'beamSplitter',
      ...(dims.diameter !== undefined ? { diameterMm: dims.diameter } : {}),
      ...(dims.width !== undefined ? { widthMm: dims.width } : {}),
      ...(dims.height !== undefined ? { heightMm: dims.height } : {}),
      thicknessMm: thickness,
      ...(splitRatio !== undefined ? { splitRatio } : {}),
      ...(wavelengthRange ? { wavelengthRange } : {}),
      ...(coating ? { coating } : {}),
      ...(substrate ? { substrate } : {}),
      shape,
    };
  } else if (componentType === 'polarizingBeamSplitter') {
    normalized = {
      kind: 'polarizingBeamSplitter',
      ...(dims.diameter !== undefined ? { diameterMm: dims.diameter } : {}),
      ...(dims.width !== undefined ? { widthMm: dims.width } : {}),
      ...(dims.height !== undefined ? { heightMm: dims.height } : {}),
      thicknessMm: thickness,
      ...(wavelengthRange ? { wavelengthRange } : {}),
      ...(coating ? { coating } : {}),
      ...(substrate ? { substrate } : {}),
      shape,
    };
  } else if (componentType === 'dichroic') {
    const filterKind = /^dmsp/i.test(sku) || /shortpass/i.test(pageText) ? 'shortpass' : /^dmbp/i.test(sku) ? 'bandpass' : 'longpass';
    normalized = {
      kind: 'dichroic',
      ...(dims.diameter !== undefined ? { diameterMm: dims.diameter } : {}),
      ...(dims.width !== undefined ? { widthMm: dims.width } : {}),
      ...(dims.height !== undefined ? { heightMm: dims.height } : {}),
      thicknessMm: thickness,
      filterKind,
      ...(cutoff !== undefined ? { cutoffWavelengthNm: cutoff } : {}),
      ...(transmissionBand ? { transmissionBand } : {}),
      ...(reflectionBand ? { reflectionBand } : {}),
      ...(coating ? { coating } : {}),
      ...(substrate ? { substrate } : {}),
      shape,
    };
  } else {
    if (dims.diameter === undefined && dims.width === undefined && dims.height === undefined) return null;
    normalized = {
      kind: 'mirror',
      ...(dims.diameter !== undefined ? { diameterMm: dims.diameter } : {}),
      ...(dims.width !== undefined ? { widthMm: dims.width } : {}),
      ...(dims.height !== undefined ? { heightMm: dims.height } : {}),
      thicknessMm: thickness,
      ...(coating ? { coating } : {}),
      ...(substrate ? { substrate } : {}),
      shape,
    };
  }

  return {
    id: `thorlabs:${sku}`,
    vendor: 'thorlabs',
    sku,
    title: titleFor(componentType, sku, values, pageText, dims, coating),
    productUrl,
    categoryPath: ['Optics', 'Mirrors & Splitters', componentType],
    componentType,
    specs,
    normalized,
    files: [],
    provenance: [{
      source: 'vendorPage',
      url: `${THORLABS}${productPath.startsWith('/') ? productPath : `/${productPath}`}`,
      note: 'Parsed from public Thorlabs GraphQL family-page product tables.',
      retrievedAt: INDEXED_AT,
    }],
    confidence: 'derived',
    lastIndexed: INDEXED_AT,
  };
}

function parseParts(page, slug) {
  const parts = [];
  for (const table of htmlTables(page.content)) {
    for (const values of tableRowsAsObjects(table)) {
      const sku = skuFromCell(values['item #'] ?? values['part #'] ?? values.item ?? values.part ?? Object.values(values).join(' '));
      if (!sku) continue;
      if (/^(?:PCM|BSH|FBTB|KM|K6|SC|ARV|CRM|C4W|C6W|SB|B6C|B3|B4|PM|KC|LMR|SM|TR|TPS)/i.test(sku)) continue;
      if (/^FK/i.test(sku)) continue;
      const part = makePart({ sku, page, slug, values });
      if (part) parts.push(part);
    }
  }
  return parts;
}

async function crawlPages(startSlugs) {
  const maxDepth = Number(argValue('--max-depth', '1'));
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
      const parts = parseParts(page, slug);
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
    const existingFiles = existing.files?.length ?? 0;
    const partFiles = part.files?.length ?? 0;
    const existingMounted = existing.specs.mounting?.value === 'Mounted';
    const partMounted = part.specs.mounting?.value === 'Mounted';
    if (partFiles > existingFiles || (partMounted && !existingMounted)) byId.set(part.id, part);
  }
  return [...byId.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

async function enrichPartsWithProductAssets(parts, { concurrency = 8, limit = 0 } = {}) {
  const enriched = parts.slice();
  const diagnostics = [];
  const count = limit > 0 ? Math.min(limit, parts.length) : parts.length;
  let next = 0;

  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= count) return;
      const part = parts[index];
      try {
        const files = dedupeFiles((await fetchProductAssets(part.sku)).map(supportFileFromAsset));
        enriched[index] = { ...part, files };
        diagnostics.push({ sku: part.sku, files: files.length });
      } catch (error) {
        diagnostics.push({ sku: part.sku, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, count || 1)) }, () => worker()));
  return { parts: enriched, diagnostics };
}

async function main() {
  const startSlugs = argValues('--slug').map(normalizeSlug).filter(Boolean);
  const starts = startSlugs.length > 0
    ? startSlugs
    : hasFlag('--filters')
      ? DEFAULT_FILTER_PAGE_URLS.map(normalizeSlug).filter(Boolean)
      : DEFAULT_START_SLUGS;
  const outPath = argValue('--out', 'src/catalog/thorlabsGeneratedFoldOpticsCatalog.ts');
  const format = argValue('--format', outPath.endsWith('.json') ? 'json' : 'ts');
  const withSupportFiles = hasFlag('--with-support-files') || hasFlag('--support-files');
  const supportConcurrency = Number(argValue('--support-concurrency', '8'));
  const supportLimit = Number(argValue('--support-limit', '0'));
  const allowEmpty = hasFlag('--allow-empty');

  const { pages, diagnostics } = await crawlPages(starts);
  let allParts = uniqueParts([...pages.entries()].flatMap(([slug, page]) => parseParts(page, slug)));
  let supportDiagnostics = [];

  if (allParts.length === 0 && !allowEmpty) {
    console.error(JSON.stringify({ diagnostics }, null, 2));
    throw new Error('Importer found 0 fold-optic catalog parts; refusing to overwrite generated catalog.');
  }

  if (withSupportFiles && allParts.length > 0) {
    const enriched = await enrichPartsWithProductAssets(allParts, {
      concurrency: supportConcurrency,
      limit: supportLimit,
    });
    allParts = enriched.parts;
    supportDiagnostics = enriched.diagnostics;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    vendor: 'thorlabs',
    source: withSupportFiles
      ? 'public Thorlabs GraphQL family pages plus product support assets'
      : 'public Thorlabs GraphQL family pages under supported fold-optic categories',
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
    const exportName = hasFlag('--filters') || /filters/i.test(path.basename(outPath))
      ? 'THORLABS_GENERATED_FILTERS_CATALOG'
      : 'THORLABS_GENERATED_FOLD_OPTICS_CATALOG';
    const jsonName = `${exportName}_JSON`;
    const sourceLabel = hasFlag('--filters')
      ? 'public Thorlabs GraphQL spectral-filter family pages.'
      : 'public Thorlabs GraphQL family pages under supported fold-optic categories.';
    const moduleText = [
      "import type { CatalogPart } from './types';",
      '',
      '// Generated by scripts/catalog/import-thorlabs-fold-optics.mjs.',
      `// Source: ${sourceLabel}`,
      `const ${jsonName} = [`,
      ...catalogChunks.map(chunk => `  ${JSON.stringify(chunk)},`),
      "].join('');",
      '',
      `export const ${exportName} = JSON.parse(${jsonName}) as CatalogPart[];`,
      '',
    ].join('\n');
    await writeFile(outPath, moduleText, 'utf8');
  }

  console.log(`Visited ${pages.size} pages.`);
  if (withSupportFiles) {
    const withMechanical = allParts.filter(part => part.files.some(file => file.role === 'mechanicalModel')).length;
    console.log(`Attached support assets to ${supportDiagnostics.length} part(s); ${withMechanical} have mechanical CAD.`);
  }
  console.log(`Wrote ${allParts.length} ${hasFlag('--filters') ? 'filter' : 'fold-optic'} catalog parts to ${outPath}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
