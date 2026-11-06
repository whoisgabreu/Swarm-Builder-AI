import { z } from "zod";
import { compilePage } from "./compiler.js";
import { normalizePlan, normalizeTheme } from "./normalize.js";
import {
  SectionSpecSchema,
  ThemeSchema,
  type BuildPlan,
  type Node,
  type SectionSpec,
  type Theme,
} from "./schema.js";

export const SitePageRoleSchema = z.enum(["home", "about", "services", "contact", "custom"]);
export type SitePageRole = z.infer<typeof SitePageRoleSchema>;

export const SitePageSchema = z.object({
  slug: z.string().min(1).max(60),
  title: z.string().max(160),
  description: z.string().max(400),
  role: SitePageRoleSchema,
  sections: z.array(SectionSpecSchema).min(2).max(5),
});
export type SitePage = z.infer<typeof SitePageSchema>;

export const SiteLayoutSchema = z.object({
  nav: SectionSpecSchema,
  footer: SectionSpecSchema,
});
export type SiteLayout = z.infer<typeof SiteLayoutSchema>;

export const SitePlanSchema = z.object({
  title: z.string().max(160),
  tagline: z.string().max(400),
  description: z.string().max(600),
  theme: ThemeSchema,
  pages: z.array(SitePageSchema).min(2).max(6),
  layout: SiteLayoutSchema,
});
export type SitePlan = z.infer<typeof SitePlanSchema>;

export type SitePageLink = {
  slug: string;
  title: string;
  path: string;
};

export type SiteLinkMode = "preview" | "static";

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

const pagePath = (page: SitePage, mode: SiteLinkMode): string => {
  const home = page.role === "home";
  if (mode === "static") return home ? "index.html" : `${page.slug}.html`;
  return home ? "/" : `/${page.slug}`;
};

export const sitePageLinks = (site: SitePlan): SitePageLink[] =>
  site.pages.map((page) => ({
    slug: page.slug,
    title: page.title,
    path: page.role === "home" ? "/" : `/${page.slug}`,
  }));

const normalizePageSections = (page: SitePage, theme: Theme): SectionSpec[] => {
  const normalized = normalizePlan({
    title: page.title,
    tagline: page.description,
    theme,
    sections: page.sections.filter((section) => section.kind !== "nav" && section.kind !== "footer"),
  });
  return normalized.sections.map((section) => ({
    ...section,
    id: section.id.startsWith(`${page.slug}-`) ? section.id : `${page.slug}-${section.id}`,
  }));
};

const normalizeLayoutSection = (
  section: SectionSpec,
  kind: "nav" | "footer",
  id: string,
  theme: Theme,
): SectionSpec => {
  const normalized = normalizePlan({
    title: section.title,
    tagline: section.goal,
    theme,
    sections: [{ ...section, id, kind }],
  });
  return { ...normalized.sections[0]!, id, kind };
};

export const normalizeSitePlan = (site: SitePlan): SitePlan => {
  const theme = normalizeTheme(site.theme);
  const usedSlugs = new Set<string>();
  let homeSeen = false;
  const pages: SitePage[] = site.pages.map((page, index) => {
    let slug = slugify(page.slug || page.title, index === 0 ? "home" : `page-${index + 1}`);
    while (usedSlugs.has(slug)) slug = `${slug}-${index + 1}`;
    usedSlugs.add(slug);
    const wantsHome = page.role === "home" || (index === 0 && !site.pages.some((item) => item.role === "home"));
    const role = wantsHome && !homeSeen ? "home" : (wantsHome ? "custom" : page.role);
    if (role === "home") homeSeen = true;
    return {
      ...page,
      slug,
      role,
      title: page.title.trim().slice(0, 160) || `Página ${index + 1}`,
      description: page.description.trim().slice(0, 400),
      sections: normalizePageSections({ ...page, slug }, theme),
    };
  });
  if (!pages.some((page) => page.role === "home")) pages[0] = { ...pages[0]!, role: "home" };

  return {
    ...site,
    title: site.title.trim().slice(0, 160) || "Site institucional",
    tagline: site.tagline.trim().slice(0, 400),
    description: site.description.trim().slice(0, 600),
    theme,
    pages,
    layout: {
      nav: normalizeLayoutSection(site.layout.nav, "nav", "site-nav", theme),
      footer: normalizeLayoutSection(site.layout.footer, "footer", "site-footer", theme),
    },
  };
};

export const siteLayoutPlan = (site: SitePlan): BuildPlan => ({
  title: site.title,
  tagline: site.tagline,
  theme: site.theme,
  sections: [site.layout.nav, site.layout.footer],
});

export const sitePagePlan = (site: SitePlan, page: SitePage): BuildPlan => ({
  title: page.title,
  tagline: page.description,
  theme: site.theme,
  sections: page.sections,
});

export const sitePageNodeId = (page: SitePage): string => `page-${page.slug}`;

export const createSitePageRoot = (input: {
  page: SitePage;
  nav: Node;
  footer: Node;
  sections: Node[];
}): Node => ({
  id: sitePageNodeId(input.page),
  type: "page",
  children: [input.nav, ...input.sections, input.footer],
});

const normalizeText = (value: string | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export const sitePageForHref = (site: SitePlan, href: string): SitePage | undefined => {
  const clean = href.trim().replace(/^\.\//, "").replace(/\.html$/i, "").replace(/^\/+|\/+$/g, "");
  if (!clean) return site.pages.find((page) => page.role === "home");
  return site.pages.find((page) => page.slug === clean);
};

const pageForLabel = (site: SitePlan, label: string | undefined): SitePage | undefined => {
  const text = normalizeText(label);
  if (!text) return undefined;
  return site.pages.find((page) => normalizeText(page.title) === text || normalizeText(page.slug) === text);
};

export const rewriteSiteLinks = (root: Node, site: SitePlan, mode: SiteLinkMode): Node => {
  const next = structuredClone(root) as Node;
  const walk = (node: Node) => {
    if (node.type === "link" || node.type === "button") {
      const target = node.href ? sitePageForHref(site, node.href) : undefined;
      const labelTarget = !target && (!node.href || node.href === "#") ? pageForLabel(site, node.text) : undefined;
      const page = target ?? labelTarget;
      if (page) node.href = pagePath(page, mode);
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(next);
  return next;
};

export const compileSitePage = (input: {
  site: SitePlan;
  page: SitePage;
  root: Node;
  mode: SiteLinkMode;
}): string => {
  const plan: BuildPlan = {
    title: input.page.title,
    tagline: input.page.description,
    theme: input.site.theme,
    sections: [input.site.layout.nav, ...input.page.sections, input.site.layout.footer],
  };
  return compilePage({
    title: input.page.title,
    description: input.page.description,
    plan,
    root: rewriteSiteLinks(input.root, input.site, input.mode),
  });
};

export const sitePageBySlug = (site: SitePlan, slug: string): SitePage | undefined =>
  site.pages.find((page) => page.slug === slug);

export type SiteDeadLink = {
  pageSlug: string;
  nodeId: string;
  href: string;
  text?: string;
};

export const findDeadSiteLinks = (site: SitePlan, pageSlug: string, root: Node): SiteDeadLink[] => {
  const dead: SiteDeadLink[] = [];
  const walk = (node: Node) => {
    if (node.type === "link" || node.type === "button") {
      const href = (node.href ?? "").trim();
      const external = /^(?:https?:|mailto:|tel:|javascript:|data:)/i.test(href) || href.startsWith("//");
      if (href && href !== "#" && !href.startsWith("#") && !external && !sitePageForHref(site, href)) {
        dead.push({ pageSlug, nodeId: node.id, href, text: node.text });
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return dead;
};
