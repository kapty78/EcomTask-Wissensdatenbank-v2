/** Phosphor-Regular-Äquivalent: 2px bei 24px → skaliert auf Sidebar-Größe */
export const SIDEBAR_ICON_SIZE = 12;
/** Verschachtelte Sidebar-Icons (Agenten-Untermenü) */
export const SIDEBAR_SUB_ICON_SIZE = 12;
/** App-Icon-Mark im Sidebar-Header */
export const SIDEBAR_BRAND_MARK_SIZE = 34;
/** Logo in Process-Logs & Eingabeleisten (Dashboard / breite Felder) */
export const INPUT_LOGO_SIZE = 20;
/** Logo in kompakten Eingabeleisten */
export const INPUT_LOGO_SIZE_COMPACT = 16;
/** Logo in Cockpit / Agent-Launcher Hero */
export const HERO_LOGO_SIZE = 48;
/** Logo im Text-Selection-Orb */
export const ORB_LOGO_SIZE = 16;
/** Logo auf Auth-Seiten (Login, Magic Link, …) */
export const AUTH_LOGO_SIZE = 32;
/** Default-Größen für SupportAiLogo */
export const LOGO_SIZE_ICON = 22;
export const LOGO_SIZE_FULL = 26;
/** Loading-Screen Logo-Größen */
export const LOADING_LOGO_SIZES = { sm: 28, md: 36, lg: 44 } as const;
export const SIDEBAR_ICON_WEIGHT = "regular" as const;

export const sidebarNavIconClass =
  "h-[12px] w-[12px] shrink-0 transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-110 group-hover:text-foreground pointer-events-none";

export const sidebarSubNavIconClass =
  "h-[12px] w-[12px] shrink-0 transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-110 group-hover:text-foreground pointer-events-none";
