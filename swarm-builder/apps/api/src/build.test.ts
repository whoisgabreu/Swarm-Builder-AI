import assert from "node:assert/strict";
import test from "node:test";
import type { BuildPlan, CriticResult, Node, SectionPatch } from "@swarm/dsl";
import type { AgentRuntime, ArtboardRequest, ArtboardResult, CreativeSetRequest, CreativeSetResult, CriticOutcome, CriticRequest, EditOutcome, EditRequest, PlanRequest, PlanResult, PlanSectionRequest, PlanSectionResult, RefineOutcome, RefineRequest, SectionRequest, SectionResult } from "@swarm/agent-runtime";
import { runBuild } from "./build.js";
import { runRevision, undoRevision, expandSelection } from "./revise.js";
import { runSectionAddition } from "./add-section.js";
import { createMockRuntime } from "@swarm/agent-runtime";
import { compilePage } from "@swarm/dsl";
import { RunChannel } from "./events.js";
import type { ProjectRecord, RunRecord } from "./store.js";

const plan: BuildPlan = {
  title: "Teste",
  tagline: "Página de teste.",
  theme: {
    colors: {
      background: "#fff",
      surface: "#f5f5f5",
      text: "#111",
      muted: "#666",
      primary: "#0d99ff",
      primaryText: "#fff",
      accent: "#8b7bff",
      border: "#ddd",
    },
    radius: "12px",
    spacing: "20px",
  },
  sections: [
    {
      id: "hero",
      kind: "hero",
      title: "Hero de teste",
      goal: "Validar o fluxo.",
      contentBrief: "Título e CTA.",
      layoutBrief: "Coluna central.",
    },
  ],
};

const makeProject = (): ProjectRecord => ({
  id: "project-1",
  prompt: "Uma landing page de teste.",
  status: "idle",
  createdAt: Date.now(),
});

const makeRun = (): RunRecord => ({
  id: "run-1",
  projectId: "project-1",
  status: "planning",
  startedAt: Date.now(),
  channel: new RunChannel(),
});

const runtime = (overrides: Partial<AgentRuntime> = {}): AgentRuntime => ({
  name: "test",
  async plan(_request: PlanRequest): Promise<PlanResult> {
    return { plan, sessionId: "planner" };
  },
  async planCreativeSet(request: CreativeSetRequest): Promise<CreativeSetResult> {
    return {
      plan: {
        title: "Mock Creative",
        concept: request.prompt,
        theme: plan.theme,
        formatId: request.formatId,
        artboards: [{ id: "cover", role: "cover", brief: request.prompt }],
      },
      sessionId: "creative-director",
    };
  },
  async buildArtboard(request: ArtboardRequest): Promise<ArtboardResult> {
    return {
      patch: {
        artboardId: request.artboard.id,
        node: {
          id: request.artboard.id,
          type: "artboard",
          children: [{ id: `${request.artboard.id}-title`, type: "heading", text: request.artboard.brief }],
        },
      },
      sessionId: "artboard",
    };
  },
  async planSection(request: PlanSectionRequest): Promise<PlanSectionResult> {
    return {
      section: {
        id: "nova-secao",
        kind: request.kind ?? "features",
        title: request.title ?? "Nova seção",
        goal: request.prompt,
        contentBrief: request.prompt,
        layoutBrief: "Siga o design system.",
        cursors: { count: 1, mode: "solo" },
      },
      sessionId: "planner",
    };
  },
  async buildSection(request: SectionRequest): Promise<SectionResult> {
    const patch: SectionPatch = {
      sectionId: request.section.id,
      node: {
        id: request.section.id,
        type: "section",
        style: { backgroundColor: "#f5f5f5", alignItems: "start" },
        children: [{ id: `${request.section.id}-title`, type: "heading", text: request.section.title }],
      },
    };
    return { patch, sessionId: `section-${request.section.id}` };
  },
  async refineSection(_request: RefineRequest): Promise<RefineOutcome> {
    return { result: { summary: "ok", patches: [] }, sessionId: "refiner" };
  },
  async editNode(_request: EditRequest): Promise<EditOutcome> {
    return { result: { summary: "ok", patches: [] }, sessionId: "editor" };
  },
  async critique(_request: CriticRequest): Promise<CriticOutcome> {
    const result: CriticResult = { summary: "ok", issues: [] };
    return { result, sessionId: "critic" };
  },
  async close() {},
  ...overrides,
});

test("build applies lenient styles instead of failing the section", async () => {
  const project = makeProject();
  const run = makeRun();
  await runBuild({ runtime: runtime(), project, run, concurrency: 1 });
  assert.equal(project.status, "done");
  assert.match(project.html ?? "", /align-items:flex-start/);
  assert.equal(run.channel.events.some((event) => event.type === "run.done"), true);
  const done = run.channel.events.find((event) => event.type === "run.done");
  assert.equal(done?.type === "run.done" ? done.stats.failed : -1, 0);
});

test("build falls back when the section agent fails twice", async () => {
  const project = makeProject();
  const run = makeRun();
  let calls = 0;
  const failing = runtime({
    async buildSection(_request: SectionRequest): Promise<SectionResult> {
      calls++;
      throw new Error("Model did not produce structured output");
    },
  });
  await runBuild({ runtime: failing, project, run, concurrency: 1 });
  assert.equal(calls, 2);
  assert.equal(project.status, "done");
  assert.match(project.html ?? "", /Hero de teste/);
  const fallback = run.channel.events.find((event) => event.type === "task.fallback");
  assert.ok(fallback);
  const done = run.channel.events.find((event) => event.type === "run.done");
  assert.equal(done?.type === "run.done" ? done.stats.failed : -1, 1);
});

test("deterministic audit fixes a stacked navbar and attributes the fix", async () => {
  const navPlan: BuildPlan = {
    ...plan,
    sections: [
      {
        id: "nav",
        kind: "nav",
        title: "Nav",
        goal: "Orientar.",
        contentBrief: "Logo, links e CTA.",
        layoutBrief: "Linha horizontal no desktop.",
        cursors: { count: 1, mode: "solo" },
      },
    ],
  };
  const nav: Node = {
    id: "nav",
    type: "section",
    props: { kind: "nav" },
    children: [
      {
        id: "nav-bar",
        type: "stack",
        style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" },
        children: [
          { id: "nav-brand", type: "link", text: "Marca", href: "#" },
          {
            id: "nav-links",
            type: "stack",
            style: { display: "flex", flexDirection: "column", gap: "20px" },
            children: [
              { id: "nav-link-1", type: "link", text: "Cursos", href: "#" },
              { id: "nav-link-2", type: "link", text: "Método", href: "#" },
            ],
          },
          {
            id: "nav-actions",
            type: "stack",
            style: { display: "flex", flexDirection: "column", gap: "12px" },
            children: [
              { id: "nav-login", type: "link", text: "Entrar", href: "#" },
              { id: "nav-cta", type: "button", text: "Começar", href: "#" },
            ],
          },
        ],
      },
    ],
  };
  const project = makeProject();
  const run = makeRun();
  const badNav = runtime({
    async plan(): Promise<PlanResult> {
      return { plan: navPlan, sessionId: "planner" };
    },
    async buildSection(): Promise<SectionResult> {
      return { patch: { sectionId: "nav", node: nav }, sessionId: "nav" };
    },
  });
  await runBuild({ runtime: badNav, project, run, concurrency: 1 });
  assert.equal(project.status, "done");
  assert.match(project.html ?? "", /data-swarm-node="nav-bar"[^>]*flex-direction:row/);
  assert.equal(run.channel.events.some((event) => event.type === "critic.issue"), true);
  assert.equal(run.channel.events.some((event) => event.type === "fix.applied"), true);
  const done = run.channel.events.find((event) => event.type === "run.done");
  assert.ok(done?.type === "run.done" && (done.stats.fixed ?? 0) >= 1);
});

test("split mode runs refiners and tags their nodes", async () => {
  const splitPlan: BuildPlan = {
    ...plan,
    sections: [
      {
        id: "hero",
        kind: "hero",
        title: "Hero",
        goal: "Converter.",
        contentBrief: "Headline e CTA.",
        layoutBrief: "Duas colunas.",
        cursors: { count: 2, mode: "split", roles: ["layout", "copy"] },
      },
    ],
  };
  const project = makeProject();
  const run = makeRun();
  let refineCalls = 0;
  const splitRuntime = runtime({
    async plan(): Promise<PlanResult> {
      return { plan: splitPlan, sessionId: "planner" };
    },
    async refineSection(request: RefineRequest): Promise<RefineOutcome> {
      refineCalls++;
      return {
        result: {
          summary: "copy refined",
          patches: [{ nodeId: "hero-title", text: `Refinado por ${request.role}` }],
        },
        sessionId: "refiner",
      };
    },
  });
  await runBuild({ runtime: splitRuntime, project, run, concurrency: 1 });
  assert.equal(project.status, "done");
  assert.equal(refineCalls, 1);
  assert.match(project.html ?? "", /Refinado por copy/);
  assert.equal(
    run.channel.events.some((event) => event.type === "patch.applied" && event.agentId === "section:hero:copy"),
    true,
  );
});

test("race mode selects one variant and discards the others", async () => {
  const racePlan: BuildPlan = {
    ...plan,
    sections: [
      {
        id: "cta",
        kind: "cta",
        title: "CTA",
        goal: "Converter.",
        contentBrief: "Chamada final.",
        layoutBrief: "Bloco central.",
        cursors: { count: 2, mode: "race" },
      },
    ],
  };
  const project = makeProject();
  const run = makeRun();
  let calls = 0;
  const raceRuntime = runtime({
    async plan(): Promise<PlanResult> {
      return { plan: racePlan, sessionId: "planner" };
    },
    async buildSection(): Promise<SectionResult> {
      const index = calls++;
      return {
        patch: {
          sectionId: "cta",
          node: {
            id: "cta",
            type: "section",
            children: [{ id: "cta-title", type: "heading", text: `Variante ${index}` }],
          },
        },
        sessionId: `variant-${index}`,
      };
    },
  });
  await runBuild({ runtime: raceRuntime, project, run, concurrency: 1 });
  assert.equal(project.status, "done");
  assert.equal(run.channel.events.filter((event) => event.type === "variant.started").length, 2);
  assert.equal(run.channel.events.filter((event) => event.type === "variant.selected").length, 1);
  assert.equal(run.channel.events.filter((event) => event.type === "variant.discarded").length, 1);
});

test("targeted revision edits only the selected node and can be undone", async () => {
  const project = makeProject();
  const buildRun = makeRun();
  await runBuild({ runtime: runtime(), project, run: buildRun, concurrency: 1 });
  assert.equal(project.status, "done");
  assert.ok(project.artifact);
  const before = project.html;
  const edited = runtime({
    async editNode(request: EditRequest): Promise<EditOutcome> {
      return {
        result: {
          summary: "Ajuste aplicado.",
          patches: [{ nodeId: request.node.id, text: "Hero revisado" }],
        },
        sessionId: "editor",
        cost: 0.001,
      };
    },
  });
  const revisionRun = makeRun();
  await runRevision({
    runtime: edited,
    project,
    run: revisionRun,
    request: "Deixe o título mais direto.",
    target: { nodeId: "hero-title" },
  });
  assert.equal(project.status, "done");
  assert.notEqual(project.html, before);
  assert.match(project.html ?? "", /Hero revisado/);
  assert.equal(project.undoStack?.length, 1);
  assert.equal(revisionRun.channel.events.some((event) => event.type === "revision.done"), true);
  const restored = undoRevision(project);
  assert.ok(restored);
  assert.equal(project.html, before);
});

test("expandSelection finds exact text matches with owners", () => {
  const nodePlan: BuildPlan = {
    ...plan,
    sections: [
      { ...plan.sections[0]!, id: "nav", kind: "nav", title: "Nav" },
      { ...plan.sections[0]!, id: "footer", kind: "footer", title: "Footer" },
    ],
  };
  const root: Node = {
    id: "page",
    type: "page",
    children: [
      { id: "nav", type: "section", children: [{ id: "nav-brand", type: "text", text: "Clarity" }] },
      { id: "footer", type: "section", children: [{ id: "footer-brand", type: "text", text: "Clarity" }] },
    ],
  };
  const project: ProjectRecord = {
    id: "p-expand",
    prompt: "x",
    status: "done",
    createdAt: Date.now(),
    plan: nodePlan,
    artifact: root,
    html: compilePage({ title: "t", plan: nodePlan, root }),
    agents: [
      { id: "section:nav", name: "Linus", color: "#000", role: "section", sectionId: "nav", cursorRole: "layout" },
      { id: "section:footer", name: "Guido", color: "#111", role: "section", sectionId: "footer", cursorRole: "layout" },
    ],
    ownership: {
      "nav-brand": { agentId: "section:nav", sectionId: "nav", cursorRole: "layout" },
      "footer-brand": { agentId: "section:footer", sectionId: "footer", cursorRole: "layout" },
    },
  };
  const matches = expandSelection(project, ["nav-brand"], "text");
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.nodeId, "footer-brand");
  assert.equal(matches[0]?.ownerName, "Guido");
});

test("multi-target revision applies one patch per owner and undo restores all", async () => {
  const nodePlan: BuildPlan = {
    ...plan,
    sections: [
      { ...plan.sections[0]!, id: "nav", kind: "nav", title: "Nav" },
      { ...plan.sections[0]!, id: "footer", kind: "footer", title: "Footer" },
    ],
  };
  const root: Node = {
    id: "page",
    type: "page",
    children: [
      { id: "nav", type: "section", children: [{ id: "nav-brand", type: "text", text: "Clarity" }] },
      { id: "footer", type: "section", children: [{ id: "footer-brand", type: "text", text: "Clarity" }] },
    ],
  };
  const project: ProjectRecord = {
    id: "p-multi",
    prompt: "x",
    status: "done",
    createdAt: Date.now(),
    plan: nodePlan,
    artifact: root,
    html: compilePage({ title: "t", plan: nodePlan, root }),
    agents: [
      { id: "section:nav", name: "Linus", color: "#000", role: "section", sectionId: "nav", cursorRole: "layout" },
      { id: "section:footer", name: "Guido", color: "#111", role: "section", sectionId: "footer", cursorRole: "layout" },
    ],
    ownership: {
      "nav-brand": { agentId: "section:nav", sectionId: "nav", cursorRole: "layout" },
      "footer-brand": { agentId: "section:footer", sectionId: "footer", cursorRole: "layout" },
    },
  };
  const before = project.html;
  const multi = runtime({
    async editNode(request: EditRequest): Promise<EditOutcome> {
      return {
        result: {
          summary: "ok",
          patches: (request.targets ?? []).map((target) => ({ nodeId: target.nodeId, text: "Casa Caderno" })),
        },
        sessionId: "editor",
      };
    },
  });
  const revRun = makeRun();
  await runRevision({
    runtime: multi,
    project,
    run: revRun,
    request: "troque o nome",
    target: { nodeIds: ["nav-brand", "footer-brand"] },
  });
  assert.equal((project.html?.match(/Casa Caderno/g) ?? []).length, 2);
  assert.equal(project.undoStack?.length, 1);
  undoRevision(project);
  assert.equal(project.html, before);
});

test("add section inserts only the new section and undo removes it", async () => {
  const mock = createMockRuntime();
  const project = makeProject();
  const buildRun = makeRun();
  await runBuild({ runtime: mock, project, run: buildRun, concurrency: 4 });
  assert.equal(project.plan?.sections.length, 5);
  const navBefore = JSON.stringify(project.plan?.sections[0]);
  const addRun = makeRun();
  await runSectionAddition({
    runtime: mock,
    project,
    run: addRun,
    prompt: "Uma seção de FAQ com perguntas frequentes.",
    title: "FAQ",
    insertIndex: 2,
    quality: "solo",
  });
  assert.equal(project.plan?.sections.length, 6);
  assert.equal(project.plan?.sections[2]?.title, "FAQ");
  assert.equal(project.artifact?.children?.[2]?.id, project.plan?.sections[2]?.id);
  assert.equal(JSON.stringify(project.plan?.sections[0]), navBefore);
  assert.equal(addRun.channel.events.some((event) => event.type === "section.add.done"), true);
  undoRevision(project);
  assert.equal(project.plan?.sections.length, 5);
  assert.equal(project.artifact?.children?.length, 5);
});
