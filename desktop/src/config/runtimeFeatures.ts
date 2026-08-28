const isExplicitlyEnabled = (value: unknown): boolean => (
    String(value ?? '').trim().toLowerCase() === 'true'
);

const isExplicitlyDisabled = (value: unknown): boolean => (
    String(value ?? '').trim().toLowerCase() === 'false'
);

export const RUNTIME_FEATURES = Object.freeze({
    // Official account/login is not part of the standard local desktop build.
    // Keep it opt-in so a fresh packaging machine never shows an unusable login gate.
    officialAccountAuth: isExplicitlyEnabled(import.meta.env.VITE_OFFICIAL_ACCOUNT_AUTH),
    // The official AI source is served by a privately deployed new-api gateway:
    // base URL is locked by code, auth is a gateway token, no account login required.
    // Mutually exclusive with officialAccountAuth; brand variants that ship without
    // the gateway can opt out with VITE_PRIVATE_GATEWAY=false.
    privateGateway: !isExplicitlyDisabled(import.meta.env.VITE_PRIVATE_GATEWAY)
        && !isExplicitlyEnabled(import.meta.env.VITE_OFFICIAL_ACCOUNT_AUTH),
});
