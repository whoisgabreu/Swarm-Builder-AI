import {
  applyCriticIssue,
  applyRefinements,
  applySectionPatch,
  buildRenderOps,
  collectNodes,
  compilePage,
  countNodes,
  createArtifact,
  diffRenderOps,
  fallbackSection,
  findNode,
  normalizeAnchors,
  normalizePlan,
  validateSectionPatch,
  type BuildPlan,
  type CriticIssue,
  type CursorPlan,
  type CursorRole,
  type Node,
  type SectionSpec,
} from "@swarm/dsl";
import type { AgentRuntime, CriticAuditIssue } from "@swarm/agent-runtime";
import { COLORS, NAMES, type AgentInfo, type RunStats } from "@swarm/protocol";
import { auditHtml, type AuditIssue, type AuditReport } from "./audit.js";
import type { ProjectRecord, RunRecord } from "./store.js";

const now = () => Date.now();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
};

const pageHtml = (plan: BuildPlan, root: Node): string =>
  compilePage({ title: plan.title, description: plan.tagline, plan, root });

const compactReport = (report: AuditReport) => {
  const view = (value: AuditReport["desktop"]) =>
    value
      ? {
          width: value.width,
          height: value.height,
          horizontalOverflow: value.horizontalOverflow,
          sections: value.sections,
          nav: value.nav,
          overflowing: value.overflowing.slice(0, 12),
        }
      : undefined;
  return {
    available: report.available,
    warning: report.warning,
    desktop: view(report.desktop),
    tablet: view(report.tablet),
    mobile: view(report.mobile),
  };
};

const toAuditIssue = (issue: AuditIssue): CriticAuditIssue => ({
  nodeId: issue.nodeId,
  sectionId: issue.sectionId,
  severity: issue.severity,
  category: issue.category,
  message: issue.message,
  autoFix: issue.autoFix,
  patch: issue.patch as CriticAuditIssue["patch"],
});

type IssueLike = CriticIssue & { sectionId?: string };

type ResolvedIssue = CriticIssue & {
  id: string;
  source: "audit" | "critic";
  sectionId?: string;
  ownerAgentId: string;
};

type CursorAssignment = {
  agent: AgentInfo;
  sectionId: string;
  cursorRole: CursorRole;
  variant?: number;
  lead: boolean;
};

type Candidate = {
  assignment: CursorAssignment;
  node: Node;
  sessionId: string;
  cost: number;
  error?: string;
};

const VARIANT_HINTS = [
  "Editorial and restrained: strong type hierarchy, generous whitespace, minimal color and one clear focal point.",
  "Bold and expressive: high contrast, oversized type, a distinctive visual motif and confident CTA.",
  "Warm and human: softer surfaces, rounded details, tactile imagery and generous breathing room.",
];

const sectionPlan = (section: SectionSpec): CursorPlan =>
  section.cursors ?? { count: 1, mode: "solo" };

const splitRoles = (plan: CursorPlan): CursorRole[] => {
  const requested = plan.roles ?? [];
  const ordered: CursorRole[] = ["layout", ...requested.filter((role) => role !== "layout"), "copy", "style", "media", "content"];
  return [...new Set(ordered)].slice(0, Math.max(1, plan.count));
};

export type BuildContext = {
  runtime: AgentRuntime;
  project: ProjectRecord;
  run: RunRecord;
  concurrency?: number;
};

export const runBuild = async ({ runtime, project, run, concurrency = 4 }: BuildContext): Promise<void> => {
  const channel = run.channel;
  const started = now();
  const emit = channel.emit.bind(channel);
  let totalCost = 0;

  project.status = "planning";
  run.status = "planning";
  emit({ type: "run.started", runId: run.id, projectId: project.id, prompt: project.prompt, at: now() });

  try {
    const planned = await runtime.plan({ brief: project.prompt });
    const plan = normalizePlan(planned.plan);
    totalCost += planned.cost ?? 0;
    project.plan = plan;
    project.parentSessionId = planned.sessionId;
    project.status = "building";
    run.status = "building";

    const architect: AgentInfo = {
      id: "architect",
      name: NAMES[0] ?? "Ada",
      color: COLORS[0] ?? "#F24E1E",
      role: "architect",
    };
    const sections = plan.sections;
    let cursorIndex = 0;
    let plannedCursors = 0;
    const maxCursors = Math.max(1, Number(process.env.SWARM_MAX_CURSORS ?? 16));
    const assignmentsBySection = new Map<string, CursorAssignment[]>();

    const makeAgent = (sectionId: string, role: CursorRole, variant?: number): AgentInfo => {
      const index = ++cursorIndex;
      const id = variant != null ? `section:${sectionId}:v${variant}` : role === "layout" ? `section:${sectionId}` : `section:${sectionId}:${role}`;
      return {
        id,
        name: NAMES[index % NAMES.length] ?? `Agent ${index}`,
        color: COLORS[index % COLORS.length] ?? "#0D99FF",
        role: "section",
        sectionId,
        cursorRole: role,
        groupId: `group:${sectionId}`,
        variant,
      };
    };

    for (const section of sections) {
      const base = sectionPlan(section);
      const remaining = Math.max(1, maxCursors - plannedCursors);
      const cursorPlan: CursorPlan = {
        ...base,
        count: Math.min(base.count, remaining),
      };
      if (cursorPlan.mode === "solo") cursorPlan.count = 1;
      if (cursorPlan.mode === "race" && cursorPlan.count < 2) cursorPlan.mode = "solo";
      if (cursorPlan.mode === "split" && cursorPlan.count < 2) cursorPlan.mode = "solo";
      section.cursors = cursorPlan;
      const list: CursorAssignment[] = [];
      if (cursorPlan.mode === "race" && cursorPlan.count > 1) {
        for (let i = 0; i < cursorPlan.count; i++) {
          list.push({ agent: makeAgent(section.id, "layout", i), sectionId: section.id, cursorRole: "layout", variant: i, lead: i === 0 });
        }
      } else if (cursorPlan.mode === "split" && cursorPlan.count > 1) {
        splitRoles(cursorPlan).forEach((role, i) => {
          list.push({ agent: makeAgent(section.id, role), sectionId: section.id, cursorRole: role, lead: i === 0 });
        });
      } else {
        list.push({ agent: makeAgent(section.id, "layout"), sectionId: section.id, cursorRole: "layout", lead: true });
      }
      plannedCursors += list.length;
      assignmentsBySection.set(section.id, list);
    }

    const allSectionAgents = [...assignmentsBySection.values()].flat().map((assignment) => assignment.agent);
    const primaryAgent = (sectionId: string): AgentInfo | undefined => assignmentsBySection.get(sectionId)?.[0]?.agent;
    const ownership = new Map<string, { agentId: string; sectionId: string; cursorRole?: CursorRole }>();
    const critic: AgentInfo = { id: "critic", name: "Review", color: "#F24822", role: "critic" };

    const tagOwnership = (node: Node, agent: AgentInfo) => {
      for (const item of collectNodes(node)) {
        ownership.set(item.id, {
          agentId: agent.id,
          sectionId: agent.sectionId ?? "",
          cursorRole: agent.cursorRole,
        });
      }
    };

    const sectionForNode = (nodeId: string | undefined): string | undefined => {
      if (!nodeId) return undefined;
      const owner = ownership.get(nodeId);
      if (owner?.sectionId) return owner.sectionId;
      return sections.find((section) => nodeId === section.id || nodeId.startsWith(`${section.id}-`))?.id;
    };

    emit({ type: "plan.ready", plan, agents: [architect, ...allSectionAgents, critic], at: now() });
    project.agents = [architect, ...allSectionAgents, critic];
    emit({ type: "agent.spawned", agent: architect, at: now() });
    for (const agent of allSectionAgents) emit({ type: "agent.spawned", agent, at: now() });

    let root = createArtifact(plan);
    project.artifact = root;
    emit({ type: "preview.sync", html: pageHtml(plan, root), at: now() });

    let applied = 0;
    let fallbackCount = 0;

    const applyFallback = (section: SectionSpec, agent: AgentInfo, message: string) => {
      const fallback = fallbackSection(section);
      root = applySectionPatch(root, fallback);
      tagOwnership(fallback, agent);
      project.artifact = root;
      applied++;
      fallbackCount++;
      const html = pageHtml(plan, root);
      project.html = html;
      emit({ type: "task.failed", sectionId: section.id, message, at: now() });
      emit({ type: "task.fallback", sectionId: section.id, message, at: now() });
      emit({
        type: "patch.applied",
        sectionId: section.id,
        agentId: agent.id,
        nodeCount: countNodes(root),
        sessionId: "fallback",
        fallback: true,
        at: now(),
      });
      emit({
        type: "render.ops",
        batch: { sectionId: section.id, agent, ops: buildRenderOps(fallback, "page") },
        at: now(),
      });
    };

    await mapLimit(sections, concurrency, async (section, index) => {
      const group = assignmentsBySection.get(section.id)!;
      const primary = group[0]!;
      const planForSection = sectionPlan(section);

      if (planForSection.mode === "race" && group.length > 1) {
        const candidates: Candidate[] = [];
        for (const assignment of group) {
          const taskId = `task:${section.id}:v${assignment.variant}`;
          emit({ type: "task.started", taskId, sectionId: section.id, agent: assignment.agent, at: now() });
          emit({ type: "variant.started", sectionId: section.id, agent: assignment.agent, variant: assignment.variant ?? 0, at: now() });
          try {
            const built = await runtime.buildSection({
              plan,
              section,
              before: sections[index - 1],
              after: sections[index + 1],
              parentSessionId: planned.sessionId,
              variantHint: VARIANT_HINTS[(assignment.variant ?? 0) % VARIANT_HINTS.length],
            });
            totalCost += built.cost ?? 0;
            const checked = validateSectionPatch(built.patch, plan);
            if (!checked.ok) throw new Error(checked.error);
            candidates.push({
              assignment,
              node: checked.node,
              sessionId: built.sessionId,
              cost: built.cost ?? 0,
            });
          } catch (error) {
            emit({ type: "task.failed", sectionId: section.id, message: errorMessage(error), at: now() });
          }
        }

        if (!candidates.length) {
          applyFallback(section, primary.agent, "No race variant produced a valid section.");
          return;
        }

        let winner = candidates[0]!;
        if (candidates.length > 1) {
          const scored: Array<{ candidate: Candidate; score: number; nodes: number }> = [];
          for (const candidate of candidates) {
            try {
              const tempRoot = applySectionPatch(createArtifact(plan), candidate.node);
              const report = await auditHtml(pageHtml(plan, tempRoot));
              const score = report.issues.reduce((sum, issue) => {
                if (issue.severity === "high") return sum + 100;
                if (issue.severity === "medium") return sum + 10;
                return sum + 1;
              }, 0);
              scored.push({ candidate, score, nodes: countNodes(candidate.node) });
            } catch {
              scored.push({ candidate, score: 1000, nodes: countNodes(candidate.node) });
            }
          }
          scored.sort((a, b) => a.score - b.score || b.nodes - a.nodes);
          winner = scored[0]!.candidate;
        }

        for (const candidate of candidates) {
          if (candidate === winner) {
            emit({
              type: "variant.selected",
              sectionId: section.id,
              agent: candidate.assignment.agent,
              variant: candidate.assignment.variant ?? 0,
              at: now(),
            });
          } else {
            emit({
              type: "variant.discarded",
              sectionId: section.id,
              agent: candidate.assignment.agent,
              variant: candidate.assignment.variant ?? 0,
              at: now(),
            });
          }
        }

        root = applySectionPatch(root, winner.node);
        tagOwnership(winner.node, winner.assignment.agent);
        project.artifact = root;
        applied++;
        const html = pageHtml(plan, root);
        project.html = html;
        emit({
          type: "patch.applied",
          sectionId: section.id,
          agentId: winner.assignment.agent.id,
          nodeCount: countNodes(root),
          sessionId: winner.sessionId,
          at: now(),
        });
        emit({
          type: "render.ops",
          batch: { sectionId: section.id, agent: winner.assignment.agent, ops: buildRenderOps(winner.node, "page") },
          at: now(),
        });
        return;
      }

      emit({ type: "task.started", taskId: `task:${section.id}`, sectionId: section.id, agent: primary.agent, at: now() });
      let leadNode: Node | null = null;
      let lastError = "";
      let retryNote: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const built = await runtime.buildSection({
            plan,
            section,
            before: sections[index - 1],
            after: sections[index + 1],
            parentSessionId: planned.sessionId,
            retryNote,
          });
          totalCost += built.cost ?? 0;
          const checked = validateSectionPatch(built.patch, plan);
          if (!checked.ok) throw new Error(checked.error);
          root = applySectionPatch(root, checked.node);
          tagOwnership(checked.node, primary.agent);
          leadNode = checked.node;
          applied++;
          const html = pageHtml(plan, root);
          project.html = html;
          emit({
            type: "patch.applied",
            sectionId: section.id,
            agentId: primary.agent.id,
            nodeCount: countNodes(root),
            sessionId: built.sessionId,
            at: now(),
          });
          emit({
            type: "render.ops",
            batch: { sectionId: section.id, agent: primary.agent, ops: buildRenderOps(checked.node, "page") },
            at: now(),
          });
          break;
        } catch (error) {
          lastError = errorMessage(error);
          const smaller = /too large|length|structured output|json|timed out/i.test(lastError);
          retryNote = smaller
            ? `Build a much smaller section: at most 25 nodes, depth 4, no reasoning text. Error: ${lastError}`
            : `Fix this validation issue: ${lastError}. Keep the section under 60 nodes.`;
        }
      }

      if (!leadNode) {
        applyFallback(section, primary.agent, lastError || "Section agent failed.");
        return;
      }

      if (planForSection.mode === "split" && group.length > 1) {
        const current = findNode(root, section.id) ?? leadNode;
        const refiners = group.slice(1);
        const outcomes = await Promise.all(
          refiners.map(async (assignment) => {
            const taskId = `task:${section.id}:${assignment.cursorRole}`;
            emit({ type: "task.started", taskId, sectionId: section.id, agent: assignment.agent, at: now() });
            try {
              const refined = await runtime.refineSection({
                plan,
                section,
                node: current,
                role: assignment.cursorRole,
                parentSessionId: planned.sessionId,
              });
              totalCost += refined.cost ?? 0;
              return { assignment, refined };
            } catch (error) {
              emit({ type: "task.failed", sectionId: section.id, message: errorMessage(error), at: now() });
              return null;
            }
          }),
        );

        for (const outcome of outcomes) {
          if (!outcome) continue;
          const { assignment, refined } = outcome;
          const patches = refined.result.patches;
          const before = findNode(root, section.id);
          if (patches.length) {
            root = applyRefinements(root, patches);
            for (const patch of patches) {
              ownership.set(patch.nodeId, {
                agentId: assignment.agent.id,
                sectionId: section.id,
                cursorRole: assignment.cursorRole,
              });
            }
          }
          const after = findNode(root, section.id);
          project.artifact = root;
          const html = pageHtml(plan, root);
          project.html = html;
          emit({
            type: "patch.applied",
            sectionId: section.id,
            agentId: assignment.agent.id,
            nodeCount: countNodes(root),
            sessionId: refined.sessionId,
            at: now(),
          });
          if (before && after) {
            emit({
              type: "render.ops",
              batch: { sectionId: section.id, agent: assignment.agent, ops: diffRenderOps(before, after) },
              at: now(),
            });
          }
        }
      }
    });

    if (applied === 0) throw new Error("no section could be built");

    project.status = "reviewing";
    run.status = "reviewing";
    emit({ type: "agent.spawned", agent: critic, at: now() });

    const beforeAudit = pageHtml(plan, root);
    const audit = await auditHtml(beforeAudit);
    emit({
      type: "audit.ready",
      available: audit.available,
      issues: audit.issues.length,
      warning: audit.warning,
      at: now(),
    });

    let modelIssues: CriticIssue[] = [];
    let criticSummary = "Auditoria determinística aplicada.";
    try {
      const reviewed = await runtime.critique({
        plan,
        root,
        parentSessionId: planned.sessionId,
        auditIssues: audit.issues.map(toAuditIssue),
        renderReport: compactReport(audit),
      });
      totalCost += reviewed.cost ?? 0;
      modelIssues = reviewed.result.issues;
      criticSummary = reviewed.result.summary;
    } catch (error) {
      emit({ type: "task.failed", sectionId: "critic", message: errorMessage(error), at: now() });
      criticSummary = "O critic LLM falhou; a auditoria determinística foi aplicada.";
    }

    const resolve = (issue: IssueLike, index: number, source: "audit" | "critic"): ResolvedIssue | null => {
      const sectionId = issue.sectionId ?? sectionForNode(issue.nodeId);
      const ownerAgentId =
        (issue.nodeId ? ownership.get(issue.nodeId)?.agentId : undefined) ??
        (sectionId ? primaryAgent(sectionId)?.id : undefined);
      if (!ownerAgentId) return null;
      return {
        ...issue,
        id: `${source}-${index + 1}`,
        source,
        sectionId,
        ownerAgentId,
        autoFix: issue.autoFix && Boolean(issue.patch) && Boolean(issue.nodeId),
      };
    };

    const resolved: ResolvedIssue[] = [];
    const seenIssues = new Set<string>();
    for (const [index, issue] of audit.issues.entries()) {
      const item = resolve(issue, index, "audit");
      if (!item) continue;
      const key = `${item.nodeId ?? ""}|${item.message}`;
      if (seenIssues.has(key)) continue;
      seenIssues.add(key);
      resolved.push(item);
    }
    for (const [index, issue] of modelIssues.entries()) {
      const item = resolve(issue, index, "critic");
      if (!item) continue;
      const key = `${item.nodeId ?? ""}|${item.message}`;
      if (seenIssues.has(key)) continue;
      seenIssues.add(key);
      resolved.push(item);
    }

    for (const issue of resolved) {
      const agent = allSectionAgents.find((candidate) => candidate.id === issue.ownerAgentId) ?? critic;
      emit({
        type: "critic.issue",
        issueId: issue.id,
        nodeId: issue.nodeId,
        sectionId: issue.sectionId,
        agent,
        severity: issue.severity,
        category: issue.category,
        message: issue.message,
        autoFix: issue.autoFix,
        at: now(),
      });
    }

    const fixable = resolved
      .filter((issue) => issue.autoFix)
      .sort((a, b) => {
        const weight = { high: 3, medium: 2, low: 1 } as const;
        return weight[b.severity] - weight[a.severity];
      })
      .slice(0, 40);

    let fixed = 0;
    for (const issue of fixable) {
      const agent = allSectionAgents.find((candidate) => candidate.id === issue.ownerAgentId) ?? critic;
      if (!issue.nodeId || !findNode(root, issue.nodeId)) {
        emit({ type: "fix.done", issueId: issue.id, sectionId: issue.sectionId, agentId: agent.id, success: false, at: now() });
        continue;
      }
      emit({
        type: "fix.started",
        issueId: issue.id,
        nodeId: issue.nodeId,
        sectionId: issue.sectionId,
        agent,
        message: issue.message,
        at: now(),
      });
      await sleep(280);
      try {
        const before = issue.nodeId ? findNode(root, issue.nodeId) : null;
        root = applyCriticIssue(root, issue);
        const after = issue.nodeId ? findNode(root, issue.nodeId) : null;
        fixed++;
        project.artifact = root;
        const html = pageHtml(plan, root);
        project.html = html;
        emit({
          type: "fix.applied",
          issueId: issue.id,
          nodeId: issue.nodeId,
          sectionId: issue.sectionId,
          agent,
          nodeCount: countNodes(root),
          at: now(),
        });
        if (before && after) {
          emit({
            type: "render.ops",
            batch: { sectionId: issue.sectionId ?? sectionForNode(issue.nodeId) ?? "", agent, ops: diffRenderOps(before, after, "set") },
            at: now(),
          });
        }
        emit({ type: "fix.done", issueId: issue.id, sectionId: issue.sectionId, agentId: agent.id, success: true, at: now() });
      } catch {
        emit({ type: "fix.done", issueId: issue.id, sectionId: issue.sectionId, agentId: agent.id, success: false, at: now() });
      }
    }

    const html = pageHtml(plan, root);
    project.html = html;
    emit({
      type: "critique.ready",
      summary: criticSummary,
      issues: resolved.length,
      fixed,
      html,
      at: now(),
    });
    emit({ type: "preview.sync", html, at: now() });

    const verified = await auditHtml(html);
    const remaining = Math.max(verified.issues.length, resolved.length - fixed);
    emit({
      type: "critique.verified",
      summary: verified.available
        ? `Auditoria final: ${remaining} problema(s) restante(s).`
        : (verified.warning ?? "Auditoria final indisponível."),
      remaining,
      html,
      at: now(),
    });

    const stats: RunStats = {
      sections: applied,
      nodes: countNodes(root),
      cost: Math.round(totalCost * 10000) / 10000,
      durationMs: now() - started,
      failed: fallbackCount,
      fallbacks: fallbackCount,
      issues: resolved.length,
      fixed,
      model: runtime.name,
    };
    project.html = html;
    project.artifact = root;
    project.ownership = Object.fromEntries(ownership);
    emit({ type: "ownership.updated", ownership: project.ownership, at: now() });
    project.status = "done";
    run.status = "done";
    run.finishedAt = now();
    emit({ type: "preview.sync", html, at: now() });
    emit({ type: "run.done", html, stats, at: now() });
  } catch (error) {
    const message = errorMessage(error);
    project.status = "failed";
    project.error = message;
    run.status = "failed";
    run.finishedAt = now();
    emit({ type: "run.failed", message, at: now() });
  }
};
