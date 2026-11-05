import assert from "node:assert/strict";
import test from "node:test";
import { createMockRuntime } from "@swarm/agent-runtime";
import { collectNodes } from "@swarm/dsl";
import { runCreativeBuild, type CreativeProjectRecord } from "./creative.js";
import { expandCreativeSelection, runCreativeRevision, undoCreativeRevision } from "./creative-revise.js";
import { RunChannel } from "./events.js";
import type { RunRecord } from "./store.js";

const project = (): CreativeProjectRecord => ({
  id: "creative-1",
  prompt: "Carrossel editorial sobre design systems para times de produto.",
  brand: "Ateliê Forma",
  cta: "Conhecer os cursos",
  formatId: "ig-portrait",
  cardCount: 3,
  status: "idle",
  createdAt: Date.now(),
  artboards: [],
  cost: 0,
});

const run = (id = "creative-run-1", status: RunRecord["status"] = "planning"): RunRecord => ({
  id,
  projectId: "creative-1",
  status,
  startedAt: Date.now(),
  channel: new RunChannel(),
});

test("creative build plans, builds, compiles and assigns ownership", async () => {
  const target = project();
  const current = run();
  await runCreativeBuild({ runtime: createMockRuntime(), project: target, run: current });
  assert.equal(target.status, "done");
  assert.equal(current.status, "done");
  assert.equal(target.artboards.length, 3);
  assert.deepEqual(target.artboards.map((artboard) => artboard.status), ["done", "done", "done"]);
  assert.ok(target.artboards.every((artboard) => artboard.html.includes("sw-artboard")));
  for (const artboard of target.artboards) {
    assert.ok(artboard.artifact);
    assert.ok(artboard.groups.length > 1, "each card exposes its principal element owners");
    assert.ok(artboard.groups.every((group) => group.nodeIds.length > 0));
    for (const node of collectNodes(artboard.artifact!)) {
      assert.ok(target.ownership?.[node.id], `node ${node.id} has an owner`);
    }
  }
  const types = current.channel.events.map((event) => event.type);
  assert.equal(types[0], "creative.started");
  assert.equal(types[1], "creative.plan");
  assert.equal(types.filter((type) => type === "creative.artboard.done").length, 3);
  assert.equal(types.at(-1), "creative.done");
});

test("creative build aggregates director and card costs in USD", async () => {
  const target = project();
  const current = run();
  const runtime = createMockRuntime();
  const originalPlan = runtime.planCreativeSet.bind(runtime);
  const originalBuild = runtime.buildArtboard.bind(runtime);
  runtime.planCreativeSet = async (request) => ({ ...(await originalPlan(request)), cost: 0.003 });
  runtime.buildArtboard = async (request) => ({ ...(await originalBuild(request)), cost: 0.001 });
  await runCreativeBuild({ runtime, project: target, run: current });
  assert.equal(target.cost, 0.006);
  assert.equal(target.stats?.cost, 0.006);
  assert.ok(target.artboards.every((artboard) => artboard.cost === 0.001));
  assert.equal(target.stats?.nodes, target.artboards.reduce((sum, artboard) => sum + artboard.nodes, 0));
});

test("creative build falls back when the artboard agent keeps failing", async () => {
  const target = project();
  const current = run();
  const runtime = createMockRuntime();
  runtime.buildArtboard = async () => {
    throw new Error("agent offline");
  };
  await runCreativeBuild({ runtime, project: target, run: current });
  assert.equal(target.status, "done");
  assert.equal(target.artboards.length, 3);
  assert.ok(target.artboards.every((artboard) => artboard.fallback === true));
  assert.ok(target.artboards.every((artboard) => artboard.html.includes("sw-artboard")));
  assert.equal(current.channel.events.filter((event) => event.type === "creative.artboard.done").length, 3);
});

test("creative revision edits one card, adds cost and can be undone without refund", async () => {
  const target = project();
  await runCreativeBuild({ runtime: createMockRuntime(), project: target, run: run() });
  const artboard = target.artboards[0]!;
  const node = collectNodes(artboard.artifact!).find((item) => item.type === "heading" || item.type === "text");
  assert.ok(node?.text);
  const beforeHtml = artboard.html;
  const runtime = createMockRuntime();
  const originalEdit = runtime.editNode.bind(runtime);
  runtime.editNode = async (request) => ({ ...(await originalEdit(request)), cost: 0.002 });
  const revisionRun = run("creative-revision-1", "reviewing");
  await runCreativeRevision({
    runtime,
    project: target,
    artboardId: artboard.id,
    run: revisionRun,
    request: "Deixe o texto mais curto.",
    target: { nodeId: node!.id },
  });
  assert.equal(revisionRun.status, "done");
  assert.match(artboard.html, /revisado/);
  assert.equal(artboard.cost, 0.002);
  assert.equal(target.cost, 0.002);
  assert.equal(artboard.undoStack.length, 1);
  const done = revisionRun.channel.events.find((event) => event.type === "revision.done");
  assert.equal(done?.type === "revision.done" ? done.success : false, true);
  assert.equal(done?.type === "revision.done" ? done.totalCost : undefined, 0.002);

  const restored = undoCreativeRevision(target, artboard.id);
  assert.equal(restored?.html, beforeHtml);
  assert.equal(artboard.undoStack.length, 0);
  assert.equal(target.cost, 0.002);
});

test("creative expansion finds matching text inside the same card", async () => {
  const target = project();
  await runCreativeBuild({ runtime: createMockRuntime(), project: target, run: run() });
  const artboard = target.artboards[0]!;
  const heading = collectNodes(artboard.artifact!).find((node) => node.type === "heading");
  assert.ok(heading?.text);
  const matches = expandCreativeSelection(target, artboard, [heading!.id]);
  assert.ok(matches.some((match) => match.nodeId !== heading!.id));
  assert.ok(matches.every((match) => target.ownership?.[match.nodeId]?.sectionId === artboard.id));
});

test("creative revision rejects nodes from another card", async () => {
  const target = project();
  await runCreativeBuild({ runtime: createMockRuntime(), project: target, run: run() });
  const artboard = target.artboards[0]!;
  const foreign = collectNodes(target.artboards[1]!.artifact!)[1]!;
  const revisionRun = run("creative-revision-2", "reviewing");
  await runCreativeRevision({
    runtime: createMockRuntime(),
    project: target,
    artboardId: artboard.id,
    run: revisionRun,
    request: "Mude isso.",
    target: { nodeId: foreign.id },
  });
  assert.equal(revisionRun.status, "failed");
  const done = revisionRun.channel.events.find((event) => event.type === "revision.done");
  assert.equal(done?.type === "revision.done" ? done.success : true, false);
});
