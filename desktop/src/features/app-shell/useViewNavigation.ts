import { routeForView, viewForRoute, isAppRoute, type AppRoute } from './routes';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImmersiveMode, ViewType } from './types';
import { normalizeRestoredWorkbenchView, WORKBENCH_LEGAL_VIEWS } from '../workbench/navigation';

const LAST_VIEW_STORAGE_KEY = 'gardenflow:app-shell:last-view:v1';
const DEFAULT_VIEW: ViewType = 'home';
const MAX_CACHED_VIEWS = 0;
const APP_VIEWS = [...WORKBENCH_LEGAL_VIEWS] satisfies ViewType[];
const NON_CACHEABLE_VIEWS = new Set<ViewType>(APP_VIEWS);

function computeMountedViews(history: ViewType[]): Set<ViewType> {
  const next = new Set<ViewType>();
  const recent = history.slice(-MAX_CACHED_VIEWS);
  for (const view of recent) {
    if (!NON_CACHEABLE_VIEWS.has(view)) {
      next.add(view);
    }
  }
  return next;
}

export function shouldRenderView(
  mountedViews: Set<ViewType>,
  currentView: ViewType,
  persistentViews: Set<ViewType>,
  view: ViewType,
): boolean {
  if (currentView === view || persistentViews.has(view)) {
    return true;
  }
  if (NON_CACHEABLE_VIEWS.has(view)) {
    return false;
  }
  return mountedViews.has(view);
}

function readInitialView(): ViewType {
  if (typeof window === 'undefined') return DEFAULT_VIEW;
  try {
    return normalizeRestoredWorkbenchView(window.localStorage.getItem(LAST_VIEW_STORAGE_KEY));
  } catch (error) {
    console.warn('Failed to restore app shell view:', error);
    return DEFAULT_VIEW;
  }
}

function persistCurrentView(view: ViewType): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_VIEW_STORAGE_KEY, view);
  } catch (error) {
    console.warn('Failed to persist app shell view:', error);
  }
}

export function useViewNavigation() {
  const [route, setRoute] = useState<AppRoute>(() => routeForView(readInitialView()));
  const [currentView, setCurrentView] = useState<ViewType>(() => viewForRoute(route));
  const [routeScope, setRouteScope] = useState('');
  const navigated = useRef(false);
  useEffect(() => {
    let active = true;
    void window.ipcRenderer.spaces.list().then(result => {
      if (!active) return;
      const scope = 'gardenflow:route:v2:' + (result.activeSpaceId || 'default');
      try {
        const saved: unknown = JSON.parse(window.localStorage.getItem(scope) || 'null');
        if (isAppRoute(saved) && !navigated.current) { setRoute(saved); setCurrentView(viewForRoute(saved)); }
      } catch { /* Invalid saved UI state falls back to a legal legacy route. */ }
      setRouteScope(scope);
    }).catch(error => console.warn('Failed to read navigation space:', error));
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (viewForRoute(route) !== currentView && !(currentView === 'cover-studio' && route.page === 'generation')) setRoute(routeForView(currentView));
  }, [currentView, route]);
  useEffect(() => { if (routeScope) window.localStorage.setItem(routeScope, JSON.stringify(route)); }, [route, routeScope]);

  const [immersiveMode, setImmersiveMode] = useState<ImmersiveMode>(false);
  const [activeManuscriptEditorFile, setActiveManuscriptEditorFile] = useState<string | null>(null);
  const [activeVideoProjectId, setActiveVideoProjectId] = useState<string | null>(null);
  const [mountedViews, setMountedViews] = useState<Set<ViewType>>(() => computeMountedViews([currentView]));
  const [persistentViews, setPersistentViews] = useState<Set<ViewType>>(() => new Set());
  const viewHistoryRef = useRef<ViewType[]>([currentView]);

  useEffect(() => {
    viewHistoryRef.current = [...viewHistoryRef.current.filter((item) => item !== currentView), currentView];
    const nextMounted = computeMountedViews(viewHistoryRef.current);
    nextMounted.add(currentView);
    setMountedViews(nextMounted);
    persistCurrentView(currentView);
  }, [currentView]);

  const navigateToView = useCallback((view: ViewType) => {
    navigated.current = true;
    setActiveManuscriptEditorFile(null);
    setActiveVideoProjectId(null);
    setImmersiveMode(false);
    setCurrentView(view);
  }, []);

  const navigateToRoute = useCallback((next: AppRoute) => {
    if (!isAppRoute(next)) return;
    navigated.current = true;
    setActiveManuscriptEditorFile(null); setActiveVideoProjectId(null); setImmersiveMode(false);
    setRoute(next); setCurrentView(viewForRoute(next));
  }, []);

  const setViewPersistent = useCallback((view: ViewType, persistent: boolean) => {
    setPersistentViews((prev) => {
      const alreadyPersistent = prev.has(view);
      if (alreadyPersistent === persistent) {
        return prev;
      }
      const next = new Set(prev);
      if (persistent) {
        next.add(view);
      } else {
        next.delete(view);
      }
      return next;
    });
  }, []);

  const returnFromSettings = useCallback(() => {
    const previousView = [...viewHistoryRef.current].reverse().find((view) => view !== 'settings') || DEFAULT_VIEW;
    setCurrentView(previousView);
  }, []);

  return {
    currentView,
    route,
    navigateToRoute,
    setCurrentView,
    immersiveMode,
    setImmersiveMode,
    activeManuscriptEditorFile,
    setActiveManuscriptEditorFile,
    activeVideoProjectId,
    setActiveVideoProjectId,
    mountedViews,
    persistentViews,
    navigateToView,
    setViewPersistent,
    returnFromSettings,
  };
}
