import type { Node, SitePage, SitePlan } from "@swarm/dsl";
import type {
  AgentInfo,
  BuildStatus,
  OwnershipEntry,
  SitePageView,
  SiteProjectView,
  SiteStats,
} from "@swarm/protocol";
import type { RunChannel } from "./events.js";

export type SitePageRecord = {
  id: string;
  slug: string;
  title: string;
  description: string;
  role: SitePage["role"];
  status: BuildStatus;
  artifact?: Node;
  html?: string;
  sections: number;
  cost: number;
  nodes: number;
  fallbacks: number;
  error?: string;
};

export type SiteLayoutRecord = {
  nav?: Node;
  footer?: Node;
};

export type SiteSnapshot = {
  plan: SitePlan;
  layout: SiteLayoutRecord;
  pages: SitePageRecord[];
  agents: AgentInfo[];
  ownership: Record<string, OwnershipEntry>;
  at: number;
};

export type SiteProjectRecord = {
  id: string;
  prompt: string;
  brand?: string;
  status: BuildStatus;
  createdAt: number;
  plan?: SitePlan;
  planningCost: number;
  parentSessionId?: string;
  runId?: string;
  layout?: SiteLayoutRecord;
  pages: SitePageRecord[];
  agents?: AgentInfo[];
  ownership?: Record<string, OwnershipEntry>;
  cost: number;
  stats?: SiteStats;
  undoStack?: SiteSnapshot[];
  error?: string;
};

export type SiteRunRecord = {
  id: string;
  projectId: string;
  status: BuildStatus;
  startedAt: number;
  finishedAt?: number;
  channel: RunChannel;
};

export const siteProjects = new Map<string, SiteProjectRecord>();

export const sitePageView = (page: SitePageRecord): SitePageView => ({
  id: page.id,
  slug: page.slug,
  title: page.title,
  description: page.description,
  role: page.role,
  status: page.status,
  html: page.html,
  sections: page.sections,
  nodes: page.nodes,
  cost: page.cost,
  fallbacks: page.fallbacks,
  error: page.error,
});

export const siteProjectView = (project: SiteProjectRecord): SiteProjectView => ({
  id: project.id,
  prompt: project.prompt,
  status: project.status,
  createdAt: project.createdAt,
  plan: project.plan,
  pages: project.pages.map(sitePageView),
  agents: project.agents,
  ownership: project.ownership,
  cost: project.cost,
  stats: project.stats,
  error: project.error,
});

export const pageRecordFromSpec = (page: SitePage): SitePageRecord => ({
  id: page.slug,
  slug: page.slug,
  title: page.title,
  description: page.description,
  role: page.role,
  status: "idle",
  sections: page.sections.length,
  cost: 0,
  nodes: 0,
  fallbacks: 0,
});
