import './siteAdapters.js';
import { applyControlledTabBadge } from './content/controlBadge.js';
import { applyAgentCursorState, hideAgentCursor, moveAgentCursor } from './content/cursorOverlay.js';
import { readDomSnapshot, readFrame } from './content/domReader.js';
import { applyTabFaviconBadge } from './content/faviconBadge.js';
import { readPageAssets } from './content/pageAssetInventory.js';
import { checkElement, clickElement, clickNextButton, clickNode, getElementAttribute, getElementValue, getElementValues, hoverElement, inspectPoint, isCheckedElement, isElementVisible, queryElements, scrollNode, scrollPage, selectElement, typeElement, waitForDomStable, waitForNode, waitForSelector } from './content/pageActions.js';
import { applySiteResearchFilters, extractSiteResearch, prepareSiteResearchItemClick, prepareSiteResearchItemClose, submitSiteResearchSearch } from './content/siteResearchExtractor.js';

const GARDENFLOW_READ_FRAME = 'gardenflow-data-ai:read-frame';
const GARDENFLOW_DOM_SNAPSHOT = 'gardenflow-data-ai:dom-snapshot';
const GARDENFLOW_SITE_RESEARCH_EXTRACT = 'gardenflow-data-ai:site-research-extract';
const GARDENFLOW_SITE_RESEARCH_APPLY_FILTERS = 'gardenflow-data-ai:site-research-apply-filters';
const GARDENFLOW_SITE_RESEARCH_SUBMIT_SEARCH = 'gardenflow-data-ai:site-research-submit-search';
const GARDENFLOW_SITE_RESEARCH_PREPARE_ITEM_CLICK = 'gardenflow-data-ai:site-research-prepare-item-click';
const GARDENFLOW_SITE_RESEARCH_PREPARE_ITEM_CLOSE = 'gardenflow-data-ai:site-research-prepare-item-close';
const GARDENFLOW_SCROLL_PAGE = 'gardenflow-data-ai:scroll-page';
const GARDENFLOW_CLICK_NEXT = 'gardenflow-data-ai:click-next';
const GARDENFLOW_CLICK_ELEMENT = 'gardenflow-data-ai:click-element';
const GARDENFLOW_CLICK_NODE = 'gardenflow-data-ai:click-node';
const GARDENFLOW_HOVER_ELEMENT = 'gardenflow-data-ai:hover-element';
const GARDENFLOW_INSPECT_POINT = 'gardenflow-data-ai:inspect-point';
const GARDENFLOW_SCROLL_NODE = 'gardenflow-data-ai:scroll-node';
const GARDENFLOW_SELECT_ELEMENT = 'gardenflow-data-ai:select-element';
const GARDENFLOW_TYPE_ELEMENT = 'gardenflow-data-ai:type-element';
const GARDENFLOW_WAIT_STABLE = 'gardenflow-data-ai:wait-stable';
const GARDENFLOW_WAIT_SELECTOR = 'gardenflow-data-ai:wait-selector';
const GARDENFLOW_WAIT_NODE = 'gardenflow-data-ai:wait-node';
const GARDENFLOW_CHECK_ELEMENT = 'gardenflow-data-ai:check-element';
const GARDENFLOW_IS_CHECKED = 'gardenflow-data-ai:is-checked';
const GARDENFLOW_IS_VISIBLE = 'gardenflow-data-ai:is-visible';
const GARDENFLOW_GET_VALUE = 'gardenflow-data-ai:get-value';
const GARDENFLOW_GET_VALUES = 'gardenflow-data-ai:get-values';
const GARDENFLOW_GET_ATTRIBUTE = 'gardenflow-data-ai:get-attribute';
const GARDENFLOW_QUERY_ELEMENTS = 'gardenflow-data-ai:query-elements';
const GARDENFLOW_PAGE_ASSETS = 'gardenflow-data-ai:page-assets';
const GARDENFLOW_CURSOR_MOVE = 'gardenflow-data-ai:cursor-move';
const GARDENFLOW_CURSOR_HIDE = 'gardenflow-data-ai:cursor-hide';
const GARDENFLOW_CONTENT_PING = 'gardenflow-data-ai:content-ping';
const GARDENFLOW_CONTROL_BADGE = 'gardenflow-data-ai:control-badge';
const TARGET_CONTENT_PING = 'CONTENT_PING';
const TARGET_CONTROL_BADGE = 'AGENT_CONTROL_BADGE';
const GARDENFLOW_TAB_FAVICON_BADGE = 'TAB_FAVICON_BADGE';
const TARGET_CURSOR_STATE = 'AGENT_CURSOR_STATE';
const TARGET_GET_CURSOR_STATE = 'GET_AGENT_CURSOR_STATE';
const TARGET_GET_CONTROL_BADGE_STATE = 'GET_AGENT_CONTROL_BADGE_STATE';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    if (message?.type === GARDENFLOW_CONTENT_PING || message?.type === TARGET_CONTENT_PING) {
      sendResponse({ success: true, ok: true, frameUrl: location.href });
      return;
    }
    if (message?.type === GARDENFLOW_READ_FRAME) {
      sendResponse({ success: true, data: readFrame(message.options || {}) });
      return;
    }
    if (message?.type === GARDENFLOW_DOM_SNAPSHOT) {
      sendResponse(readDomSnapshot(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_SITE_RESEARCH_EXTRACT) {
      sendResponse(extractSiteResearch(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_SITE_RESEARCH_APPLY_FILTERS) {
      sendResponse(await applySiteResearchFilters(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_SITE_RESEARCH_SUBMIT_SEARCH) {
      sendResponse(await submitSiteResearchSearch(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_SITE_RESEARCH_PREPARE_ITEM_CLICK) {
      sendResponse(await prepareSiteResearchItemClick(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_SITE_RESEARCH_PREPARE_ITEM_CLOSE) {
      sendResponse(await prepareSiteResearchItemClose(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_SCROLL_PAGE) {
      sendResponse(await scrollPage(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_CLICK_NEXT) {
      sendResponse(await clickNextButton(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_CLICK_ELEMENT) {
      sendResponse(await clickElement(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_CLICK_NODE) {
      sendResponse(await clickNode(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_HOVER_ELEMENT) {
      sendResponse(await hoverElement(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_INSPECT_POINT) {
      sendResponse(inspectPoint(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_SCROLL_NODE) {
      sendResponse(scrollNode(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_SELECT_ELEMENT) {
      sendResponse(await selectElement(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_TYPE_ELEMENT) {
      sendResponse(await typeElement(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_WAIT_STABLE) {
      sendResponse(await waitForDomStable(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_WAIT_SELECTOR) {
      sendResponse(await waitForSelector(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_WAIT_NODE) {
      sendResponse(await waitForNode(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_CHECK_ELEMENT) {
      sendResponse(await checkElement(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_IS_CHECKED) {
      sendResponse(isCheckedElement(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_IS_VISIBLE) {
      sendResponse(isElementVisible(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_GET_VALUE) {
      sendResponse(getElementValue(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_GET_VALUES) {
      sendResponse(getElementValues(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_GET_ATTRIBUTE) {
      sendResponse(getElementAttribute(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_QUERY_ELEMENTS) {
      sendResponse(queryElements(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_PAGE_ASSETS) {
      sendResponse({ success: true, assets: readPageAssets(message.options || {}) });
      return;
    }
    if (message?.type === GARDENFLOW_CURSOR_MOVE) {
      sendResponse(moveAgentCursor(message.options || {}));
      return;
    }
    if (message?.type === TARGET_CURSOR_STATE) {
      sendResponse(applyAgentCursorState(message.state || message.options?.state || message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_CURSOR_HIDE) {
      sendResponse(hideAgentCursor());
      return;
    }
    if (message?.type === GARDENFLOW_TAB_FAVICON_BADGE) {
      sendResponse(applyTabFaviconBadge(message.options || {}));
      return;
    }
    if (message?.type === GARDENFLOW_CONTROL_BADGE || message?.type === TARGET_CONTROL_BADGE) {
      sendResponse(applyControlledTabBadge(message.state || message.options || {}));
      return;
    }
    sendResponse({ success: false, error: 'Unknown content message type' });
  })().catch((error) => {
    sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

chrome.runtime.sendMessage({ type: TARGET_GET_CURSOR_STATE }).then((response) => {
  if (response?.state) applyAgentCursorState(response.state);
}).catch(() => {});

chrome.runtime.sendMessage({ type: TARGET_GET_CONTROL_BADGE_STATE }).then((response) => {
  if (response?.state) applyControlledTabBadge(response.state);
}).catch(() => {});
