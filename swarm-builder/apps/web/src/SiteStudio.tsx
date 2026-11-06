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
  OwnershipEntry,
  SitePageView,
  SiteProjectView,
  SiteStats,
} from "@swarm/protocol";
import type { SectionKind, SectionSpec, SitePage, SitePageRole, SitePlan } from "@swarm/dsl";
import { ModeToggle, type StudioMode } from "./ModeToggle.js";
import { formatCents, formatUsd } from "./format.js";

const EVENT_TYPES: BuildEvent["type"][] = [
  "site.plan.ready",
  "site.layout.started",
  "site.layout.done",
  "site.page.started",
  "site.page.done",
  "site.done",
  "agent.spawned",
  "task.started",
  "patch.applied",
  "task.failed",
  "task.fallback",
  "preview.updated",
  "preview.sync",
  "render.ops",
  "ownership.updated",
  "revision.started",
  "revision.applied",
  "revision.done",
  "section.add.started",
  "section.added",
  "section.add.done",
  "run.failed",
];

const ROLE_LABEL: Record<SitePageRole, string> = {
  home: "Início",
  about: "Sobre",
  services: "Serviços",
  contact: "Contato",
  custom: "Livre",
};

const DEVICES = ["desktop", "mobile", "tablet"] as const;
type Device = (typeof DEVICES)[number];

type Phase = "brief" | "planning" | "map" | "running" | "done" | "failed";

type SitePreviewHandle = {
  send: (event: BuildEvent) => void;
  control: (control: Record<string, unknown>) => void;
};

const SitePreview = forwardRef<
  SitePreviewHandle,
  {
    pageId: string;
    html: string;
    selectMode: boolean;
    highlight: string[];
    device: Device;
    onNavigate: (href: string) => void;
  }
>(function SitePreview({ pageId, html, selectMode, highlight, device, onNavigate }, ref) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<Array<{ event?: BuildEvent; control?: Record<string, unknown> }>>([]);
  const pageRef = useRef(pageId);
  const htmlRef = useRef(html);
  const selectRef = useRef(selectMode);
  const highlightRef = useRef(highlight);
  const lastSyncedRef = useRef("");
  const navigateRef = useRef(onNavigate);

  if (pageRef.current !== pageId) {
    pageRef.current = pageId;
    readyRef.current = false;
    pendingRef.current = [];
    lastSyncedRef.current = "";
  }
  htmlRef.current = html;
  selectRef.current = selectMode;
  highlightRef.current = highlight;
  navigateRef.current = onNavigate;

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

  const sync = useCallback(
    (value: string) => {
      if (!value || !readyRef.current || value === lastSyncedRef.current) return;
      lastSyncedRef.current = value;
      send({ type: "preview.sync", html: value, force: true, at: Date.now() });
    },
    [send],
  );

  const handleLoad = useCallback(() => {
    readyRef.current = true;
    const pending = pendingRef.current;
    pendingRef.current = [];
    for (const payload of pending) rawPost(payload);
    control({ siteMode: true, tour: false, select: selectRef.current, highlightNodes: highlightRef.current });
    sync(htmlRef.current);
  }, [control, rawPost, sync]);

  useEffect(() => {
    sync(html);
  }, [html, sync]);

  useEffect(() => {
    if (readyRef.current) control({ select: selectMode });
  }, [selectMode, control]);

  useEffect(() => {
    if (readyRef.current) control({ highlightNodes: highlight });
  }, [highlight, control]);

  useEffect(() => {
    const onMessage = (message: MessageEvent) => {
      const data = message.data;
      if (!data || data.source !== "swarm-preview" || data.type !== "page.navigate") return;
      if (typeof data.href === "string") navigateRef.current(data.href);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className={`device-frame ${device}`}>
      <iframe
        key={pageId}
        ref={iframeRef}
        title="Site gerado"
        srcDoc={PREVIEW_SHELL}
        sandbox="allow-scripts"
        className={html ? "" : "is-hidden"}
        onLoad={handleLoad}
      />
    </div>
  );
});

const defaultSection = (id: string, kind: SectionKind, title: string, goal: string): SectionSpec => ({
  id,
  kind,
  title,
  goal,
  contentBrief: goal,
  layoutBrief: "Siga o design system do site e mantenha a hierarquia editorial.",
  cursors: { count: 1, mode: "solo" },
});

const defaultPage = (index: number): SitePage => ({
  slug: `pagina-${index}`,
  title: `Nova página ${index}`,
  description: "Página institucional com conteúdo claro e focado.",
  role: "custom",
  sections: [
    defaultSection("hero", "hero", "Abertura", "Apresentar a página com uma promessa clara."),
    defaultSection("content", "features", "Conteúdo", "Desenvolver o conteúdo principal com clareza."),
    defaultSection("cta", "cta", "Chamada final", "Convidar o visitante a dar o próximo passo."),
  ],
});

const hrefToSlug = (href: string, pages: SitePageView[]): string | null => {
  const clean = href
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\.?\//, "")
    .replace(/\.html$/i, "")
    .replace(/\/+$/, "");
  const slug = clean || "home";
  const target = pages.find((page) => page.slug === slug) ?? (slug === "home" ? pages.find((page) => page.role === "home") : undefined);
  return target?.slug ?? null;
};

export function SiteStudio({ onModeChange }: { onModeChange: (mode: StudioMode) => void }) {
  const [prompt, setPrompt] = useState("Site institucional para uma consultoria de dados e design, com foco em autoridade, serviços e contato.");
  const [brand, setBrand] = useState("Clarity");
  const [phase, setPhase] = useState<Phase>("brief");
  const [status, setStatus] = useState("Descreva o site");
  const [site, setSite] = useState<SiteProjectView | null>(null);
  const [pages, setPages] = useState<SitePageView[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [ownership, setOwnership] = useState<Record<string, OwnershipEntry>>({});
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [cost, setCost] = useState(0);
  const [events, setEvents] = useState<BuildEvent[]>([]);
  const [activePageId, setActivePageId] = useState<string>("");
  const [device, setDevice] = useState<Device>("desktop");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedPageId, setSelectedPageId] = useState("");
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newSectionPrompt, setNewSectionPrompt] = useState("");
  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [newSectionKind, setNewSectionKind] = useState<SectionKind | "auto">("auto");
  const [newSectionIndex, setNewSectionIndex] = useState(0);
  const [newSectionQuality, setNewSectionQuality] = useState<"solo" | "split" | "race">("solo");
  const sourceRef = useRef<EventSource | null>(null);
  const previewRef = useRef<SitePreviewHandle | null>(null);
  const siteIdRef = useRef<string | null>(null);

  const activePage = pages.find((page) => page.slug === activePageId) ?? pages[0];
  const activePlanPage = site?.plan?.pages.find((page) => page.slug === activePage?.slug);
  const activeAgents = useMemo(
    () => agents.filter((agent) => agent.pageId === activePage?.slug || agent.pageId === "shared"),
    [agents, activePage?.slug],
  );
  const highlight = useMemo(() => {
    if (selectedAgentId) {
      return Object.entries(ownership)
        .filter(([, entry]) => entry.agentId === selectedAgentId)
        .map(([id]) => id);
    }
    return selectedNodeId ? [selectedNodeId] : [];
  }, [selectedAgentId, selectedNodeId, ownership]);

  const closeSource = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);
  useEffect(() => closeSource, [closeSource]);

  const postControl = useCallback((control: Record<string, unknown>) => {
    previewRef.current?.control(control);
  }, []);

  const refreshSite = useCallback(async (id: string) => {
    const response = await fetch(`/api/sites/${id}`);
    if (!response.ok) return;
    const view = (await response.json()) as SiteProjectView;
    setSite(view);
    setPages(view.pages);
    setAgents(view.agents ?? []);
    setOwnership(view.ownership ?? {});
    setCost(view.cost ?? 0);
    setStats(view.stats ?? null);
  }, []);

  const handleEvent = useCallback(
    (event: BuildEvent) => {
      setEvents((current) => [...current.slice(-199), event]);
      switch (event.type) {
        case "site.plan.ready":
          setSite((current) => (current ? { ...current, plan: event.plan } : current));
          break;
        case "site.layout.started":
          setStatus("Construindo navegação e rodapé");
          break;
        case "site.layout.done":
          setStatus("Construindo páginas");
          break;
        case "site.page.started":
          setStatus(`Construindo ${event.pageId}`);
          setPages((current) => current.map((page) => (page.slug === event.pageId ? { ...page, status: "building" } : page)));
          break;
        case "site.page.done":
          setPages((current) => current.map((page) => (page.slug === event.page.slug ? event.page : page)));
          setActivePageId((current) => current || event.page.slug);
          break;
        case "agent.spawned":
          setAgents((current) => {
            const next = [...current];
            const index = next.findIndex((agent) => agent.id === event.agent.id);
            if (index >= 0) next[index] = event.agent;
            else next.push(event.agent);
            return next;
          });
          break;
        case "ownership.updated":
          setOwnership(event.ownership);
          break;
        case "preview.updated":
        case "preview.sync":
          if (event.pageId) {
            setPages((current) =>
              current.map((page) => (page.slug === event.pageId ? { ...page, html: event.html } : page)),
            );
          }
          break;
        case "revision.started":
          setRevisionBusy(true);
          setPhase("running");
          setStatus("Aplicando alteração");
          if (event.pageId === activePageId || event.pageId === "shared") previewRef.current?.send(event);
          break;
        case "revision.applied":
          if (event.pageId === activePageId || event.pageId === "shared") previewRef.current?.send(event);
          break;
        case "revision.done":
          setRevisionBusy(false);
          setPhase("done");
          setStatus(event.success ? "Site atualizado" : "Alteração falhou");
          if (event.totalCost !== undefined) setCost(event.totalCost);
          if (event.success) setUndoAvailable(true);
          previewRef.current?.send(event);
          closeSource();
          if (event.success && siteIdRef.current) void refreshSite(siteIdRef.current);
          break;
        case "section.add.started":
          setRevisionBusy(true);
          setPhase("running");
          setStatus("Adicionando seção");
          break;
        case "section.add.done":
          setRevisionBusy(false);
          setPhase("done");
          setStatus(event.success ? "Seção adicionada" : "Falha ao adicionar seção");
          if (event.success) setUndoAvailable(true);
          closeSource();
          if (event.success && siteIdRef.current) void refreshSite(siteIdRef.current);
          break;
        case "site.done":
          setStats(event.stats);
          setCost(event.stats.cost);
          setPages(event.pages);
          setActivePageId((current) => current || event.pages[0]?.slug || "");
          setPhase("done");
          setStatus("Site concluído");
          closeSource();
          break;
        case "run.failed":
          setPhase("failed");
          setStatus("Falha no build");
          setError(event.message);
          closeSource();
          break;
      }
    },
    [activePageId, closeSource, refreshSite],
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
        if (sourceRef.current === source) setError("Conexão com o build foi interrompida.");
      };
    },
    [closeSource, handleEvent],
  );

  const planSite = useCallback(async () => {
    if (prompt.trim().length < 10) return;
    setPhase("planning");
    setStatus("Planejando o site");
    setError("");
    try {
      const response = await fetch("/api/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), brand: brand.trim() || undefined }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Falha ao planejar o site");
      const view = (await response.json()) as SiteProjectView;
      siteIdRef.current = view.id;
      setSite(view);
      setPages(view.pages);
      setCost(view.cost ?? 0);
      setActivePageId(view.pages[0]?.slug ?? "");
      setPhase("map");
      setStatus("Revise o mapa do site");
    } catch (caught) {
      setPhase("failed");
      setStatus("Falha ao planejar");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [prompt, brand]);

  const changePlan = useCallback((next: SitePlan) => {
    setSite((current) => (current ? { ...current, plan: next } : current));
  }, []);

  const updatePlanPage = useCallback(
    (index: number, patch: Partial<SitePage>) => {
      if (!site?.plan) return;
      const nextPages = site.plan.pages.map((page, pageIndex) => (pageIndex === index ? { ...page, ...patch } : page));
      changePlan({ ...site.plan, pages: nextPages });
    },
    [site?.plan, changePlan],
  );

  const addPlanPage = useCallback(() => {
    if (!site?.plan || site.plan.pages.length >= 6) return;
    changePlan({ ...site.plan, pages: [...site.plan.pages, defaultPage(site.plan.pages.length + 1)] });
  }, [site?.plan, changePlan]);

  const removePlanPage = useCallback(
    (index: number) => {
      if (!site?.plan || site.plan.pages.length <= 2) return;
      changePlan({ ...site.plan, pages: site.plan.pages.filter((_, pageIndex) => pageIndex !== index) });
    },
    [site?.plan, changePlan],
  );

  const movePlanPage = useCallback(
    (index: number, direction: -1 | 1) => {
      if (!site?.plan) return;
      const target = index + direction;
      if (target < 0 || target >= site.plan.pages.length) return;
      const next = [...site.plan.pages];
      [next[index], next[target]] = [next[target]!, next[index]!];
      changePlan({ ...site.plan, pages: next });
    },
    [site?.plan, changePlan],
  );

  const buildSite = useCallback(async () => {
    if (!site?.id || !site.plan) return;
    setPhase("running");
    setStatus("Preparando o site");
    setError("");
    setStats(null);
    setUndoAvailable(false);
    try {
      const saved = await fetch(`/api/sites/${site.id}/plan`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: site.plan }),
      });
      if (!saved.ok) throw new Error((await saved.json().catch(() => ({}))).error ?? "Falha ao salvar o mapa");
      const view = (await saved.json()) as SiteProjectView;
      setSite(view);
      setPages(view.pages);
      setCost(view.cost ?? 0);
      setActivePageId(view.pages[0]?.slug ?? "");
      const started = await fetch(`/api/sites/${site.id}/build`, { method: "POST" });
      if (!started.ok) throw new Error((await started.json().catch(() => ({}))).error ?? "Falha ao iniciar o build");
      const run = (await started.json()) as { runId: string };
      listen(run.runId);
    } catch (caught) {
      setPhase("failed");
      setStatus("Falha ao construir");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [site?.id, site?.plan, listen]);

  const requestRevision = useCallback(
    async (target: { nodeId?: string; nodeIds?: string[]; agentId?: string; request: string; pageId: string }) => {
      if (!site?.id || revisionBusy) return;
      setRevisionBusy(true);
      setPhase("running");
      setStatus("Aplicando alteração");
      setError("");
      try {
        const response = await fetch(`/api/sites/${site.id}/revise`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(target),
        });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Falha ao solicitar alteração");
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
    [site?.id, revisionBusy, listen, postControl],
  );

  const undo = useCallback(async () => {
    if (!site?.id || revisionBusy) return;
    setRevisionBusy(true);
    try {
      const response = await fetch(`/api/sites/${site.id}/undo`, { method: "POST" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Nada para desfazer");
      const view = (await response.json()) as SiteProjectView;
      setSite(view);
      setPages(view.pages);
      setAgents(view.agents ?? []);
      setOwnership(view.ownership ?? {});
      setCost(view.cost ?? 0);
      setStats(view.stats ?? null);
      setUndoAvailable(false);
      setSelectMode(false);
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setSelectedAgentId("");
      postControl({ select: false });
      setStatus("Alteração desfeita");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRevisionBusy(false);
    }
  }, [site?.id, revisionBusy, postControl]);

  const addSection = useCallback(async () => {
    if (!site?.id || !activePage || revisionBusy || newSectionPrompt.trim().length < 3) return;
    setRevisionBusy(true);
    setPhase("running");
    setStatus("Adicionando seção");
    try {
      const response = await fetch(`/api/sites/${site.id}/pages/${activePage.slug}/sections`, {
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
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Falha ao adicionar seção");
      const data = (await response.json()) as { runId: string };
      setAddOpen(false);
      listen(data.runId);
    } catch (caught) {
      setRevisionBusy(false);
      setPhase("done");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [site?.id, activePage, revisionBusy, newSectionPrompt, newSectionTitle, newSectionKind, newSectionIndex, newSectionQuality, listen]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.source !== "swarm-preview") return;
      if (data.type === "page.navigate" && typeof data.href === "string") {
        const slug = hrefToSlug(data.href, pages);
        if (slug) setActivePageId(slug);
        return;
      }
      if (data.type === "node.selected" && typeof data.nodeId === "string") {
        const nodeId = data.nodeId as string;
        const nodeIds = Array.isArray(data.nodeIds) && data.nodeIds.length ? (data.nodeIds as string[]) : [nodeId];
        const entries = nodeIds.map((id) => ({ id, owner: ownership[id] }));
        const ownerIds = [...new Set(entries.map((entry) => entry.owner?.agentId).filter((id): id is string => Boolean(id)))];
        const agent = agents.find((candidate) => candidate.id === ownerIds[0]);
        const firstOwner = entries[0]?.owner;
        setSelectedNodeId(nodeId);
        setSelectedNodeIds(nodeIds);
        setSelectedAgentId(ownerIds.length === 1 ? ownerIds[0]! : "");
        setSelectedPageId(firstOwner?.pageId === "shared" ? "shared" : (firstOwner?.pageId ?? activePage?.slug ?? ""));
        const ownerLabels = [...new Set(entries.map((entry) => {
          const ownerId = entry.owner?.agentId;
          return agents.find((candidate) => candidate.id === ownerId)?.name ?? (entry.owner ? ownerId : undefined);
        }).filter((label): label is string => Boolean(label)))];
        if (!ownerLabels.length && agent?.name) ownerLabels.push(agent.name);
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
      if (data.type === "selection.expand" && Array.isArray(data.nodeIds) && site?.id) {
        void (async () => {
          try {
            const response = await fetch(`/api/sites/${site.id}/selection/expand`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ pageId: selectedPageId || activePage?.slug, nodeIds: data.nodeIds }),
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
          void requestRevision({
            nodeIds,
            nodeId,
            agentId,
            request: data.request,
            pageId: selectedPageId || activePage?.slug || "",
          });
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
  }, [activePage?.slug, agents, ownership, pages, postControl, requestRevision, selectedPageId, site?.id]);

  const recentEvents = useMemo(() => events.slice(-20).reverse(), [events]);
  const activePlanSections = activePlanPage?.sections ?? [];
  const donePages = pages.filter((page) => page.status === "done").length;

  if (!site && (phase === "brief" || phase === "planning" || phase === "failed")) {
    return (
      <div className="shell site-shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">S</div>
            <div>
              <div className="brand-name">Swarm Builder · Site institucional</div>
              <div className="brand-sub">páginas conectadas por um layout compartilhado</div>
            </div>
          </div>
          <div className="topbar-meta">
            <ModeToggle mode="site" onChange={onModeChange} />
            <span className="phase">{status}</span>
            <span className="dot-live" />
            <span>site</span>
          </div>
        </header>
        <main className="site-brief">
          <div className="panel site-brief-card">
            <div className="panel-head">
              <span>Brief do site</span>
              <span className="hint">a IA propõe o mapa; você revisa antes do build</span>
            </div>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} spellCheck={false} />
            <label className="field-label">Marca / nome do site</label>
            <input value={brand} onChange={(event) => setBrand(event.target.value)} />
            <button className="primary" type="button" onClick={planSite} disabled={phase === "planning" || prompt.trim().length < 10}>
              {phase === "planning" ? "Planejando site…" : "Planejar site"}
            </button>
            {error && <div className="error">{error}</div>}
          </div>
        </main>
      </div>
    );
  }

  if (phase === "map" && site?.plan) {
    return (
      <div className="shell site-shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">S</div>
            <div>
              <div className="brand-name">Swarm Builder · Site institucional</div>
              <div className="brand-sub">revise o mapa antes de construir</div>
            </div>
          </div>
          <div className="topbar-meta">
            <ModeToggle mode="site" onChange={onModeChange} />
            <span className="phase">{status}</span>
            <span className="dot-live" />
            <span>{site.plan.pages.length} páginas</span>
          </div>
        </header>
        <main className="site-map">
          <div className="panel site-map-panel">
            <div className="panel-head">
              <span>Mapa do site</span>
              <span className="hint">título, slug, papel e ordem</span>
            </div>
            {site.plan.pages.map((page, index) => (
              <div className="site-map-page" key={index}>
                <div className="site-map-index">{String(index + 1).padStart(2, "0")}</div>
                <div className="site-map-fields">
                  <input value={page.title} onChange={(event) => updatePlanPage(index, { title: event.target.value })} />
                  <input value={page.slug} onChange={(event) => updatePlanPage(index, { slug: event.target.value })} />
                  <select value={page.role} onChange={(event) => updatePlanPage(index, { role: event.target.value as SitePageRole })}>
                    {(Object.keys(ROLE_LABEL) as SitePageRole[]).map((role) => (
                      <option key={role} value={role}>{ROLE_LABEL[role]}</option>
                    ))}
                  </select>
                  <input
                    className="site-map-description"
                    value={page.description}
                    onChange={(event) => updatePlanPage(index, { description: event.target.value })}
                    placeholder="Descrição da página"
                  />
                </div>
                <div className="site-map-actions">
                  <button type="button" className="ghost" onClick={() => movePlanPage(index, -1)} disabled={index === 0}>↑</button>
                  <button type="button" className="ghost" onClick={() => movePlanPage(index, 1)} disabled={index === site.plan!.pages.length - 1}>↓</button>
                  <button type="button" className="ghost" onClick={() => removePlanPage(index)} disabled={site.plan!.pages.length <= 2}>×</button>
                </div>
              </div>
            ))}
            <button type="button" className="ghost" onClick={addPlanPage} disabled={site.plan!.pages.length >= 6}>+ Página</button>
            <div className="site-map-summary">
              <b>{site.plan.title}</b>
              <span>{site.plan.tagline}</span>
              <small>Navegação: {site.plan.pages.map((page) => page.title).join(" · ")}</small>
            </div>
            <button className="primary" type="button" onClick={buildSite}>Construir site</button>
            {error && <div className="error">{error}</div>}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="shell site-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-name">Swarm Builder · Site institucional</div>
            <div className="brand-sub">{site?.plan?.title ?? "site"} · {pages.length} páginas</div>
          </div>
        </div>
        <div className="topbar-meta">
          <ModeToggle mode="site" onChange={onModeChange} />
          <span className={`phase phase-${phase === "done" ? "done" : phase === "failed" ? "failed" : phase === "running" ? "running" : ""}`}>{status}</span>
          <span className="dot-live" />
          <span>{site?.stats?.model ?? "runtime"}</span>
        </div>
      </header>

      <nav className="mobile-tabs">
        <button type="button" className="on">Site</button>
      </nav>

      <main className="workspace">
        <section className="panel controls">
          <div className="panel-head">
            <span>Páginas</span>
            <span className="hint">{donePages}/{pages.length} prontas</span>
          </div>
          <div className="site-page-list">
            {pages.map((page) => (
              <button
                key={page.slug}
                type="button"
                className={`site-page-row ${page.slug === activePage?.slug ? "active" : ""} status-${page.status}`}
                onClick={() => setActivePageId(page.slug)}
                disabled={revisionBusy}
              >
                <span className="site-page-dot" />
                <span className="site-page-copy">
                  <b>{page.title}</b>
                  <small>/{page.slug === "home" ? "" : page.slug} · {page.sections} seções · {formatUsd(page.cost)}</small>
                </span>
                <span className="site-page-state">{page.status === "done" ? "pronta" : page.status === "building" ? "ativa" : page.status === "failed" ? "falhou" : "fila"}</span>
              </button>
            ))}
          </div>

          <div className="progress-wrap">
            <div className="progress"><i style={{ width: `${pages.length ? (donePages / pages.length) * 100 : 0}%` }} /></div>
            <div className="progress-label"><span>{donePages} de {pages.length} páginas</span><span>{pages.length ? Math.round((donePages / pages.length) * 100) : 0}%</span></div>
          </div>

          <div className="stats site-stats">
            <div><b>{stats?.pages ?? pages.length}</b><span>páginas</span></div>
            <div><b>{stats?.sections ?? activePlanSections.length}</b><span>seções</span></div>
            <div><b>{stats?.nodes ?? pages.reduce((sum, page) => sum + page.nodes, 0)}</b><span>nós</span></div>
            <div title={formatCents(cost)}><b>{formatUsd(cost)}</b><span>custo</span></div>
            <div><b>{stats?.fallbacks ?? pages.reduce((sum, page) => sum + page.fallbacks, 0)}</b><span>fallbacks</span></div>
            <div><b>{stats?.issues ?? 0}</b><span>issues</span></div>
          </div>

          <div className="sections">
            <div className="panel-head">
              <span>Seções da página</span>
              <button className="log-toggle" type="button" onClick={() => {
                setNewSectionPrompt("");
                setNewSectionTitle("");
                setNewSectionKind("auto");
                setNewSectionIndex(activePlanSections.length);
                setNewSectionQuality("solo");
                setAddOpen(true);
              }} disabled={!activePage || revisionBusy}>+ Seção</button>
            </div>
            {activePlanSections.map((section, index) => (
              <div className="section-row" key={section.id}>
                <span className="section-index">{String(index + 1).padStart(2, "0")}</span>
                <div className="section-copy">
                  <span className="section-title">{section.title}</span>
                  <span className="section-kind">{section.kind}</span>
                </div>
                <span className="section-state">{activePage?.status === "done" ? "pronta" : activePage?.status ?? "fila"}</span>
              </div>
            ))}
          </div>

          <div className="site-actions">
            <button className="ghost" type="button" onClick={() => void refreshSite(site?.id ?? "")} disabled={!site?.id}>Atualizar</button>
            <a className="ghost download-link" href={site?.id ? `/api/sites/${site.id}/export` : "#"} download>Exportar ZIP</a>
            <button className="ghost" type="button" onClick={() => setPhase("map")} disabled={revisionBusy}>Editar mapa</button>
          </div>
          {error && <div className="error">{error}</div>}
        </section>

        <section className="panel preview-panel">
          <div className="preview-head">
            <div>
              <span className="panel-title">Preview do site</span>
              <span className="hint">{activePage ? `${activePage.title} · ${activePage.slug}` : "aguardando build"}</span>
            </div>
            <div className="preview-actions">
              <div className="device-toggle">
                {DEVICES.map((item) => (
                  <button key={item} type="button" className={device === item ? "on" : ""} onClick={() => setDevice(item)}>
                    {item === "desktop" ? "Desktop" : item === "mobile" ? "Mobile" : "Tablet"}
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
                  const agent = activeAgents.find((candidate) => candidate.id === value);
                  if (agent) {
                    setSelectedPageId(agent.pageId === "shared" ? "shared" : agent.pageId ?? activePage?.slug ?? "");
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
                disabled={!activePage?.html || revisionBusy}
              >
                <option value="">Editar por agente…</option>
                {activeAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name} · {agent.sectionId}{agent.pageId === "shared" ? " · layout" : ""}</option>
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
                disabled={!activePage?.html || revisionBusy}
              >
                {selectMode ? "Clique em um elemento" : "Selecionar"}
              </button>
              {undoAvailable && <button className="tour-toggle" type="button" onClick={undo} disabled={revisionBusy}>Desfazer</button>}
              {revisionBusy && <span className="badge badge-running">aplicando</span>}
              <span className={`badge badge-${phase === "done" ? "done" : phase === "failed" ? "failed" : "running"}`}>
                {phase === "running" ? "gerando" : phase === "done" ? "pronto" : phase === "failed" ? "erro" : "idle"}
              </span>
            </div>
          </div>
          <div className="site-page-tabs">
            {pages.map((page) => (
              <button key={page.slug} type="button" className={page.slug === activePage?.slug ? "on" : ""} onClick={() => setActivePageId(page.slug)} disabled={revisionBusy}>
                {page.title}
              </button>
            ))}
          </div>
          <div className="preview-stage">
            {activePage?.html ? (
              <SitePreview
                ref={previewRef}
                pageId={activePage.slug}
                html={activePage.html}
                selectMode={selectMode}
                highlight={highlight}
                device={device}
                onNavigate={(href) => {
                  const slug = hrefToSlug(href, pages);
                  if (slug) setActivePageId(slug);
                }}
              />
            ) : (
              <div className="preview-empty">
                <div className="orbit">
                  <span className="cursor c1" />
                  <span className="cursor c2" />
                  <span className="cursor c3" />
                  <span className="cursor c4" />
                </div>
                <h2>{phase === "running" ? "O swarm está construindo o site" : "O site ainda não foi construído"}</h2>
                <p>O layout compartilhado e as páginas aparecem aqui conforme os agentes terminam.</p>
              </div>
            )}
          </div>
        </section>

        <section className="panel log-panel">
          <div className="panel-head"><span>Eventos do site</span><span className="hint">{events.length} eventos</span></div>
          <div className="log">
            {recentEvents.length ? recentEvents.map((event, index) => (
              <div className="log-row" key={`${index}-${event.type}`}>
                <span className="log-type">{event.type}</span>
                <span className="log-text">{event.type === "site.page.started" || event.type === "site.page.done" ? (event.type === "site.page.started" ? event.pageId : event.page.slug) : ""}</span>
              </div>
            )) : <div className="empty">Nenhum evento ainda.</div>}
          </div>
        </section>
      </main>

      {addOpen && (
        <div className="modal-backdrop" onMouseDown={() => setAddOpen(false)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="panel-head"><span>Adicionar seção em {activePage?.title}</span><button className="log-toggle" type="button" onClick={() => setAddOpen(false)}>Fechar</button></div>
            <label className="field-label">Posição</label>
            <select value={newSectionIndex} onChange={(event) => setNewSectionIndex(Number(event.target.value))}>
              <option value={0}>No início</option>
              {activePlanSections.map((section, index) => <option key={section.id} value={index + 1}>Depois de {section.title}</option>)}
            </select>
            <label className="field-label">Título (opcional)</label>
            <input value={newSectionTitle} onChange={(event) => setNewSectionTitle(event.target.value)} />
            <label className="field-label">O que essa seção deve ter?</label>
            <textarea className="revision-input" value={newSectionPrompt} onChange={(event) => setNewSectionPrompt(event.target.value)} rows={4} />
            <div className="modal-row">
              <div><label className="field-label">Tipo</label><select value={newSectionKind} onChange={(event) => setNewSectionKind(event.target.value as SectionKind | "auto")}><option value="auto">Auto</option>{["hero", "features", "showcase", "testimonials", "cta", "custom"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></div>
              <div><label className="field-label">Qualidade</label><select value={newSectionQuality} onChange={(event) => setNewSectionQuality(event.target.value as "solo" | "split" | "race")}><option value="solo">Solo</option><option value="split">Split</option><option value="race">Race</option></select></div>
            </div>
            <div className="modal-actions"><button className="primary small" type="button" onClick={addSection} disabled={revisionBusy || newSectionPrompt.trim().length < 3}>Adicionar seção</button><button className="ghost" type="button" onClick={() => setAddOpen(false)}>Cancelar</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
