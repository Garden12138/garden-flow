declare const compatibility: {
    identity: { displayName: string; slug: string; appId: string; nativeHost: string; assetProtocol: string; database: string; workspaceDirectory: string; repository: string; updatesEnabled: boolean; legacy: { userDataNames: string[]; displayNames: string[]; browserExtensionExportPaths: string[]; cliExecutables: string[]; database: string; workspaceDirectory: string; projectDirectory: string; nativeHost: string; assetProtocols: string[]; videoEndpoint: string; keys: Record<string, string>; values: Record<string, string>; contextPrefixes: Record<string, string>; environment: Record<string, string> } };
    canonicalKey(value: string): string;
    canonicalValue<T>(value: T): T;
    migrateStructured<T>(value: T, field?: string): T;
    applyEnvironmentAliases(environment: NodeJS.ProcessEnv): void;
    migrateStorage(storage: Storage): void;
};
export = compatibility;
