import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import compatibility from '../shared/brandCompatibility.cjs';
import { configureMigratedPaths } from './core/legacyPathResolver';

compatibility.applyEnvironmentAliases(process.env);
const userData = process.env.GARDENFLOW_USER_DATA_DIR || path.join(app.getPath('appData'), compatibility.identity.displayName);
fs.mkdirSync(userData, { recursive: true });
app.setName(compatibility.identity.displayName);
app.setPath('userData', userData);
app.setPath('sessionData', userData);
const migrationFile = path.join(userData, '.gardenflow-migration.json');
if (fs.existsSync(migrationFile)) configureMigratedPaths(JSON.parse(fs.readFileSync(migrationFile, 'utf8')).pathAliases || []);

// Aliases share the same validated handler. A call is dispatched exactly once.
const registerHandler = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => {
    registerHandler(channel, (event, ...args) => listener(event, ...args.map(value => compatibility.migrateStructured(value))));
    for (const [legacy, current] of Object.entries(compatibility.identity.legacy.values)) {
        if (legacy !== channel && current === channel && legacy.includes(':')) {
            registerHandler(legacy, (event, ...args) => listener(event, ...args.map(value => compatibility.migrateStructured(value))));
        }
    }
};

export function assertDataMigrationReady(): void {
    if (fs.existsSync(path.join(userData, compatibility.identity.database))) return;
    if (process.env.GARDENFLOW_USER_DATA_DIR) return;
    const sources = compatibility.identity.legacy.userDataNames
        .map(name => path.join(app.getPath('appData'), name, compatibility.identity.legacy.database))
        .filter(file => fs.existsSync(file));
    if (sources.length) throw new Error('发现已有数据。请先退出旧应用并运行 pnpm migrate:data --dry-run，再执行备份迁移；GardenFlow 不会创建空数据库覆盖旧数据。');
}
