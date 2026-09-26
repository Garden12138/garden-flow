import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAliyunVideoReferenceImages } from '../electron/core/aliyunVideoReferenceImages.ts';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);

test('Aliyun reference preparation sends local images directly without GitHub uploads', async () => {
    const transcodedPaths: string[] = [];
    const prepare = () => normalizeAliyunVideoReferenceImages({
        references: ['/tmp/product.avif', '/tmp/diagram.bmp', '/tmp/other.JPG'],
        normalize: async () => {
            throw new Error('GitHub 图床上传失败 (409)');
        },
        readLocalImage: async () => jpeg,
        transcodeLocalImage: async (filePath) => {
            transcodedPaths.push(filePath);
            return jpeg;
        },
    });
    const [first, second] = await Promise.all([prepare(), prepare()]);

    assert.deepEqual(transcodedPaths, ['/tmp/product.avif', '/tmp/diagram.bmp', '/tmp/product.avif', '/tmp/diagram.bmp']);
    assert.deepEqual(first, Array(3).fill(`data:image/jpeg;base64,${jpeg.toString('base64')}`));
    assert.deepEqual(second, first);
});

test('Aliyun reference preparation fails locally if conversion cannot produce JPEG', async () => {
    let normalizeCalls = 0;
    await assert.rejects(normalizeAliyunVideoReferenceImages({
        references: ['/tmp/product.avif'],
        normalize: async (value) => {
            normalizeCalls += 1;
            return value;
        },
        transcodeLocalImage: async () => Buffer.from('not-a-jpeg'),
    }), /未生成有效 JPEG/);
    assert.equal(normalizeCalls, 0);
});

test('Aliyun reference preparation preserves supported image data URLs without GitHub uploads', async () => {
    const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    const refs = await normalizeAliyunVideoReferenceImages({
        references: [dataUrl],
        normalize: async () => {
            throw new Error('GitHub hosting must not be used for data URLs');
        },
        transcodeLocalImage: async () => {
            throw new Error('data URL is not a local image');
        },
    });
    assert.deepEqual(refs, [dataUrl]);
});

test('Aliyun reference preparation rejects unsupported remote formats before submitting a task', async () => {
    await assert.rejects(normalizeAliyunVideoReferenceImages({
        references: ['https://example.com/product.avif'],
        normalize: async (value) => value,
        transcodeLocalImage: async () => {
            throw new Error('remote images must not be transcoded as local files');
        },
    }), /不支持 \.avif 参考图/);
});
