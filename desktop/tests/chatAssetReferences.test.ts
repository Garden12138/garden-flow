import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findPlainAssetMentionNames,
  planPastedAssetMentions,
  resolveSubmittedAssetMentions,
} from '../shared/chatAssetReferences.ts';

const product = { id: 'product-001', name: '商品', referenceType: 'product' };
const subject = { id: 'subject-001', name: '主体', referenceType: 'subject' };

test('uses the composer DOM mention snapshot when React selection state is stale', () => {
  assert.deepEqual(
    resolveSubmittedAssetMentions(['product-001'], [product, subject], []),
    [product],
  );
});

test('does not resurrect a removed mention from stale React selection state', () => {
  assert.deepEqual(
    resolveSubmittedAssetMentions([], [product], [product]),
    [],
  );
});

test('preserves DOM order and can resolve an option retained only in selected state', () => {
  assert.deepEqual(
    resolveSubmittedAssetMentions(['subject-001', 'product-001', 'product-001'], [subject], [product]),
    [subject, product],
  );
});

test('converts a pasted unique full asset name into a structured mention plan', () => {
  const plan = planPastedAssetMentions('@商品 生成 15 秒竖版视频', [product, subject]);
  assert.deepEqual(plan.matchedAssets, [product]);
  assert.deepEqual(plan.ambiguousNames, []);
  assert.deepEqual(plan.segments, [
    { type: 'mention', asset: product },
    { type: 'text', text: ' 生成 15 秒竖版视频' },
  ]);
});

test('prefers the longest exact catalog name and does not match inside a longer word', () => {
  const shortProduct = { id: 'product-short', name: '伟嘉猫粮', referenceType: 'product' };
  const longProduct = { id: 'product-long', name: '伟嘉猫粮10kg', referenceType: 'product' };
  assert.deepEqual(
    planPastedAssetMentions('@伟嘉猫粮10kg 生成视频', [shortProduct, longProduct]).matchedAssets,
    [longProduct],
  );
  assert.deepEqual(
    planPastedAssetMentions('@伟嘉猫粮新品', [shortProduct]).matchedAssets,
    [],
  );
});

test('keeps ambiguous pasted names as text and reports them for explicit selection', () => {
  const duplicateProduct = { id: 'product-002', name: '商品', referenceType: 'product' };
  const plan = planPastedAssetMentions('@商品 生成视频', [product, duplicateProduct]);
  assert.deepEqual(plan.matchedAssets, []);
  assert.deepEqual(plan.ambiguousNames, ['商品']);
  assert.deepEqual(plan.segments, [{ type: 'text', text: '@商品 生成视频' }]);
});

test('detects catalog mentions that remain plain text at submit time', () => {
  assert.deepEqual(
    findPlainAssetMentionNames('请用 @商品 生成视频', [product, subject]),
    ['商品'],
  );
  assert.deepEqual(findPlainAssetMentionNames('请用普通文字生成视频', [product]), []);
});
