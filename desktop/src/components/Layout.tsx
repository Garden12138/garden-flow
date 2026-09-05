import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Settings as SettingsIcon, Folder, Dices, Pencil, ChevronDown, Sun, Moon, AlertCircle, Bell, Clock3, Edit, BookOpenText, Trash2, Box, Sparkles, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import type { ImmersiveMode, ViewType } from '../features/app-shell/types';
import { NotificationCenterDrawer } from './NotificationCenterDrawer';
import { useI18n, type I18nKey } from '../i18n';
import { selectNotificationUnreadCount, useNotificationStore } from '../notifications/store';
import { AppGlobalSearchOverlay } from '../features/app-shell/AppGlobalSearchOverlay';
import { AppSpaceRenameDialog } from '../features/app-shell/AppSpaceRenameDialog';
import { AppTitleBar, getAppTitleBarPlatform } from '../features/app-shell/AppTitleBar';
import { AppUpdateNoticeModal } from '../features/app-shell/AppUpdateNoticeModal';
import { dispatchAppIntent } from '../features/app-shell/appIntent';
import { useAppUpdateNotice } from '../features/app-shell/useAppUpdateNotice';
import { useGlobalKnowledgeSearch } from '../features/app-shell/useGlobalKnowledgeSearch';
import { useLayoutSidebar } from '../features/app-shell/useLayoutSidebar';
import { useLayoutSpaces } from '../features/app-shell/useLayoutSpaces';
import { useLayoutTheme } from '../features/app-shell/useLayoutTheme';
import { flowStageForView, WORKBENCH_NAVIGATION, type WorkbenchNavigationItem } from '../features/workbench/navigation';

interface LayoutProps {
  children: ReactNode;
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

type SidebarNavItem = WorkbenchNavigationItem & {
  labelKey: I18nKey;
  icon: typeof Sparkles;
};

const NAV_ICONS: Record<WorkbenchNavigationItem['key'], typeof Sparkles> = {
  workbench: Sparkles,
  collect: BookOpenText,
  ideate: Dices,
  compose: Edit,
  produce: Pencil,
  assets: Folder,
  media: Box,
  schedule: Clock3,
};

const NAV_ITEMS: SidebarNavItem[] = WORKBENCH_NAVIGATION.map((item) => ({
  ...item,
  labelKey: item.labelKey,
  icon: NAV_ICONS[item.key],
}));

const STAGE_INDEX: Partial<Record<ViewType, string>> = {
  home: 'TODAY',
  knowledge: '01 · COLLECT',
  wander: '02 · IDEATE',
  gardenflow: '03 · COMPOSE',
  'generation-studio': '04 · PRODUCE',
  subjects: 'LIBRARY',
  'media-library': 'LIBRARY',
  automation: '05 · SCHEDULE',
  settings: 'SYSTEM',
  approval: 'REVIEW',
};

const STAGE_SUMMARY_KEYS: Partial<Record<ViewType, I18nKey>> = {
  home: 'workbench.stage.home.summary',
  knowledge: 'workbench.stage.collect.summary',
  wander: 'workbench.stage.ideate.summary',
  gardenflow: 'workbench.stage.compose.summary',
  'generation-studio': 'workbench.stage.produce.summary',
  subjects: 'workbench.stage.assets.summary',
  'media-library': 'workbench.stage.media.summary',
  automation: 'workbench.stage.schedule.summary',
};
export function Layout({ children, currentView, onNavigate, immersiveMode = false, hideGlobalSidebar = false, globalNotice = null, globalSidebarContent, activeModalView, renderTitleBarContent, renderTitleBarActions }: LayoutProps) {
  const { t } = useI18n();
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const notificationDrawerOpen = useNotificationStore((state) => state.drawerOpen);
  const toggleNotificationDrawer = useNotificationStore((state) => state.toggleDrawer);
  const unreadNotificationCount = useNotificationStore(selectNotificationUnreadCount);
  const isFixedViewportView = false;
  const titleBarPlatform = getAppTitleBarPlatform();
  const usesAppTitleBar = titleBarPlatform !== null;
  const hasGlobalSidebar = !immersiveMode && !hideGlobalSidebar;
  const { themeMode, setManualThemeMode } = useLayoutTheme(immersiveMode);
  const titleBarContent = renderTitleBarContent?.({ currentView }) ?? null;
  const titleBarActions = renderTitleBarActions?.({ currentView }) ?? null;
  const {
    isSidebarCollapsed,
    sidebarWidth,
    isSidebarAnimating,
    sidebarVisualCollapsed,
    toggleSidebarCollapsed,
    startSidebarResize,
  } = useLayoutSidebar();
  const {
    spaces,
    activeSpaceId,
    activeSpaceName,
    isSwitchingSpace,
    isSpaceMenuOpen,
    setIsSpaceMenuOpen,
    hoveredSpaceId,
    setHoveredSpaceId,
    isSpaceDialogOpen,
    spaceDialogMode,
    spaceDialogName,
    setSpaceDialogName,
    isSpaceDialogSubmitting,
    deletingSpaceId,
    spaceMenuRef,
    handleSwitchSpace,
    openCreateSpaceDialog,
    openRenameSpaceDialog,
    handleDeleteSpace,
    closeSpaceDialog,
    submitSpaceDialog,
  } = useLayoutSpaces(sidebarVisualCollapsed);
  const {
    updateNotice,
    updatePublishedDateLabel,
    installState,
    isInstallingUpdate,
    installUpdate,
    closeUpdateNotice,
  } = useAppUpdateNotice(t('layout.openDownloadFailed'));
  const {
    globalSearchInputRef,
    globalSearchQuery,
    setGlobalSearchQuery,
    globalSearchResults,
    isGlobalSearchLoading,
    isGlobalSearchVisible,
    isGlobalSearchClosing,
    openGlobalSearch,
    closeGlobalSearch,
    submitGlobalSearch,
    navigateToGlobalSearch,
  } = useGlobalKnowledgeSearch(onNavigate);
  const visibleView = activeModalView || currentView;
  const activeNavigationItem = NAV_ITEMS.find((item) => item.view === visibleView) || null;
  const activeNavigationIndex = activeNavigationItem ? NAV_ITEMS.indexOf(activeNavigationItem) : -1;
  const nextNavigationItem = activeNavigationIndex >= 0 && activeNavigationIndex < NAV_ITEMS.length - 1
    ? NAV_ITEMS[activeNavigationIndex + 1]
    : null;
  const activeStageTitle = activeNavigationItem
    ? t(activeNavigationItem.labelKey)
    : visibleView === 'settings'
      ? t('nav.settings')
      : visibleView === 'approval'
        ? '审批'
        : 'GardenFlow';
  const activeStageIndex = STAGE_INDEX[visibleView] || 'WORKSPACE';
  const activeStageSummaryKey = STAGE_SUMMARY_KEYS[visibleView];
  const activeStageSummary = activeStageSummaryKey ? t(activeStageSummaryKey) : '';
  const visibleGlobalSidebarContent = sidebarVisualCollapsed ? null : globalSidebarContent;

  useEffect(() => {
    const handleWorkbenchShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const hasCommandModifier = (event.metaKey || event.ctrlKey) && !event.altKey;
      if (hasCommandModifier && key === 'k') {
        event.preventDefault();
        openGlobalSearch();
        return;
      }
      if (hasCommandModifier && key === 'n') {
        event.preventDefault();
        setCreateMenuOpen((open) => !open);
        return;
      }
      if (event.key === 'Escape') {
        setCreateMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleWorkbenchShortcut, true);
    return () => window.removeEventListener('keydown', handleWorkbenchShortcut, true);
  }, [openGlobalSearch]);

  const handleCreateAction = useCallback((action: 'chat' | 'material' | 'manuscript' | 'media' | 'automation') => {
    setCreateMenuOpen(false);
    if (action === 'chat') {
      dispatchAppIntent({ type: 'gardenflow.open', action: 'new' });
      return;
    }
    if (action === 'material') {
      dispatchAppIntent({ type: 'flow.open', stage: 'collect' });
      return;
    }
    if (action === 'manuscript') {
      dispatchAppIntent({
        type: 'flow.open',
        stage: 'compose',
        handoff: {
          kind: 'chat-draft',
          message: {
            content: '从一份新的创作简报开始。',
            displayContent: '从一份新的创作简报开始。',
            sessionRouting: 'new',
            deliveryMode: 'draft',
          },
        },
      });
      return;
    }
    if (action === 'media') {
      dispatchAppIntent({
        type: 'generation.open',
        intent: { mode: 'image', source: 'standalone' },
      });
      return;
    }
    dispatchAppIntent({ type: 'flow.open', stage: 'schedule' });
  }, []);

  const handleSidebarNavigate = useCallback((item: SidebarNavItem) => {
    onNavigate(item.view);
  }, [onNavigate]);

  const renderSidebarNavItem = (item: SidebarNavItem) => {
    const { key, view, stage, labelKey, icon: Icon } = item;
    const label = t(labelKey);
    const isActive = currentView === view || activeModalView === view;
    return (
      <button
        key={key}
        type="button"
        data-guide-id={`nav-${key}`}
        data-flow-stage={stage}
        data-active={isActive ? 'true' : 'false'}
        onClick={() => handleSidebarNavigate(item)}
        title={label}
        aria-label={label}
        className={clsx(
          'app-sidebar-nav-item relative w-full rounded-xl transition-all font-normal inline-flex items-center',
          'app-sidebar-nav-item--collapsed justify-center',
          isActive ? 'app-sidebar-nav-item--active shadow-none' : 'app-sidebar-nav-item--plain'
        )}
      >
        <Icon className="app-sidebar-nav-icon shrink-0" strokeWidth={1.65} />
        <span className="app-sidebar-nav-label app-sidebar-nav-label--collapsed">
          {label}
        </span>
      </button>
    );
  };

  return (
    <div
      data-current-view={visibleView}
      data-flow-stage={flowStageForView(visibleView) || undefined}
      className={clsx(
        'app-layout-shell relative flex h-screen w-full overflow-hidden text-text-primary',
        hasGlobalSidebar && 'app-layout-shell--layered',
        immersiveMode === 'dark' ? 'bg-[#0f0f0f]' : 'bg-background'
      )}
    >
      <AppTitleBar
        immersiveMode={immersiveMode}
        enabled={usesAppTitleBar}
        platform={titleBarPlatform}
        content={titleBarContent}
        stageIndex={activeStageIndex}
        stageTitle={activeStageTitle}
        activeSpaceName={activeSpaceName}
        isSidebarCollapsed={isSidebarCollapsed}
        toggleSidebarCollapsed={toggleSidebarCollapsed}
        openGlobalSearch={openGlobalSearch}
        openRunningTasks={() => onNavigate('generation-studio')}
        createMenuOpen={createMenuOpen}
        toggleCreateMenu={() => setCreateMenuOpen((open) => !open)}
        notificationDrawerOpen={notificationDrawerOpen}
        unreadNotificationCount={unreadNotificationCount}
        toggleNotificationDrawer={toggleNotificationDrawer}
        themeMode={themeMode}
        setManualThemeMode={setManualThemeMode}
        extraActions={titleBarActions}
      />

      {createMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-[68]"
            aria-hidden="true"
            onMouseDown={() => setCreateMenuOpen(false)}
          />
          <div
            className={clsx(
              'workbench-create-menu fixed right-4 z-[69] w-[252px] overflow-hidden',
              usesAppTitleBar ? 'top-[calc(var(--app-titlebar-height)+0.5rem)]' : 'top-3'
            )}
            role="menu"
            aria-label={t('workbench.create')}
            data-no-window-drag
          >
            <div className="workbench-create-menu__header">
              <span>{t('workbench.create')}</span>
              <kbd>⌘N</kbd>
            </div>
            {([
              ['chat', Edit, 'workbench.create.newChat'],
              ['material', BookOpenText, 'workbench.create.importMaterial'],
              ['manuscript', Pencil, 'workbench.create.newManuscript'],
              ['media', Box, 'workbench.create.mediaGeneration'],
              ['automation', Clock3, 'workbench.create.automation'],
            ] as const).map(([action, Icon, labelKey]) => (
              <button
                key={action}
                type="button"
                role="menuitem"
                onClick={() => handleCreateAction(action)}
                className="workbench-create-menu__item"
              >
                <Icon className="h-4 w-4" strokeWidth={1.7} />
                <span>{t(labelKey)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {globalNotice && (
        <div
          className={clsx(
            'pointer-events-none absolute left-1/2 z-[80] -translate-x-1/2',
            usesAppTitleBar ? 'top-[calc(var(--app-titlebar-height)+0.75rem)]' : 'top-3'
          )}
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-red-200/80 bg-red-50/96 px-4 py-2 text-[12px] font-medium text-red-700 shadow-[0_12px_30px_-18px_rgba(220,38,38,0.55)] backdrop-blur">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
            <span className="whitespace-nowrap">{globalNotice}</span>
          </div>
        </div>
      )}

      {/* Sidebar */}
      {hasGlobalSidebar && (
        <aside
          className={clsx(
            'app-sidebar-shell bg-surface-secondary/85 border-r border-border flex shrink-0 overflow-hidden',
            usesAppTitleBar && 'pt-[var(--app-titlebar-height)]',
            isSidebarAnimating && 'app-sidebar-shell--animating',
            sidebarVisualCollapsed ? 'app-sidebar-shell--collapsed' : 'app-sidebar-shell--expanded'
          )}
          style={!sidebarVisualCollapsed ? { '--app-sidebar-expanded-width': `${sidebarWidth}px` } as React.CSSProperties : undefined}
        >
          <nav className="app-sidebar-nav workbench-flow-rail">
            <div className="workbench-flow-rail__brand" aria-label="GardenFlow">GF</div>
            <div className="workbench-flow-rail__stages">
              {NAV_ITEMS.map(renderSidebarNavItem)}
            </div>
            <div className="workbench-flow-rail__tools">
              <button
                type="button"
                onClick={() => setCreateMenuOpen(true)}
                className="workbench-flow-rail__tool"
                title={t('workbench.create')}
                aria-label={t('workbench.create')}
              >
                <Plus className="h-[17px] w-[17px]" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className={clsx('workbench-flow-rail__tool', visibleView === 'settings' && 'is-active')}
                title={t('nav.settings')}
                aria-label={t('nav.settings')}
              >
                <SettingsIcon className="h-[17px] w-[17px]" strokeWidth={1.75} />
              </button>
            </div>
          </nav>

          {!sidebarVisualCollapsed && (
            <div className="workbench-context-shelf min-w-0 flex-1 flex flex-col overflow-hidden">
              <div className="workbench-context-shelf__heading">
                <div className="workbench-context-shelf__eyebrow">{activeStageIndex}</div>
                <h2>{activeStageTitle}</h2>
                {activeStageSummary && <p>{activeStageSummary}</p>}
              </div>

              {visibleGlobalSidebarContent ? (
                <div className="workbench-context-shelf__content min-h-0 flex-1 overflow-hidden flex flex-col">
                  {visibleGlobalSidebarContent}
                </div>
              ) : (
                <div className="workbench-context-shelf__guide min-h-0 flex-1 overflow-auto">
                  <div className="workbench-context-shelf__note">
                    <span>EDITORIAL NOTE</span>
                    <p>{activeStageSummary || '在一个空间里组织素材、创作与发布计划。'}</p>
                  </div>
                  {nextNavigationItem && (
                    <button
                      type="button"
                      className="workbench-context-shelf__next"
                      onClick={() => onNavigate(nextNavigationItem.view)}
                    >
                      <span>下一阶段</span>
                      <strong>{t(nextNavigationItem.labelKey)}</strong>
                      <ChevronDown className="h-4 w-4 -rotate-90" strokeWidth={1.7} />
                    </button>
                  )}
                </div>
              )}

              {/* Footer */}
              <div className="workbench-context-shelf__footer border-t border-border px-4 py-2 space-y-2">
            {sidebarVisualCollapsed && (
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className="h-8 w-8 rounded-md text-text-tertiary hover:text-text-primary transition-colors inline-flex items-center justify-center shrink-0"
                title={t('nav.settings')}
                aria-label={t('nav.settings')}
              >
                <SettingsIcon className="w-[17px] h-[17px]" strokeWidth={1.75} />
              </button>
            )}
            <div
              className={clsx(
                'app-sidebar-footer-meta flex items-center gap-2 text-[11px] text-text-tertiary/90 whitespace-nowrap transition-[max-height,opacity,transform]',
                sidebarVisualCollapsed ? 'max-h-0 overflow-hidden opacity-0 translate-y-1' : 'max-h-8 overflow-visible opacity-100 translate-y-0 justify-start',
                isSpaceMenuOpen && 'relative z-[140]'
              )}
            >
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className="h-8 rounded-md px-2 text-text-tertiary hover:text-text-primary hover:bg-surface-primary transition-colors inline-flex items-center justify-center gap-1.5 shrink-0"
                title={t('nav.settings')}
                aria-label={t('nav.settings')}
              >
                <SettingsIcon className="w-[19px] h-[19px]" strokeWidth={1.75} />
                <span className="text-xs font-medium">{t('nav.settings')}</span>
              </button>
              {!usesAppTitleBar && (
                <>
                  <button
                    type="button"
                    onClick={toggleNotificationDrawer}
                    className="relative h-5 w-5 rounded-md border border-border bg-surface-primary text-text-secondary hover:text-text-primary hover:bg-surface-secondary transition-colors inline-flex items-center justify-center shrink-0"
                    title={notificationDrawerOpen ? t('layout.closeNotificationCenter') : t('layout.openNotificationCenter')}
                    aria-label={notificationDrawerOpen ? t('layout.closeNotificationCenter') : t('layout.openNotificationCenter')}
                  >
                    <Bell className="w-[11px] h-[11px]" strokeWidth={1.75} />
                    {unreadNotificationCount > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 min-w-[14px] h-[14px] rounded-full bg-accent-primary px-1 text-[9px] leading-[14px] text-white">
                        {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualThemeMode((prev) => prev === 'dark' ? 'light' : 'dark')}
                    className="h-5 w-5 rounded-md border border-border bg-surface-primary text-text-secondary hover:text-text-primary hover:bg-surface-secondary transition-colors inline-flex items-center justify-center shrink-0"
                    title={themeMode === 'dark' ? t('layout.switchToLight') : t('layout.switchToDark')}
                    aria-label={themeMode === 'dark' ? t('layout.switchToLight') : t('layout.switchToDark')}
                  >
                    {themeMode === 'dark'
                      ? <Sun className="w-[11px] h-[11px]" strokeWidth={1.75} />
                      : <Moon className="w-[11px] h-[11px]" strokeWidth={1.75} />}
                  </button>
                </>
              )}
              <div ref={spaceMenuRef} className="relative min-w-0">
                <button
                  type="button"
                  onClick={() => setIsSpaceMenuOpen((prev) => !prev)}
                  disabled={isSwitchingSpace}
                  className="h-7 w-[118px] px-2.5 text-[12px] flex items-center justify-between gap-1 rounded-lg border border-border bg-surface-primary text-text-primary disabled:opacity-50"
                >
                  <span className="min-w-0 truncate">{activeSpaceName}</span>
                  <ChevronDown className={clsx('w-[13px] h-[13px] shrink-0 text-text-tertiary transition-transform', isSpaceMenuOpen && 'rotate-180')} strokeWidth={1.75} />
                </button>

                {isSpaceMenuOpen && (
                  <div
                    className="app-space-menu absolute right-0 bottom-full z-[1] mb-1.5 w-[172px] overflow-hidden rounded-lg border border-border shadow-lg"
                  >
                    <div className="max-h-44 overflow-y-auto">
                      {spaces.length === 0 ? (
                        <div className="h-9 px-2.5 text-[12px] text-text-tertiary flex items-center">
                          {t('layout.noSpace')}
                        </div>
                      ) : (
                        spaces.map((space) => {
                          const isActive = space.id === activeSpaceId;
                          const showEdit = hoveredSpaceId === space.id;
                          const canDelete = space.id !== 'default';
                          const isDeleting = deletingSpaceId === space.id;
                          return (
                            <div
                              key={space.id}
                              className={clsx(
                                'h-9 px-2.5 flex items-center gap-1.5',
                                isActive ? 'bg-accent-primary/10' : 'hover:bg-surface-secondary'
                              )}
                              onMouseEnter={() => setHoveredSpaceId(space.id)}
                              onMouseLeave={() => setHoveredSpaceId((prev) => (prev === space.id ? null : prev))}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  void handleSwitchSpace(space.id);
                                }}
                                className={clsx('flex-1 text-left text-[12px] truncate', isActive ? 'text-accent-primary' : 'text-text-primary')}
                              >
                                {space.name}
                              </button>
                              <button
                                type="button"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  openRenameSpaceDialog(space);
                                }}
                                className={clsx(
                                  'w-5 h-5 inline-flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-primary transition-opacity',
                                  showEdit ? 'opacity-100' : 'opacity-0 pointer-events-none'
                                )}
                                title={t('layout.renameSpace')}
                              >
                                <Pencil className="w-[12px] h-[12px]" strokeWidth={1.75} />
                              </button>
                              {canDelete && (
                                <button
                                  type="button"
                                  disabled={isDeleting}
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    void handleDeleteSpace(space);
                                  }}
                                  className={clsx(
                                    'w-5 h-5 inline-flex items-center justify-center rounded-md text-text-secondary hover:text-red-500 hover:bg-surface-primary disabled:opacity-50 transition-opacity',
                                    showEdit ? 'opacity-100' : 'opacity-0 pointer-events-none'
                                  )}
                                  title={t('layout.deleteSpace')}
                                >
                                  <Trash2 className="w-[12px] h-[12px]" strokeWidth={1.75} />
                                </button>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        openCreateSpaceDialog();
                      }}
                      className="h-9 w-full border-t border-border px-2.5 text-[12px] text-accent-primary hover:bg-surface-secondary flex items-center gap-1.5"
                    >
                      <span className="text-[15px] leading-none">+</span>
                      <span className="truncate">{t('layout.createSpace')}</span>
                    </button>

                  </div>
                )}
              </div>
              </div>
            </div>
            </div>
          )}

          {!sidebarVisualCollapsed && (
            <div
              className="app-sidebar-resize-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="调整侧边栏宽度"
              title="调整侧边栏宽度"
              data-no-window-drag
              onPointerDown={startSidebarResize}
            />
          )}
        </aside>
      )}

      {/* Main Content */}
      <main
        className={clsx(
          'app-main-shell flex-1 flex flex-col min-w-0 relative',
          hasGlobalSidebar && 'app-main-shell--layered'
        )}
      >
        {/* Content */}
        <div
          className={clsx(
            'flex-1',
            usesAppTitleBar && 'pt-[var(--app-titlebar-height)]',
            isFixedViewportView ? 'min-h-0 flex flex-col overflow-hidden' : 'overflow-auto'
          )}
        >
          {children}
        </div>
      </main>

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
