import { getSettings } from '../../db.ts';
import { uploadTestPng as uploadTestPngWithDeps } from './service.ts';

export {
    normalizeMediaValueForRemote,
    uploadImageBuffer,
    uploadTestPng,
} from './service.ts';
export { uploadToGithub } from './githubAdapter.ts';
export { waitForPublicUrlReady } from './publicUrlReady.ts';
export { buildGithubPublicUrl, buildRemotePath, normalizePathPrefix } from './url.ts';

export async function testUploadSavedImageHosting(): Promise<{
    ok: boolean;
    publicUrl?: string;
    error?: string;
}> {
    return uploadTestPngWithDeps({
        getSettings: () => getSettings(),
    });
}
