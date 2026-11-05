import type { BuildPlan, Node } from "@swarm/dsl";
import type { AgentInfo, BuildStatus, OwnershipEntry, ProjectView } from "@swarm/protocol";
import { RunChannel } from "./events.js";

export type ProjectRecord = {
  id: string;
  prompt: string;
  status: BuildStatus;
  createdAt: number;
  plan?: BuildPlan;
  artifact?: Node;
  html?: string;
  error?: string;
  runId?: string;
  parentSessionId?: string;
  agents?: AgentInfo[];
  ownership?: Record<string, OwnershipEntry>;
  undoStack?: Array<{ artifact: Node; html: string; ownership: Record<string, OwnershipEntry>; plan: BuildPlan; agents: AgentInfo[]; at: number }>;
};

export type RunRecord = {
  id: string;
  projectId: string;
  status: BuildStatus;
  startedAt: number;
  finishedAt?: number;
  channel: RunChannel;
};

export const projects = new Map<string, ProjectRecord>();
export const runs = new Map<string, RunRecord>();

export const projectView = (project: ProjectRecord): ProjectView => ({
  id: project.id,
  prompt: project.prompt,
  status: project.status,
  createdAt: project.createdAt,
  plan: project.plan,
  html: project.html,
  error: project.error,
  ownership: project.ownership,
});
