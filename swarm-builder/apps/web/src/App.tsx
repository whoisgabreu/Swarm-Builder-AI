import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BuildPlan, SectionKind } from "@swarm/dsl";
import { PREVIEW_SHELL } from "@swarm/swarm-runtime";
import { SiteStudio } from "./SiteStudio.js";
import { ModeToggle, type StudioMode } from "./ModeToggle.js";
import type {
  AgentInfo,
  BuildEvent,
  BuildStatus,
  ProjectView,
  RunStats,
  SequencedEvent,
} from "@swarm/protocol";

const EVENT_TYPES: BuildEvent["type"][] = [
  "run.started",
  "plan.ready",
  "agent.spawned",
  "task.started",
  "patch.applied",
  "task.failed",
  "task.fallback",
  "plan.updated",
  "preview.updated",
  "preview.sync",
  "render.ops",
  "ownership.updated",
  "audit.ready",
  "critic.issue",
  "fix.started",
  "fix.applied",
  "fix.done",
  "critique.ready",
  "critique.verified",
  "revision.started",
  "revision.applied",
  "revision.done",
  "revision.undone",
  "section.add.started",
  "section.added",
  "section.add.done",
  "variant.started",
  "variant.selected",
  "variant.discarded",
  "run.done",
  "run.failed",
];

type SectionState = "pending" | "working" | "done" | "failed" | "fallback";

type IssueView = {
  id: string;
  nodeId?: string;
  sectionId?: string;
  owner: string;
  ownerColor: string;
  severity: "high" | "medium" | "low";
  category: string;
  message: string;
  autoFix: boolean;
  status: "open" | "fixing" | "fixed" | "failed";
};

type Phase = "idle" | "running" | "done" | "failed";

const statusText: Record<BuildStatus, string> = {
  idle: "Pronto para começar",
  planning: "Planejando a página",
  building: "Construindo seções",
  reviewing: "Revisando o resultado",
  done: "Página concluída",
  failed: "Build interrompido",
  aborted: "Build cancelado",
};

const describe = (event: SequencedEvent): string => {
  switch (event.type) {
    case "run.started":
      return "Build iniciada";
    case "plan.ready":
      return `Plano criado com ${event.plan.sections.length} seções`;
    case "plan.updated":
      return `Plano atualizado: ${event.plan.sections.length} seções`;
    case "agent.spawned":
      return `${event.agent.name} entrou no swarm (${event.agent.cursorRole ?? event.agent.role})`;
    case "task.started":
      return `${event.agent.name} começou ${event.sectionId}${event.agent.cursorRole ? ` · ${event.agent.cursorRole}` : ""}`;
    case "patch.applied":
      return `${event.sectionId} aplicada (${event.nodeCount} nós)`;
    case "task.failed":
      return `${event.sectionId} falhou: ${event.message}`;
    case "task.fallback":
      return `${event.sectionId} recebeu fallback: ${event.message}`;
    case "preview.updated":
      return "Preview atualizado";
    case "preview.sync":
      return "Preview sincronizado";
    case "render.ops":
      return `${event.batch.ops.length} operações em ${event.batch.sectionId}`;
    case "ownership.updated":
      return `${Object.keys(event.ownership).length} nós com dono`;
    case "audit.ready":
      return event.available ? `Auditoria de layout: ${event.issues} problema(s)` : `Auditoria indisponível: ${event.warning ?? ""}`;
    case "critic.issue":
      return `${event.severity} · ${event.sectionId ?? event.nodeId ?? "página"}: ${event.message}`;
    case "fix.started":
      return `${event.agent.name} corrigindo ${event.nodeId ?? event.sectionId ?? "página"}`;
    case "fix.applied":
      return `Correção aplicada em ${event.nodeId ?? event.sectionId ?? "página"}`;
    case "fix.done":
      return event.success ? `Correção concluída: ${event.issueId}` : `Correção falhou: ${event.issueId}`;
    case "critique.ready":
      return `Revisão: ${event.issues} problema(s) · ${event.fixed} corrigido(s)`;
    case "critique.verified":
      return `Auditoria final: ${event.remaining} problema(s) restante(s)`;
    case "revision.started":
      return `${event.agent.name} revisando ${event.nodeId ?? event.sectionId ?? "página"}: ${event.request}`;
    case "revision.applied":
      return `Alteração aplicada em ${event.nodeIds.join(", ") || event.sectionId || "página"}`;
    case "revision.done":
      return event.success ? `Alteração concluída: ${event.summary}` : `Alteração falhou: ${event.summary}`;
    case "revision.undone":
      return "Alteração desfeita";
    case "section.add.started":
      return `Adicionando seção na posição ${event.insertIndex}: ${event.prompt.slice(0, 80)}`;
    case "section.added":
      return `Seção ${event.sectionId} adicionada na posição ${event.index}`;
    case "section.add.done":
      return event.success ? `Seção adicionada: ${event.summary}` : `Falha ao adicionar seção: ${event.summary}`;
    case "variant.started":
      return `${event.agent.name} gerou variante ${event.variant + 1} de ${event.sectionId}`;
    case "variant.selected":
      return `${event.agent.name} venceu a variante de ${event.sectionId}`;
    case "variant.discarded":
      return `${event.agent.name} foi descartado em ${event.sectionId}`;
    case "run.done":
      return `Concluído em ${(event.stats.durationMs / 1000).toFixed(1)}s`;
    case "run.failed":
      return `Falha: ${event.message}`;
    default:
      return event.type;
  }
};

const formatUsd = (value: number): string => `US$ ${value.toFixed(value < 0.1 ? 3 : 2).replace(".", ",")}`;
const formatCents = (value: number): string => `${(value * 100).toFixed(1).replace(".", ",")}¢ USD`;
const issueStatusLabel = (status: IssueView["status"]): string =>
  status === "fixing" ? "corrigindo" : status === "fixed" ? "corrigido" : status === "failed" ? "falhou" : "aberto";

const EXAMPLES = [
  "Landing page para uma consultoria de dados para varejo. Tom sóbrio, premium, sem jargão. Oferta: diagnóstico gratuito de 30 minutos.",
  "Site de lançamento para um app de finanças pessoais com IA. Público jovem, visual escuro, linguagem direta e foco em conversão.",
  "Página para uma plataforma de cursos de design. Editorial, acolhedora, com prova social e planos claros.",
];

export function App() {
  const [prompt, setPrompt] = useState(EXAMPLES[0]!);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<BuildStatus>("idle");
  const [project, setProject] = useState<ProjectView | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [plan, setPlan] = useState<BuildPlan | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sections, setSections] = useState<Record<string, SectionState>>({});
  const [html, setHtml] = useState("");
  const [stats, setStats] = useState<RunStats | null>(null);
  const [critique, setCritique] = useState("");
  const [issues, setIssues] = useState<IssueView[]>([]);
  const [auditWarning, setAuditWarning] = useState("");
  const [error, setError] = useState("");
  const [events, setEvents] = useState<SequencedEvent[]>([]);
  const [runtimeName, setRuntimeName] = useState("runtime");
  const [mode, setMode] = useState<StudioMode>("landing");
  const [tour, setTour] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [logOpen, setLogOpen] = useState(true);
  const [mobileTab, setMobileTab] = useState<"brief" | "preview" | "log">("preview");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile" | "tablet">("desktop");
  const [addOpen, setAddOpen] = useState(false);
  const [newSectionPrompt, setNewSectionPrompt] = useState("");
  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [newSectionKind, setNewSectionKind] = useState<SectionKind | "auto">("auto");
  const [newSectionIndex, setNewSectionIndex] = useState(0);
  const [newSectionQuality, setNewSectionQuality] = useState<"solo" | "split" | "race">("solo");
  const sourceRef = useRef<EventSource | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewReady = useRef(false);
  const eventsRef = useRef<SequencedEvent[]>([]);

  const postEvent = useCallback((event: SequencedEvent) => {
    if (!previewReady.current) return;
    iframeRef.current?.contentWindow?.postMessage({ source: "swarm-studio", event }, "*");
  }, []);

  const postControl = useCallback((control: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage({ source: "swarm-studio", control }, "*");
  }, []);

  const postSync = useCallback((html: string) => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: "swarm-studio", event: { type: "preview.sync", html, force: true, at: Date.now() } },
      "*",
    );
  }, []);

  const closeSource = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  useEffect(() => closeSource, [closeSource]);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => (response.ok ? response.json() : null))
      .then((health: { runtime?: string } | null) => {
        if (health?.runtime) setRuntimeName(health.runtime);
      })
      .catch(() => {});
  }, []);

  const handleEvent = useCallback(
    (event: SequencedEvent) => {
      eventsRef.current = [...eventsRef.current.slice(-199), event];
      setEvents(eventsRef.current);
      postEvent(event);
      switch (event.type) {
        case "run.started":
          setStatus("planning");
          break;
        case "plan.ready":
          setPlan(event.plan);
          setAgents(event.agents);
          setIssues([]);
          setAuditWarning("");
          setSelectedNodeId(null);
          setSelectedNodeIds([]);
          setSelectedAgentId("");
          setUndoAvailable(false);
          setSections(Object.fromEntries(event.plan.sections.map((section) => [section.id, "pending"])));
          setStatus("building");
          break;
        case "plan.updated":
          setPlan(event.plan);
          setSections((current) => {
            const next: Record<string, SectionState> = { ...current };
            for (const section of event.plan.sections) if (!next[section.id]) next[section.id] = "pending";
            for (const id of Object.keys(next)) if (!event.plan.sections.some((section) => section.id === id)) delete next[id];
            return next;
          });
          break;
        case "agent.spawned":
          setAgents((current) => [...current.filter((agent) => agent.id !== event.agent.id), event.agent]);
          break;
        case "section.add.started":
          setPhase("running");
          setStatus("reviewing");
          setRevisionBusy(true);
          break;
        case "section.added":
          setSections((current) => ({ ...current, [event.sectionId]: "working" }));
          setAgents((current) => {
            const next = [...current];
            for (const agent of event.agents) if (!next.some((item) => item.id === agent.id)) next.push(agent);
            return next;
          });
          break;
        case "section.add.done":
          setRevisionBusy(false);
          setPhase("done");
          setStatus("done");
          setUndoAvailable(event.success);
          if (event.sectionId) setSections((current) => ({ ...current, [event.sectionId!]: event.success ? "done" : "failed" }));
          closeSource();
          break;
        case "task.started":
          setStatus("building");
          setSections((current) => ({ ...current, [event.sectionId]: "working" }));
          break;
        case "patch.applied":
          setSections((current) => ({ ...current, [event.sectionId]: event.fallback ? "fallback" : "done" }));
          break;
        case "task.failed":
          if (event.sectionId === "critic") {
            setCritique(event.message);
          } else {
            setSections((current) => ({ ...current, [event.sectionId]: "failed" }));
          }
          break;
        case "task.fallback":
          setSections((current) => ({ ...current, [event.sectionId]: "fallback" }));
          break;
        case "preview.updated":
          setStatus("building");
          setHtml(event.html);
          break;
        case "preview.sync":
          setHtml(event.html);
          break;
        case "render.ops":
          break;
        case "ownership.updated":
          setProject((current) => (current ? { ...current, ownership: event.ownership } : current));
          break;
        case "audit.ready":
          setStatus("reviewing");
          setAuditWarning(event.available ? "" : (event.warning ?? "Auditoria indisponível"));
          break;
        case "critic.issue":
          setIssues((current) => [
            ...current.filter((issue) => issue.id !== event.issueId),
            {
              id: event.issueId,
              nodeId: event.nodeId,
              sectionId: event.sectionId,
              owner: event.agent.name,
              ownerColor: event.agent.color,
              severity: event.severity,
              category: event.category,
              message: event.message,
              autoFix: event.autoFix,
              status: "open",
            },
          ]);
          break;
        case "fix.started":
          setIssues((current) => current.map((issue) => (issue.id === event.issueId ? { ...issue, status: "fixing" } : issue)));
          setStatus("reviewing");
          break;
        case "fix.applied":
          setIssues((current) => current.map((issue) => (issue.id === event.issueId ? { ...issue, status: "fixed" } : issue)));
          break;
        case "fix.done":
          setIssues((current) =>
            current.map((issue) => (issue.id === event.issueId ? { ...issue, status: event.success ? "fixed" : "failed" } : issue)),
          );
          break;
        case "variant.started":
          setSections((current) => ({ ...current, [event.sectionId]: "working" }));
          break;
        case "variant.selected":
          break;
        case "variant.discarded":
          break;
        case "critique.ready":
          setStatus("reviewing");
          setCritique(`${event.summary} (${event.issues} problemas, ${event.fixed} corrigidos)`);
          setHtml(event.html);
          break;
        case "critique.verified":
          setCritique(`${event.summary}`);
          setHtml(event.html);
          break;
        case "revision.started":
          setRevisionBusy(true);
          setPhase("running");
          setStatus("reviewing");
          break;
        case "revision.applied":
          break;
        case "revision.done":
          setRevisionBusy(false);
          setPhase("done");
          setStatus("done");
          setUndoAvailable(event.success);
          closeSource();
          break;
        case "revision.undone":
          setUndoAvailable(false);
          break;
        case "run.done":
          setStatus("done");
          setPhase("done");
          setHtml(event.html);
          setStats(event.stats);
          closeSource();
          break;
        case "run.failed":
          setStatus("failed");
          setPhase("failed");
          setError(event.message);
          closeSource();
          break;
      }
    },
    [closeSource, postEvent],
  );

  const listen = useCallback(
    (id: string) => {
      closeSource();
      const source = new EventSource(`/api/runs/${id}/events`);
      sourceRef.current = source;
      for (const type of EVENT_TYPES) {
        source.addEventListener(type, (message) => {
          const event = JSON.parse((message as MessageEvent).data) as SequencedEvent;
          handleEvent(event);
        });
      }
      source.onerror = () => {
        if (phase !== "done" && phase !== "failed") {
          setError("Conexão com o build foi interrompida.");
        }
      };
    },
    [closeSource, handleEvent, phase],
  );

  const start = useCallback(async () => {
    const brief = prompt.trim();
    if (brief.length < 10 || phase === "running") return;
    closeSource();
    setPhase("running");
    setStatus("planning");
    setPlan(null);
    setAgents([]);
    setSections({});
    setHtml("");
    setStats(null);
    setCritique("");
    setIssues([]);
    setAuditWarning("");
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedAgentId("");
    setUndoAvailable(false);
    setRendering(false);
    setError("");
    eventsRef.current = [];
    setEvents([]);
    setRunId(null);
    setProject(null);

    try {
      const created = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: brief }),
      });
      if (!created.ok) throw new Error((await created.json().catch(() => ({}))).error ?? "Falha ao criar projeto");
      const projectView = (await created.json()) as ProjectView;
      setProject(projectView);

      const started = await fetch(`/api/projects/${projectView.id}/build`, { method: "POST" });
      if (!started.ok) throw new Error((await started.json().catch(() => ({}))).error ?? "Falha ao iniciar build");
      const run = (await started.json()) as { runId: string };
      setRunId(run.runId);
      listen(run.runId);
    } catch (caught) {
      setPhase("failed");
      setStatus("failed");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [closeSource, listen, phase, prompt]);

  const sectionList = plan?.sections ?? [];
  const doneSections = Object.values(sections).filter((value) => value === "done").length;
  const progress = sectionList.length ? Math.round((doneSections / sectionList.length) * 100) : 0;
  const activeAgents = useMemo(() => agents.filter((agent) => agent.role === "section"), [agents]);
  const recentEvents = useMemo(() => events.slice(-24).reverse(), [events]);
  const selectedOwner = selectedNodeId ? project?.ownership?.[selectedNodeId] : undefined;
  const selectedAgent = agents.find((agent) => agent.id === (selectedOwner?.agentId ?? selectedAgentId));
  const partial = Boolean(stats?.failed);
  const displayStatus =
    status === "done" && partial
      ? `Concluída com ${stats?.failed} fallback(s)${stats?.issues ? ` · ${stats.issues} issues` : ""}`
      : status === "done" && stats?.issues
        ? `Concluída · ${stats.fixed ?? 0}/${stats.issues} corrigidos`
        : statusText[status];

  useEffect(() => {
    if (!selectedNodeId) return;
    const owner = project?.ownership?.[selectedNodeId];
    if (owner?.agentId) setSelectedAgentId(owner.agentId);
  }, [selectedNodeId, project?.ownership]);

  useEffect(() => {
    if (!previewReady.current) return;
    const sectionRoot = selectedAgent?.sectionId;
    const highlight = selectedAgentId ? [sectionRoot, selectedNodeId].filter(Boolean) : [];
    postControl({ highlightNodes: highlight });
  }, [selectedAgentId, selectedAgent?.sectionId, selectedNodeId, postControl]);

  const requestRevision = useCallback(
    async (target: { nodeId?: string; nodeIds?: string[]; agentId?: string; request: string }) => {
      if (!project || phase === "running") return;
      setRevisionBusy(true);
      setPhase("running");
      setStatus("reviewing");
      setError("");
      try {
        const response = await fetch(`/api/projects/${project.id}/revise`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(target),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Falha ao solicitar alteração");
        }
        const data = (await response.json()) as { runId: string };
        listen(data.runId);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setRevisionBusy(false);
        setPhase("done");
        setError(message);
        postControl({ composerError: message });
      }
    },
    [project, phase, listen, postControl],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.source !== "swarm-preview") return;
      if (data.type === "node.selected" && typeof data.nodeId === "string") {
        const nodeId = data.nodeId as string;
        const nodeIds = Array.isArray(data.nodeIds) && data.nodeIds.length ? (data.nodeIds as string[]) : [nodeId];
        setSelectedNodeId(nodeId);
        setSelectedNodeIds(nodeIds);
        const entries = nodeIds.map((id) => ({ id, owner: project?.ownership?.[id] }));
        const ownerIds = [...new Set(entries.map((entry) => entry.owner?.agentId).filter((id): id is string => Boolean(id)))];
        const agent =
          agents.find((candidate) => candidate.id === ownerIds[0]) ??
          agents.find((candidate) => {
            const section = plan?.sections.find((item) => nodeId === item.id || nodeId.startsWith(`${item.id}-`));
            return candidate.sectionId === section?.id && candidate.cursorRole === "layout";
          });
        setSelectedAgentId(ownerIds.length === 1 ? ownerIds[0]! : "");
        const ownerLabels = [...new Set(
          entries.map((entry) => {
            const ownerId = entry.owner?.agentId;
            return agents.find((candidate) => candidate.id === ownerId)?.name ?? (entry.owner ? ownerId : undefined);
          }).filter((label): label is string => Boolean(label)),
        )];
        if (!ownerLabels.length && agent?.name) ownerLabels.push(agent.name);
        const firstOwner = entries[0]?.owner;
        postControl({
          composer: {
            nodeId,
            nodeIds,
            clickX: data.clickX,
            clickY: data.clickY,
            rect: data.rect,
            sectionId: firstOwner?.sectionId,
            agentName: ownerLabels.length === 1 ? ownerLabels[0] : undefined,
            agentColor: agent?.color,
            agentRole: ownerLabels.length === 1 ? (firstOwner?.cursorRole ?? agent?.cursorRole) : undefined,
            ownerLabels,
          },
        });
      }
      if (data.type === "selection.changed" && Array.isArray(data.nodeIds)) {
        const nodeIds = data.nodeIds as string[];
        setSelectedNodeIds(nodeIds);
        setSelectedNodeId(nodeIds[nodeIds.length - 1] ?? null);
      }
      if (data.type === "selection.expand" && Array.isArray(data.nodeIds) && project?.id) {
        void (async () => {
          try {
            const response = await fetch(`/api/projects/${project.id}/selection/expand`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ nodeIds: data.nodeIds, by: "text" }),
            });
            if (!response.ok) throw new Error("Falha ao buscar ocorrências");
            const body = (await response.json()) as { matches: Array<{ nodeId: string; ownerName?: string; text?: string }> };
            postControl({ composerExpand: body.matches });
          } catch (caught) {
            postControl({ composerError: caught instanceof Error ? caught.message : String(caught) });
          }
        })();
      }
      if (data.type === "revision.request" && typeof data.request === "string") {
        const nodeIds = Array.isArray(data.nodeIds) ? (data.nodeIds as string[]) : undefined;
        const nodeId = typeof data.nodeId === "string" ? data.nodeId : undefined;
        const agentId = typeof data.agentId === "string" ? data.agentId : undefined;
        if (nodeIds?.length || nodeId || agentId) {
          void requestRevision({ nodeIds, nodeId, agentId, request: data.request });
        }
      }
      if (data.type === "composer.cancel") {
        setSelectedNodeId(null);
        setSelectedNodeIds([]);
        setSelectedAgentId("");
      }
      if (data.type === "render.busy") setRendering(true);
      if (data.type === "render.drained") setRendering(false);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [postControl, project?.id, project?.ownership, plan?.sections, agents, requestRevision]);

  const undoRevision = useCallback(async () => {
    if (!project) return;
    try {
      const response = await fetch(`/api/projects/${project.id}/undo`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Nada para desfazer");
      }
      const data = (await response.json()) as {
        html: string;
        ownership?: ProjectView["ownership"];
        plan?: BuildPlan;
        agents?: AgentInfo[];
      };
      setHtml(data.html);
      setProject((current) => (current ? { ...current, html: data.html, ownership: data.ownership } : current));
      if (data.plan) {
        setPlan(data.plan);
        setSections(Object.fromEntries(data.plan.sections.map((section) => [section.id, "done"])));
      }
      if (data.agents) setAgents(data.agents);
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setSelectedAgentId("");
      postSync(data.html);
      setUndoAvailable(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [project, postSync]);

  const openAddSection = useCallback(() => {
    const sections = plan?.sections ?? [];
    const footerIndex = sections.findIndex((section) => section.kind === "footer");
    setNewSectionIndex(footerIndex >= 0 ? footerIndex : sections.length);
    setNewSectionPrompt("");
    setNewSectionTitle("");
    setNewSectionKind("auto");
    setNewSectionQuality("solo");
    setAddOpen(true);
  }, [plan?.sections]);

  const addSection = useCallback(async () => {
    if (!project || !plan || revisionBusy || newSectionPrompt.trim().length < 3) return;
    setError("");
    setRevisionBusy(true);
    setPhase("running");
    setStatus("reviewing");
    try {
      const response = await fetch(`/api/projects/${project.id}/sections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: newSectionPrompt.trim(),
          title: newSectionTitle.trim() || undefined,
          kind: newSectionKind === "auto" ? undefined : newSectionKind,
          insertIndex: newSectionIndex,
          quality: newSectionQuality,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Falha ao adicionar seção");
      }
      const data = (await response.json()) as { runId: string };
      setAddOpen(false);
      listen(data.runId);
    } catch (caught) {
      setRevisionBusy(false);
      setPhase("done");
      setStatus("done");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [project, plan, revisionBusy, newSectionPrompt, newSectionTitle, newSectionKind, newSectionIndex, newSectionQuality, listen]);

  const copyHtml = useCallback(async () => {
    if (!html) return;
    await navigator.clipboard.writeText(html).catch(() => {});
  }, [html]);

  if (mode === "site") return <SiteStudio onModeChange={setMode} />;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-name">Swarm Builder</div>
            <div className="brand-sub">agentes criando páginas reais</div>
          </div>
        </div>
        <div className="topbar-meta">
          <ModeToggle mode={mode} onChange={setMode} />
          <span className={`phase phase-${phase}`}>{displayStatus}</span>
          <span className="dot-live" />
          <span>{runtimeName} runtime</span>
        </div>
      </header>

      <nav className="mobile-tabs">
        <button type="button" className={mobileTab === "brief" ? "on" : ""} onClick={() => setMobileTab("brief")}>Brief</button>
        <button type="button" className={mobileTab === "preview" ? "on" : ""} onClick={() => setMobileTab("preview")}>Preview</button>
        <button type="button" className={mobileTab === "log" ? "on" : ""} onClick={() => setMobileTab("log")}>Eventos</button>
      </nav>

      <main className="workspace">
        <section className={`panel controls ${mobileTab === "brief" ? "mobile-active" : ""}`}>
          <div className="panel-head">
            <span>Brief</span>
            <span className="hint">descreva a página em linguagem natural</span>
          </div>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            spellCheck={false}
            rows={7}
            placeholder="Cole o brief da página que você quer construir…"
          />
          <div className="examples">
            {EXAMPLES.map((example, index) => (
              <button key={example} type="button" onClick={() => setPrompt(example)}>
                Exemplo {index + 1}
              </button>
            ))}
          </div>
          <button className="primary" type="button" onClick={start} disabled={phase === "running" || prompt.trim().length < 10}>
            {phase === "running" ? "Swarm em ação…" : phase === "idle" ? "Construir com o swarm" : "Construir novamente"}
          </button>
          <div className="progress-wrap">
            <div className="progress">
              <i style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-label">
              <span>{doneSections} de {sectionList.length || "—"} seções</span>
              <span>{progress}%</span>
            </div>
          </div>

          <div className="agents">
            <div className="panel-head">
              <span>Agentes</span>
              <span className="hint">{activeAgents.length || "—"} no swarm</span>
            </div>
            <div className="agent-grid">
              {activeAgents.map((agent) => (
                <div className="agent" key={agent.id}>
                  <span className="agent-dot" style={{ background: agent.color }} />
                  <span className="agent-name">{agent.name}</span>
                  <span className="agent-role">
                    {agent.sectionId}
                    {agent.cursorRole ? ` · ${agent.cursorRole}` : ""}
                    {agent.variant != null ? ` · v${agent.variant + 1}` : ""}
                  </span>
                </div>
              ))}
              {!activeAgents.length && <div className="empty">O plano ainda não foi criado.</div>}
            </div>
          </div>

          {issues.length > 0 && (
            <div className="issues">
              <div className="panel-head">
                <span>Correções</span>
                <span className="hint">
                  {issues.filter((issue) => issue.status === "fixed").length}/{issues.length} resolvidas
                </span>
              </div>
              {issues.slice(0, 14).map((issue) => (
                <div className={`issue severity-${issue.severity} status-${issue.status}`} key={issue.id}>
                  <span className="agent-dot" style={{ background: issue.ownerColor }} />
                  <div className="issue-copy">
                    <span className="issue-message">{issue.message}</span>
                    <span className="issue-meta">
                      {issue.sectionId ?? issue.nodeId ?? "página"} · {issue.owner} · {issue.category}
                    </span>
                  </div>
                  <span className="issue-status">{issueStatusLabel(issue.status)}</span>
                </div>
              ))}
            </div>
          )}

          {auditWarning && <div className="warning">{auditWarning}</div>}

          {plan && (
            <div className="sections">
              <div className="panel-head">
                <span>Seções</span>
                <button className="log-toggle" type="button" onClick={openAddSection} disabled={phase === "running"}>
                  + Seção
                </button>
              </div>
              {sectionList.map((section, index) => {
                const state = sections[section.id] ?? "pending";
                const group = activeAgents.filter((candidate) => candidate.sectionId === section.id);
                const agent = group[0];
                return (
                  <div className={`section-row state-${state}`} key={section.id}>
                    <span className="section-index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="agent-dot" style={{ background: agent?.color ?? "#3a3a44" }} />
                    <div className="section-copy">
                      <span className="section-title">{section.title}</span>
                      <span className="section-kind">
                        {section.kind}
                        {group.length > 1 ? ` · ${group.length} cursores` : ""}
                        {section.cursors?.mode ? ` · ${section.cursors.mode}` : ""}
                      </span>
                    </div>
                    <span className="section-state">{state === "working" ? "ativa" : state === "done" ? "pronta" : state === "failed" ? "falhou" : state === "fallback" ? "fallback" : "fila"}</span>
                  </div>
                );
              })}
            </div>
          )}

          {(stats || critique) && (
            <div className="result-card">
              {stats && (
                <div className="stats">
                  <div><b>{stats.sections}</b><span>seções</span></div>
                  <div><b>{stats.nodes}</b><span>nós</span></div>
                  <div><b>{(stats.durationMs / 1000).toFixed(1)}s</b><span>tempo</span></div>
                  <div title={formatCents(stats.cost)}><b>{formatUsd(stats.cost)}</b><span>custo</span></div>
                  <div><b>{stats.failed ?? 0}</b><span>fallbacks</span></div>
                  <div><b>{stats.issues ?? 0}</b><span>issues</span></div>
                  <div><b>{stats.fixed ?? 0}</b><span>fixes</span></div>
                </div>
              )}
              {critique && <p className="critique">{critique}</p>}
              <button className="ghost" type="button" onClick={copyHtml} disabled={!html || phase === "running"}>
                Copiar HTML
              </button>
            </div>
          )}

          {error && <div className="error">{error}</div>}
        </section>

        <section className={`panel preview-panel ${mobileTab === "preview" ? "mobile-active" : ""}`}>
          <div className="preview-head">
            <div>
              <span className="panel-title">Preview ao vivo</span>
              <span className="hint">{runId ? `run ${runId.slice(0, 8)}` : "aguardando build"}</span>
            </div>
            <div className="preview-actions">
              <div className="device-toggle">
                {(["desktop", "mobile", "tablet"] as const).map((device) => (
                  <button
                    key={device}
                    type="button"
                    className={previewDevice === device ? "on" : ""}
                    onClick={() => setPreviewDevice(device)}
                  >
                    {device === "desktop" ? "Desktop" : device === "mobile" ? "Mobile" : "Tablet"}
                  </button>
                ))}
              </div>
              <select
                className="agent-select"
                value={selectedAgentId}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelectedAgentId(value);
                  setSelectedNodeId(null);
                  const agent = agents.find((candidate) => candidate.id === value);
                  if (agent) {
                    postControl({
                      composerForAgent: {
                        agentId: agent.id,
                        sectionId: agent.sectionId,
                        agentName: agent.name,
                        agentColor: agent.color,
                        agentRole: agent.cursorRole,
                      },
                    });
                  }
                }}
              >
                <option value="">Editar por agente…</option>
                {activeAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} · {agent.sectionId}
                    {agent.cursorRole ? ` · ${agent.cursorRole}` : ""}
                  </option>
                ))}
              </select>
              <button
                className={`tour-toggle ${selectMode ? "on" : ""}`}
                type="button"
                onClick={() => {
                  const next = !selectMode;
                  setSelectMode(next);
                  postControl({ select: next });
                  if (!next) {
                    setSelectedNodeId(null);
                    setSelectedAgentId("");
                  }
                }}
              >
                {selectMode ? "Clique em um elemento" : "Selecionar"}
              </button>
              {undoAvailable && (
                <button className="tour-toggle" type="button" onClick={undoRevision}>
                  Desfazer
                </button>
              )}
              {rendering && <span className="badge badge-running">renderizando</span>}
              {revisionBusy && <span className="badge badge-running">aplicando</span>}
              <button
                className={`tour-toggle ${tour ? "on" : ""}`}
                type="button"
                onClick={() => {
                  const next = !tour;
                  setTour(next);
                  postControl({ tour: next });
                }}
              >
                {tour ? "Seguindo o swarm" : "Scroll livre"}
              </button>
              <span className={`badge badge-${phase}`}>
                {phase === "running" ? "gerando" : phase === "done" ? (partial ? "parcial" : "pronto") : phase === "failed" ? "erro" : "idle"}
              </span>
            </div>
          </div>
          <div className="preview-stage">
            <div className={`device-frame ${previewDevice}`}>
              <iframe
                ref={iframeRef}
                title="Página gerada"
                srcDoc={PREVIEW_SHELL}
                sandbox="allow-scripts"
                className={html ? "" : "is-hidden"}
                onLoad={() => {
                  previewReady.current = true;
                  postControl({ tour });
                  for (const event of eventsRef.current) postEvent(event);
                }}
              />
            </div>
            {!html && (
              <div className="preview-empty">
                <div className="orbit">
                  <span className="cursor c1" />
                  <span className="cursor c2" />
                  <span className="cursor c3" />
                  <span className="cursor c4" />
                </div>
                <h2>Sua página começa com um brief</h2>
                <p>O arquiteto planeja, os agentes constroem cada seção e o crítico revisa. Tudo aparece aqui.</p>
              </div>
            )}
          </div>
        </section>

        <section className={`panel log-panel ${mobileTab === "log" ? "mobile-active" : ""} ${logOpen ? "" : "collapsed"}`}>
          <div className="panel-head">
            <span>Eventos do swarm</span>
            <span className="hint">{events.length} eventos</span>
            <button className="log-toggle" type="button" onClick={() => setLogOpen((value) => !value)}>
              {logOpen ? "Recolher" : "Expandir"}
            </button>
          </div>
          <div className="log">
            {recentEvents.length ? (
              recentEvents.map((event) => (
                <div className="log-row" key={`${event.seq}-${event.type}`}>
                  <span className="log-seq">{String(event.seq).padStart(3, "0")}</span>
                  <span className={`log-type type-${event.type}`}>{event.type}</span>
                  <span className="log-text">{describe(event)}</span>
                </div>
              ))
            ) : (
              <div className="empty">Nenhum evento ainda. Envie um brief para começar.</div>
            )}
          </div>
        </section>
      </main>

      {addOpen && (
        <div className="modal-backdrop" onMouseDown={() => setAddOpen(false)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="panel-head">
              <span>Adicionar seção</span>
              <button className="log-toggle" type="button" onClick={() => setAddOpen(false)}>
                Fechar
              </button>
            </div>

            <label className="field-label">Posição de inserção</label>
            <select value={newSectionIndex} onChange={(event) => setNewSectionIndex(Number(event.target.value))}>
              <option value={0}>No início, antes da seção 1</option>
              {(plan?.sections ?? []).map((section, index) => (
                <option key={section.id} value={index + 1}>
                  Depois da seção {index + 1} — {section.title}
                </option>
              ))}
            </select>

            <label className="field-label">Título (opcional)</label>
            <input
              value={newSectionTitle}
              onChange={(event) => setNewSectionTitle(event.target.value)}
              placeholder="Ex.: Perguntas frequentes"
            />

            <label className="field-label">O que essa seção deve ter?</label>
            <textarea
              className="revision-input"
              value={newSectionPrompt}
              onChange={(event) => setNewSectionPrompt(event.target.value)}
              rows={4}
              placeholder="Ex.: uma seção de FAQ com 5 perguntas sobre os cursos, planos e certificados."
            />

            <div className="modal-row">
              <div>
                <label className="field-label">Tipo</label>
                <select value={newSectionKind} onChange={(event) => setNewSectionKind(event.target.value as SectionKind | "auto")}>
                  <option value="auto">Auto</option>
                  {["nav", "hero", "features", "showcase", "testimonials", "pricing", "cta", "footer", "custom"].map((kind) => (
                    <option key={kind} value={kind}>{kind}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Qualidade</label>
                <select value={newSectionQuality} onChange={(event) => setNewSectionQuality(event.target.value as "solo" | "split" | "race")}>
                  <option value="solo">Solo</option>
                  <option value="split">Split</option>
                  <option value="race">Race</option>
                </select>
              </div>
            </div>

            <div className="modal-actions">
              <button className="primary small" type="button" onClick={addSection} disabled={revisionBusy || newSectionPrompt.trim().length < 3}>
                {revisionBusy ? "Adicionando…" : "Adicionar seção"}
              </button>
              <button className="ghost" type="button" onClick={() => setAddOpen(false)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
