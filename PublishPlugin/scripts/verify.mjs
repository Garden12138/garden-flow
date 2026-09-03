import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', 'extension');
const required = ['manifest.json', 'background.js', 'pageAdapter.js', 'popup.html', 'popup.js', 'popup.css'];
for (const file of required) {
  if (!fs.existsSync(path.join(output, file))) throw new Error(`Missing extension output: ${file}`);
}
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Publisher extension must use Manifest V3');
if (manifest.host_permissions?.length !== 1 || manifest.host_permissions[0] !== 'https://creator.xiaohongshu.com/*') throw new Error('Publisher host permissions are too broad');
if (manifest.permissions?.includes('cookies') || manifest.host_permissions?.includes('<all_urls>')) throw new Error('Publisher extension requests forbidden permissions');
const extensionId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)));
if (extensionId !== 'jafdjmajegkaabbohedhmmlhogdejkpb') throw new Error(`Unexpected fixed extension id: ${extensionId}`);
const background = fs.readFileSync(path.join(output, 'background.js'), 'utf8');
const injectedVerificationStart = background.indexOf('function readPreparedEditorSnapshot()');
const injectedVerificationEnd = background.indexOf('function editorVerificationPayload(payload)');
const injectedVerification = background.slice(injectedVerificationStart, injectedVerificationEnd);
if (injectedVerificationStart < 0 || injectedVerificationEnd < 0 || injectedVerification.includes('verifyPreparedEditorSnapshot(')) {
  throw new Error('Injected editor snapshot reader must not depend on extension-module closures');
}
if (!background.includes("payload?.phase === 'prepare'") || !background.includes("payload?.phase === 'submit'")) {
  throw new Error('Publisher execution must keep prepare and submit as distinct phases');
}
const persistPublishedIndex = background.indexOf('saveResult(jobId, published)');
const restorePageIndex = background.indexOf('restorePublishPage(ownership.tabId, jobId, request.noteType)');
if (persistPublishedIndex < 0 || restorePageIndex < 0 || persistPublishedIndex > restorePageIndex) {
  throw new Error('Published state must be persisted before attempting to restore the publish page');
}
if (!background.includes('buildPublishModeUrl(noteType')
  || !background.includes('restorePublishPage(tabs[0].id, jobId, noteType)')) {
  throw new Error('Publisher mode switching and typed restore must stay enabled');
}
if (background.includes('expectedInputExists')) {
  throw new Error('Hidden file inputs must not be used as publish-mode readiness evidence');
}
if (!background.includes("'DOM.getFlattenedDocument'")
  || !background.includes('backendNodeId: candidate.backendDOMNodeId')
  || background.includes("'DOM.resolveNode', { nodeId }")) {
  throw new Error('Media assignment must use stable backend node ids without post-assignment stale-node reads');
}
if (!background.includes('canResumeOwnedPreparingDraft(snapshot, ownership.status)')) {
  throw new Error('A same-task draft interrupted after media assignment must resume without uploading again');
}
console.log('Publisher extension verification passed');
