import assert from "node:assert/strict";
import test from "node:test";
import { compileSitePage, findDeadSiteLinks, normalizeSitePlan, rewriteSiteLinks, sitePageLinks, type SitePlan } from "./site.js";
import type { Node } from "./schema.js";

const section = (id: string, kind: "hero" | "features" | "cta" | "custom", title: string) => ({
  id,
  kind,
  title,
  goal: title,
  contentBrief: `${title} com conteúdo específico.`,
  layoutBrief: "Layout responsivo e editorial.",
  cursors: { count: 1 as const, mode: "solo" as const },
});

const plan = (): SitePlan => ({
  title: "Clarity",
  tagline: "Sites claros.",
  description: "Site institucional da Clarity.",
  theme: {
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
    radius: "18px",
    spacing: "28px",
  },
  pages: [
    {
      slug: "home",
      title: "Início",
      description: "Página inicial.",
      role: "home",
      sections: [section("hero", "hero", "Hero"), section("features", "features", "Recursos"), section("cta", "cta", "CTA")],
    },
    {
      slug: "sobre",
      title: "Sobre",
      description: "Sobre a empresa.",
      role: "about",
      sections: [section("hero", "hero", "Sobre"), section("values", "features", "Valores")],
    },
    {
      slug: "contato",
      title: "Contato",
      description: "Fale com o time.",
      role: "contact",
      sections: [section("hero", "hero", "Contato"), section("form", "custom", "Formulário")],
    },
  ],
  layout: {
    nav: { ...section("nav", "custom", "Navegação"), kind: "nav" },
    footer: { ...section("footer", "custom", "Rodapé"), kind: "footer" },
  },
});

const root = (): Node => ({
  id: "page-home",
  type: "page",
  children: [
    {
      id: "site-nav",
      type: "section",
      children: [{ id: "site-nav-sobre", type: "link", text: "Sobre", href: "/sobre" }],
    },
    {
      id: "home-hero",
      type: "section",
      children: [{ id: "home-hero-title", type: "heading", level: 1, text: "Olá" }],
    },
    {
      id: "site-footer",
      type: "section",
      children: [{ id: "site-footer-contato", type: "link", text: "Contato", href: "/contato" }],
    },
  ],
});

test("normalizeSitePlan creates stable slugs, home and page-scoped section ids", () => {
  const normalized = normalizeSitePlan(plan());
  assert.deepEqual(normalized.pages.map((page) => page.slug), ["home", "sobre", "contato"]);
  assert.equal(normalized.pages[0]?.role, "home");
  assert.equal(normalized.pages[0]?.sections[0]?.id, "home-hero");
  assert.equal(normalized.pages[1]?.sections[0]?.id, "sobre-hero");
  assert.equal(normalized.layout.nav.id, "site-nav");
  assert.equal(normalized.layout.footer.id, "site-footer");
  assert.deepEqual(sitePageLinks(normalized).map((page) => page.path), ["/", "/sobre", "/contato"]);
});

test("compileSitePage resolves preview and static page links", () => {
  const site = normalizeSitePlan(plan());
  const home = site.pages[0]!;
  const preview = compileSitePage({ site, page: home, root: root(), mode: "preview" });
  assert.match(preview, /href="\/sobre"/);
  assert.match(preview, /href="\/contato"/);
  const staticHtml = compileSitePage({ site, page: home, root: root(), mode: "static" });
  assert.match(staticHtml, /href="sobre.html"/);
  assert.match(staticHtml, /href="contato.html"/);
  assert.match(staticHtml, /<title>Início<\/title>/);

  const renamed = normalizeSitePlan({
    ...plan(),
    pages: plan().pages.map((page, index) => (index === 0 ? { ...page, slug: "inicio" } : page)),
  });
  const renamedHome = renamed.pages[0]!;
  const renamedRoot = root();
  renamedRoot.children?.[0]?.children?.push({ id: "site-nav-home", type: "link", text: "Início", href: "/" });
  const renamedHtml = compileSitePage({ site: renamed, page: renamedHome, root: renamedRoot, mode: "static" });
  assert.match(renamedHtml, /href="index.html"/);
  assert.deepEqual(sitePageLinks(renamed)[0]?.path, "/");
});

test("rewriteSiteLinks maps labels and detects dead page links", () => {
  const site = normalizeSitePlan(plan());
  const node: Node = {
    id: "page-home",
    type: "page",
    children: [
      { id: "nav-home", type: "link", text: "Sobre", href: "#" },
      { id: "nav-dead", type: "link", text: "Blog", href: "/blog" },
    ],
  };
  const rewritten = rewriteSiteLinks(node, site, "static");
  assert.equal(rewritten.children?.[0]?.href, "sobre.html");
  const dead = findDeadSiteLinks(site, "home", node);
  assert.equal(dead.length, 1);
  assert.equal(dead[0]?.href, "/blog");
});
