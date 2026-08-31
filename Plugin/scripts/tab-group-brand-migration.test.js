import assert from 'node:assert/strict';

const storageKey = 'gardenflowBrowserDataAiTabGroups';
let storedValue = {
  groups: [{ chromeGroupId: 7, presentationColor: 'blue', title: 'Bojin' }],
  sessionGroupTitles: { session: 'Bojin' },
};
const liveGroup = { id: 7, title: 'Bojin', color: 'blue', collapsed: false };
const updates = [];

const event = { addListener() {} };
globalThis.chrome = {
  storage: {
    session: {
      async get(key) {
        return key === storageKey ? { [storageKey]: storedValue } : {};
      },
      async set(value) {
        if (value?.[storageKey]) storedValue = value[storageKey];
      },
    },
  },
  tabs: {
    async get(tabId) {
      return tabId === 42 ? { id: 42, groupId: 7 } : null;
    },
    async query(query) {
      return Number(query?.groupId) === 7 ? [{ id: 42, groupId: 7 }] : [];
    },
  },
  tabGroups: {
    onCreated: event,
    onRemoved: event,
    onUpdated: event,
    async get(groupId) {
      return Number(groupId) === 7 ? { ...liveGroup } : null;
    },
    async query(query) {
      return query?.title === liveGroup.title ? [{ ...liveGroup }] : [];
    },
    async update(groupId, update) {
      assert.equal(groupId, 7);
      Object.assign(liveGroup, update);
      updates.push({ ...update });
      return { ...liveGroup };
    },
  },
};

const moduleUrl = new URL('../src/background/tabGroupManager.js', import.meta.url);
moduleUrl.searchParams.set('test', String(Date.now()));
const { initializeManagedTabGroups, listManagedTabGroups } = await import(moduleUrl.href);

const initialized = await initializeManagedTabGroups();
assert.equal(initialized.success, true);
assert.equal(liveGroup.title, 'GardenFlow');
assert.ok(updates.some((update) => update.title === 'GardenFlow'));
assert.equal(storedValue.groups[0].title, 'GardenFlow');
assert.equal(storedValue.sessionGroupTitles.session, 'GardenFlow');

const snapshot = await listManagedTabGroups();
assert.equal(snapshot.groups[0].title, 'GardenFlow');
assert.equal(snapshot.sessionGroupTitles.session, 'GardenFlow');

console.log(JSON.stringify({
  ok: true,
  migratedGroupId: 7,
  title: liveGroup.title,
}));
