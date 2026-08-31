import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export function readMigrationState(): { automationHold?: boolean; skipCatchUpBefore?: number; pathAliases?: Array<{ from: string; to: string }> } {
    const file = path.join(app.getPath('userData'), '.gardenflow-migration.json');
    if (!fs.existsSync(file)) return {};
    // Corrupt migration state must fail closed, never silently start background jobs.
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function backgroundAutomationHeld(): boolean {
    return process.env.GARDENFLOW_HOLD_AUTOMATION === '1' || readMigrationState().automationHold === true;
}
