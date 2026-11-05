import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { PREVIEW_SHELL } from "@swarm/swarm-runtime";
import type {
  AgentInfo,
  BuildEvent,
  CreativeArtboardView,
  CreativeLayerGroup,
  CreativeProjectView,
  CreativeStats,
  OwnershipEntry,
} from "@swarm/protocol";
import type { ArtboardRole, CreativeFormatId, CreativeSetPlan } from "@swarm/dsl";
import { ModeToggle, type StudioMode } from "./ModeToggle.js";
import { formatCents, formatUsd } from "./format.js";

const EVENT_TYPES: BuildEvent["type"][] = [
  "creative.started",
  "creative.plan",
  "creative.artboard.started",
  "creative.artboard.done",
  "creative.done",
  "creative.failed",
  "agent.spawned",
  "ownership.updated",
  "preview.updated",
  "preview.sync",
  "revision.started",
  "revision.applied",
  "revision.done",
  "revision.undone",
];

const FORMATS: Array<{ id: CreativeFormatId; label: string; width: number; height: number }> = [
  { id: "ig-square", label: "Quadrado 1:1", width: 1080, height: 1080 },
  { id: "ig-portrait", label: "Retrato 4:5", width: 1080, height: 1350 },
];

const ROLE_LABEL: Record<ArtboardRole, string> = {
  cover: "Capa",
  value: "Conteúdo",
  proof: "Prova",
  cta: "CTA",
  custom: "Livre",
};

type Phase = "idle" | "running" | "done" | "failed";

export type CreativePreviewHandle = {
  send: (event: BuildEvent) => void;
  control: (control: Record<string, unknown>) => void;
};

type PreviewProps = {
  artboardId: string;
  html: string;
  width: number;
  height: number;
  groups?: CreativeLayerGroup[];
  agents?: AgentInfo[];
  selectMode: boolean;
  highlight: string[];
};

const CreativePreview = forwardRef<CreativePreviewHandle, PreviewProps>(function CreativePreview(
  { artboardId, html, width, height, groups = [], agents = [], selectMode, highlight },
  ref,
) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<Array<{ event?: BuildEvent; control?: Record<string, unknown> }>>([]);
  const artboardRef = useRef(artboardId);
  const htmlRef = useRef(html);
  const groupsRef = useRef(groups);
  const agentsRef = useRef(agents);
  const selectRef = useRef(selectMode);
  const highlightRef = useRef(highlight);
  const lastSyncedRef = useRef("");
  const lastRevealRef = useRef("");
  const timersRef = useRef<number[]>([]);
  const [scale, setScale] = useState(0.4);

  if (artboardRef.current !== artboardId) {
    artboardRef.current = artboardId;
    readyRef.current = false;
    pendingRef.current = [];
    lastSyncedRef.current = "";
    lastRevealRef.current = "";
  }
  htmlRef.current = html;
  groupsRef.current = groups;
  agentsRef.current = agents;
  selectRef.current = selectMode;
  highlightRef.current = highlight;

  const rawPost = useCallback((payload: { event?: BuildEvent; control?: Record<string, unknown> }) => {
    iframeRef.current?.contentWindow?.postMessage({ source: "swarm-studio", ...payload }, "*");
  }, []);

  const post = useCallback(
    (payload: { event?: BuildEvent; control?: Record<string, unknown> }) => {
      if (!readyRef.current) {
        pendingRef.current.push(payload);
        return;
      }
      rawPost(payload);
    },
    [rawPost],
  );

  const send = useCallback((event: BuildEvent) => post({ event }), [post]);
  const control = useCallback((value: Record<string, unknown>) => post({ control: value }), [post]);

  useImperativeHandle(ref, () => ({ send, control }), [send, control]);

  const syncHtml = useCallback(
    (value: string) => {
      if (!value || !readyRef.current || value === lastSyncedRef.current) return;
      lastSyncedRef.current = value;
      send({ type: "preview.sync", html: value, force: true, at: Date.now() });
    },
    [send],
  );

  const reveal = useCallback(() => {
    if (!readyRef.current) return;
    const currentGroups = groupsRef.current;
    const currentAgents = agentsRef.current;
    const key = `${artboardRef.current}:${currentGroups.map((group) => `${group.agentId}:${group.nodeId}`).join(",")}`;
    if (!currentGroups.length || key === lastRevealRef.current) return;
    lastRevealRef.current = key;
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
    const byId = new Map(currentAgents.map((agent) => [agent.id, agent]));
    currentGroups.forEach((group, index) => {
      const agent = byId.get(group.agentId);
      if (!agent) return;
      const delay = 140 + index * 180;
      timersRef.current.push(
        window.setTimeout(() => {
          send({
            type: "task.started",
            taskId: `creative:${group.agentId}`,
            sectionId: group.nodeId,
            agent,
            label: agent.name,
            at: Date.now(),
          });
        }, delay),
      );
      timersRef.current.push(
        window.setTimeout(() => {
          send({
            type: "patch.applied",
            sectionId: artboardRef.current,
            agentId: group.agentId,
            nodeCount: group.nodeIds.length,
            sessionId: "creative",
            label: agent.name,
            at: Date.now(),
          });
        }, delay + 520),
      );
    });
  }, [send]);

  const handleLoad = useCallback(() => {
    readyRef.current = true;
    const pending = pendingRef.current;
    pendingRef.current = [];
    for (const payload of pending) rawPost(payload);
    control({ tour: false });
    control({ select: selectRef.current });
    control({ highlightNodes: highlightRef.current });
    control({ uiScale: 1 / scale });
    syncHtml(htmlRef.current);
    reveal();
  }, [control, rawPost, reveal, scale, syncHtml]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const next = Math.min(el.clientWidth / width, el.clientHeight / height);
      setScale(Math.max(0.08, Math.min(1, next)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, height]);

  useEffect(() => {
    htmlRef.current = html;
    syncHtml(html);
  }, [html, syncHtml]);

  useEffect(() => {
    groupsRef.current = groups;
    agentsRef.current = agents;
    reveal();
  }, [groups, agents, reveal]);

  useEffect(() => {
    selectRef.current = selectMode;
    if (readyRef.current) control({ select: selectMode });
  }, [selectMode, control]);

  useEffect(() => {
    highlightRef.current = highlight;
    if (readyRef.current) control({ highlightNodes: highlight });
  }, [highlight, control]);

  useEffect(() => {
    if (readyRef.current) control({ uiScale: 1 / scale });
  }, [scale, control]);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="artboard-stage" ref={stageRef}>
      <div className="artboard-scale" style={{ width: width * scale, height: height * scale }}>
        <iframe
          key={artboardId}
          ref={iframeRef}
          title="Artboard"
          srcDoc={PREVIEW_SHELL}
          sandbox="allow-scripts"
          onLoad={handleLoad}
          style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}
        />
      </div>
    </div>
  );
});

export function CreativeStudio({ onModeChange }: { onModeChange: (mode: StudioMode) => void }) {
  const [prompt, setPrompt] = useState("Carrossel para o lançamento de uma plataforma de design editorial, com tom premium e foco em conversão.");
  const [brand, setBrand] = useState("Ateliê Forma");
  const [cta, setCta] = useState("Conhecer os cursos");
  const [formatId, setFormatId] = useState<CreativeFormatId>("ig-square");
  const [cardCount, setCardCount] = useState(4);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("Pronto para criar");
  const [project, setProject] = useState<CreativeProjectView | null>(null);
  const [plan, setPlan] = useState<CreativeSetPlan | null>(null);
  const [artboards, setArtboards] = useState<CreativeArtboardView[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [ownership, setOwnership] = useState<Record<string, OwnershipEntry>>({});
  const [cost, setCost] = useState(0);
  const [stats, setStats] = useState<CreativeStats | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [events, setEvents] = useState<BuildEvent[]>([]);
  const [error, setError] = useState("");
  const [exportFormat, setExportFormat] = useState<"png" | "jpeg">("png");
  const [exportScale, setExportScale] = useState<1 | 2>(1);
  const [exporting, setExporting] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [lastRevisionCost, setLastRevisionCost] = useState<number | null>(null);
  const runIdRef = useRef<string | null>(null);
  const projectIdRef = useRef<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const previewRef = useRef<CreativePreviewHandle | null>(null);

  const format = FORMATS.find((item) => item.id === formatId) ?? FORMATS[0]!;
  const active = artboards[activeIndex] ?? artboards[0];
  const activeFormat = plan
    ? FORMATS.find((item) => item.id === plan.formatId) ?? format
    : format;
  const activeAgents = useMemo(
    () => (active?.id ? agents.filter((agent) => agent.sectionId === active.id) : []),
    [agents, active?.id],
  );
  const activeAgent = activeAgents.find((agent) => agent.id === selectedAgentId);
  const highlightNodes = useMemo(() => {
    if (selectedAgentId) {
      return Object.entries(ownership)
        .filter(([, entry]) => entry.agentId === selectedAgentId && entry.sectionId === active?.id)
        .map(([id]) => id);
    }
    return selectedNodeId ? [selectedNodeId] : [];
  }, [selectedAgentId, selectedNodeId, ownership, active?.id]);

  const closeSource = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);
  useEffect(() => closeSource, [closeSource]);

  useEffect(() => {
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedAgentId("");
    setUndoAvailable(active?.undoAvailable ?? false);
  }, [active?.id, active?.undoAvailable]);

  const postControl = useCallback((control: Record<string, unknown>) => {
    previewRef.current?.control(control);
  }, []);

  const refreshProject = useCallback(async (id: string) => {
    const response = await fetch(`/api/creative/projects/${id}`);
    if (!response.ok) return;
    const view = (await response.json()) as CreativeProjectView;
    setProject(view);
    setAgents(view.agents ?? []);
    setOwnership(view.ownership ?? {});
    setCost(view.cost ?? 0);
    setStats(view.stats ?? null);
    setArtboards(view.artboards);
  }, []);

  const mergeAgents = useCallback((incoming: AgentInfo[]) => {
    setAgents((current) => {
      const next = [...current];
      for (const agent of incoming) {
        const index = next.findIndex((item) => item.id === agent.id);
        if (index >= 0) next[index] = agent;
        else next.push(agent);
      }
      return next;
    });
  }, []);

  const handleEvent = useCallback(
    (event: BuildEvent) => {
      setEvents((current) => [...current.slice(-119), event]);
      switch (event.type) {
        case "creative.started":
          setStatus("Diretor planejando o carrossel");
          break;
        case "creative.plan":
          setPlan(event.plan);
          setAgents(event.agents);
          setOwnership({});
          setCost(0);
          setStats(null);
          setStatus(`Construindo ${event.artboards.length} cards`);
          setArtboards(
            event.artboards.map((artboard, index) => ({
              id: artboard.id,
              index,
              role: artboard.role,
              html: "",
              status: "working",
              groups: [],
              cost: 0,
              nodes: 0,
              undoAvailable: false,
            })),
          );
          setActiveIndex(0);
          break;
        case "agent.spawned":
          mergeAgents([event.agent]);
          break;
        case "creative.artboard.started":
          setArtboards((current) =>
            current.map((artboard) =>
              artboard.id === event.artboardId ? { ...artboard, status: "working" } : artboard,
            ),
          );
          break;
        case "creative.artboard.done":
          mergeAgents(event.agents);
          setArtboards((current) =>
            current.map((artboard) =>
              artboard.id === event.artboardId
                ? {
                    ...artboard,
                    html: event.html,
                    status: "done",
                    fallback: event.fallback,
                    groups: event.groups,
                    cost: event.cost,
                    nodes: event.nodes,
                    undoAvailable: false,
                  }
                : artboard,
            ),
          );
          if (event.totalCost !== undefined) setCost(event.totalCost);
          break;
        case "ownership.updated":
          setOwnership(event.ownership);
          break;
        case "preview.updated":
        case "preview.sync":
          if (event.artboardId) {
            setArtboards((current) =>
              current.map((artboard) =>
                artboard.id === event.artboardId ? { ...artboard, html: event.html } : artboard,
              ),
            );
          }
          break;
        case "revision.started":
          setRevisionBusy(true);
          setPhase("running");
          setStatus("Aplicando alteração");
          previewRef.current?.send(event);
          break;
        case "revision.applied":
          previewRef.current?.send(event);
          break;
        case "revision.done":
          setRevisionBusy(false);
          setPhase("done");
          setStatus(event.success ? "Card atualizado" : "Alteração falhou");
          setLastRevisionCost(event.cost);
          if (event.totalCost !== undefined) setCost(event.totalCost);
          else setCost((current) => current + event.cost);
          if (event.artboardId) {
            setArtboards((current) =>
              current.map((artboard) =>
                artboard.id === event.artboardId
                  ? {
                      ...artboard,
                      cost: event.artboardCost ?? artboard.cost,
                      undoAvailable: event.success ? true : artboard.undoAvailable,
                    }
                  : artboard,
              ),
            );
          }
          if (event.success) {
            setUndoAvailable(true);
            if (projectIdRef.current) void refreshProject(projectIdRef.current);
          }
          previewRef.current?.send(event);
          closeSource();
          break;
        case "revision.undone":
          setRevisionBusy(false);
          closeSource();
          break;
        case "creative.done":
          setPhase("done");
          setStatus("Carrossel concluído");
          setStats(event.stats);
          setCost(event.stats.cost);
          setArtboards(event.artboards);
          closeSource();
          break;
        case "creative.failed":
          setPhase("failed");
          setStatus("Falha ao criar");
          setError(event.message);
          closeSource();
          break;
      }
    },
    [closeSource, mergeAgents, refreshProject],
  );

  const listen = useCallback(
    (runId: string) => {
      closeSource();
      const source = new EventSource(`/api/runs/${runId}/events`);
      sourceRef.current = source;
      for (const type of EVENT_TYPES) {
        source.addEventListener(type, (message) => {
          handleEvent(JSON.parse((message as MessageEvent).data) as BuildEvent);
        });
      }
      source.onerror = () => {
        if (sourceRef.current === source) {
          setError("Conexão com o build foi interrompida.");
        }
      };
    },
    [closeSource, handleEvent],
  );

  const build = useCallback(async () => {
    if (phase === "running" || prompt.trim().length < 10) return;
    closeSource();
    setPhase("running");
    setStatus("Criando projeto");
    setProject(null);
    projectIdRef.current = null;
    setPlan(null);
    setArtboards([]);
    setAgents([]);
    setOwnership({});
    setCost(0);
    setStats(null);
    setActiveIndex(0);
    setEvents([]);
    setError("");
    setSelectMode(false);
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedAgentId("");
    setRevisionBusy(false);
    setUndoAvailable(false);
    setLastRevisionCost(null);
    try {
      const created = await fetch("/api/creative/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          brand: brand.trim() || undefined,
          cta: cta.trim() || undefined,
          formatId,
          cardCount,
        }),
      });
      if (!created.ok) throw new Error((await created.json().catch(() => ({}))).error ?? "Falha ao criar projeto");
      const projectView = (await created.json()) as CreativeProjectView;
      projectIdRef.current = projectView.id;
      setProject(projectView);
      setCost(projectView.cost ?? 0);
      setStatus("Planejando carrossel");
      const started = await fetch(`/api/creative/projects/${projectView.id}/build`, { method: "POST" });
      if (!started.ok) throw new Error((await started.json().catch(() => ({}))).error ?? "Falha ao iniciar build");
      const run = (await started.json()) as { runId: string };
      runIdRef.current = run.runId;
      listen(run.runId);
    } catch (caught) {
      setPhase("failed");
      setStatus("Falha ao criar");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [phase, prompt, brand, cta, formatId, cardCount, closeSource, listen]);

  const requestRevision = useCallback(
    async (target: { nodeId?: string; nodeIds?: string[]; agentId?: string; request: string }) => {
      if (!project || !active?.id || revisionBusy) return;
      setRevisionBusy(true);
      setPhase("running");
      setStatus("Aplicando alteração");
      setError("");
      try {
        const response = await fetch(`/api/creative/projects/${project.id}/artboards/${active.id}/revise`, {
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
        setStatus("Alteração falhou");
        setError(message);
        postControl({ composerError: message });
      }
    },
    [project, active?.id, revisionBusy, listen, postControl],
  );

  const undoRevision = useCallback(async () => {
    if (!project || !active?.id || revisionBusy) return;
    setRevisionBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/creative/projects/${project.id}/artboards/${active.id}/undo`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Nada para desfazer");
      }
      const data = (await response.json()) as {
        html: string;
        ownership: Record<string, OwnershipEntry>;
        groups: CreativeLayerGroup[];
        cost: number;
        artboard: CreativeArtboardView | null;
        undoAvailable: boolean;
      };
      setOwnership(data.ownership);
      setCost(data.cost);
      setArtboards((current) =>
        current.map((artboard) =>
          artboard.id === active.id
            ? data.artboard ?? { ...artboard, html: data.html, groups: data.groups }
            : artboard,
        ),
      );
      setUndoAvailable(data.undoAvailable);
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setSelectedAgentId("");
      if (project.id) await refreshProject(project.id);
      setSelectMode(false);
      postControl({ select: false });
      setStatus("Alteração desfeita");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRevisionBusy(false);
    }
  }, [project, active?.id, revisionBusy, postControl, refreshProject]);

  useEffect(() => {
    const onMessage = (message: MessageEvent) => {
      const data = message.data;
      if (!data || data.source !== "swarm-preview") return;
      if (data.type === "node.selected" && typeof data.nodeId === "string") {
        const nodeId = data.nodeId as string;
        const nodeIds = Array.isArray(data.nodeIds) && data.nodeIds.length ? (data.nodeIds as string[]) : [nodeId];
        setSelectedNodeId(nodeId);
        setSelectedNodeIds(nodeIds);
        const entries = nodeIds.map((id) => ({ id, owner: ownership[id] }));
        const ownerIds = [...new Set(entries.map((entry) => entry.owner?.agentId).filter((id): id is string => Boolean(id)))];
        const agent =
          agents.find((candidate) => candidate.id === ownerIds[0]) ??
          activeAgents.find((candidate) => candidate.id.startsWith("artboard:"));
        setSelectedAgentId(ownerIds.length === 1 ? ownerIds[0]! : "");
        const ownerLabels = [...new Set(
          entries
            .map((entry) => {
              const ownerId = entry.owner?.agentId;
              return agents.find((candidate) => candidate.id === ownerId)?.name ?? (entry.owner ? ownerId : undefined);
            })
            .filter((label): label is string => Boolean(label)),
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
            sectionId: active?.id,
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
      if (data.type === "selection.expand" && Array.isArray(data.nodeIds) && project?.id && active?.id) {
        void (async () => {
          try {
            const response = await fetch(
              `/api/creative/projects/${project.id}/artboards/${active.id}/selection/expand`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ nodeIds: data.nodeIds }),
              },
            );
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
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [active?.id, activeAgents, agents, ownership, project?.id, postControl, requestRevision]);

  const exportAll = useCallback(async () => {
    if (!project?.id || !artboards.some((artboard) => artboard.html)) return;
    setExporting(true);
    try {
      const response = await fetch(`/api/creative/projects/${project.id}/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          format: exportFormat,
          scale: exportScale,
          artboardIds: artboards.filter((artboard) => artboard.html).map((artboard) => artboard.id),
        }),
      });
      if (!response.ok) throw new Error("Falha ao exportar");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `creative-${project.id}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setExporting(false);
    }
  }, [project?.id, artboards, exportFormat, exportScale]);

  const doneCount = useMemo(() => artboards.filter((artboard) => artboard.status === "done").length, [artboards]);
  const totalNodes = stats?.nodes ?? artboards.reduce((sum, artboard) => sum + (artboard.nodes ?? 0), 0);
  const fallbackCount = stats?.fallbacks ?? artboards.filter((artboard) => artboard.fallback).length;
  const partialCost = cost || project?.cost || 0;

  return (
    <div className="shell creative-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-name">Swarm Builder · Criativos</div>
            <div className="brand-sub">carrosséis estáticos com HTML</div>
          </div>
        </div>
        <div className="topbar-meta">
          <ModeToggle mode="creative" onChange={onModeChange} />
          <span className={`phase phase-${phase === "done" ? "done" : phase === "failed" ? "failed" : phase === "running" ? "running" : ""}`}>
            {status}
          </span>
          <span className="dot-live" />
          <span>criativo</span>
        </div>
      </header>

      <main className="workspace creative-workspace">
        <section className="panel controls creative-controls">
          <div className="panel-head">
            <span>Brief do criativo</span>
            <span className="hint">feed Instagram</span>
          </div>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} spellCheck={false} />
          <div className="creative-fields">
            <label>
              <span>Marca</span>
              <input value={brand} onChange={(event) => setBrand(event.target.value)} />
            </label>
            <label>
              <span>CTA</span>
              <input value={cta} onChange={(event) => setCta(event.target.value)} />
            </label>
            <label>
              <span>Formato</span>
              <select value={formatId} onChange={(event) => setFormatId(event.target.value as CreativeFormatId)}>
                {FORMATS.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Cards</span>
              <select value={cardCount} onChange={(event) => setCardCount(Number(event.target.value))}>
                {Array.from({ length: 8 }, (_, index) => index + 1).map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </select>
            </label>
          </div>
          <button className="primary" type="button" onClick={build} disabled={phase === "running" || prompt.trim().length < 10}>
            {phase === "running" ? "Criando carrossel…" : "Criar carrossel"}
          </button>
          <div className="progress-wrap">
            <div className="progress"><i style={{ width: `${artboards.length ? (doneCount / artboards.length) * 100 : 0}%` }} /></div>
            <div className="progress-label">
              <span>{doneCount} de {artboards.length || cardCount} cards</span>
              <span>{artboards.length ? Math.round((doneCount / artboards.length) * 100) : 0}%</span>
            </div>
          </div>

          <div className="creative-stats">
            <div title={formatCents(partialCost)}><b>{formatUsd(partialCost)}</b><span>custo total</span></div>
            <div><b>{totalNodes}</b><span>nós</span></div>
            <div><b>{stats ? `${(stats.durationMs / 1000).toFixed(1)}s` : "—"}</b><span>tempo</span></div>
            <div><b>{fallbackCount}</b><span>fallbacks</span></div>
          </div>

          <div className="creative-cards">
            <div className="panel-head"><span>Cards</span><span className="hint">{artboards.length || cardCount} previstos</span></div>
            {artboards.map((artboard, index) => (
              <button
                key={artboard.id}
                type="button"
                className={`creative-card ${index === activeIndex ? "active" : ""} status-${artboard.status}`}
                onClick={() => setActiveIndex(index)}
                disabled={revisionBusy}
                title={formatCents(artboard.cost ?? 0)}
              >
                <span className="creative-card-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="creative-card-copy">
                  <b>{ROLE_LABEL[artboard.role] ?? artboard.role}</b>
                  <small>{artboard.id} · {formatUsd(artboard.cost ?? 0)}</small>
                </span>
                <span className="creative-card-state">
                  {artboard.status === "done" ? (artboard.fallback ? "fallback" : "pronto") : artboard.status === "failed" ? "falhou" : "gerando"}
                </span>
              </button>
            ))}
            {!artboards.length && <div className="empty">O carrossel ainda não foi planejado.</div>}
          </div>

          {artboards.some((artboard) => artboard.html) && (
            <div className="creative-export">
              <div className="panel-head"><span>Exportar</span><span className="hint">PNG/JPEG · 1x/2x · ZIP</span></div>
              <div className="creative-fields two">
                <label>
                  <span>Formato</span>
                  <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as "png" | "jpeg")}>
                    <option value="png">PNG</option>
                    <option value="jpeg">JPEG</option>
                  </select>
                </label>
                <label>
                  <span>Escala</span>
                  <select value={exportScale} onChange={(event) => setExportScale(Number(event.target.value) as 1 | 2)}>
                    <option value={1}>1x</option>
                    <option value={2}>2x</option>
                  </select>
                </label>
              </div>
              {active?.html && (
                <a
                  className="ghost download-link"
                  href={`/api/creative/projects/${project?.id}/artboards/${active.id}/export?format=${exportFormat}&scale=${exportScale}`}
                  download
                >
                  Baixar card {active.index + 1}
                </a>
              )}
              <button className="primary" type="button" onClick={exportAll} disabled={exporting || !artboards.some((artboard) => artboard.html)}>
                {exporting ? "Gerando ZIP…" : "Exportar todos em ZIP"}
              </button>
            </div>
          )}

          {stats && (
            <div className="creative-result">
              <div className="panel-head"><span>Consumo</span><span className="hint">{stats.model ?? "runtime"} · USD</span></div>
              <div className="creative-result-row">
                <b>{formatUsd(stats.cost)}</b>
                <span>{stats.artboards} cards · {stats.nodes} nós · {(stats.durationMs / 1000).toFixed(1)}s</span>
              </div>
              {lastRevisionCost !== null && (
                <div className="creative-result-row">
                  <b>{formatUsd(lastRevisionCost)}</b>
                  <span>última revisão</span>
                </div>
              )}
            </div>
          )}

          {error && <div className="error">{error}</div>}
        </section>

        <section className="panel creative-preview-panel">
          <div className="preview-head">
            <div>
              <span className="panel-title">Preview do carrossel</span>
              <span className="hint">{active ? `${active.index + 1} / ${artboards.length}` : `${format.width} × ${format.height}`}</span>
            </div>
            <div className="preview-actions">
              <span className="badge badge-running">{activeFormat.width} × {activeFormat.height}</span>
              <select
                className="agent-select"
                value={selectedAgentId}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelectedAgentId(value);
                  setSelectedNodeId(null);
                  const agent = activeAgents.find((candidate) => candidate.id === value);
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
                disabled={!active?.html || revisionBusy}
              >
                <option value="">Editar por agente…</option>
                {activeAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} · {agent.cursorRole ?? agent.role}
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
                    setSelectedNodeIds([]);
                    setSelectedAgentId("");
                  }
                }}
                disabled={!active?.html || revisionBusy}
              >
                {selectMode ? "Clique em um elemento" : "Selecionar"}
              </button>
              {undoAvailable && (
                <button className="tour-toggle" type="button" onClick={undoRevision} disabled={revisionBusy}>
                  Desfazer
                </button>
              )}
              {revisionBusy && <span className="badge badge-running">aplicando</span>}
              <span className={`badge badge-${phase === "done" ? "done" : phase === "failed" ? "failed" : "running"}`}>
                {phase === "running" ? "gerando" : phase === "done" ? "pronto" : phase === "failed" ? "erro" : "idle"}
              </span>
            </div>
          </div>
          <div className="creative-preview-stage">
            {active?.html ? (
              <CreativePreview
                ref={previewRef}
                artboardId={active.id}
                html={active.html}
                width={activeFormat.width}
                height={activeFormat.height}
                groups={active.groups}
                agents={activeAgents}
                selectMode={selectMode}
                highlight={highlightNodes}
              />
            ) : (
              <div className="creative-placeholder">
                <div className="orbit">
                  <span className="cursor c1" />
                  <span className="cursor c2" />
                  <span className="cursor c3" />
                  <span className="cursor c4" />
                </div>
                <h2>{phase === "running" ? "O swarm está desenhando o carrossel" : "Crie seu primeiro carrossel"}</h2>
                <p>Escolha o formato, descreva o conceito e exporte os cards prontos em PNG ou JPEG.</p>
              </div>
            )}
          </div>
          <div className="creative-strip">
            {artboards.map((artboard, index) => (
              <button
                key={artboard.id}
                type="button"
                className={`creative-thumb ${index === activeIndex ? "active" : ""}`}
                onClick={() => setActiveIndex(index)}
                disabled={revisionBusy}
                title={`${ROLE_LABEL[artboard.role]} · ${artboard.id} · ${formatUsd(artboard.cost ?? 0)}`}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <small>{ROLE_LABEL[artboard.role]}</small>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
