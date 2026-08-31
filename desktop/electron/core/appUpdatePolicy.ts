export const GARDENFLOW_UPDATE_REPOSITORY = 'Garden12138/garden-flow';
export const GARDENFLOW_UPDATE_LATEST_RELEASE_API_URL = `https://api.github.com/repos/${GARDENFLOW_UPDATE_REPOSITORY}/releases/latest`;

export type AppUpdateAsset = {
    name: string;
    downloadUrl: string;
    size: number;
    digest: string;
};

const INSTALLER_EXTENSIONS: Partial<Record<NodeJS.Platform, string[]>> = {
    darwin: ['dmg', 'zip'],
    win32: ['exe'],
    linux: ['appimage', 'deb', 'rpm'],
};

const ARCH_ALIASES: Partial<Record<NodeJS.Architecture, string[]>> = {
    arm64: ['arm64', 'aarch64'],
    x64: ['x64', 'amd64'],
    ia32: ['ia32', 'x86'],
};

export function selectCompatibleGardenFlowReleaseAsset(
    assets: AppUpdateAsset[],
    platform: NodeJS.Platform = process.platform,
    architecture: NodeJS.Architecture = process.arch,
): AppUpdateAsset | null {
    const extensions = INSTALLER_EXTENSIONS[platform] || [];
    const architectureAliases = ARCH_ALIASES[architecture] || [architecture.toLowerCase()];
    return assets
        .map((asset) => {
            const match = /^GardenFlow-(.+)-([A-Za-z0-9_]+)\.([A-Za-z0-9]+)$/i.exec(asset.name);
            if (!match) return null;
            const assetArchitecture = match[2].toLowerCase();
            const extension = match[3].toLowerCase();
            if (!architectureAliases.includes(assetArchitecture) || !extensions.includes(extension)) return null;
            return {
                asset,
                extensionRank: extensions.indexOf(extension),
            };
        })
        .filter((candidate): candidate is { asset: AppUpdateAsset; extensionRank: number } => Boolean(candidate))
        .sort((left, right) => left.extensionRank - right.extensionRank)[0]?.asset || null;
}
