import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePathname, useRouter, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TABS, tabBarVisible } from "./tabs";
import { colors, spacing } from "./theme";
import { t } from "./i18n";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** Bottom navigation for the top-level screens, with a raised "Report" action in the middle. */
export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  if (!tabBarVisible(pathname)) return null;

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]} accessibilityRole="tablist">
      {TABS.map((tab) => {
        const active = tab.href === pathname;
        const label = t(tab.labelKey);
        return (
          <Pressable
            key={tab.href}
            onPress={() => (tab.primary ? router.push(tab.href as Href) : router.navigate(tab.href as Href))}
            style={styles.item}
            accessibilityRole={tab.primary ? "button" : "tab"}
            aria-selected={active}
            accessibilityLabel={label}
          >
            {tab.primary ? (
              <View style={styles.primary}>
                <Ionicons name={tab.icon as IconName} size={28} color={colors.accentText} />
              </View>
            ) : (
              <Ionicons
                name={(active ? tab.iconActive : tab.icon) as IconName}
                size={22}
                color={active ? colors.accent : colors.textDim}
              />
            )}
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
  },
  item: { flex: 1, alignItems: "center", gap: 2, minHeight: 48, justifyContent: "flex-end" },
  primary: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginTop: -22,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: colors.surface,
  },
  label: { fontSize: 11, color: colors.textDim },
  labelActive: { color: colors.accent, fontWeight: "700" },
});
