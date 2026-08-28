import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import createArchive from 'archiver';

export interface XhsZipTextEntry {
    name: string;
    content: string;
}

export interface XhsZipFileEntry {
    name: string;
    absolutePath: string;
}

export async function writeXhsMaterialZip(
    outputPath: string,
    textEntries: XhsZipTextEntry[],
    fileEntries: XhsZipFileEntry[],
): Promise<void> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await new Promise<void>((resolve, reject) => {
        const output = fsSync.createWriteStream(outputPath);
        const archive = createArchive('zip', { zlib: { level: 9 } });
        let settled = false;
        const settle = (callback: () => void) => {
            if (settled) return;
            settled = true;
            callback();
        };
        output.on('close', () => settle(resolve));
        output.on('error', (error) => settle(() => reject(error)));
        archive.on('error', (error: unknown) => settle(() => reject(error)));
        archive.pipe(output);
        for (const entry of textEntries) archive.append(entry.content, { name: entry.name });
        for (const entry of fileEntries) archive.file(entry.absolutePath, { name: entry.name });
        void archive.finalize();
    });
}
