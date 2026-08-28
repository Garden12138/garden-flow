import fs from 'node:fs';
import path from 'node:path';
import {
    runBrowserNativeHost,
    type BrowserNativeHostDiagnostic,
} from './browserNativeHostRuntime.ts';
import { browserCaptureStateRoot } from './core/browserCaptureProtocol.ts';

const LOG_MAX_BYTES = 1024 * 1024;
const stateRoot = browserCaptureStateRoot();
const logPath = path.join(stateRoot, 'native-host.log');

function prepareLogFile(): void {
    try {
        fs.mkdirSync(stateRoot, { recursive: true });
        if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= LOG_MAX_BYTES) return;
        const previousPath = path.join(stateRoot, 'native-host.previous.log');
        fs.rmSync(previousPath, { force: true });
        fs.renameSync(logPath, previousPath);
    } catch {
        // Native Messaging stdout is reserved for framed protocol messages.
    }
}

function writeDiagnostic(diagnostic: BrowserNativeHostDiagnostic): void {
    try {
        fs.appendFileSync(logPath, `${JSON.stringify({
            timestamp: new Date().toISOString(),
            pid: process.pid,
            ...diagnostic,
        })}\n`, 'utf8');
    } catch {
        // Diagnostics must never interfere with the Native Messaging protocol.
    }
}

function errorDetails(error: unknown): Record<string, unknown> {
    return {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
    };
}

prepareLogFile();
process.on('uncaughtException', (error) => {
    writeDiagnostic({ event: 'uncaught_exception', details: errorDetails(error) });
    process.exit(1);
});
process.on('unhandledRejection', (error) => {
    writeDiagnostic({ event: 'unhandled_rejection', details: errorDetails(error) });
    process.exitCode = 1;
});
process.on('exit', (code) => {
    writeDiagnostic({ event: 'host_exit', details: { code } });
});

void runBrowserNativeHost({ onDiagnostic: writeDiagnostic }).catch((error) => {
    writeDiagnostic({ event: 'startup_failed', details: errorDetails(error) });
    process.exitCode = 1;
});
