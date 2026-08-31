import path from 'node:path';
import fs from 'node:fs';
import compatibility from '../../shared/brandCompatibility.cjs';

let pathAliases: Array<{ from: string; to: string }> = [];
export function configureMigratedPaths(aliases: Array<{ from: string; to: string }>): void {
    pathAliases = aliases;
}

export function resolveMigratedPath(value: string): string {
    const normalized = path.normalize(value);
    for (const alias of pathAliases) {
        const relative = path.relative(alias.from, normalized);
        if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
        const parts = relative.split(path.sep);
        if (parts[0] === compatibility.identity.legacy.projectDirectory) parts[0] = compatibility.identity.slug;
        if (parts[0] === 'spaces' && parts[2] === compatibility.identity.legacy.projectDirectory) parts[2] = compatibility.identity.slug;
        const mapped = path.join(alias.to, ...parts);
        // A migrated attachment must not escape its new workspace through a link.
        // Check the nearest existing ancestor as well, so new-file writes are safe.
        if (fs.existsSync(alias.to)) {
            let ancestor = mapped;
            while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
            const relativeReal = path.relative(fs.realpathSync(alias.to), fs.realpathSync(ancestor));
            if (relativeReal === '..' || relativeReal.startsWith(`..${path.sep}`) || path.isAbsolute(relativeReal)) {
                throw new Error('Migrated path resolves outside workspace');
            }
        }
        return mapped;
    }
    return normalized;
}
