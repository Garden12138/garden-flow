import generatedBrand from './brand.generated.json';
import { resolveRuntimeAssetUrl } from '../utils/runtimeAssetUrl';

type GeneratedBrandConfig = {
  variant?: string;
  displayName?: string;
  windowTitle?: string;
  htmlTitle?: string;
  aiDisplayName?: string;
  logoSrc?: string;
  tagline?: string;
  visibleSettingsTabs?: string[];
  theme?: AppBrandTheme;
};

const config = generatedBrand as GeneratedBrandConfig;

export type AppBrandThemeModeTokens = Partial<{
  background: string;
  surfacePrimary: string;
  surfaceSecondary: string;
  surfaceTertiary: string;
  surfaceElevated: string;
  border: string;
  divider: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  accentPrimary: string;
  accentHover: string;
  accentMuted: string;
  accentBorder: string;
  focusRing: string;
  primary: string;
  primaryHover: string;
  primaryPressed: string;
  primaryText: string;
  statusSuccess: string;
  statusWarning: string;
  statusError: string;
  successBg: string;
  successText: string;
  warningBg: string;
  warningText: string;
  dangerBg: string;
  dangerText: string;
  info: string;
  infoBg: string;
  infoText: string;
  brandIris: string;
  brandLeaf: string;
  brandGold: string;
  accentSecondary: string;
  accentSecondaryMuted: string;
  accentGold: string;
  appShellBackground: string;
  sidebarBackground: string;
  sidebarItemColor: string;
  sidebarItemHoverBackground: string;
  sidebarItemHoverColor: string;
  sidebarItemActiveBackground: string;
  sidebarItemActiveColor: string;
  sidebarItemActiveIconColor: string;
  sidebarNewChatBackground: string;
  sidebarNewChatHoverBackground: string;
  sidebarNewChatColor: string;
  cardShadow: string;
  cardHoverShadow: string;
  aiPanelBackground: string;
  aiPanelBorder: string;
  aiPanelShadow: string;
  aiChipBackground: string;
  aiChipColor: string;
  aiChipBorder: string;
  moduleIdeateBg: string;
  moduleIdeateIcon: string;
  moduleWriteBg: string;
  moduleWriteIcon: string;
  moduleRepurposeBg: string;
  moduleRepurposeIcon: string;
  moduleScheduleBg: string;
  moduleScheduleIcon: string;
  moduleAnalyticsBg: string;
  moduleAnalyticsIcon: string;
  moduleBrandBg: string;
  moduleBrandIcon: string;
}>;

export type AppBrandTheme = Partial<{
  light: AppBrandThemeModeTokens;
  dark: AppBrandThemeModeTokens;
}>;

export const APP_BRAND = {
  variant: String(config.variant || 'gardenflow'),
  displayName: String(config.displayName || 'GardenFlow'),
  windowTitle: String(config.windowTitle || config.displayName || 'GardenFlow'),
  htmlTitle: String(config.htmlTitle || config.windowTitle || config.displayName || 'GardenFlow'),
  aiDisplayName: String(config.aiDisplayName || config.displayName || 'GardenFlow'),
  logoSrc: resolveRuntimeAssetUrl(String(config.logoSrc || 'branding/app-icon.png')),
  tagline: String(config.tagline || ''),
  visibleSettingsTabs: Array.isArray(config.visibleSettingsTabs)
    ? config.visibleSettingsTabs.map((tab) => String(tab || '').trim()).filter(Boolean)
    : [],
  theme: config.theme || {},
} as const;
