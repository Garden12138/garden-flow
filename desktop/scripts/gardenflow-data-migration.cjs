'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const compatibility = require('../shared/brandCompatibility.cjs');
const { identity, migrateStructured, canonicalKey } = compatibility;
const MARKER = '.gardenflow-migration.json';
const TRANSIENT = new Set(['SingletonLock', 'SingletonSocket', 'SingletonCookie']);
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
// These are immutable evidence/history, not current routing configuration.
const HISTORICAL_TABLES = new Set(['session_transcript_records', 'session_checkpoints', 'session_tool_results', 'runtime_events', 'agent_task_traces', 'acp_runs', 'acp_run_events', 'acp_artifacts', 'file_index_events']);

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, file);
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function inventory(root) {
    const result = {};
    if (!fs.existsSync(root)) return result;
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (TRANSIENT.has(entry.name)) continue;
            const file = path.join(dir, entry.name);
            const relative = path.relative(root, file);
            if (entry.isDirectory()) walk(file);
            else if (entry.isSymbolicLink()) result[relative] = { symlink: fs.readlinkSync(file) };
            else if (entry.isFile()) {
                const bytes = fs.readFileSync(file);
                result[relative] = { bytes: bytes.length, sha256: hash(bytes) };
            }
        }
    }
    walk(root);
    return result;
}

function copyVerified(source, target) {
    const before = inventory(source);
    fs.cpSync(source, target, { recursive: true, dereference: false, verbatimSymlinks: true, filter: file => !TRANSIENT.has(path.basename(file)) });
    if (JSON.stringify(before) !== JSON.stringify(inventory(source)) || JSON.stringify(before) !== JSON.stringify(inventory(target))) {
        throw new Error('Data changed during backup or backup verification failed. Close all writers and retry.');
    }
    return before;
}

function defaults(options = {}) {
    const home = options.home || os.homedir();
    const appData = process.platform === 'darwin' ? path.join(home, 'Library/Application Support')
        : process.platform === 'win32' ? (process.env.APPDATA || path.join(home, 'AppData/Roaming'))
            : (process.env.XDG_CONFIG_HOME || path.join(home, '.config'));
    return {
        sourceUserData: path.join(appData, identity.legacy.userDataNames[0]),
        sourceWorkspace: path.join(home, identity.legacy.workspaceDirectory),
        targetUserData: path.join(appData, identity.displayName),
        targetWorkspace: path.join(home, identity.workspaceDirectory),
        backupRoot: path.join(home, '.gardenflow-backups'),
        archiveConflicts: false,
        ...options,
    };
}

function validatePaths(options) {
    const roots = ['sourceUserData', 'sourceWorkspace', 'targetUserData', 'targetWorkspace', 'backupRoot'].map(key => path.resolve(options[key]));
    for (let i = 0; i < roots.length; i++) {
        for (let j = i + 1; j < roots.length; j++) {
            const relative = path.relative(roots[i], roots[j]);
            const reverse = path.relative(roots[j], roots[i]);
            if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative)) || (!reverse.startsWith('..') && !path.isAbsolute(reverse))) {
                throw new Error('Migration roots must be separate, non-nested directories.');
            }
        }
    }
    for (const key of ['sourceUserData', 'sourceWorkspace', 'targetUserData', 'targetWorkspace']) {
        if (fs.existsSync(options[key]) && fs.lstatSync(options[key]).isSymbolicLink()) throw new Error('Migration roots cannot be symbolic links.');
    }
}

function projectPath(relative) {
    const parts = relative.split(path.sep);
    if (parts[0] === identity.legacy.projectDirectory) parts[0] = identity.slug;
    if (parts[0] === 'spaces' && parts[2] === identity.legacy.projectDirectory) parts[2] = identity.slug;
    return parts.join(path.sep);
}

function mapPath(value, sourceRoot, targetRoot) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) return value;
    const relative = path.relative(sourceRoot, path.normalize(value));
    if (relative.startsWith('..') || path.isAbsolute(relative)) return value;
    return path.join(targetRoot, projectPath(relative));
}

function migrateRecord(record, options) {
    const result = migrateStructured(record);
    // Only typed path fields are rewritten. URLs and prose retain their bytes.
    function paths(object) {
        if (ArrayBuffer.isView(object)) return object;
        if (Array.isArray(object)) return object.map(paths);
        if (!object || typeof object !== 'object') return object;
        return Object.fromEntries(Object.entries(object).map(([key, value]) => {
            if (typeof value === 'string' && /^(?:workspace_dir|workspaceRoot|workspacePath|file_path|filePath|source_path|sourcePath|absolute_path|absolutePath|projectPath|directory|cwd)$/.test(key)) {
                return [key, mapPath(value, options.sourceWorkspace, options.targetWorkspace)];
            }
            if (key.endsWith('_json') && typeof value === 'string') {
                try {
                    const parsed = JSON.parse(value);
                    const next = paths(parsed);
                    return [key, JSON.stringify(parsed) === JSON.stringify(next) ? value : JSON.stringify(next)];
                } catch { return [key, value]; }
            }
            return [key, paths(value)];
        }));
    }
    return paths(result);
}

function migrateDatabaseRecord(table, record, options) {
    if (HISTORICAL_TABLES.has(table)) return record;
    const expected = migrateRecord(record, options);
    if (Object.hasOwn(record, 'id')) expected.id = record.id;
    for (const [key, value] of Object.entries(expected)) {
        if (typeof value !== 'string' || !['metadata', 'config', 'settings'].includes(key)) continue;
        try {
            const parsed = JSON.parse(value);
            const next = migrateRecord(parsed, options);
            if (JSON.stringify(parsed) !== JSON.stringify(next)) expected[key] = JSON.stringify(next);
        } catch { /* Non-JSON values remain unchanged. */ }
    }
    return expected;
}

function databaseSnapshot(db) {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const result = {};
    for (const { name } of tables) result[name] = db.prepare(`SELECT * FROM ${quote(name)} ORDER BY rowid`).all();
    return result;
}

function migrateDatabase(file, options, Database) {
    const db = new Database(file);
    try {
        const check = db.prepare('PRAGMA integrity_check').get();
        if (Object.values(check)[0] !== 'ok') throw new Error('Source SQLite integrity check failed.');
        const before = databaseSnapshot(db);
        const changes = {};
        db.exec('BEGIN IMMEDIATE');
        try {
            for (const [table, records] of Object.entries(before)) {
                const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all();
                for (const column of columns) {
                    const target = canonicalKey(column.name);
                    if (target !== column.name) {
                        if (columns.some(item => item.name === target)) throw new Error(`Conflicting SQLite column in ${table}: ${target}`);
                        db.exec(`ALTER TABLE ${quote(table)} RENAME COLUMN ${quote(column.name)} TO ${quote(target)}`);
                    }
                }
                const rows = db.prepare(`SELECT rowid AS __migration_rowid__, * FROM ${quote(table)} ORDER BY rowid`).all();
                for (let index = 0; index < rows.length; index++) {
                    const row = rows[index];
                    const expected = migrateDatabaseRecord(table, records[index], options);
                    const changed = Object.keys(expected).filter(key => expected[key] !== row[key] && !(expected[key] instanceof Uint8Array));
                    for (const key of changed) changes[`${table}.${key}`] = (changes[`${table}.${key}`] || 0) + 1;
                    if (changed.length) db.prepare(`UPDATE ${quote(table)} SET ${changed.map(key => `${quote(key)} = ?`).join(', ')} WHERE rowid = ?`).run(...changed.map(key => expected[key]), row.__migration_rowid__);
                }
            }
            db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        const after = databaseSnapshot(db);
        for (const [table, records] of Object.entries(before)) {
            if (records.length !== after[table].length) throw new Error(`Record count mismatch: ${table}`);
            for (let i = 0; i < records.length; i++) {
                const expected = migrateDatabaseRecord(table, records[i], options);
                if (JSON.stringify(expected) !== JSON.stringify(after[table][i])) throw new Error(`Unexplained SQLite difference: ${table} row ${i}`);
                for (const [key, value] of Object.entries(records[i])) {
                    if (['id', 'content', 'text', 'title', 'prompt', 'embedding', 'tool_calls', 'tool_result', 'timestamp', 'created_at'].includes(key)) {
                        if (JSON.stringify(value) !== JSON.stringify(after[table][i][key])) throw new Error(`Protected data changed: ${table}.${key}`);
                    }
                }
            }
        }
        if (Object.values(db.prepare('PRAGMA integrity_check').get())[0] !== 'ok') throw new Error('Migrated SQLite integrity check failed.');
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        return {
            counts: Object.fromEntries(Object.entries(after).map(([table, records]) => [table, records.length])),
            changes,
            historyHashes: Object.fromEntries(Object.entries(before).filter(([table]) => HISTORICAL_TABLES.has(table)).map(([table, records]) => [table, hash(JSON.stringify(records))])),
        };
    } finally { db.close(); }
}

function migrateWorkspace(root, options) {
    const source = inventory(root);
    const projectRoots = [path.join(root, identity.legacy.projectDirectory)];
    const spacesRoot = path.join(root, 'spaces');
    if (fs.existsSync(spacesRoot)) {
        for (const space of fs.readdirSync(spacesRoot, { withFileTypes: true })) {
            if (space.isDirectory()) projectRoots.push(path.join(spacesRoot, space.name, identity.legacy.projectDirectory));
        }
    }
    for (const directory of projectRoots.filter(file => fs.existsSync(file))) {
        if (!fs.lstatSync(directory).isDirectory()) throw new Error('Application project root must be a directory, not a link.');
        const target = path.join(path.dirname(directory), identity.slug);
        if (fs.existsSync(target)) throw new Error(`Workspace path collision: ${target}`);
        fs.renameSync(directory, target);
    }
    for (const relative of Object.keys(source)) {
        const targetRelative = projectPath(relative);
        const target = path.join(root, targetRelative);
        // Only application-managed project/settings JSON is transformed.
        if (target.endsWith('.json') && !source[relative].symlink && (targetRelative.split(path.sep).includes(identity.slug) || /(?:settings|config)\.json$/.test(targetRelative))) {
            let value;
            try { value = JSON.parse(fs.readFileSync(target, 'utf8')); } catch { continue; }
            const next = migrateRecord(value, options);
            if (JSON.stringify(value) !== JSON.stringify(next)) writeJson(target, next);
        }
    }
    // Whole directory renames preserve empty user directories as well as files.
    const target = inventory(root);
    return Object.entries(source).map(([from, previous]) => {
        const to = projectPath(from);
        if (!target[to]) throw new Error(`Missing migrated file: ${to}`);
        const changed = JSON.stringify(previous) !== JSON.stringify(target[to]);
        if (changed && !to.endsWith('.json')) throw new Error(`Non-JSON content changed: ${to}`);
        return { from, to, before: previous, after: target[to], transformation: changed ? 'structured-metadata' : 'unchanged' };
    });
}

function rollback(journalPath) {
    const journal = readJson(journalPath);
    if (journal.phase === 'rolled_back') return journal;
    for (const [kind, target] of [['userData', journal.options.targetUserData], ['workspace', journal.options.targetWorkspace]]) {
        const marker = path.join(target, MARKER);
        if (fs.existsSync(marker) && readJson(marker).id === journal.id) {
            const preserved = path.join(journal.backup, `rolled-back-${kind}-${Date.now()}`);
            fs.renameSync(target, preserved);
        }
        const archived = path.join(journal.backup, `existing-${kind}`);
        if (fs.existsSync(archived)) {
            if (fs.existsSync(target)) throw new Error(`Refusing to overwrite newer data during rollback: ${target}`);
            fs.renameSync(archived, target);
        }
    }
    journal.phase = 'rolled_back';
    writeJson(journalPath, journal);
    return journal;
}

function migrateData(input, Database) {
    const options = defaults(input);
    validatePaths(options);
    const markerPath = path.join(options.targetUserData, MARKER);
    if (fs.existsSync(markerPath)) {
        const marker = readJson(markerPath);
        if (fs.existsSync(path.join(options.targetWorkspace, MARKER)) && readJson(path.join(options.targetWorkspace, MARKER)).id === marker.id) {
            return { status: 'already_migrated', marker };
        }
        throw new Error('Incomplete migration. Recover using its journal before retrying.');
    }
    const sourceDatabase = path.join(options.sourceUserData, identity.legacy.database);
    if (!fs.existsSync(sourceDatabase) || !fs.existsSync(options.sourceWorkspace)) throw new Error('Migration source database/workspace is missing.');
    const conflicts = [options.targetUserData, options.targetWorkspace].filter(dir => fs.existsSync(dir) && fs.readdirSync(dir).length);
    if (options.dryRun) return { status: 'dry_run', options, conflicts, workspaceFiles: Object.keys(inventory(options.sourceWorkspace)).length };
    if (conflicts.length && !options.archiveConflicts) throw new Error('Target contains data. Review dry-run and explicitly allow archiving; data is never merged.');
    if (fs.existsSync(options.backupRoot)) {
        for (const name of fs.readdirSync(options.backupRoot)) {
            const file = path.join(options.backupRoot, name, 'journal.json');
            if (!fs.existsSync(file)) continue;
            const previous = readJson(file);
            if (!['complete', 'rolled_back'].includes(previous.phase) && previous.options.targetUserData === options.targetUserData) {
                throw new Error(`Unfinished migration; recover first with --rollback ${file}`);
            }
        }
    }
    const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
    const backup = path.join(options.backupRoot, id);
    const stageUserData = path.join(path.dirname(options.targetUserData), `.gardenflow-userdata-stage-${id}`);
    const stageWorkspace = path.join(path.dirname(options.targetWorkspace), `.gardenflow-workspace-stage-${id}`);
    fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
    const journalPath = path.join(backup, 'journal.json');
    const journal = { id, options, backup, stageUserData, stageWorkspace, phase: 'backing_up' };
    writeJson(journalPath, journal);
    const sourceUserDataInventory = copyVerified(options.sourceUserData, path.join(backup, 'source-userData'));
    const sourceWorkspaceInventory = copyVerified(options.sourceWorkspace, path.join(backup, 'source-workspace'));
    copyVerified(path.join(backup, 'source-userData'), stageUserData);
    copyVerified(path.join(backup, 'source-workspace'), stageWorkspace);
    fs.chmodSync(stageUserData, 0o700);
    fs.chmodSync(stageWorkspace, 0o700);
    // A previous, unrelated named database is archived with the full source copy, not selected or merged.
    for (const suffix of ['', '-wal', '-shm']) {
        const candidate = path.join(stageUserData, identity.database + suffix);
        if (fs.existsSync(candidate)) fs.renameSync(candidate, path.join(backup, `preexisting-${identity.database}${suffix}`));
    }
    for (const suffix of ['', '-wal', '-shm']) {
        const oldFile = path.join(stageUserData, identity.legacy.database + suffix);
        if (fs.existsSync(oldFile)) fs.renameSync(oldFile, path.join(stageUserData, identity.database + suffix));
    }
    const databaseVerification = migrateDatabase(path.join(stageUserData, identity.database), options, Database);
    const { counts } = databaseVerification;
    const files = migrateWorkspace(stageWorkspace, options);
    const marker = { schemaVersion: 1, id, journalPath, automationHold: true, skipCatchUpBefore: Date.now(), pathAliases: [{ from: options.sourceWorkspace, to: options.targetWorkspace }] };
    writeJson(path.join(stageUserData, MARKER), marker);
    writeJson(path.join(stageWorkspace, MARKER), marker);
    writeJson(path.join(backup, 'verification.json'), { ...databaseVerification, files, sourceUserDataInventory, sourceWorkspaceInventory });
    if (JSON.stringify(sourceUserDataInventory) !== JSON.stringify(inventory(options.sourceUserData)) || JSON.stringify(sourceWorkspaceInventory) !== JSON.stringify(inventory(options.sourceWorkspace))) throw new Error('Source changed during migration; cutover cancelled.');
    journal.phase = 'verified'; writeJson(journalPath, journal);
    try {
        for (const [kind, target, stage] of [['workspace', options.targetWorkspace, stageWorkspace], ['userData', options.targetUserData, stageUserData]]) {
            if (fs.existsSync(target)) fs.renameSync(target, path.join(backup, `existing-${kind}`));
            journal.phase = `archived_${kind}`; writeJson(journalPath, journal);
            if (input.failAt === `archived_${kind}`) throw new Error('Injected cutover failure');
            fs.renameSync(stage, target);
            journal.phase = `installed_${kind}`; writeJson(journalPath, journal);
        }
        journal.phase = 'complete'; writeJson(journalPath, journal);
    } catch (error) { rollback(journalPath); throw error; }
    return { status: 'migrated', journalPath, counts, fileCount: files.length, marker };
}

function resumeAutomation(userData) {
    const file = path.join(userData, MARKER);
    const marker = readJson(file);
    marker.automationHold = false;
    marker.skipCatchUpBefore = Date.now();
    writeJson(file, marker);
    return { status: 'automation_released', skipCatchUpBefore: marker.skipCatchUpBefore };
}

function assertNoOpenFiles(roots) {
    if (process.platform !== 'darwin') return;
    for (const root of roots.filter(file => fs.existsSync(file))) {
        let output;
        try { output = execFileSync('/usr/sbin/lsof', ['-t', '+D', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch (error) { if (error.status === 1 && !error.stderr?.length) continue; throw new Error(`Cannot confirm that data writers are closed: ${root}`); }
        if (output.trim()) throw new Error(`Close the application and all background writers before migration: ${root}`);
    }
}

module.exports = { MARKER, defaults, inventory, mapPath, projectPath, migrateRecord, migrateDatabaseRecord, databaseSnapshot, migrateData, migrateDatabase, rollback, resumeAutomation };

if (require.main === module) {
    const arguments_ = process.argv.slice(2);
    const options = {};
    const names = { '--source-user-data': 'sourceUserData', '--source-workspace': 'sourceWorkspace', '--target-user-data': 'targetUserData', '--target-workspace': 'targetWorkspace', '--backup-root': 'backupRoot' };
    try {
        for (let i = 0; i < arguments_.length; i++) {
            const item = arguments_[i];
            if (names[item]) { if (!arguments_[i + 1]) throw new Error(`Missing value: ${item}`); options[names[item]] = path.resolve(arguments_[++i]); }
            else if (item === '--dry-run') options.dryRun = true;
            else if (item === '--archive-conflicts') options.archiveConflicts = true;
            else if (item === '--rollback') options.rollback = arguments_[++i];
            else if (item === '--resume-automation') options.resumeAutomation = true;
            else throw new Error(`Unknown argument: ${item}`);
        }
        if (!options.dryRun) {
            const resolved = options.rollback ? readJson(path.resolve(options.rollback)).options : defaults(options);
            assertNoOpenFiles([resolved.sourceUserData, resolved.sourceWorkspace, resolved.targetUserData, resolved.targetWorkspace]);
        }
        const { DatabaseSync } = require('node:sqlite');
        const result = options.rollback ? rollback(path.resolve(options.rollback)) : options.resumeAutomation ? resumeAutomation(defaults(options).targetUserData) : migrateData(options, DatabaseSync);
        console.log(JSON.stringify(result, null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
