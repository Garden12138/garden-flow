// Run: pnpm --dir desktop exec node --test tests/workspaceRoutes.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_SECTIONS, isAppRoute, routeForView, viewForRoute } from '../src/features/app-shell/routes.ts';
import { DesktopOpenSchema, desktopOpenRoute } from '../shared/workspaceHandoff.ts';

test('core tasks have independent destinations within two navigation clicks', () => {
    assert.deepEqual(APP_SECTIONS.map(section => section.id), ['home', 'research', 'create', 'publish', 'review', 'library', 'automation', 'settings']);
    for (const section of APP_SECTIONS) for (const item of section.pages) {
        assert.ok(isAppRoute(item.route));
        assert.equal(viewForRoute(item.route), item.view);
    }
    assert.equal(viewForRoute({ section: 'research', page: 'opportunities' }), 'opportunities');
    assert.equal(viewForRoute({ section: 'create', page: 'campaigns' }), 'campaigns');
    assert.equal(viewForRoute({ section: 'publish', page: 'tasks' }), 'publication');
    assert.equal(viewForRoute({ section: 'review', page: 'experiments' }), 'experiments');
});
test('legacy views retain their intended workspace and invalid restored routes are rejected', () => {
    assert.deepEqual(routeForView('gardenflow'), { section: 'create', page: 'assistant' });
    assert.deepEqual(routeForView('archives'), { section: 'library', page: 'profiles' });
    assert.deepEqual(routeForView('cover-studio'), { section: 'create', page: 'generation' });
    assert.equal(isAppRoute({ section: 'create', page: 'publication' }), false);
    assert.equal(isAppRoute({ section: 'research', page: 'opportunities', entityId: {} }), false);
    assert.equal(isAppRoute({ section: 'library', page: 'materials', entityKind: 'execute' }), false);
});
test('browser handoff accepts page navigation and cannot trigger writing, generation or publication', () => {
    assert.deepEqual(desktopOpenRoute(DesktopOpenSchema.parse({ destination: 'materials', entityId: 'note_1', spaceId: 'space_a', entityKind: 'redbook-note' })), { section: 'library', page: 'materials', entityId: 'note_1', entityKind: 'redbook-note' });
    assert.deepEqual(desktopOpenRoute(DesktopOpenSchema.parse({ destination: 'publication' })), { section: 'publish', page: 'tasks' });
    assert.equal(DesktopOpenSchema.safeParse({ destination: 'publication', action: 'submit' }).success, false);
    assert.equal(DesktopOpenSchema.safeParse({ destination: 'generate' }).success, false);
    assert.equal(DesktopOpenSchema.safeParse({ destination: 'materials', entityId: 'x'.repeat(501) }).success, false);
});
