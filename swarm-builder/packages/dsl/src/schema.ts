import { z } from "zod";

const cssValue = z
  .string()
  .max(400)
  .refine(
    (value) => !/url\s*\(|javascript:|expression\s*\(|@import|<|>/i.test(value),
    "unsafe CSS value",
  );

export const StyleSchema = z.object({
  display: cssValue.optional(),
  flexDirection: cssValue.optional(),
  flexWrap: cssValue.optional(),
  alignItems: cssValue.optional(),
  justifyContent: cssValue.optional(),
  alignContent: cssValue.optional(),
  justifyItems: cssValue.optional(),
  gap: cssValue.optional(),
  rowGap: cssValue.optional(),
  columnGap: cssValue.optional(),
  gridTemplateColumns: cssValue.optional(),
  gridTemplateRows: cssValue.optional(),
  gridAutoFlow: cssValue.optional(),
  gridColumn: cssValue.optional(),
  gridRow: cssValue.optional(),
  flex: cssValue.optional(),
  order: cssValue.optional(),
  width: cssValue.optional(),
  maxWidth: cssValue.optional(),
  minWidth: cssValue.optional(),
  minHeight: cssValue.optional(),
  maxHeight: cssValue.optional(),
  height: cssValue.optional(),
  margin: cssValue.optional(),
  marginTop: cssValue.optional(),
  marginRight: cssValue.optional(),
  marginBottom: cssValue.optional(),
  marginLeft: cssValue.optional(),
  padding: cssValue.optional(),
  paddingTop: cssValue.optional(),
  paddingRight: cssValue.optional(),
  paddingBottom: cssValue.optional(),
  paddingLeft: cssValue.optional(),
  background: cssValue.optional(),
  backgroundColor: cssValue.optional(),
  backgroundImage: cssValue.optional(),
  backgroundSize: cssValue.optional(),
  backgroundPosition: cssValue.optional(),
  backgroundRepeat: cssValue.optional(),
  color: cssValue.optional(),
  border: cssValue.optional(),
  borderColor: cssValue.optional(),
  borderWidth: cssValue.optional(),
  borderStyle: cssValue.optional(),
  borderRadius: cssValue.optional(),
  boxShadow: cssValue.optional(),
  fontSize: cssValue.optional(),
  fontWeight: cssValue.optional(),
  fontFamily: cssValue.optional(),
  lineHeight: cssValue.optional(),
  letterSpacing: cssValue.optional(),
  textAlign: cssValue.optional(),
  textTransform: cssValue.optional(),
  textDecoration: cssValue.optional(),
  textShadow: cssValue.optional(),
  whiteSpace: cssValue.optional(),
  wordBreak: cssValue.optional(),
  overflowWrap: cssValue.optional(),
  opacity: cssValue.optional(),
  objectFit: cssValue.optional(),
  objectPosition: cssValue.optional(),
  aspectRatio: cssValue.optional(),
  position: cssValue.optional(),
  top: cssValue.optional(),
  right: cssValue.optional(),
  bottom: cssValue.optional(),
  left: cssValue.optional(),
  zIndex: cssValue.optional(),
  overflow: cssValue.optional(),
  cursor: cssValue.optional(),
  pointerEvents: cssValue.optional(),
  userSelect: cssValue.optional(),
  listStyle: cssValue.optional(),
  filter: cssValue.optional(),
  backdropFilter: cssValue.optional(),
  transform: cssValue.optional(),
  transformOrigin: cssValue.optional(),
  transition: cssValue.optional(),
}).catchall(cssValue.optional());

export const ResponsiveSchema = z.object({
  mobile: StyleSchema.optional(),
  tablet: StyleSchema.optional(),
  hide: z.array(z.enum(["mobile", "tablet"])).max(2).optional(),
});

export const NodeTypeSchema = z.enum([
  "page",
  "section",
  "stack",
  "grid",
  "text",
  "heading",
  "image",
  "button",
  "link",
  "input",
  "list",
  "listItem",
  "spacer",
  "icon",
]);

export type NodeType = z.infer<typeof NodeTypeSchema>;
export type Style = z.infer<typeof StyleSchema>;
export type Responsive = z.infer<typeof ResponsiveSchema>;

export type Node = {
  id: string;
  type: NodeType;
  text?: string;
  level?: number;
  src?: string;
  alt?: string;
  href?: string;
  target?: "_self" | "_blank";
  style?: Style;
  responsive?: Responsive;
  props?: Record<string, string | number | boolean>;
  a11y?: { role?: string; label?: string };
  children?: Node[];
};

const nodeId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "use letters, digits, dashes or underscores");

const NodeSchemaBase: z.ZodType<Node> = z.object({
  id: nodeId,
  type: NodeTypeSchema,
  text: z.string().max(4000).optional(),
  level: z.number().int().min(1).max(6).optional(),
  src: z.string().max(2000).optional(),
  alt: z.string().max(400).optional(),
  href: z.string().max(1200).optional(),
  target: z.enum(["_self", "_blank"]).optional(),
  style: StyleSchema.optional(),
  responsive: ResponsiveSchema.optional(),
  props: z
    .record(z.string(), z.union([z.string().max(1000), z.number(), z.boolean()]))
    .optional(),
  a11y: z.object({ role: z.string().max(40).optional(), label: z.string().max(200).optional() }).optional(),
  children: z.array(z.lazy(() => NodeSchemaBase)).max(120).optional(),
});

export const NodeSchema = NodeSchemaBase;

export const ThemeSchema = z.object({
  colors: z.object({
    background: cssValue,
    surface: cssValue,
    text: cssValue,
    muted: cssValue,
    primary: cssValue,
    primaryText: cssValue,
    accent: cssValue,
    border: cssValue,
  }),
  fonts: z
    .object({
      body: cssValue,
      display: cssValue,
    })
    .optional(),
  radius: cssValue.optional(),
  spacing: cssValue.optional(),
});

export const SectionKindSchema = z.enum([
  "nav",
  "hero",
  "features",
  "showcase",
  "testimonials",
  "pricing",
  "cta",
  "footer",
  "custom",
]);

export const CursorRoleSchema = z.enum(["layout", "copy", "media", "style", "content"]);

export const CursorPlanSchema = z.object({
  count: z.number().int().min(1).max(3).default(1),
  mode: z.enum(["solo", "split", "race"]).default("solo"),
  roles: z.array(CursorRoleSchema).max(3).optional(),
  budgetUsd: z.number().min(0).max(10).optional(),
});

export const SectionSpecSchema = z.object({
  id: nodeId,
  kind: SectionKindSchema,
  title: z.string().max(200),
  goal: z.string().max(600),
  contentBrief: z.string().max(1600),
  layoutBrief: z.string().max(1200),
  imageBrief: z.string().max(600).optional(),
  cursors: CursorPlanSchema.optional(),
});

export const BuildPlanSchema = z.object({
  title: z.string().max(160),
  tagline: z.string().max(400),
  theme: ThemeSchema,
  sections: z.array(SectionSpecSchema).min(3).max(7),
});

export const NewSectionPlanSchema = z.object({
  section: SectionSpecSchema,
  notes: z.string().max(400).optional(),
});

export const SectionPatchSchema = z.object({
  sectionId: nodeId,
  node: NodeSchema,
  notes: z.array(z.string().max(300)).max(20).optional(),
});

export const RefinementPatchSchema = z.object({
  nodeId: nodeId,
  text: z.string().max(4000).optional(),
  src: z.string().max(2000).optional(),
  alt: z.string().max(400).optional(),
  href: z.string().max(1200).optional(),
  style: StyleSchema.optional(),
  responsive: ResponsiveSchema.optional(),
});

export const RefinementResultSchema = z.object({
  summary: z.string().max(600),
  patches: z.array(RefinementPatchSchema).max(24),
});

export const CriticIssueSchema = z.object({
  nodeId: nodeId.optional(),
  severity: z.enum(["high", "medium", "low"]).default("medium"),
  category: z.enum(["layout", "copy", "a11y", "visual", "content"]).default("visual"),
  message: z.string().min(1).max(1000),
  autoFix: z.boolean().default(true),
  patch: z
    .object({
      text: z.string().max(4000).optional(),
      src: z.string().max(2000).optional(),
      alt: z.string().max(400).optional(),
      href: z.string().max(1200).optional(),
      style: StyleSchema.optional(),
      responsive: ResponsiveSchema.optional(),
    })
    .optional(),
});

export const CriticResultSchema = z.object({
  summary: z.string().max(1200),
  issues: z.array(CriticIssueSchema).max(60),
});

export type Theme = z.infer<typeof ThemeSchema>;
export type SectionKind = z.infer<typeof SectionKindSchema>;
export type CursorRole = z.infer<typeof CursorRoleSchema>;
export type CursorPlan = z.infer<typeof CursorPlanSchema>;
export type SectionSpec = z.infer<typeof SectionSpecSchema>;
export type NewSectionPlan = z.infer<typeof NewSectionPlanSchema>;
export type RefinementPatch = z.infer<typeof RefinementPatchSchema>;
export type RefinementResult = z.infer<typeof RefinementResultSchema>;
export type BuildPlan = z.infer<typeof BuildPlanSchema>;
export type SectionPatch = z.infer<typeof SectionPatchSchema>;
export type CriticIssue = z.infer<typeof CriticIssueSchema>;
export type CriticResult = z.infer<typeof CriticResultSchema>;
