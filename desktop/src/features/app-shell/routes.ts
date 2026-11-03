import type { ViewType } from './types';

type RoutePages = {
    home: 'continue' | 'pending';
    research: 'opportunities' | 'consumer' | 'topics' | 'maintenance';
    create: 'works' | 'campaigns' | 'assistant' | 'generation';
    publish: 'tasks' | 'history' | 'connections';
    review: 'observations' | 'experiments';
    library: 'materials' | 'products' | 'characters' | 'media' | 'profiles';
    automation: 'tasks' | 'runs' | 'approvals';
    settings: 'general' | 'ai' | 'connections' | 'skills' | 'members' | 'privacy';
};
export type AppSection = keyof RoutePages;
export type AppRoute = { [S in AppSection]: { section: S; page: RoutePages[S]; entityId?: string; entityKind?: 'redbook-note' | 'youtube-video' | 'document-source' } }[AppSection];
export interface RoutePage { route: AppRoute; label: string; view: ViewType; }
export interface RouteSection { id: AppSection; label: string; description: string; pages: RoutePage[]; }
export const APP_SECTIONS: readonly RouteSection[] = [
    { id: 'home', label: '工作台', description: '从真实需求到可发布作品', pages: [
        { route: { section: 'home', page: 'continue' }, label: '继续工作', view: 'home' },
        { route: { section: 'home', page: 'pending' }, label: '待处理', view: 'approval' },
    ] },
    { id: 'research', label: '研究与选题', description: '从资料与评论中找到值得做的方向', pages: [
        { route: { section: 'research', page: 'opportunities' }, label: '消费者机会', view: 'opportunities' },
        { route: { section: 'research', page: 'consumer' }, label: '消费者研究', view: 'consumer-research' },
        { route: { section: 'research', page: 'topics' }, label: '灵感选题', view: 'wander' },
        { route: { section: 'research', page: 'maintenance' }, label: '来源复核', view: 'source-maintenance' },
    ] },
    { id: 'create', label: '创作', description: '让每一个方向成为可以持续编辑的作品', pages: [
        { route: { section: 'create', page: 'works' }, label: '我的作品', view: 'works' },
        { route: { section: 'create', page: 'campaigns' }, label: '成组内容', view: 'campaigns' },
        { route: { section: 'create', page: 'assistant' }, label: 'AI 助手', view: 'gardenflow' },
        { route: { section: 'create', page: 'generation' }, label: '生成工具', view: 'generation-studio' },
    ] },
    { id: 'publish', label: '发布', description: '核对作品、账号与页面，清楚掌握发布进度', pages: [
        { route: { section: 'publish', page: 'tasks' }, label: '发布任务', view: 'publication' },
        { route: { section: 'publish', page: 'history' }, label: '发布历史', view: 'publication-history' },
        { route: { section: 'publish', page: 'connections' }, label: '账号与连接', view: 'publication-connections' },
    ] },
    { id: 'review', label: '复盘', description: '保留真实反馈，为下一轮找到依据', pages: [
        { route: { section: 'review', page: 'observations' }, label: '作品表现', view: 'observations' },
        { route: { section: 'review', page: 'experiments' }, label: '内容实验', view: 'experiments' },
    ] },
    { id: 'library', label: '资源库', description: '复用资料、商品与媒体，让上下文跟随创作', pages: [
        { route: { section: 'library', page: 'materials' }, label: '资料', view: 'knowledge' },
        { route: { section: 'library', page: 'products' }, label: '商品与品牌', view: 'subjects' },
        { route: { section: 'library', page: 'characters' }, label: '角色与声音', view: 'characters' },
        { route: { section: 'library', page: 'media' }, label: '媒体', view: 'media-library' },
        { route: { section: 'library', page: 'profiles' }, label: '风格档案', view: 'archives' },
    ] },
    { id: 'automation', label: '自动化', description: '可追踪、可停止的后台任务', pages: [
        { route: { section: 'automation', page: 'tasks' }, label: '自动任务', view: 'automation' },
        { route: { section: 'automation', page: 'runs' }, label: '运行记录', view: 'automation-history' },
        { route: { section: 'automation', page: 'approvals' }, label: '待确认', view: 'approval' },
    ] },
    { id: 'settings', label: '设置', description: '按需配置，随时继续当前工作', pages: [
        { route: { section: 'settings', page: 'general' }, label: '通用', view: 'settings' },
        { route: { section: 'settings', page: 'ai' }, label: 'AI 服务', view: 'settings' },
        { route: { section: 'settings', page: 'connections' }, label: '连接', view: 'settings' },
        { route: { section: 'settings', page: 'skills' }, label: '技能', view: 'skills' },
        { route: { section: 'settings', page: 'members' }, label: '成员', view: 'members' },
        { route: { section: 'settings', page: 'privacy' }, label: '隐私与诊断', view: 'settings' },
    ] },
];
export const ROUTE_PAGES = APP_SECTIONS.flatMap(section => section.pages);
export function isAppRoute(value: unknown): value is AppRoute {
    if (!value || typeof value !== 'object') return false;
    const route = value as Record<string, unknown>;
    return ROUTE_PAGES.some(item => item.route.section === route.section && item.route.page === route.page)
        && (route.entityKind === undefined || ['redbook-note', 'youtube-video', 'document-source'].includes(String(route.entityKind)))
        && (route.entityId === undefined || typeof route.entityId === 'string' && route.entityId.length <= 500);
}
export function viewForRoute(route: AppRoute): ViewType {
    return ROUTE_PAGES.find(item => item.route.section === route.section && item.route.page === route.page)?.view || 'home';
}
export function routeForView(view: ViewType): AppRoute {
    if (view === 'cover-studio') return { section: 'create', page: 'generation' };
    return ROUTE_PAGES.find(item => item.view === view)?.route || { section: 'home', page: 'continue' };
}
