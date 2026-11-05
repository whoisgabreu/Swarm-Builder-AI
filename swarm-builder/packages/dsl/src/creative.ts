import { z } from "zod";
import { NodeSchema, ThemeSchema, type Node, type Theme } from "./schema.js";

export const CreativeFormatIdSchema = z.enum(["ig-square", "ig-portrait"]);
export type CreativeFormatId = z.infer<typeof CreativeFormatIdSchema>;

export const CREATIVE_FORMATS = {
  "ig-square": { id: "ig-square", label: "Instagram 1:1", width: 1080, height: 1080 },
  "ig-portrait": { id: "ig-portrait", label: "Instagram 4:5", width: 1080, height: 1350 },
} as const;

export const ArtboardRoleSchema = z.enum(["cover", "value", "proof", "cta", "custom"]);
export type ArtboardRole = z.infer<typeof ArtboardRoleSchema>;

export const ArtboardSpecSchema = z.object({
  id: z.string().min(1).max(80),
  role: ArtboardRoleSchema,
  brief: z.string().max(1200),
});
export type ArtboardSpec = z.infer<typeof ArtboardSpecSchema>;

export const CreativeSetPlanSchema = z.object({
  title: z.string().max(160),
  concept: z.string().max(1200),
  theme: ThemeSchema,
  formatId: CreativeFormatIdSchema,
  artboards: z.array(ArtboardSpecSchema).min(1).max(8),
});
export type CreativeSetPlan = z.infer<typeof CreativeSetPlanSchema>;

export const ArtboardPatchSchema = z.object({
  artboardId: z.string().min(1).max(80),
  node: NodeSchema,
  notes: z.array(z.string().max(300)).max(10).optional(),
});
export type ArtboardPatch = z.infer<typeof ArtboardPatchSchema>;

const slug = (value: string, fallback: string): string => {
  const out = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return out || fallback;
};

export const normalizeCreativePlan = (plan: CreativeSetPlan, cardCount: number): CreativeSetPlan => {
  const format = CREATIVE_FORMATS[plan.formatId] ?? CREATIVE_FORMATS["ig-square"];
  const target = Math.max(1, Math.min(8, cardCount));
  const used = new Set<string>();
  const roles = ["cover", "value", "proof", "cta", "custom"] as const;
  const artboards = plan.artboards.slice(0, target).map((artboard, index) => {
    let id = slug(artboard.id, `${artboard.role}-${index + 1}`);
    while (used.has(id)) id = `${id}-${index + 1}`;
    used.add(id);
    return { ...artboard, id };
  });
  while (artboards.length < target) {
    const index = artboards.length;
    const role = roles[Math.min(index, roles.length - 1)] ?? "custom";
    let id = `${role}-${index + 1}`;
    while (used.has(id)) id = `${id}-${index + 1}`;
    used.add(id);
    artboards.push({ id, role, brief: plan.concept || `Card ${index + 1}` });
  }
  return {
    ...plan,
    formatId: format.id,
    artboards,
  };
};

const normalizeNodeIds = (node: Node, artboardId: string): Node => {
  const next = structuredClone(node);
  const walk = (current: Node, root = false) => {
    if (root) current.id = artboardId;
    else if (!current.id.startsWith(`${artboardId}-`)) current.id = `${artboardId}-${current.id}`;
    for (const child of current.children ?? []) walk(child);
  };
  walk(next, true);
  return next;
};

export const countCreativeNodes = (node: Node): number =>
  1 + (node.children ?? []).reduce((sum, child) => sum + countCreativeNodes(child), 0);

export const validateArtboardPatch = (
  patch: ArtboardPatch,
  plan: CreativeSetPlan,
): { ok: true; node: Node } | { ok: false; error: string } => {
  const spec = plan.artboards.find((artboard) => artboard.id === patch.artboardId);
  if (!spec) return { ok: false, error: `unknown artboard ${patch.artboardId}` };
  if (patch.node.type !== "artboard") return { ok: false, error: "artboard root must be type artboard" };
  const node = normalizeNodeIds(patch.node, spec.id);
  if (!node.text && !(node.children ?? []).some((child) => child.type === "heading" || child.type === "text")) {
    return { ok: false, error: "artboard has no text content" };
  }
  const count = countCreativeNodes(node);
  if (count > 140) return { ok: false, error: `artboard is too large: ${count} nodes` };
  const format = CREATIVE_FORMATS[plan.formatId];
  node.style = {
    ...(node.style ?? {}),
    width: `${format.width}px`,
    height: `${format.height}px`,
    position: "relative",
    overflow: "hidden",
  };
  return { ok: true, node };
};

export const fallbackArtboard = (spec: ArtboardSpec, plan: CreativeSetPlan): Node => {
  const format = CREATIVE_FORMATS[plan.formatId];
  const headline = spec.role === "cover" ? plan.title : spec.brief.split(".")[0] || spec.brief;
  return {
    id: spec.id,
    type: "artboard",
    style: {
      width: `${format.width}px`,
      height: `${format.height}px`,
      position: "relative",
      overflow: "hidden",
      background: "var(--sw-background)",
      color: "var(--sw-text)",
      padding: "88px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      gap: "28px",
    },
    children: [
      { id: `${spec.id}-eyebrow`, type: "text", text: plan.title.toUpperCase(), style: { color: "var(--sw-accent)", fontSize: "24px", fontWeight: "700", letterSpacing: "0.12em" } },
      { id: `${spec.id}-title`, type: "heading", level: 1, text: headline, style: { fontSize: "96px", lineHeight: "1.02", letterSpacing: "-0.04em" } },
      { id: `${spec.id}-body`, type: "text", text: spec.brief, style: { fontSize: "30px", lineHeight: "1.35", color: "var(--sw-muted)", maxWidth: "760px" } },
      { id: `${spec.id}-brand`, type: "text", text: plan.title, style: { fontSize: "24px", fontWeight: "700", marginTop: "40px" } },
    ],
  };
};

export type CreativeArtboard = {
  id: string;
  index: number;
  role: ArtboardRole;
  artifact: Node;
  html: string;
  status: "done";
};

export type CreativeSet = {
  plan: CreativeSetPlan;
  format: (typeof CREATIVE_FORMATS)[CreativeFormatId];
  artboards: CreativeArtboard[];
  agents: Array<{ id: string; name: string; color: string; sectionId?: string; cursorRole?: string }>;
};

export type { Node, Theme };
