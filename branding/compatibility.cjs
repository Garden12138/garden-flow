'use strict';

const identity = require('./identity.json');
const aliases = identity.legacy;
const opaqueFields = new Set(['content', 'text', 'prompt', 'systemPrompt', 'system_prompt', 'objective', 'stepPrompt', 'body', 'markdown', 'description', 'summary', 'title', 'reasoning', 'tool_calls', 'tool_result']);
const identityFields = new Set(['mode', 'scope', 'sourceMode', 'source', 'type', 'kind', 'provider', 'preset', 'presetId', 'preset_id', 'sourceId', 'default_ai_source_id', 'model', 'modelId', 'modelName', 'defaultModel', 'id', 'skill', 'skillName', 'forcedSkillNames', 'models', 'name', 'appSlug', 'sourceType', 'actionType', 'uiHint', 'context', 'contextKey', 'context_key', 'contextType', 'contextId', 'source_type', 'source_mode', 'scope_id', 'runtimeMode', 'runtime_mode', 'sessionType']);

function canonicalKey(value) {
    if (Object.hasOwn(aliases.keys, value)) return aliases.keys[value];
    if (Object.hasOwn(aliases.values, value)) return aliases.values[value];
    // Only qualified storage / wire identifiers use prefix aliases, never prose.
    for (const [oldKey, newKey] of Object.entries(aliases.values).sort((a, b) => b[0].length - a[0].length)) {
        if (value.startsWith(`${oldKey}:`)) return newKey + value.slice(oldKey.length);
    }
    return value;
}

function canonicalValue(value) {
    return typeof value === 'string' && Object.hasOwn(aliases.values, value) ? aliases.values[value] : value;
}

function migrateStructured(value, field = '') {
    if (ArrayBuffer.isView(value)) return value;
    if (opaqueFields.has(field) || /(?:key|token|secret|password|endpoint|url)$/i.test(field)) return value;
    if (Array.isArray(value)) return value.map(item => migrateStructured(item, field));
    if (value && typeof value === 'object') {
        const result = {};
        for (const [key, item] of Object.entries(value)) {
            const target = canonicalKey(key);
            // A deliberately saved new key takes precedence over a legacy alias.
            if (target !== key && Object.hasOwn(value, target)) continue;
            result[target] = migrateStructured(item, target);
        }
        return result;
    }
    if (typeof value !== 'string') return value;
    if (field === 'contextId') {
        for (const [oldPrefix, newPrefix] of Object.entries(aliases.contextPrefixes)) {
            if (value.startsWith(oldPrefix)) return newPrefix + value.slice(oldPrefix.length);
        }
    }
    if (field.endsWith('_json')) {
        try {
            const parsed = JSON.parse(value);
            const next = migrateStructured(parsed, field.endsWith('models_json') ? 'models' : '');
            return JSON.stringify(parsed) === JSON.stringify(next) ? value : JSON.stringify(next);
        } catch { return value; }
    }
    if (identityFields.has(field) || /^(?:model_name|.*_model)(?:_|$)/.test(field)) return canonicalKey(value);
    return value;
}

function applyEnvironmentAliases(environment) {
    for (const [oldName, newName] of Object.entries(aliases.environment)) {
        if (environment[newName] === undefined && environment[oldName] !== undefined) environment[newName] = environment[oldName];
    }
}

function migrateStorage(storage) {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(Boolean);
    for (const key of keys) {
        const target = canonicalKey(key);
        if (target === key || storage.getItem(target) !== null) continue;
        const raw = storage.getItem(key);
        let next = raw;
        try { next = JSON.stringify(migrateStructured(JSON.parse(raw))); } catch { /* Keep non-JSON preferences. */ }
        storage.setItem(target, next);
    }
}

module.exports = { identity, canonicalKey, canonicalValue, migrateStructured, applyEnvironmentAliases, migrateStorage };
