import type { ImageHostingConfig } from '../../../shared/imageHosting.ts';

export type ImageHostingUploadInput = {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    remotePath?: string;
};

export type ImageHostingUploadResult = {
    publicUrl: string;
    remotePath: string;
    provider: string;
};

export type ImageHostingAdapter = {
    type: ImageHostingConfig['type'];
    upload(
        input: ImageHostingUploadInput,
        config: ImageHostingConfig,
        options?: { fetchImpl?: typeof fetch },
    ): Promise<ImageHostingUploadResult>;
};
