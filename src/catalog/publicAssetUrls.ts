function appBasePath(): string {
    const env = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;
    return env?.BASE_URL || '/';
}

function basePrefixedPath(path: string, base: string): string {
    const cleanPath = path.replace(/^\//, '');
    const cleanBase = base.replace(/\/$/, '');
    return cleanBase ? `${cleanBase}/${cleanPath}` : `/${cleanPath}`;
}

export function publicAssetUrlCandidates(url: string): string[] {
    if (/^(https?:|blob:|data:)/i.test(url)) return [url];

    const rootUrl = `/${url.replace(/^\//, '')}`;
    const baseUrl = basePrefixedPath(rootUrl, appBasePath());
    return Array.from(new Set([baseUrl, rootUrl]));
}
