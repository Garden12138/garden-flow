declare module 'archiver' {
    interface ArchiveStream extends NodeJS.ReadWriteStream {
        append(content: string | Buffer, options: { name: string }): ArchiveStream;
        file(sourcePath: string, options: { name: string; stats?: import('node:fs').Stats }): ArchiveStream;
        finalize(): Promise<void> | void;
    }

    export default function createArchive(
        format: string,
        options?: Record<string, unknown>,
    ): ArchiveStream;
}
