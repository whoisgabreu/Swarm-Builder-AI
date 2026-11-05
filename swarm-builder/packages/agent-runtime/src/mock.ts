import type { BuildPlan, CriticResult, Node, SectionPatch, SectionSpec } from "@swarm/dsl";
import type {
  AgentRuntime,
  CriticOutcome,
  CriticRequest,
  EditOutcome,
  EditRequest,
  PlanRequest,
  PlanSectionRequest,
  PlanSectionResult,
  PlanResult,
  RefineOutcome,
  RefineRequest,
  SectionRequest,
  SectionResult,
} from "./types.js";

const theme: BuildPlan["theme"] = {
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
  radius: "18px",
  spacing: "28px",
};

const sectionSpecs: SectionSpec[] = [
  {
    id: "nav",
    kind: "nav",
    title: "Navegação",
    goal: "Orientar e levar ao CTA principal.",
    contentBrief: "Logo Clarity, links Produto, Como funciona, Preços e botão Começar grátis.",
    layoutBrief: "Linha compacta, logo à esquerda, links ao centro e CTA à direita.",
    cursors: { count: 1, mode: "solo" },
  },
  {
    id: "hero",
    kind: "hero",
    title: "Hero",
    goal: "Explicar a proposta em 5 segundos e gerar o primeiro clique.",
    contentBrief:
      "Headline: Transforme ideias em páginas que convertem. Subheadline sobre clareza, velocidade e resultado. CTA Começar grátis e link Ver demonstração. Badge 'Novo · agente de design'.",
    layoutBrief: "Duas colunas: copy e CTAs à esquerda, imagem abstrata à direita.",
    imageBrief: "Objeto abstrato luminoso em fundo escuro.",
    cursors: { count: 3, mode: "split", roles: ["layout", "copy", "style"] },
  },
  {
    id: "features",
    kind: "features",
    title: "Recursos",
    goal: "Mostrar os três pilares do produto.",
    contentBrief:
      "Título 'Tudo que você precisa para publicar'. Cards: Design inteligente, Conteúdo sob medida, Publicação instantânea.",
    layoutBrief: "Cabeçalho centralizado e grade de três cards com ícones.",
    cursors: { count: 2, mode: "split", roles: ["layout", "copy"] },
  },
  {
    id: "cta",
    kind: "cta",
    title: "CTA final",
    goal: "Converter visitantes prontos em teste gratuito.",
    contentBrief: "Título 'Sua próxima página começa agora'. Texto curto e botão Criar minha página.",
    layoutBrief: "Bloco centralizado com fundo destacado.",
    cursors: { count: 2, mode: "race" },
  },
  {
    id: "footer",
    kind: "footer",
    title: "Rodapé",
    goal: "Fechar a página com links essenciais.",
    contentBrief: "Clarity © 2026, links Privacidade, Termos e Contato.",
    layoutBrief: "Linha simples com marca e links.",
    cursors: { count: 1, mode: "solo" },
  },
];

const mockPlan = (): BuildPlan => ({
  title: "Clarity",
  tagline: "Páginas claras, feitas por um time de agentes.",
  theme,
  sections: sectionSpecs,
});

const text = (id: string, value: string, style?: Node["style"]): Node => ({
  id,
  type: "text",
  text: value,
  style,
});

const heading = (id: string, value: string, level: number, style?: Node["style"]): Node => ({
  id,
  type: "heading",
  text: value,
  level,
  style,
});

const button = (id: string, value: string, style?: Node["style"]): Node => ({
  id,
  type: "button",
  text: value,
  href: "#",
  style,
});

const stack = (id: string, children: Node[], style?: Node["style"]): Node => ({
  id,
  type: "stack",
  children,
  style,
});

const card = (id: string, title: string, body: string, icon: string): Node =>
  stack(
    id,
    [
      { id: `${id}-icon`, type: "icon", text: icon, style: { fontSize: "24px" } },
      heading(`${id}-title`, title, 3, { fontSize: "20px" }),
      text(`${id}-body`, body),
    ],
    {
      background: "var(--sw-surface)",
      border: "1px solid var(--sw-border)",
      borderRadius: "var(--sw-radius)",
      padding: "26px",
      gap: "12px",
      minHeight: "190px",
    },
  );

const mockSection = (spec: SectionSpec): Node => {
  switch (spec.kind) {
    case "nav":
      return {
        id: spec.id,
        type: "section",
        props: { kind: "nav" },
        children: [
          stack(
            "nav-inner",
            [
              text("nav-logo", "Clarity", { color: "var(--sw-text)", fontWeight: "750", fontSize: "18px" }),
              stack(
                "nav-links",
                [
                  { id: "nav-product", type: "link", text: "Produto", href: "#features", style: { fontSize: "14px" } },
                  { id: "nav-how", type: "link", text: "Como funciona", href: "#features", style: { fontSize: "14px" } },
                  { id: "nav-pricing", type: "link", text: "Preços", href: "#cta", style: { fontSize: "14px" } },
                ],
                { display: "flex", flexDirection: "row", gap: "24px", alignItems: "center" },
              ),
              button("nav-cta", "Começar grátis", { padding: "9px 16px", fontSize: "13px" }),
            ],
            {
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "24px",
            },
          ),
        ],
      };
    case "hero":
      return {
        id: spec.id,
        type: "section",
        props: { kind: "hero" },
        children: [
          {
            id: "hero-inner",
            type: "grid",
            style: {
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "56px",
              alignItems: "center",
              maxWidth: "1120px",
              margin: "0 auto",
            },
            children: [
              stack("hero-copy", [
                text("hero-badge", "Novo · agente de design", {
                  display: "inline-flex",
                  width: "fit-content",
                  padding: "7px 12px",
                  border: "1px solid var(--sw-border)",
                  borderRadius: "999px",
                  fontSize: "12px",
                  color: "var(--sw-muted)",
                }),
                heading("hero-title", "Transforme ideias em páginas que convertem.", 1, {
                  fontSize: "clamp(44px, 6vw, 76px)",
                }),
                text(
                  "hero-subtitle",
                  "Um time de agentes de IA planeja, escreve e monta cada seção da sua página. Você revisa e publica.",
                  { fontSize: "18px", maxWidth: "560px" },
                ),
                stack(
                  "hero-actions",
                  [
                    button("hero-primary", "Começar grátis"),
                    { id: "hero-secondary", type: "link", text: "Ver demonstração →", href: "#features", style: { color: "var(--sw-text)", fontWeight: "600" } },
                  ],
                  { display: "flex", flexDirection: "row", gap: "18px", alignItems: "center", margin: "8px 0 0" },
                ),
              ]),
              {
                id: "hero-visual",
                type: "image",
                src: "https://picsum.photos/seed/clarity-hero/1000/820",
                alt: "Composição abstrata luminosa em fundo escuro",
                style: { minHeight: "480px", height: "100%", width: "100%" },
              },
            ],
          },
        ],
      };
    case "features":
      return {
        id: spec.id,
        type: "section",
        props: { kind: "features" },
        children: [
          stack("features-inner", [
            stack("features-head", [
              text("features-eyebrow", "RECURSOS", { fontSize: "12px", letterSpacing: ".16em", color: "var(--sw-primary)", fontWeight: "700" }),
              heading("features-title", "Tudo que você precisa para publicar", 2, { fontSize: "clamp(32px, 4vw, 52px)" }),
              text("features-subtitle", "Do conceito ao site no ar, sem trocar de ferramenta.", { fontSize: "17px", maxWidth: "600px" }),
            ], { gap: "14px", alignItems: "center", textAlign: "center", margin: "0 0 44px" }),
            {
              id: "features-grid",
              type: "grid",
              style: { gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "18px" },
              children: [
                card("features-design", "Design inteligente", "Layouts e tokens gerados com intenção, não com cara de template.", "✦"),
                card("features-copy", "Conteúdo sob medida", "Copy específica para o seu produto, seção por seção.", "✳"),
                card("features-publish", "Publicação instantânea", "Revise, aprove e exporte uma página pronta para o ar.", "↗"),
              ],
            },
          ], { maxWidth: "1120px", margin: "0 auto", gap: "0" }),
        ],
      };
    case "cta":
      return {
        id: spec.id,
        type: "section",
        props: { kind: "cta" },
        children: [
          stack("cta-inner", [
            text("cta-eyebrow", "COMECE AGORA", { fontSize: "12px", letterSpacing: ".16em", color: "var(--sw-primary)", fontWeight: "700" }),
            heading("cta-title", "Sua próxima página começa agora.", 2, { fontSize: "clamp(36px, 5vw, 62px)" }),
            text("cta-text", "Descreva sua ideia. O swarm cuida do resto.", { fontSize: "18px" }),
            button("cta-button", "Criar minha página", { marginTop: "8px", padding: "15px 26px" }),
          ], {
            alignItems: "center",
            textAlign: "center",
            gap: "16px",
            maxWidth: "760px",
            margin: "0 auto",
            padding: "64px 40px",
            background: "var(--sw-surface)",
            border: "1px solid var(--sw-border)",
            borderRadius: "calc(var(--sw-radius) * 1.5)",
          }),
        ],
      };
    case "footer":
      return {
        id: spec.id,
        type: "section",
        props: { kind: "footer" },
        children: [
          stack("footer-inner", [
            text("footer-brand", "Clarity", { color: "var(--sw-text)", fontWeight: "700" }),
            stack("footer-links", [
              { id: "footer-privacy", type: "link", text: "Privacidade", href: "#" },
              { id: "footer-terms", type: "link", text: "Termos", href: "#" },
              { id: "footer-contact", type: "link", text: "Contato", href: "#" },
            ], { display: "flex", flexDirection: "row", gap: "20px" }),
            text("footer-copy", "© 2026 Clarity. Feito por agentes, revisado por humanos.", { fontSize: "12px" }),
          ], { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: "24px" }),
        ],
      };
    default:
      return {
        id: spec.id,
        type: "section",
        children: [stack(`${spec.id}-inner`, [heading(`${spec.id}-title`, spec.title, 2), text(`${spec.id}-text`, spec.contentBrief)])],
      };
  }
};

export class MockRuntime implements AgentRuntime {
  readonly name = "mock";

  async plan(_request: PlanRequest): Promise<PlanResult> {
    return { plan: mockPlan(), sessionId: "mock-architect", cost: 0 };
  }

  async buildSection(request: SectionRequest): Promise<SectionResult> {
    const patch: SectionPatch = { sectionId: request.section.id, node: mockSection(request.section) };
    return { patch, sessionId: `mock-${request.section.id}`, cost: 0 };
  }

  async planSection(request: PlanSectionRequest): Promise<PlanSectionResult> {
    const kind = request.kind ?? "features";
    const slug = (request.title ?? kind)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || kind;
    const quality = request.quality ?? "solo";
    return {
      section: {
        id: `${slug}-${Date.now().toString(36)}`,
        kind,
        title: request.title ?? "Nova seção",
        goal: request.prompt,
        contentBrief: request.prompt,
        layoutBrief: "Siga o design system e o tom da página.",
        cursors:
          quality === "split"
            ? { count: 2, mode: "split", roles: ["layout", "copy"] }
            : quality === "race"
              ? { count: 2, mode: "race" }
              : { count: 1, mode: "solo" },
      },
      notes: "Mock section plan.",
      sessionId: "mock-section-planner",
      cost: 0,
    };
  }

  async editNode(request: EditRequest): Promise<EditOutcome> {
    const patches = request.targets?.length
      ? request.targets.map((target) =>
          target.text
            ? { nodeId: target.nodeId, text: `${target.text} (revisado)` }
            : { nodeId: target.nodeId, style: { border: "1px solid #c6f24e" } },
        )
      : request.node.text
        ? [{ nodeId: request.node.id, text: `${request.node.text} (revisado)` }]
        : [{ nodeId: request.node.id, style: { border: "1px solid #c6f24e" } }];
    return { result: { summary: "Mock edit applied.", patches }, sessionId: "mock-editor", cost: 0 };
  }

  async refineSection(_request: RefineRequest): Promise<RefineOutcome> {
    return { result: { summary: "Mock refinement: no changes.", patches: [] }, sessionId: "mock-refiner", cost: 0 };
  }

  async critique(_request: CriticRequest): Promise<CriticOutcome> {
    const result: CriticResult = { summary: "Mock review: page is complete.", issues: [] };
    return { result, sessionId: "mock-critic", cost: 0 };
  }

  async close(): Promise<void> {}
}

export const createMockRuntime = (): AgentRuntime => new MockRuntime();
