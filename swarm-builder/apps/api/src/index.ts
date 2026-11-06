import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { SectionKindSchema, SitePlanSchema, normalizeSitePlan } from "@swarm/dsl";
import { createMockRuntime, OpenCodeRuntime, type AgentRuntime } from "@swarm/agent-runtime";
import type { SequencedEvent } from "@swarm/protocol";
import { runBuild } from "./build.js";
import { runSiteBuild } from "./site-build.js";
import { expandSiteSelection, runSiteRevision, runSiteSectionAddition, undoSite } from "./site-revise.js";
import { buildSiteZip } from "./site-export.js";
import { pageRecordFromSpec, siteProjectView, siteProjects, type SiteProjectRecord } from "./site-store.js";
import { runSectionAddition } from "./add-section.js";
import { expandSelection, runRevision, undoRevision, type RevisionTarget } from "./revise.js";
import { projectView, projects, runs, type ProjectRecord, type RunRecord } from "./store.js";
import { RunChannel } from "./events.js";

const here = dirname(fileURLToPath(import.meta.url));
const runtimeDir = resolve(here, "../../../runtime");
const mock = process.env.SWARM_MOCK === "1";
const runtime: AgentRuntime = mock
  ? createMockRuntime()
  : new OpenCodeRuntime({
      runtimeDir,
      port: Number(process.env.SWARM_OPENCODE_PORT ?? 4097),
    });

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const createProjectSchema = z.object({
  prompt: z.string().trim().min(10).max(4000),
});

const createSiteSchema = z.object({
  prompt: z.string().trim().min(10).max(4000),
  brand: z.string().trim().max(120).optional(),
});

const updateSitePlanSchema = z.object({
  plan: SitePlanSchema,
});

const siteReviseSchema = z
  .object({
    pageId: z.string().min(1).max(80),
    request: z.string().trim().min(3).max(2000),
    nodeId: z.string().max(80).optional(),
    nodeIds: z.array(z.string().max(80)).max(80).optional(),
    agentId: z.string().max(120).optional(),
    expand: z.enum(["text"]).optional(),
  })
  .refine((value) => Boolean(value.nodeId || value.nodeIds?.length || value.agentId), {
    message: "select one or more nodes or an agent",
  });

const siteAddSectionSchema = z.object({
  prompt: z.string().trim().min(3).max(2000),
  title: z.string().trim().max(160).optional(),
  kind: SectionKindSchema.optional(),
  insertIndex: z.number().int().min(0).max(20),
  quality: z.enum(["solo", "split", "race"]).optional(),
});

const siteExpandSchema = z.object({
  pageId: z.string().min(1).max(80),
  nodeIds: z.array(z.string().max(80)).min(1).max(80),
});

const buildInFlight = new Set(["planning", "building", "reviewing"]);

const reviseSchema = z
  .object({
    request: z.string().trim().min(3).max(2000),
    nodeId: z.string().max(80).optional(),
    nodeIds: z.array(z.string().max(80)).max(80).optional(),
    sectionId: z.string().max(80).optional(),
    agentId: z.string().max(120).optional(),
    expand: z.enum(["text"]).optional(),
  })
  .refine((value) => Boolean(value.nodeId || value.nodeIds?.length || value.sectionId || value.agentId), {
    message: "select one or more nodes, a section or an agent",
  });

const expandSchema = z.object({
  nodeIds: z.array(z.string().max(80)).min(1).max(80),
  by: z.literal("text"),
});

const addSectionSchema = z.object({
  prompt: z.string().trim().min(3).max(2000),
  title: z.string().trim().max(160).optional(),
  kind: SectionKindSchema.optional(),
  insertIndex: z.number().int().min(0).max(20),
  quality: z.enum(["solo", "split", "race"]).optional(),
});

const sseWrite = (raw: NodeJS.WritableStream, event: SequencedEvent): void => {
  raw.write(`id: ${event.seq}\n`);
  raw.write(`event: ${event.type}\n`);
  raw.write(`data: ${JSON.stringify(event)}\n\n`);
};

app.get("/api/health", async () => ({
  ok: true,
  runtime: runtime.name,
  mock,
  opencodePort: Number(process.env.SWARM_OPENCODE_PORT ?? 4097),
}));

app.post("/api/projects", async (request, reply) => {
  const parsed = createProjectSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid prompt" });
  }
  const project: ProjectRecord = {
    id: randomUUID(),
    prompt: parsed.data.prompt,
    status: "idle",
    createdAt: Date.now(),
  };
  projects.set(project.id, project);
  return reply.code(201).send(projectView(project));
});

app.post("/api/sites", async (request, reply) => {
  const parsed = createSiteSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid site brief" });
  try {
    const planned = await runtime.planSite({ brief: parsed.data.prompt, brand: parsed.data.brand });
    const plan = normalizeSitePlan(planned.plan);
    const site: SiteProjectRecord = {
      id: randomUUID(),
      prompt: parsed.data.prompt,
      brand: parsed.data.brand,
      status: "idle",
      createdAt: Date.now(),
      plan,
      planningCost: planned.cost ?? 0,
      parentSessionId: planned.sessionId,
      pages: plan.pages.map(pageRecordFromSpec),
      layout: {},
      agents: [],
      ownership: {},
      cost: planned.cost ?? 0,
    };
    siteProjects.set(site.id, site);
    return reply.code(201).send(siteProjectView(site));
  } catch (error) {
    app.log.error(error);
    return reply.code(502).send({ error: error instanceof Error ? error.message : "site planning failed" });
  }
});

app.get("/api/sites/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const site = siteProjects.get(id);
  if (!site) return reply.code(404).send({ error: "site not found" });
  return siteProjectView(site);
});

app.patch("/api/sites/:id/plan", async (request, reply) => {
  const { id } = request.params as { id: string };
  const site = siteProjects.get(id);
  if (!site) return reply.code(404).send({ error: "site not found" });
  if (buildInFlight.has(site.status)) return reply.code(409).send({ error: "a build is already running" });
  const parsed = updateSitePlanSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid site plan" });
  const plan = normalizeSitePlan(parsed.data.plan);
  site.plan = plan;
  site.pages = plan.pages.map(pageRecordFromSpec);
  site.layout = {};
  site.agents = [];
  site.ownership = {};
  site.cost = site.planningCost;
  site.stats = undefined;
  site.error = undefined;
  site.undoStack = [];
  site.status = "idle";
  return siteProjectView(site);
});

app.post("/api/sites/:id/build", async (request, reply) => {
  const { id } = request.params as { id: string };
  const site = siteProjects.get(id);
  if (!site) return reply.code(404).send({ error: "site not found" });
  if (!site.plan) return reply.code(409).send({ error: "site has no plan" });
  if (buildInFlight.has(site.status)) return reply.code(409).send({ error: "a build is already running", runId: site.runId });
  const run: RunRecord = {
    id: randomUUID(),
    projectId: site.id,
    status: "planning",
    startedAt: Date.now(),
    channel: new RunChannel(),
  };
  runs.set(run.id, run);
  site.runId = run.id;
  site.status = "planning";
  site.error = undefined;
  site.stats = undefined;
  site.undoStack = [];
  void runSiteBuild({ runtime, site, run }).catch((error) => {
    app.log.error(error);
    site.status = "failed";
    site.error = error instanceof Error ? error.message : String(error);
    run.status = "failed";
    run.finishedAt = Date.now();
    run.channel.emit({ type: "run.failed", message: site.error, at: Date.now() });
  });
  return reply.code(202).send({ runId: run.id, siteId: site.id });
});

app.post("/api/sites/:id/revise", async (request, reply) => {
  const { id } = request.params as { id: string };
  const site = siteProjects.get(id);
  if (!site) return reply.code(404).send({ error: "site not found" });
  if (buildInFlight.has(site.status)) return reply.code(409).send({ error: "a build or revision is already running", runId: site.runId });
  const parsed = siteReviseSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid revision" });
  const run: RunRecord = {
    id: randomUUID(),
    projectId: site.id,
    status: "reviewing",
    startedAt: Date.now(),
    channel: new RunChannel(),
  };
  runs.set(run.id, run);
  site.status = "reviewing";
  site.runId = run.id;
  void runSiteRevision({
    runtime,
    site,
    run,
    pageId: parsed.data.pageId,
    request: parsed.data.request,
    target: {
      nodeId: parsed.data.nodeId,
      nodeIds: parsed.data.nodeIds,
      agentId: parsed.data.agentId,
      expand: parsed.data.expand,
    },
  }).catch((error) => {
    app.log.error(error);
    site.status = "done";
    run.status = "failed";
    run.finishedAt = Date.now();
    run.channel.emit({
      type: "revision.done",
      revisionId: run.id,
      success: false,
      summary: error instanceof Error ? error.message : String(error),
      cost: 0,
      totalCost: site.cost,
      pageId: parsed.data.pageId,
      at: Date.now(),
    });
  });
  return reply.code(202).send({ runId: run.id, siteId: site.id, pageId: parsed.data.pageId });
});

app.post("/api/sites/:id/pages/:pageId/sections", async (request, reply) => {
  const { id, pageId } = request.params as { id: string; pageId: string };
  const site = siteProjects.get(id);
  if (!site) return reply.code(404).send({ error: "site not found" });
  if (buildInFlight.has(site.status)) return reply.code(409).send({ error: "a build or revision is already running", runId: site.runId });
  const parsed = siteAddSectionSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid section" });
  const run: RunRecord = {
    id: randomUUID(),
    projectId: site.id,
    status: "reviewing",
    startedAt: Date.now(),
    channel: new RunChannel(),
  };
  runs.set(run.id, run);
  site.status = "reviewing";
  site.runId = run.id;
  void runSiteSectionAddition({
    runtime,
    site,
    run,
    pageId,
    prompt: parsed.data.prompt,
    title: parsed.data.title,
    kind: parsed.data.kind,
    insertIndex: parsed.data.insertIndex,
    quality: parsed.data.quality,
  }).catch((error) => {
    app.log.error(error);
    site.status = "done";
    run.status = "failed";
    run.finishedAt = Date.now();
    run.channel.emit({
      type: "section.add.done",
      success: false,
      summary: error instanceof Error ? error.message : String(error),
      cost: 0,
      at: Date.now(),
    });
  });
  return reply.code(202).send({ runId: run.id, siteId: site.id, pageId });
});

app.post("/api/sites/:id/undo", async (request, reply) => {
  const { id } = request.params as { id: string };
  const site = siteProjects.get(id);
  if (!site) return reply.code(404).send({ error: "site not found" });
  if (buildInFlight.has(site.status)) return reply.code(409).send({ error: "a build or revision is already running" });
  const pages = undoSite(site);
  if (!pages) return reply.code(409).send({ error: "nothing to undo" });
  return siteProjectView(site);
});

app.post("/api/sites/:id/selection/expand", async (request, reply) => {
  const { id } = request.params as { id: string };
  const site = siteProjects.get(id);
  if (!site) return reply.code(404).send({ error: "site not found" });
  const parsed = siteExpandSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid selection" });
  return { matches: expandSiteSelection(site, parsed.data.pageId, parsed.data.nodeIds) };
});

app.get("/api/sites/:id/export", async (request, reply) => {
  const { id } = request.params as { id: string };
  const site = siteProjects.get(id);
  if (!site) return reply.code(404).send({ error: "site not found" });
  if (!site.pages.some((page) => page.artifact)) return reply.code(409).send({ error: "site has no built pages" });
  const archive = await buildSiteZip(site);
  reply.header("Content-Type", "application/zip");
  reply.header("Content-Disposition", `attachment; filename="site-${site.id}.zip"`);
  return reply.send(archive);
});

app.get("/api/projects/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const project = projects.get(id);
  if (!project) return reply.code(404).send({ error: "project not found" });
  return projectView(project);
});

app.post("/api/projects/:id/build", async (request, reply) => {
  const { id } = request.params as { id: string };
  const project = projects.get(id);
  if (!project) return reply.code(404).send({ error: "project not found" });
  if (buildInFlight.has(project.status)) {
    return reply.code(409).send({ error: "a build is already running", runId: project.runId });
  }

  const run: RunRecord = {
    id: randomUUID(),
    projectId: project.id,
    status: "planning",
    startedAt: Date.now(),
    channel: new RunChannel(),
  };
  runs.set(run.id, run);
  project.runId = run.id;
  project.status = "planning";
  project.html = undefined;
  project.plan = undefined;
  project.error = undefined;

  const concurrency = Number(process.env.SWARM_CONCURRENCY ?? 4);
  void runBuild({ runtime, project, run, concurrency }).catch((error) => {
    app.log.error(error);
    project.status = "failed";
    project.error = error instanceof Error ? error.message : String(error);
    run.status = "failed";
    run.finishedAt = Date.now();
    run.channel.emit({ type: "run.failed", message: project.error, at: Date.now() });
  });

  return reply.code(202).send({ runId: run.id, projectId: project.id });
});

app.post("/api/projects/:id/revise", async (request, reply) => {
  const { id } = request.params as { id: string };
  const project = projects.get(id);
  if (!project) return reply.code(404).send({ error: "project not found" });
  if (buildInFlight.has(project.status)) return reply.code(409).send({ error: "a build or revision is already running" });
  if (!project.plan || !project.artifact) return reply.code(409).send({ error: "project has no artifact to revise" });

  const parsed = reviseSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid revision" });

  const run: RunRecord = {
    id: randomUUID(),
    projectId: project.id,
    status: "reviewing",
    startedAt: Date.now(),
    channel: new RunChannel(),
  };
  runs.set(run.id, run);
  project.status = "reviewing";
  project.runId = run.id;

  const target: RevisionTarget = {
    nodeId: parsed.data.nodeId,
    nodeIds: parsed.data.nodeIds,
    sectionId: parsed.data.sectionId,
    agentId: parsed.data.agentId,
    expand: parsed.data.expand,
  };
  const revisionId = run.id;
  void runRevision({
    runtime,
    project,
    run,
    request: parsed.data.request,
    target,
    parentSessionId: project.parentSessionId,
  }).catch((error) => {
    app.log.error(error);
    project.status = "done";
    run.status = "failed";
    run.finishedAt = Date.now();
    run.channel.emit({
      type: "revision.done",
      revisionId,
      success: false,
      summary: error instanceof Error ? error.message : String(error),
      cost: 0,
      at: Date.now(),
    });
  });

  return reply.code(202).send({ runId: run.id, revisionId });
});

app.post("/api/projects/:id/sections", async (request, reply) => {
  const { id } = request.params as { id: string };
  const project = projects.get(id);
  if (!project) return reply.code(404).send({ error: "project not found" });
  if (buildInFlight.has(project.status)) return reply.code(409).send({ error: "a build or operation is already running" });
  if (!project.plan || !project.artifact) return reply.code(409).send({ error: "project has no artifact" });
  if (project.plan.sections.length >= 12) return reply.code(409).send({ error: "section limit reached" });

  const parsed = addSectionSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid section" });
  const insertIndex = Math.min(parsed.data.insertIndex, project.plan.sections.length);

  const run: RunRecord = {
    id: randomUUID(),
    projectId: project.id,
    status: "reviewing",
    startedAt: Date.now(),
    channel: new RunChannel(),
  };
  runs.set(run.id, run);
  project.status = "reviewing";
  project.runId = run.id;

  void runSectionAddition({
    runtime,
    project,
    run,
    prompt: parsed.data.prompt,
    title: parsed.data.title,
    kind: parsed.data.kind,
    insertIndex,
    quality: parsed.data.quality,
    parentSessionId: project.parentSessionId,
  }).catch((error) => {
    app.log.error(error);
    project.status = "done";
    run.status = "failed";
    run.finishedAt = Date.now();
    run.channel.emit({
      type: "section.add.done",
      success: false,
      summary: error instanceof Error ? error.message : String(error),
      cost: 0,
      at: Date.now(),
    });
  });

  return reply.code(202).send({ runId: run.id });
});

app.post("/api/projects/:id/undo", async (request, reply) => {
  const { id } = request.params as { id: string };
  const project = projects.get(id);
  if (!project) return reply.code(404).send({ error: "project not found" });
  if (buildInFlight.has(project.status)) return reply.code(409).send({ error: "a build or revision is already running" });
  const restored = undoRevision(project);
  if (!restored) return reply.code(404).send({ error: "nothing to undo" });
  return { html: restored.html, ownership: restored.ownership, plan: restored.plan, agents: restored.agents };
});

app.post("/api/projects/:id/selection/expand", async (request, reply) => {
  const { id } = request.params as { id: string };
  const project = projects.get(id);
  if (!project) return reply.code(404).send({ error: "project not found" });
  const parsed = expandSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid selection" });
  const matches = expandSelection(project, parsed.data.nodeIds, parsed.data.by);
  return { matches };
});

app.get("/api/runs/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const run = runs.get(id);
  if (!run) return reply.code(404).send({ error: "run not found" });
  return {
    id: run.id,
    projectId: run.projectId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    events: run.channel.events.length,
  };
});

app.get("/api/runs/:id/events", async (request, reply) => {
  const { id } = request.params as { id: string };
  const run = runs.get(id);
  if (!run) return reply.code(404).send({ error: "run not found" });

  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  raw.write(": connected\n\n");

  let last = 0;
  const send = (event: SequencedEvent) => {
    if (event.seq <= last) return;
    last = event.seq;
    sseWrite(raw, event);
  };

  const unsubscribe = run.channel.subscribe(send);
  for (const event of run.channel.events) send(event);

  const heartbeat = setInterval(() => raw.write(": ping\n\n"), 15000);
  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  raw.on("close", close);
  raw.on("error", close);
});

app.get("/api/runs/:id/preview", async (request, reply) => {
  const { id } = request.params as { id: string };
  const run = runs.get(id);
  if (!run) return reply.code(404).send({ error: "run not found" });
  const project = projects.get(run.projectId);
  if (!project?.html) return reply.code(404).send({ error: "preview not ready" });
  return reply.type("text/html; charset=utf-8").send(project.html);
});

const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: "127.0.0.1" });
app.log.info(`swarm-builder api on http://127.0.0.1:${port} (runtime=${runtime.name}, mock=${mock})`);

const shutdown = async () => {
  await app.close();
  await runtime.close();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
