import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Home, Search, Plus, BookOpenText, Palette, Send, BarChart3, Library, Clock3, Settings, ChevronDown, Pencil, Trash2, X, ArrowLeft, Menu, Bell, Sun, Moon } from 'lucide-react';
import type { ImmersiveMode, ViewType } from '../features/app-shell/types';
import { APP_SECTIONS, type AppRoute, type AppSection } from '../features/app-shell/routes';
import { NotificationCenterDrawer } from './NotificationCenterDrawer';
import { useI18n } from '../i18n';
import { selectNotificationUnreadCount, useNotificationStore } from '../notifications/store';
import { AppGlobalSearchOverlay } from '../features/app-shell/AppGlobalSearchOverlay';
import { AppSpaceRenameDialog } from '../features/app-shell/AppSpaceRenameDialog';
import { AppTitleBar, getAppTitleBarPlatform } from '../features/app-shell/AppTitleBar';
import { AppUpdateNoticeModal } from '../features/app-shell/AppUpdateNoticeModal';
import { dispatchAppIntent } from '../features/app-shell/appIntent';
import { useAppUpdateNotice } from '../features/app-shell/useAppUpdateNotice';
import { useGlobalKnowledgeSearch } from '../features/app-shell/useGlobalKnowledgeSearch';
import { useLayoutSpaces } from '../features/app-shell/useLayoutSpaces';
import { useLayoutTheme } from '../features/app-shell/useLayoutTheme';

interface LayoutProps {
    children: ReactNode;
    route: AppRoute;
    creationActive?: boolean;
    currentView: ViewType;
    onNavigate: (view: ViewType) => void;
    immersiveMode?: ImmersiveMode;
    hideGlobalSidebar?: boolean;
    globalNotice?: string | null;
    globalSidebarContent?: ReactNode;
    activeModalView?: ViewType;
    renderTitleBarContent?: (context: { currentView: ViewType }) => ReactNode;
    renderTitleBarActions?: (context: { currentView: ViewType }) => ReactNode;
}
const icons: Record<AppSection, typeof Home> = { home: Home, research: Search, create: Palette, publish: Send, review: BarChart3, library: Library, automation: Clock3, settings: Settings };
export function Layout({ children, route, creationActive = false, currentView, onNavigate, immersiveMode = false, globalNotice, globalSidebarContent, renderTitleBarContent, renderTitleBarActions }: LayoutProps) {
    const { t } = useI18n();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const notificationDrawerOpen = useNotificationStore(state => state.drawerOpen);
    const toggleNotificationDrawer = useNotificationStore(state => state.toggleDrawer);
    const unreadNotificationCount = useNotificationStore(selectNotificationUnreadCount);
    const titleBarPlatform = getAppTitleBarPlatform();
    const usesAppTitleBar = titleBarPlatform !== null;
    const { themeMode, setManualThemeMode } = useLayoutTheme(immersiveMode);
    const { spaces, activeSpaceId, activeSpaceName, isSwitchingSpace, isSpaceMenuOpen, setIsSpaceMenuOpen, isSpaceDialogOpen, spaceDialogMode, spaceDialogName, setSpaceDialogName, isSpaceDialogSubmitting, deletingSpaceId, spaceMenuRef, handleSwitchSpace, openCreateSpaceDialog, openRenameSpaceDialog, handleDeleteSpace, closeSpaceDialog, submitSpaceDialog } = useLayoutSpaces(false);
    const { updateNotice, updatePublishedDateLabel, installState, isInstallingUpdate, installUpdate, closeUpdateNotice } = useAppUpdateNotice(t('layout.openDownloadFailed'));
    const { globalSearchInputRef, globalSearchQuery, setGlobalSearchQuery, globalSearchResults, isGlobalSearchLoading, isGlobalSearchVisible, isGlobalSearchClosing, openGlobalSearch, closeGlobalSearch, submitGlobalSearch, navigateToGlobalSearch } = useGlobalKnowledgeSearch(onNavigate);
    const section = APP_SECTIONS.find(item => item.id === route.section)!;
    const page = section.pages.find(item => item.route.page === route.page)!;
    const openCreate = useCallback(() => dispatchAppIntent({ type: 'creation.choose' }), []);
    const navigate = (next: AppRoute) => { setMobileNavOpen(false); setHistoryOpen(false); dispatchAppIntent({ type: 'route.open', route: next }); };
    useEffect(() => {
        const keydown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'n') { event.preventDefault(); openCreate(); }
            if (event.key === 'Escape') { setMobileNavOpen(false); setHistoryOpen(false); setIsSpaceMenuOpen(false); }
        };
        window.addEventListener('keydown', keydown);
        return () => window.removeEventListener('keydown', keydown);
    }, [openCreate, setIsSpaceMenuOpen]);
    useEffect(() => { document.getElementById('workspace-main')?.focus({ preventScroll: true }); }, [route.section, route.page, route.entityId]);
    const navGroup = (utility: boolean) => APP_SECTIONS.filter(item => ['automation', 'settings'].includes(item.id) === utility).map(item => {
        const Icon = icons[item.id]; const active = route.section === item.id;
        return <div key={item.id} className="workspace-nav-group">
            <button type="button" data-guide-id={`nav-${item.id}`} aria-current={active ? 'page' : undefined} aria-expanded={active} className={`workspace-nav-item ${active ? 'is-active' : ''}`} onClick={() => navigate(item.pages[0].route)}><Icon size={18} strokeWidth={1.7} /><span>{item.label}</span>{active && <ChevronDown size={14} className="ml-auto" />}</button>
            {active && <div className="workspace-subnav">{item.pages.map(child => <button key={child.route.page} type="button" aria-current={route.page === child.route.page ? 'page' : undefined} className={route.page === child.route.page ? 'is-active' : ''} onClick={() => navigate(child.route)}>{child.label}</button>)}</div>}
        </div>;
    });
    return (<div data-current-view={currentView} data-section={route.section} data-editor-active={creationActive} className={`workspace-shell ${usesAppTitleBar ? 'has-titlebar' : ''} ${creationActive || immersiveMode ? 'is-editor' : ''}`}>
        <AppTitleBar immersiveMode={immersiveMode} enabled={usesAppTitleBar} platform={titleBarPlatform}
            content={creationActive ? <button onClick={() => navigate({ section: 'create', page: 'works' })} className="workspace-back-button"><ArrowLeft size={15} />我的作品</button> : renderTitleBarContent?.({ currentView }) || null}
            stageIndex="" stageTitle={creationActive ? '创作 / 作品编辑' : `${section.label} / ${page.label}`} activeSpaceName={activeSpaceName}
            isSidebarCollapsed={!mobileNavOpen} toggleSidebarCollapsed={() => setMobileNavOpen(value => !value)}
            openGlobalSearch={openGlobalSearch} openRunningTasks={() => navigate({ section: 'automation', page: 'runs' })}
            createMenuOpen={false} toggleCreateMenu={openCreate} notificationDrawerOpen={notificationDrawerOpen}
            unreadNotificationCount={unreadNotificationCount} toggleNotificationDrawer={toggleNotificationDrawer}
            themeMode={themeMode} setManualThemeMode={setManualThemeMode} extraActions={renderTitleBarActions?.({ currentView }) || null} />
        {!usesAppTitleBar && <header className="workspace-web-toolbar"><button className="workspace-icon-button" aria-label="打开导航" onClick={() => setMobileNavOpen(value => !value)}><Menu size={18} /></button>{creationActive ? <button onClick={() => navigate({ section: 'create', page: 'works' })} className="workspace-back-button"><ArrowLeft size={16} />我的作品</button> : <span>{section.label} / {page.label}</span>}<div className="ml-auto flex gap-2"><button className="workspace-icon-button" aria-label="搜索资料" onClick={openGlobalSearch}><Search size={18} /></button><button className="workspace-icon-button" aria-label="运行记录" onClick={() => navigate({ section: 'automation', page: 'runs' })}><Clock3 size={18} /></button><button className="workspace-icon-button" aria-label="通知" onClick={toggleNotificationDrawer}><Bell size={18} /></button><button className="workspace-icon-button" aria-label="切换主题" onClick={() => setManualThemeMode(value => value === 'dark' ? 'light' : 'dark')}>{themeMode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button><button className="workspace-primary-button" onClick={openCreate}><Plus size={16} />新建</button></div></header>}
        {mobileNavOpen && <button className="workspace-nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}
        <aside className={`workspace-sidebar ${mobileNavOpen ? 'is-open' : ''}`}>
            <div className="workspace-brand"><img src="/branding/app-icon.png" alt="" /><strong>GardenFlow</strong><button className="workspace-icon-button workspace-mobile-close" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)}><X size={16} /></button></div>
            <div className="workspace-space" ref={spaceMenuRef}>
                <button className="workspace-space-trigger" disabled={isSwitchingSpace} aria-expanded={isSpaceMenuOpen} onClick={() => setIsSpaceMenuOpen(value => !value)}><span className="workspace-space-avatar">{activeSpaceName.slice(0, 1)}</span><span className="truncate">{activeSpaceName}</span><ChevronDown size={14} /></button>
                {isSpaceMenuOpen && <div className="workspace-space-menu">{spaces.map(space => <div key={space.id} className="flex items-center"><button className="min-w-0 flex-1 truncate text-left" aria-current={space.id === activeSpaceId ? 'true' : undefined} onClick={() => void handleSwitchSpace(space.id)}>{space.name}</button><button aria-label={`重命名空间 ${space.name}`} onClick={() => openRenameSpaceDialog(space)}><Pencil size={13} /></button>{space.id !== 'default' && <button aria-label={`删除空间 ${space.name}`} disabled={deletingSpaceId === space.id} onClick={() => void handleDeleteSpace(space)}><Trash2 size={13} /></button>}</div>)}<button onClick={openCreateSpaceDialog}><Plus size={14} />创建空间</button></div>}
            </div>
            <button className="workspace-primary-button workspace-new-button" onClick={openCreate}><Plus size={16} />开始创作<kbd>⌘N</kbd></button>
            <nav aria-label="主要导航" className="workspace-navigation">{navGroup(false)}<div className="workspace-utility-nav">{navGroup(true)}</div></nav>
            <div className="workspace-sidebar-footer"><span className="workspace-status-dot" />本地工作空间</div>
        </aside>
        <main className="workspace-main" id="workspace-main" tabIndex={-1}>
            {globalNotice && <div role="status" className="workspace-notice">{globalNotice}</div>}
            {currentView === 'gardenflow' && !creationActive && <div className="workspace-assistant-toolbar"><button className="workspace-secondary-button" onClick={() => setHistoryOpen(value => !value)}>会话与稿件</button><button className="workspace-secondary-button" onClick={() => navigate({ section: 'settings', page: 'members' })}>管理成员</button><button className="workspace-secondary-button" onClick={() => navigate({ section: 'settings', page: 'skills' })}>管理技能</button></div>}
            {children}
        </main>
        {historyOpen && globalSidebarContent && <div className="workspace-history-drawer"><header className="flex items-center justify-between p-4"><strong>会话与稿件</strong><button aria-label="关闭会话与稿件" className="workspace-icon-button" onClick={() => setHistoryOpen(false)}><X size={18} /></button></header><div className="min-h-0 flex-1 overflow-auto">{globalSidebarContent}</div></div>}
      {isSpaceDialogOpen && (
        <AppSpaceRenameDialog
          name={spaceDialogName}
          setName={setSpaceDialogName}
          isSubmitting={isSpaceDialogSubmitting}
          title={t(spaceDialogMode === 'create' ? 'layout.createSpace' : 'layout.renameSpace')}
          submit={submitSpaceDialog}
          close={closeSpaceDialog}
        />
      )}

      {isGlobalSearchVisible && (
        <AppGlobalSearchOverlay
          inputRef={globalSearchInputRef}
          query={globalSearchQuery}
          setQuery={setGlobalSearchQuery}
          results={globalSearchResults}
          isLoading={isGlobalSearchLoading}
          isClosing={isGlobalSearchClosing}
          closeSearch={closeGlobalSearch}
          submitSearch={submitGlobalSearch}
          navigateToSearch={navigateToGlobalSearch}
        />
      )}

      {updateNotice && (
        <AppUpdateNoticeModal
          notice={updateNotice}
          publishedDateLabel={updatePublishedDateLabel}
          installState={installState}
          isInstallingUpdate={isInstallingUpdate}
          installUpdate={installUpdate}
          closeNotice={closeUpdateNotice}
        />
      )}

      <NotificationCenterDrawer />
    </div>
  );
}
