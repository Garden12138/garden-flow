import identity from './brand.generated.json';

declare const compatibility: {
    identity: typeof identity;
    canonicalKey(value: string): string;
    canonicalValue<T>(value: T): T;
    migrateStructured<T>(value: T, field?: string): T;
    applyEnvironmentAliases(environment: NodeJS.ProcessEnv): void;
    migrateStorage(storage: Storage): void;
};

export const canonicalKey: typeof compatibility.canonicalKey;
export const canonicalValue: typeof compatibility.canonicalValue;
export const migrateStructured: typeof compatibility.migrateStructured;
export const applyEnvironmentAliases: typeof compatibility.applyEnvironmentAliases;
export const migrateStorage: typeof compatibility.migrateStorage;
export { identity };
export default compatibility;
