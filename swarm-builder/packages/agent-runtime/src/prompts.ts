import type { BuildPlan, Node, SectionSpec, SitePlan } from "@swarm/dsl";
import type { CriticRequest, EditRequest, PlanSectionRequest, RefineRequest } from "./types.js";

const RESPONSIVE_RULES = [
  "Responsive requirements:",
  "- Mobile target: 390px; tablet target: 768px; desktop is the base style.",
  "- Use responsive.mobile and responsive.tablet for layout changes that auto-fit/flex-wrap cannot handle.",
  "- Navbar must fit or wrap/stack without horizontal overflow; CTA must remain visible.",
  "- Collapse multi-column grids to one column on mobile.",
  "- Body copy, links and buttons must be at least 14px; tap targets at least 44x44px.",
  "- Avoid fixed widths larger than the viewport. Use width:100%, max-width and aspect-ratio.",
  "- Hide only secondary content on mobile; never hide the main CTA.",
].join("\n");

const compactPlan = (plan: BuildPlan) => ({
  title: plan.title,
  tagline: plan.tagline,
  theme: plan.theme,
  sections: plan.sections.map(({ id, kind, title }) => ({ id, kind, title })),
});

export const planPrompt = (brief: string): string =>
  [
    "Create a complete landing page plan for this brief:",
    brief.trim(),
    "",
    "Return a BuildPlan. Prefer 5 to 7 sections. The plan must be executable by independent section agents.",
  ].join("\n");

export const sitePlanPrompt = (input: { brief: string; brand?: string }): string =>
  [
    "Create a complete institutional website plan for this brief:",
    input.brief.trim(),
    input.brand ? `Brand/site name: ${input.brand}` : "",
    "",
    "Return a SitePlan with 2 to 6 pages and a shared layout.",
    "The site must have a home page. Prefer: Home, Sobre, Serviços, Contato; add cases or equipe only when the brief justifies it.",
    "Each page needs 2-5 sections. Sections must be independent and executable by separate agents.",
    "The shared layout needs one nav SectionSpec and one footer SectionSpec.",
    "Nav and footer content must list the pages as links; use page paths like /sobre, /servicos and /.",
    "The contact page should use a visual form plus email, phone and WhatsApp links; no backend submission.",
    "Keep the same theme, tone and navigation across all pages.",
    "Return only JSON matching the SitePlan schema.",
  ]
    .filter(Boolean)
    .join("\n");

export const sectionPrompt = (input: {
  plan: BuildPlan;
  section: SectionSpec;
  before?: Pick<SectionSpec, "id" | "kind" | "title">;
  after?: Pick<SectionSpec, "id" | "kind" | "title">;
  retryNote?: string;
  variantHint?: string;
  sitePages?: Array<{ slug: string; title: string; path: string }>;
}): string =>
  [
    "Build exactly one section for this page.",
    "",
    `Section spec:\n${JSON.stringify(input.section, null, 2)}`,
    `Internal links must use only these anchors: ${["#top", ...input.plan.sections.map((section) => `#${section.id}`)].join(", ")}.`,
    input.sitePages?.length
      ? `Site pages for navigation links: ${input.sitePages.map((page) => `${page.title} (${page.path})`).join(", ")}. Use these paths for page links; do not use anchors for other pages.`
      : "",
    "",
    `Page context:\n${JSON.stringify(compactPlan(input.plan), null, 2)}`,
    "",
    input.before ? `Previous section: ${JSON.stringify(input.before)}` : "This is the first section.",
    input.after ? `Next section: ${JSON.stringify(input.after)}` : "This is the last section.",
    input.variantHint ? `Variant direction: ${input.variantHint}` : "",
    "",
    RESPONSIVE_RULES,
    "",
    "Hard limits: at most 40 nodes total, depth at most 5, at most 2 CTAs. Avoid decorative wrappers.",
    "Do not explain your reasoning. Emit the structured SectionPatch now.",
    input.retryNote
      ? `Previous attempt was rejected: ${input.retryNote}\nRetry smaller and simpler: at most 25 nodes, no reasoning text.`
      : "",
    "",
    `Return a SectionPatch with sectionId "${input.section.id}".`,
  ]
    .filter(Boolean)
    .join("\n");

const CRITIC_STYLE_KEYS = [
  "display",
  "flexDirection",
  "flexWrap",
  "alignItems",
  "justifyContent",
  "gap",
  "gridTemplateColumns",
  "width",
  "maxWidth",
  "minWidth",
  "height",
  "minHeight",
  "padding",
  "margin",
  "background",
  "backgroundColor",
  "color",
  "fontSize",
  "fontWeight",
  "textAlign",
  "position",
  "overflow",
  "borderRadius",
];

const compactStyle = (node: Node): Record<string, string> | undefined => {
  if (!node.style) return undefined;
  const out: Record<string, string> = {};
  for (const key of CRITIC_STYLE_KEYS) {
    const value = node.style[key as keyof typeof node.style];
    if (value != null) out[key] = String(value);
  }
  return Object.keys(out).length ? out : undefined;
};

const criticNodes = (root: Node): Record<string, unknown>[] => {
  const nodes: Record<string, unknown>[] = [];
  const walk = (node: Node, depth: number) => {
    if (depth > 6 || nodes.length >= 180) return;
    nodes.push({
      id: node.id,
      type: node.type,
      depth,
      text: node.text ? node.text.slice(0, 180) : undefined,
      alt: node.alt,
      src: node.src,
      href: node.href,
      style: compactStyle(node),
    });
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  walk(root, 0);
  return nodes;
};

const ROLE_INSTRUCTIONS: Record<string, string> = {
  layout:
    "Fix layout and composition: flex/grid direction, alignment, gaps, wrapping, max-width, spacing and section height. Keep the copy intact.",
  copy:
    "Improve headlines, labels, CTA text and supporting paragraphs. Keep the same intent and language; do not touch layout or images.",
  media:
    "Improve images: src, alt text, object-fit, aspect ratio and placement. Use deterministic https://picsum.photos/seed/... URLs when needed.",
  style:
    "Improve color, typography, borders, radius, shadows and token usage. Keep the layout and copy intact.",
  content:
    "Improve content completeness: fill missing promises, proof points, CTAs and labels. Keep the layout intact.",
};

export const refinePrompt = (input: RefineRequest): string =>
  [
    `Refine the "${input.section.id}" section as the ${input.role} specialist.`,
    "",
    `Section spec:\n${JSON.stringify(input.section, null, 2)}`,
    `Allowed internal anchors: ${["#top", ...input.plan.sections.map((section) => `#${section.id}`)].join(", ")}.`,
    "",
    `Current section tree:\n${JSON.stringify(input.node, null, 2)}`,
    "",
    RESPONSIVE_RULES,
    "",
    `Role instructions:\n${ROLE_INSTRUCTIONS[input.role] ?? "Improve the section while staying within the existing tree."}`,
    "",
    "Return a RefinementResult with targeted patches that reference existing node ids.",
    "Do not replace the whole tree. Do not return markdown or explanations outside the JSON.",
  ].join("\n");

export const planSectionPrompt = (input: PlanSectionRequest): string =>
  [
    "Create a SectionSpec for a NEW section that will be inserted into an existing page.",
    "",
    `Page title: ${input.plan.title}`,
    `Tagline: ${input.plan.tagline}`,
    `Theme: ${JSON.stringify(input.plan.theme)}`,
    "",
    `Existing sections (numbered):\n${input.plan.sections
      .map((section, index) => `${index + 1}. ${section.id} · ${section.kind} · ${section.title}`)
      .join("\n")}`,
    "",
    `Insertion index: ${input.insertIndex} (0 = before section 1; N = after section N).`,
    `User brief: ${input.prompt}`,
    input.title ? `Requested title: ${input.title}` : "",
    input.kind ? `Requested kind: ${input.kind}` : "",
    `Requested quality: ${input.quality ?? "solo"}`,
    "",
    "Rules:",
    RESPONSIVE_RULES,
    "- Match the page's visual language and design tokens.",
    "- Choose a unique section id (lowercase, dashes).",
    "- Keep contentBrief and layoutBrief concise.",
    "- Use only these internal anchors: #top and the existing section ids.",
    '- quality solo => cursors {count:1, mode:"solo"}.',
    '- quality split => cursors {count:2 or 3, mode:"split", roles:["layout","copy"]}.',
    '- quality race => cursors {count:2 or 3, mode:"race"}.',
    "- Do not modify existing sections.",
    "Return a NewSectionPlan with the section and optional notes.",
  ]
    .filter(Boolean)
    .join("\n");

export const editPrompt = (input: EditRequest): string =>
  [
    `You are ${input.agentName}, the owner agent for this part of the page.`,
    `The user requested a precise change: "${input.request}"`,
    "",
    `Section spec:\n${JSON.stringify(input.section, null, 2)}`,
    `Allowed internal anchors: ${["#top", ...input.plan.sections.map((section) => `#${section.id}`)].join(", ")}.`,
    "",
    `Target subtree:\n${JSON.stringify(input.node, null, 2)}`,
    "",
    RESPONSIVE_RULES,
    "",
    input.targets?.length
      ? `Selected targets:\n${JSON.stringify(input.targets, null, 2)}\nApply the same change consistently to all selected targets.`
      : "",
    `Allowed node ids (you may only patch these): ${input.allowedNodeIds.join(", ")}`,
    input.role ? `Your specialist role: ${input.role}.` : "",
    "",
    "Return a RefinementResult with small, targeted patches.",
    "Do not create or remove nodes. Do not touch nodes outside the allowed ids.",
    "Do not explain your reasoning. Emit the structured patches now.",
  ]
    .filter(Boolean)
    .join("\n");

export const criticPrompt = (input: CriticRequest): string => {
  const sections = input.plan.sections.map(({ id, kind, title, goal, layoutBrief, contentBrief }) => ({
    id,
    kind,
    title,
    goal,
    layoutBrief,
    contentBrief,
  }));
  return [
    "Review this generated landing page. Use the render audit as ground truth.",
    "Find high-impact issues that remain, and propose fixes that reference existing node ids.",
    "",
    "Hard rubric:",
    "- Navbar on desktop must be ONE horizontal row, height <= 120px: brand left, links center/right, actions/CTA right.",
    "- Each section must follow its layoutBrief and contain its promised content.",
    "- No horizontal overflow, no empty sections, no button without visible text.",
    "- Images need alt text. CTAs must be visible and clear.",
    "- Copy must be specific, in the brief language, with no lorem ipsum or placeholders.",
    "- Mobile 390px: no overflow, navbar fits/wraps, grids collapse to one column, fonts >=14px, tap targets >=44px, CTA visible.",
    "- Tablet 768px: same rules with more breathing room.",
    "",
    `Page plan sections:\n${JSON.stringify(sections, null, 2)}`,
    "",
    `Deterministic audit issues (already queued for auto-fix when possible):\n${JSON.stringify(input.auditIssues ?? [], null, 2)}`,
    "",
    `Render report (desktop/mobile geometry):\n${JSON.stringify(input.renderReport ?? {}, null, 2)}`,
    "",
    `Page node tree (compact):\n${JSON.stringify(criticNodes(input.root), null, 2)}`,
    "",
    "Return a CriticResult. Each issue must have nodeId (when applicable), severity, category, message, autoFix and an optional patch.",
    "Do not return markdown or explanations outside the JSON.",
  ].join("\n");
};
