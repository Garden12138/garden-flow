import path from 'node:path';
import fs from 'node:fs';

function normalize(p: string): string {
    let resolved = path.resolve(p);
    let ancestor = resolved;
    while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
    if (fs.existsSync(ancestor)) resolved = path.join(fs.realpathSync(ancestor), path.relative(ancestor, resolved));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function withTrailingSep(p: string): string {
    return p.endsWith(path.sep) ? p : `${p}${path.sep}`;
}

export function isPathInWorkspace(targetPath: string, workspaceRoot: string): boolean {
    const normalizedRoot = normalize(workspaceRoot);
    const normalizedTarget = normalize(targetPath);
    return (
        normalizedTarget === normalizedRoot ||
        normalizedTarget.startsWith(withTrailingSep(normalizedRoot))
    );
}

export function resolvePathInWorkspace(inputPath: string, workspaceRoot: string): string {
    const resolved = path.isAbsolute(inputPath)
        ? path.resolve(inputPath)
        : path.resolve(workspaceRoot, inputPath);

    if (!isPathInWorkspace(resolved, workspaceRoot)) {
        throw new Error(`Path is outside workspace: ${resolved}`);
    }

    return resolved;
}
