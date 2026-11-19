/**
 * The bottom tab bar's destinations, kept apart from the component so the
 * rules can be tested without loading the router or the icon font.
 */

export interface Tab {
  /** Where the tab goes. */
  href: string;
  labelKey: string;
  /** Ionicons glyph names, outline when inactive and filled when active. */
  icon: string;
  iconActive: string;
  /** The raised centre action that starts a report. */
  primary?: boolean;
}

export const TABS: Tab[] = [
  { href: "/", labelKey: "tabs.home", icon: "home-outline", iconActive: "home" },
  { href: "/feed", labelKey: "tabs.feed", icon: "newspaper-outline", iconActive: "newspaper" },
  { href: "/compose", labelKey: "tabs.report", icon: "add", iconActive: "add", primary: true },
  { href: "/org", labelKey: "tabs.org", icon: "briefcase-outline", iconActive: "briefcase" },
  { href: "/settings", labelKey: "tabs.settings", icon: "settings-outline", iconActive: "settings" },
];

/**
 * The tab bar shows on the top-level screens only. Inside a flow (onboarding,
 * writing a report, reading one) it would be one more way to lose your place.
 */
export function tabBarVisible(pathname: string): boolean {
  return TABS.some((tab) => !tab.primary && tab.href === pathname);
}
