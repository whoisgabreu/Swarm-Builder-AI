import type { BuildPlan, CursorPlan, CursorRole, SectionSpec, Style, Theme } from "./schema.js";

const FALLBACK: Theme = {
  colors: {
    background: "#0b0b0f",
    surface: "#15151c",
    text: "#f5f3ef",
    muted: "#a7a4ad",
    primary: "#c6f24e",
    primaryText: "#10120a",
    accent: "#8b7bff",
    border: "#2a2a35",
  },
  fonts: {
    body: "Inter, system-ui, -apple-system, sans-serif",
    display: "Inter, system-ui, -apple-system, sans-serif",
  },
  radius: "16px",
  spacing: "24px",
};

const colorPattern = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|color\(|var\(--sw-)/i;
const lengthPattern = /^(\d*\.?\d+(px|rem|em|%|vw|vh|vmin|vmax|ch|ex|pt|cm|mm|in)|clamp\(|min\(|max\(|calc\(|var\(--sw-)/i;
const fontPattern = /^[\p{L}\p{N}\s,'"-]+$/u;

const pickColor = (value: unknown, fallback: string): string => {
  const text = String(value ?? "").trim();
  return colorPattern.test(text) && text.length <= 80 ? text : fallback;
};

const pickLength = (value: unknown, fallback: string): string => {
  const text = String(value ?? "").trim();
  if (lengthPattern.test(text) && text.length <= 80) return text;
  const match = text.match(/-?\d*\.?\d+(px|rem|em|%|vw|vh|ch)/i);
  return match ? match[0] : fallback;
};

const cleanFont = (value: unknown, fallback: string): string => {
  const text = String(value ?? "")
    .replace(/[『』“”]/g, "")
    .split(/[;\n]|—/)[0]
    ?.replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text || text.length > 180 || !fontPattern.test(text)) return fallback;
  return text;
};

export const normalizeTheme = (theme: BuildPlan["theme"]): Theme => {
  const colors = theme.colors;
  return {
    colors: {
      background: pickColor(colors.background, FALLBACK.colors.background),
      surface: pickColor(colors.surface, FALLBACK.colors.surface),
      text: pickColor(colors.text, FALLBACK.colors.text),
      muted: pickColor(colors.muted, FALLBACK.colors.muted),
      primary: pickColor(colors.primary, FALLBACK.colors.primary),
      primaryText: pickColor(colors.primaryText, FALLBACK.colors.primaryText),
      accent: pickColor(colors.accent, FALLBACK.colors.accent),
      border: pickColor(colors.border, FALLBACK.colors.border),
    },
    fonts: {
      body: cleanFont(theme.fonts?.body, FALLBACK.fonts!.body),
      display: cleanFont(theme.fonts?.display, FALLBACK.fonts!.display),
    },
    radius: pickLength(theme.radius, FALLBACK.radius!),
    spacing: pickLength(theme.spacing, FALLBACK.spacing!),
  };
};

const slugify = (value: string, fallback: string): string => {
  const slug = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
};

const truncate = (value: string, max: number): string => {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const boundary = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "), cut.lastIndexOf(", "));
  return (boundary > max * 0.55 ? cut.slice(0, boundary + 1) : cut).trim();
};

const SPLIT_ROLES: CursorRole[] = ["layout", "copy", "style"];

const normalizeCursors = (cursors: CursorPlan | undefined): CursorPlan => {
  const raw = cursors ?? { count: 1, mode: "solo" as const };
  let count = Math.min(3, Math.max(1, Math.round(raw.count ?? 1)));
  let mode = raw.mode ?? "solo";
  if (mode === "solo") count = 1;
  if (mode === "race" && count < 2) mode = "solo";
  if (mode === "solo") count = 1;
  const roles =
    mode === "split"
      ? [...(raw.roles ?? []), ...SPLIT_ROLES].slice(0, count)
      : undefined;
  return { count, mode, roles, budgetUsd: raw.budgetUsd };
};

const normalizeSection = (section: SectionSpec, index: number): SectionSpec => ({
  ...section,
  title: truncate(section.title, 160) || `Seção ${index + 1}`,
  goal: truncate(section.goal, 400),
  contentBrief: truncate(section.contentBrief, 900),
  layoutBrief: truncate(section.layoutBrief, 700),
  imageBrief: section.imageBrief ? truncate(section.imageBrief, 300) : undefined,
  cursors: normalizeCursors(section.cursors),
});

export const normalizePlan = (plan: BuildPlan): BuildPlan => {
  const used = new Set<string>();
  const sections = plan.sections.map((section, index) => {
    let id = slugify(section.id, `section-${index + 1}`);
    while (used.has(id)) id = `${id}-${index + 1}`;
    used.add(id);
    return { ...normalizeSection(section, index), id };
  });
  return {
    ...plan,
    title: truncate(plan.title, 160) || "Página sem título",
    tagline: truncate(plan.tagline, 400),
    theme: normalizeTheme(plan.theme),
    sections,
  };
};

const ALIGN_MAP: Record<string, string> = {
  start: "flex-start",
  end: "flex-end",
  left: "flex-start",
  right: "flex-end",
  middle: "center",
  center: "center",
  "flex-start": "flex-start",
  "flex-end": "flex-end",
  stretch: "stretch",
  baseline: "baseline",
  normal: "normal",
};

const JUSTIFY_MAP: Record<string, string> = {
  start: "flex-start",
  end: "flex-end",
  left: "flex-start",
  right: "flex-end",
  middle: "center",
  center: "center",
  "flex-start": "flex-start",
  "flex-end": "flex-end",
  "space-between": "space-between",
  "space-around": "space-around",
  "space-evenly": "space-evenly",
  stretch: "stretch",
  normal: "normal",
};

const DISCARD = Symbol("discard");

const asKeyword =
  (allowed: Record<string, string>) =>
  (value: string): string | typeof DISCARD => {
    const key = value.trim().toLowerCase().replace(/\s+/g, "-");
    return allowed[key] ?? DISCARD;
  };

const DISPLAY = asKeyword({
  block: "block",
  flex: "flex",
  grid: "grid",
  inline: "inline",
  "inline-block": "inline-block",
  "inline-flex": "inline-flex",
  "inline-grid": "inline-grid",
  none: "none",
  contents: "contents",
});

const FLEX_DIRECTION = asKeyword({
  row: "row",
  column: "column",
  "row-reverse": "row-reverse",
  "column-reverse": "column-reverse",
  horizontal: "row",
  vertical: "column",
});

const FLEX_WRAP = asKeyword({ wrap: "wrap", nowrap: "nowrap", "wrap-reverse": "wrap-reverse" });
const ALIGN = asKeyword(ALIGN_MAP);
const JUSTIFY = asKeyword(JUSTIFY_MAP);
const TEXT_ALIGN = asKeyword({ left: "left", center: "center", right: "right", justify: "justify", start: "left", end: "right" });
const TEXT_TRANSFORM = asKeyword({ none: "none", uppercase: "uppercase", lowercase: "lowercase", capitalize: "capitalize" });
const TEXT_DECORATION = asKeyword({ none: "none", underline: "underline", "line-through": "line-through", overline: "overline" });
const WHITE_SPACE = asKeyword({ normal: "normal", nowrap: "nowrap", "pre-line": "pre-line", "pre-wrap": "pre-wrap", pre: "pre", "break-spaces": "break-spaces" });
const OBJECT_FIT = asKeyword({ cover: "cover", contain: "contain", fill: "fill", none: "none", "scale-down": "scale-down" });
const POSITION = asKeyword({ static: "static", relative: "relative", absolute: "absolute", fixed: "fixed", sticky: "sticky" });
const OVERFLOW = asKeyword({ visible: "visible", hidden: "hidden", auto: "auto", scroll: "scroll", clip: "clip" });
const POINTER_EVENTS = asKeyword({ auto: "auto", none: "none" });
const USER_SELECT = asKeyword({ auto: "auto", none: "none", text: "text", all: "all" });
const FONT_WEIGHT = asKeyword({ normal: "normal", bold: "bold", bolder: "bolder", lighter: "lighter" });
const LINE_HEIGHT = asKeyword({ normal: "normal" });

const enumNormalizers: Record<string, (value: string) => string | typeof DISCARD> = {
  display: DISPLAY,
  flexDirection: FLEX_DIRECTION,
  flexWrap: FLEX_WRAP,
  alignItems: ALIGN,
  justifyContent: JUSTIFY,
  alignContent: JUSTIFY,
  justifyItems: ALIGN,
  textAlign: TEXT_ALIGN,
  textTransform: TEXT_TRANSFORM,
  textDecoration: TEXT_DECORATION,
  whiteSpace: WHITE_SPACE,
  objectFit: OBJECT_FIT,
  position: POSITION,
  overflow: OVERFLOW,
  pointerEvents: POINTER_EVENTS,
  userSelect: USER_SELECT,
};

const camelKey = (key: string): string => key.replace(/[-_]([a-z])/gi, (_, char: string) => char.toUpperCase());

const isSafeValue = (value: string): boolean => !/[<>;]|\burl\s*\(|\bjavascript:|\bexpression\s*\(/i.test(value);

export const normalizeStyle = (style: Style | undefined): Style | undefined => {
  if (!style) return undefined;
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(style)) {
    if (rawValue == null) continue;
    const key = camelKey(rawKey);
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) continue;
    const raw = String(rawValue).trim();
    if (!raw || !isSafeValue(raw)) continue;

    const normalizer = enumNormalizers[key];
    if (normalizer) {
      const value = normalizer(raw);
      if (value !== DISCARD) out[key] = value;
      continue;
    }

    if (key === "fontWeight" && !/^\d{1,4}$/.test(raw)) {
      const value = FONT_WEIGHT(raw);
      if (value === DISCARD) continue;
      out[key] = value;
      continue;
    }
    if (key === "lineHeight" && !/^(\d*\.?\d+)(px|rem|em|%)?$/.test(raw)) {
      const value = LINE_HEIGHT(raw);
      if (value === DISCARD) continue;
      out[key] = value;
      continue;
    }
    if (key === "zIndex" && !/^-?\d+$/.test(raw)) continue;
    if (key === "opacity") {
      const number = Number(raw);
      if (!Number.isFinite(number)) continue;
      out[key] = String(Math.max(0, Math.min(1, number)));
      continue;
    }
    out[key] = raw;
  }
  return out as Style;
};
