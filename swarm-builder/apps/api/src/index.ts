import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import JSZip from "jszip";
import { CREATIVE_FORMATS, CreativeFormatIdSchema, SectionKindSchema } from "@swarm/dsl";
import { createMockRuntime, OpenCodeRuntime, type AgentRuntime } from "@swarm/agent-runtime";
import type { SequencedEvent } from "@swarm/protocol";
import { runBuild } from "./build.js";
import { runSectionAddition } from "./add-section.js";
import { creativeArtboardView, creativeProjectView, creativeProjects, runCreativeBuild, type CreativeProjectRecord } from "./creative.js";
import {
  expandCreativeSelection,
  runCreativeRevision,
  undoCreativeRevision,
  type CreativeRevisionTarget,
} from "./creative-revise.js";
import { renderArtboardImage } from "./render-image.js";
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

const createCreativeSchema = z.object({
  prompt: z.string().trim().min(10).max(4000),
  brand: z.string().trim().max(120).optional(),
  cta: z.string().trim().max(120).optional(),
  formatId: CreativeFormatIdSchema.default("ig-square"),
  cardCount: z.number().int().min(1).max(8).default(3),
});

const creativeExportSchema = z.object({
  format: z.enum(["png", "jpeg"]).default("png"),
  scale: z.number().int().min(1).max(2).default(1),
  artboardIds: z.array(z.string().max(80)).max(8).optional(),
});

const creativeReviseSchema = z
  .object({
    request: z.string().trim().min(3).max(2000),
    nodeId: z.string().max(80).optional(),
    nodeIds: z.array(z.string().max(80)).max(80).optional(),
    agentId: z.string().max(120).optional(),
    expand: z.enum(["text"]).optional(),
  })
  .refine((value) => Boolean(value.nodeId || value.nodeIds?.length || value.agentId), {
    message: "select one or more nodes or an agent",
  });

const creativeExpandSchema = z.object({
  nodeIds: z.array(z.string().max(80)).min(1).max(80),
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

app.post("/api/creative/projects", async (request, reply) => {
  const parsed = createCreativeSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid creative brief" });
  const project: CreativeProjectRecord = {
    id: randomUUID(),
    prompt: parsed.data.prompt,
    brand: parsed.data.brand,
    cta: parsed.data.cta,
    formatId: parsed.data.formatId,
    cardCount: parsed.data.cardCount,
    status: "idle",
    createdAt: Date.now(),
    artboards: [],
    cost: 0,
  };
  creativeProjects.set(project.id, project);
  return reply.code(201).send(creativeProjectView(project));
});

app.get("/api/creative/projects/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const project = creativeProjects.get(id);
  if (!project) return reply.code(404).send({ error: "creative project not found" });
  return creativeProjectView(project);
});

app.post("/api/creative/projects/:id/build", async (request, reply) => {
  const { id } = request.params as { id: string };
  const project = creativeProjects.get(id);
  if (!project) return reply.code(404).send({ error: "creative project not found" });
  if (buildInFlight.has(project.status)) return reply.code(409).send({ error: "build already running", runId: project.runId });
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
  project.artboards = [];
  project.error = undefined;
  const requestedConcurrency = Number(process.env.SWARM_CONCURRENCY ?? 3);
  const concurrency = Number.isFinite(requestedConcurrency)
    ? Math.max(1, Math.min(8, Math.trunc(requestedConcurrency)))
    : 3;
  void runCreativeBuild({ runtime, project, run, concurrency }).catch((error) => {
    app.log.error(error);
    project.status = "failed";
    project.error = error instanceof Error ? error.message : String(error);
    run.status = "failed";
    run.finishedAt = Date.now();
    run.channel.emit({ type: "creative.failed", message: project.error, at: Date.now() });
  });
  return reply.code(202).send({ runId: run.id, projectId: project.id });
});

app.post("/api/creative/projects/:id/artboards/:artboardId/revise", async (request, reply) => {
  const { id, artboardId } = request.params as { id: string; artboardId: string };
  const project = creativeProjects.get(id);
  if (!project) return reply.code(404).send({ error: "creative project not found" });
  const artboard = project.artboards.find((item) => item.id === artboardId);
  if (!artboard?.artifact) return reply.code(404).send({ error: "artboard not ready" });
  if (buildInFlight.has(project.status)) return reply.code(409).send({ error: "a build or revision is already running", runId: project.runId });
  const parsed = creativeReviseSchema.safeParse(request.body);
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
  void runCreativeRevision({
    runtime,
    project,
    artboardId,
    run,
    request: parsed.data.request,
    target: parsed.data as CreativeRevisionTarget,
  }).catch((error) => {
    app.log.error(error);
    project.status = "done";
    run.status = "failed";
    run.finishedAt = Date.now();
    run.channel.emit({
      type: "revision.done",
      revisionId: run.id,
      success: false,
      summary: error instanceof Error ? error.message : String(error),
      cost: 0,
      at: Date.now(),
    });
  });
  return reply.code(202).send({ runId: run.id });
});

app.post("/api/creative/projects/:id/artboards/:artboardId/undo", async (request, reply) => {
  const { id, artboardId } = request.params as { id: string; artboardId: string };
  const project = creativeProjects.get(id);
  if (!project) return reply.code(404).send({ error: "creative project not found" });
  if (buildInFlight.has(project.status)) return reply.code(409).send({ error: "a build or revision is already running" });
  const restored = undoCreativeRevision(project, artboardId);
  if (!restored) return reply.code(409).send({ error: "nothing to undo" });
  const artboard = project.artboards.find((item) => item.id === artboardId);
  return {
    ...restored,
    artboard: artboard ? creativeArtboardView(artboard) : null,
    undoAvailable: Boolean(artboard?.undoStack.length),
  };
});

app.post("/api/creative/projects/:id/artboards/:artboardId/selection/expand", async (request, reply) => {
  const { id, artboardId } = request.params as { id: string; artboardId: string };
  const project = creativeProjects.get(id);
  if (!project) return reply.code(404).send({ error: "creative project not found" });
  const artboard = project.artboards.find((item) => item.id === artboardId);
  if (!artboard?.artifact) return reply.code(404).send({ error: "artboard not ready" });
  const parsed = creativeExpandSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid selection" });
  return { matches: expandCreativeSelection(project, artboard, parsed.data.nodeIds) };
});

app.get("/api/creative/projects/:id/artboards/:artboardId/export", async (request, reply) => {
  const { id, artboardId } = request.params as { id: string; artboardId: string };
  const project = creativeProjects.get(id);
  if (!project) return reply.code(404).send({ error: "creative project not found" });
  const artboard = project.artboards.find((item) => item.id === artboardId);
  if (!artboard?.html) return reply.code(404).send({ error: "artboard not ready" });
  const query = request.query as { format?: string; scale?: string };
  const format = query.format === "jpeg" ? "jpeg" : "png";
  const requestedScale = Number(query.scale ?? 1);
  const scale = Number.isFinite(requestedScale) ? Math.max(1, Math.min(2, Math.trunc(requestedScale))) : 1;
  const creativeFormat = CREATIVE_FORMATS[project.formatId];
  const buffer = await renderArtboardImage({
    html: artboard.html,
    width: creativeFormat.width,
    height: creativeFormat.height,
    scale,
    format,
  });
  reply.header("Content-Type", format === "jpeg" ? "image/jpeg" : "image/png");
  reply.header("Content-Disposition", `attachment; filename="${project.id}-${artboard.id}@${scale}x.${format}"`);
  return reply.send(buffer);
});

app.post("/api/creative/projects/:id/export", async (request, reply) => {
  const { id } = request.params as { id: string };
  const project = creativeProjects.get(id);
  if (!project) return reply.code(404).send({ error: "creative project not found" });
  const parsed = creativeExportSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid export" });
  const selected = project.artboards.filter(
    (artboard) => artboard.html && (!parsed.data.artboardIds?.length || parsed.data.artboardIds.includes(artboard.id)),
  );
  if (!selected.length) return reply.code(409).send({ error: "no artboards ready" });
  const creativeFormat = CREATIVE_FORMATS[project.formatId];
  const zip = new JSZip();
  for (const artboard of selected) {
    const buffer = await renderArtboardImage({
      html: artboard.html,
      width: creativeFormat.width,
      height: creativeFormat.height,
      scale: parsed.data.scale,
      format: parsed.data.format,
    });
    zip.file(`${String(artboard.index + 1).padStart(2, "0")}-${artboard.id}@${parsed.data.scale}x.${parsed.data.format}`, buffer);
  }
  const archive = await zip.generateAsync({ type: "nodebuffer" });
  reply.header("Content-Type", "application/zip");
  reply.header("Content-Disposition", `attachment; filename="creative-${project.id}.zip"`);
  return reply.send(archive);
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
