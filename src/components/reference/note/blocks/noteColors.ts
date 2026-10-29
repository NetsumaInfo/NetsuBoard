// Soft dark label palette shared by the callout block and its colour picker.
import i18n from "@/i18n";

export const DB_COLORS: { key: string; label: string; bg: string; fg: string }[] = [
  { key: "gray", get label() { return i18n.t("note:color.gray"); }, bg: "#3a3f4b", fg: "#e3e4e8" },
  { key: "blue", get label() { return i18n.t("note:color.blue"); }, bg: "#2b4a7e", fg: "#dbe7ff" },
  { key: "green", get label() { return i18n.t("note:color.green"); }, bg: "#2c5b43", fg: "#d6f5e3" },
  { key: "yellow", get label() { return i18n.t("note:color.yellow"); }, bg: "#6b5a1f", fg: "#fbf1c7" },
  { key: "orange", get label() { return i18n.t("note:color.orange"); }, bg: "#7a481f", fg: "#ffe4cc" },
  { key: "red", get label() { return i18n.t("note:color.red"); }, bg: "#7a2f34", fg: "#ffd9dc" },
  { key: "purple", get label() { return i18n.t("note:color.purple"); }, bg: "#4e336e", fg: "#ecdcff" },
  { key: "pink", get label() { return i18n.t("note:color.pink"); }, bg: "#6e3355", fg: "#ffd9ee" },
];

export function colorOf(key: string): { bg: string; fg: string } {
  const c = DB_COLORS.find((x) => x.key === key);
  return c ? { bg: c.bg, fg: c.fg } : { bg: DB_COLORS[0].bg, fg: DB_COLORS[0].fg };
}
