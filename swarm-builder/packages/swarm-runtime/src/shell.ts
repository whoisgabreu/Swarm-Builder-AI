const CURSOR_PATH =
  "M4.6 3.9 C4.2 3.1 4.9 2.4 5.7 2.8 L20.6 9.4 C21.5 9.8 21.4 11.1 20.4 11.3 L13.9 12.9 C13.4 13 13 13.4 12.9 13.9 L11.3 20.4 C11.1 21.4 9.8 21.5 9.4 20.6 Z";

export const PREVIEW_SHELL = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Swarm preview</title>
<style>
html,body{margin:0;min-height:100%;background:#0b0b0f;color:#f5f3ef;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
#swarm-page{min-height:100vh}
#swarm-page-style{display:none}
#swarm-overlay{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:2147483647}
.sw-cursor{position:absolute;left:0;top:0;opacity:0;will-change:transform;transition:transform .62s cubic-bezier(.2,.8,.2,1),opacity .28s ease;transform:translate3d(0,0,0)}
.sw-cursor .sw-float{position:relative;animation:swFloat 2.5s ease-in-out infinite}
.sw-cursor svg{display:block;overflow:visible;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35));transform:translate(-4px,-3px)}
.sw-cursor-label{position:absolute;left:19px;top:19px;padding:2px 6px;border-radius:4px;color:#fff;font:650 10px/16px Inter,system-ui,sans-serif;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.24)}
.sw-cursor.thinking::after{content:"";position:absolute;left:6px;top:6px;width:20px;height:20px;border-radius:50%;border:1.5px solid var(--sw-color,#0D99FF);opacity:.5;animation:swPulse 1.5s ease-out infinite;pointer-events:none}
.sw-cursor.done{opacity:.35}
.sw-cursor.done .sw-float,.sw-cursor.failed .sw-float,.sw-cursor.discarded .sw-float{animation:none}
.sw-cursor.failed .sw-cursor-label{background:#F24822!important}
.sw-cursor.discarded{opacity:0!important;transition:opacity .55s ease}
.sw-outline.fixing{border-color:#F24822;box-shadow:0 0 0 4px rgba(242,72,34,.16)}
.sw-outline.fixed{border-color:#14AE5C;box-shadow:0 0 0 4px rgba(20,174,92,.16)}
.sw-selected{outline:2px solid #0D99FF!important;outline-offset:2px!important}
.sw-composer{position:absolute;width:310px;max-width:calc(100% - 24px);padding:12px;border-radius:12px;background:rgba(22,22,28,.98);border:1px solid #3a3a46;box-shadow:0 18px 50px rgba(0,0,0,.45);pointer-events:auto;color:#f4f2ee;font:12px/1.45 Inter,system-ui,sans-serif;z-index:10}
.sw-composer-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.sw-composer-dot{width:8px;height:8px;border-radius:50%;flex:none}
.sw-composer-owner{font-weight:650;color:#e9e7ec;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sw-composer-role{margin-left:auto;font-size:9px;color:#8d8b95;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap}
.sw-composer textarea{width:100%;min-height:66px;padding:9px;border-radius:8px;border:1px solid #33333f;background:#0d0d12;color:#f3f1ee;font:11px/1.5 Inter,system-ui,sans-serif;resize:vertical;outline:none}
.sw-composer textarea:focus{border-color:rgba(198,242,78,.5);box-shadow:0 0 0 3px rgba(198,242,78,.08)}
.sw-composer-actions{display:flex;align-items:center;gap:7px;margin-top:8px}
.sw-composer button{padding:7px 10px;border-radius:8px;border:1px solid #33333f;background:#1a1a21;color:#d7d5db;font:600 10px/1 Inter,system-ui,sans-serif;cursor:pointer}
.sw-composer button.primary{background:#c6f24e;border-color:#c6f24e;color:#0b0d06}
.sw-composer button:disabled{opacity:.55;cursor:not-allowed}
.sw-composer-status{margin-left:auto;font-size:9px;color:#8d8b95}
.sw-composer-error{margin-top:7px;font-size:10px;line-height:1.4;color:#ff9d85}
.sw-composer-confirm{margin-top:8px;padding-top:8px;border-top:1px solid #33333f;font-size:10px;line-height:1.5;color:#d7d5db}
.sw-composer-confirm b{display:block;margin-bottom:4px;color:#f4f2ee}
.sw-composer-confirm-list{max-height:64px;overflow:auto;color:#8d8b95;font-family:ui-monospace,monospace;font-size:9px;margin-bottom:6px;word-break:break-word}
.sw-composer-confirm button{background:#c6f24e;border-color:#c6f24e;color:#0b0d06}
.sw-agent-highlight{outline:2px dashed #FFC700!important;outline-offset:2px!important}
@keyframes swFloat{0%,100%{transform:translate(0,0)}25%{transform:translate(3px,-4px)}50%{transform:translate(-2px,3px)}75%{transform:translate(-3px,-2px)}}
@keyframes swPulse{0%{transform:scale(.7);opacity:.55}100%{transform:scale(1.8);opacity:0}}
.sw-outline{position:absolute;display:none;border:1.5px solid #0D99FF;border-radius:7px;box-shadow:0 0 0 3px rgba(13,153,255,.12);transition:left .35s ease,top .35s ease,width .35s ease,height .35s ease,border-color .25s ease,box-shadow .25s ease}
.sw-outline.done{border-color:#14AE5C;box-shadow:0 0 0 3px rgba(20,174,92,.12)}
.sw-outline.failed{border-color:#F24822;box-shadow:0 0 0 3px rgba(242,72,34,.12)}
.sw-toast{position:absolute;left:50%;bottom:22px;transform:translate(-50%,14px);opacity:0;padding:9px 13px;border-radius:10px;background:rgba(22,22,28,.96);border:1px solid #2c2c36;color:#e9e7ec;font:560 11px/16px Inter,system-ui,sans-serif;white-space:nowrap;box-shadow:0 14px 36px rgba(0,0,0,.35);transition:opacity .3s ease,transform .35s cubic-bezier(.2,.8,.2,1);backdrop-filter:blur(12px)}
.sw-toast.on{opacity:1;transform:translate(-50%,0)}
.sw-toast b{color:#c6f24e;font-weight:700}
</style>
</head>
<body>
<div id="swarm-page"></div>
<style id="swarm-page-style"></style>
<div id="swarm-overlay"></div>
<script>
(function(){
  "use strict";
  var root = document.getElementById("swarm-page");
  var styleEl = document.getElementById("swarm-page-style");
  var overlay = document.getElementById("swarm-overlay");
  var agents = Object.create(null);
  var active = Object.create(null);
  var cursors = Object.create(null);
  var outline = null;
  var toastEl = null;
  var toastTimer = null;
  var tourEnabled = true;
  var tourPausedUntil = 0;
  var lastFollow = 0;
  var nodeEls = Object.create(null);
  var renderQueues = [];
  var activeQueues = 0;
  var pendingSync = null;
  var pendingDone = null;
  var renderBusy = false;
  var renderGeneration = 0;
  var selectMode = false;
  var uiScale = 1;
  var selectedNode = null;
  var selectedNodes = [];
  var highlightedNodes = [];
  var composer = null;
  var composerNodeId = null;
  var composerNodeIds = [];
  var composerOwnerLabels = [];
  var composerAgentId = null;
  var composerConfirmed = false;
  var composerAnchor = null;
  var composerBusy = false;
  var composerOpen = false;
  var MAX_QUEUES = 2;
  function sleep(ms) {
    return new Promise(function(resolve){ setTimeout(resolve, ms); });
  }

  function notifyParent(type, extra) {
    var payload = { source: "swarm-preview", type: type };
    if (extra) {
      Object.keys(extra).forEach(function(key){ payload[key] = extra[key]; });
    }
    window.parent.postMessage(payload, "*");
  }

  function ensureOutline() {
    if (outline) return outline;
    outline = document.createElement("div");
    outline.className = "sw-outline";
    overlay.appendChild(outline);
    return outline;
  }

  function ensureToast() {
    if (toastEl) return toastEl;
    toastEl = document.createElement("div");
    toastEl.className = "sw-toast";
    overlay.appendChild(toastEl);
    return toastEl;
  }

  function toast(html) {
    var el = ensureToast();
    el.innerHTML = html;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ el.classList.remove("on"); }, 3200);
  }

  function ensureCursor(agent) {
    if (cursors[agent.id]) return cursors[agent.id];
    var el = document.createElement("div");
    el.className = "sw-cursor";
    el.style.setProperty("--sw-color", agent.color);
    var index = Object.keys(cursors).length;
    var left = index % 2 === 0;
    var startX = left ? -60 : window.innerWidth + 60;
    var startY = window.innerHeight * (0.24 + (index % 5) * 0.11);
    el.style.transform = "translate3d(" + startX + "px," + startY + "px,0)";
    el.innerHTML = '<div class="sw-float"><svg width="28" height="28" viewBox="0 0 28 28"><path d="${CURSOR_PATH}" fill="' + agent.color + '" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg><span class="sw-cursor-label"></span></div>';
    var label = el.querySelector(".sw-cursor-label");
    label.textContent = "pensando";
    label.style.background = agent.color;
    overlay.appendChild(el);
    cursors[agent.id] = el;
    return el;
  }

  function sectionRect(sectionId) {
    var el = document.querySelector('[data-swarm-node="' + sectionId + '"]');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { el: el, x: r.left, y: r.top, w: r.width, h: r.height };
  }

  function moveCursor(agent, sectionId, animate) {
    var rect = sectionRect(sectionId);
    if (!rect) return;
    var existed = !!cursors[agent.id];
    var el = ensureCursor(agent);
    var label = el.querySelector(".sw-cursor-label");
    if (label) {
      label.textContent = "pensando";
      label.style.background = agent.color;
    }
    var same = Object.keys(active).filter(function(id){ return id !== agent.id && active[id] === sectionId; }).length;
    var x = rect.x + Math.min(rect.w * 0.34, 240) + same * 16;
    var y = rect.y + Math.min(rect.h * 0.34, 150) + same * 12;
    var target = "translate3d(" + x + "px," + y + "px,0)";
    el.classList.remove("done", "failed");
    el.classList.add("thinking");
    el.style.opacity = "1";
    if (!existed && animate !== false) {
      void el.offsetWidth;
      requestAnimationFrame(function(){
        requestAnimationFrame(function(){ el.style.transform = target; });
      });
    } else {
      if (animate === false) el.style.transition = "none";
      el.style.transform = target;
      if (animate === false) {
        requestAnimationFrame(function(){ el.style.transition = ""; });
      }
    }
    var o = ensureOutline();
    o.className = "sw-outline";
    o.style.display = "block";
    o.style.left = rect.x + "px";
    o.style.top = rect.y + "px";
    o.style.width = Math.max(0, rect.w - 1) + "px";
    o.style.height = Math.max(0, rect.h - 1) + "px";
    active[agent.id] = sectionId;
  }

  function followSection(sectionId) {
    if (composerOpen || !tourEnabled || Date.now() < tourPausedUntil) return;
    if (Date.now() - lastFollow < 700) return;
    var el = document.querySelector('[data-swarm-node="' + sectionId + '"]');
    if (!el) return;
    var r = el.getBoundingClientRect();
    var margin = 80;
    if (r.top >= margin && r.bottom <= window.innerHeight - margin) return;
    lastFollow = Date.now();
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function markDone(agentId, text) {
    var el = cursors[agentId];
    if (el) {
      el.classList.remove("thinking");
      el.classList.add("done");
      var label = el.querySelector(".sw-cursor-label");
      if (label) label.textContent = text || "pronto";
    }
    if (outline) outline.classList.add("done");
    delete active[agentId];
    setTimeout(function(){
      if (el && el.classList.contains("done")) el.style.opacity = "0.3";
    }, 1100);
  }

  function agentForSection(sectionId) {
    var found = null;
    Object.keys(active).forEach(function(agentId){
      if (active[agentId] === sectionId) found = agentId;
    });
    return found;
  }

  function markFailed(sectionId) {
    var agentId = agentForSection(sectionId);
    if (agentId && cursors[agentId]) {
      var el = cursors[agentId];
      el.classList.remove("thinking");
      el.classList.add("failed");
      var label = el.querySelector(".sw-cursor-label");
      if (label) label.textContent = "falhou";
      delete active[agentId];
    }
    if (outline) {
      outline.classList.add("failed");
      outline.style.display = "block";
      var r = sectionRect(sectionId);
      if (r) {
        outline.style.left = r.x + "px";
        outline.style.top = r.y + "px";
        outline.style.width = Math.max(0, r.w - 1) + "px";
        outline.style.height = Math.max(0, r.h - 1) + "px";
      }
    }
  }

  function reapply() {
    Object.keys(active).forEach(function(agentId){
      var agent = agents[agentId];
      if (agent) moveCursor(agent, active[agentId], false);
    });
  }

  function applyHtml(html) {
    if (!html) return;
    try {
      Array.prototype.forEach.call(document.querySelectorAll('style[data-swarm-responsive]'), function(el){ el.remove(); });
      var doc = new DOMParser().parseFromString(html, "text/html");
      var style = doc.querySelector("style");
      styleEl.textContent = style ? style.textContent : "";
      doc.querySelectorAll("script").forEach(function(node){ node.remove(); });
      root.innerHTML = doc.body ? doc.body.innerHTML : "";
      nodeEls = Object.create(null);
      Array.prototype.forEach.call(root.querySelectorAll("[data-swarm-node]"), function(el){
        nodeEls[el.getAttribute("data-swarm-node")] = el;
      });
      selectedNodes.forEach(function(id){ if (nodeEls[id]) nodeEls[id].classList.add("sw-selected"); });
      highlightedNodes.forEach(function(id){ if (nodeEls[id]) nodeEls[id].classList.add("sw-agent-highlight"); });
      if (composer) {
        if (composerNodeId && nodeEls[composerNodeId]) positionComposer();
        else closeComposer(false);
      }
      requestAnimationFrame(reapply);
    } catch (error) {
      root.innerHTML = '<pre style="padding:24px;color:#ff9d85;white-space:pre-wrap">' + String(error) + "</pre>";
    }
  }

  function queueSync(html, force) {
    if (!html) return;
    if (force) {
      renderGeneration++;
      renderQueues = [];
      pendingSync = null;
      pendingDone = null;
      renderBusy = false;
      activeQueues = 0;
      applyHtml(html);
      notifyParent("render.drained");
      return;
    }
    if (renderBusy || activeQueues > 0 || renderQueues.length > 0) {
      pendingSync = html;
    } else {
      applyHtml(html);
    }
  }

  function finishRenderIfIdle() {
    if (activeQueues > 0 || renderQueues.length > 0) return;
    renderBusy = false;
    if (pendingSync) {
      var html = pendingSync;
      pendingSync = null;
      applyHtml(html);
    }
    notifyParent("render.drained");
    if (pendingDone) {
      var done = pendingDone;
      pendingDone = null;
      handleDone(done);
    }
  }

  function handleDone(event) {
    active = Object.create(null);
    if (outline) outline.style.display = "none";
    var ids = Object.keys(cursors);
    var cx = window.innerWidth / 2;
    var cy = Math.min(window.innerHeight * 0.34, 320);
    ids.forEach(function(agentId, index){
      var el = cursors[agentId];
      el.classList.remove("thinking");
      el.classList.add("done");
      var angle = (index / Math.max(1, ids.length)) * Math.PI * 2;
      var x = cx + Math.cos(angle) * 78;
      var y = cy + Math.sin(angle) * 48;
      setTimeout(function(){
        el.style.transition = "transform .9s cubic-bezier(.2,.8,.2,1),opacity .6s ease";
        el.style.transform = "translate3d(" + x + "px," + y + "px,0)";
        el.style.opacity = "1";
      }, index * 35);
      setTimeout(function(){ el.style.opacity = "0"; }, 1550 + index * 35);
    });
    var count = event.stats.sections;
    var extra = event.stats.failed ? " · <b>" + event.stats.failed + "</b> com fallback" : "";
    var fixes = event.stats.fixed ? " · <b>" + event.stats.fixed + "</b> correções" : "";
    toast("Página construída por <b>" + count + "</b> agentes em <b>" + (event.stats.durationMs / 1000).toFixed(1) + "s</b>" + extra + fixes);
  }

  function pumpQueues() {
    while (activeQueues < MAX_QUEUES && renderQueues.length > 0) {
      var q = renderQueues.shift();
      activeQueues++;
      playQueue(q).then(function(){
        activeQueues = Math.max(0, activeQueues - 1);
        pumpQueues();
        if (activeQueues === 0 && renderQueues.length === 0) finishRenderIfIdle();
      });
    }
  }

  function enqueueBatch(batch) {
    if (!batch || !batch.ops || !batch.ops.length) return;
    renderBusy = true;
    notifyParent("render.busy");
    renderQueues.push({ batch: batch, index: 0, generation: renderGeneration });
    pumpQueues();
  }

  async function playQueue(queue) {
    for (; queue.index < queue.batch.ops.length; queue.index++) {
      if (queue.generation !== renderGeneration) return;
      await playOp(queue.batch.ops[queue.index], queue.batch.agent, queue.generation);
    }
  }

  function cursorLabel(agent, text) {
    var el = cursors[agent.id];
    if (!el) return;
    var label = el.querySelector(".sw-cursor-label");
    if (label) label.textContent = text;
  }

  function applyResponsive(nodeId, responsive) {
    var existing = document.querySelector('style[data-swarm-responsive="' + nodeId + '"]');
    if (existing) existing.remove();
    if (!responsive) return;
    var css = "";
    if (responsive.mobile) css += '@media(max-width:767px){[data-swarm-node="' + nodeId + '"]{' + responsive.mobile + '}}';
    if (responsive.tablet) css += '@media(min-width:768px) and (max-width:1023px){[data-swarm-node="' + nodeId + '"]{' + responsive.tablet + '}}';
    if (!css) return;
    var style = document.createElement("style");
    style.setAttribute("data-swarm-responsive", nodeId);
    style.textContent = css;
    document.head.appendChild(style);
  }

  function createNode(op) {
    var el = document.createElement(op.tag || "div");
    if (op.className) el.className = op.className;
    el.setAttribute("data-swarm-node", op.nodeId);
    el.setAttribute("style", (op.style || "") + ";opacity:0;transition:opacity .28s ease");
    if (op.attrs) {
      Object.keys(op.attrs).forEach(function(key){
        if (op.attrs[key] != null) el.setAttribute(key, op.attrs[key]);
      });
    }
    var existing = nodeEls[op.nodeId];
    var parent = op.parentId ? nodeEls[op.parentId] : root;
    var before = op.beforeNodeId ? nodeEls[op.beforeNodeId] : null;
    if (existing && existing.parentNode) {
      existing.parentNode.replaceChild(el, existing);
    } else if (before && before.parentNode) {
      before.parentNode.insertBefore(el, before);
    } else if (parent) {
      parent.appendChild(el);
    } else {
      root.appendChild(el);
    }
    nodeEls[op.nodeId] = el;
    if (op.responsive) applyResponsive(op.nodeId, op.responsive);
    return el;
  }

  async function playOp(op, agent, generation) {
    if (generation !== renderGeneration) return;
    var factor = (renderQueues.length + activeQueues > 6) ? 0.45 : 1;
    if (op.op === "create") {
      var created = createNode(op);
      if (agent) {
        moveCursor(agent, op.nodeId, true);
        followSection(op.nodeId);
        cursorLabel(agent, "desenhando");
      }
      await sleep(65 * factor);
      return;
    }
    if (op.op === "reveal") {
      var revealEl = nodeEls[op.nodeId];
      if (revealEl) revealEl.style.opacity = "1";
      await sleep(35 * factor);
      return;
    }
    if (op.op === "text") {
      var textEl = nodeEls[op.nodeId];
      if (!textEl) return;
      if (agent) {
        moveCursor(agent, op.nodeId, true);
        followSection(op.nodeId);
        cursorLabel(agent, "digitando");
      }
      if (op.mode === "set") {
        textEl.textContent = op.text;
        await sleep(45 * factor);
      } else {
        var value = op.text || "";
        textEl.textContent = "";
        var step = Math.max(1, Math.ceil(value.length / 55));
        for (var i = 0; i < value.length; i += step) {
          textEl.textContent += value.slice(i, i + step);
          await sleep(12 * factor);
        }
      }
      return;
    }
    if (op.op === "media") {
      var mediaEl = nodeEls[op.nodeId];
      if (!mediaEl) return;
      if (mediaEl.tagName !== "IMG") {
        var img = document.createElement("img");
        img.className = mediaEl.className;
        img.setAttribute("data-swarm-node", op.nodeId);
        var style = mediaEl.getAttribute("style") || "";
        img.setAttribute("style", style);
        if (mediaEl.parentNode) mediaEl.parentNode.replaceChild(img, mediaEl);
        nodeEls[op.nodeId] = img;
        mediaEl = img;
      }
      if (agent) {
        moveCursor(agent, op.nodeId, true);
        followSection(op.nodeId);
        cursorLabel(agent, "imagem");
      }
      mediaEl.style.opacity = "0";
      mediaEl.src = op.src;
      if (op.alt) mediaEl.alt = op.alt;
      if (op.objectFit) mediaEl.style.objectFit = op.objectFit;
      await sleep(220 * factor);
      mediaEl.style.opacity = "1";
      return;
    }
    if (op.op === "style") {
      var styleEl2 = nodeEls[op.nodeId];
      if (!styleEl2) return;
      if (agent) {
        moveCursor(agent, op.nodeId, true);
        followSection(op.nodeId);
        cursorLabel(agent, "ajustando");
      }
      styleEl2.setAttribute("style", op.style + ";transition:all .2s ease;opacity:1");
      await sleep(90 * factor);
      return;
    }
    if (op.op === "responsive") {
      applyResponsive(op.nodeId, op.responsive);
      await sleep(60 * factor);
      return;
    }
    if (op.op === "remove") {
      var removeEl = nodeEls[op.nodeId];
      if (removeEl && removeEl.parentNode) removeEl.parentNode.removeChild(removeEl);
      delete nodeEls[op.nodeId];
      await sleep(50 * factor);
    }
  }

  function setSelectMode(on) {
    selectMode = !!on;
    document.body.style.cursor = selectMode ? "crosshair" : "";
    if (!selectMode) {
      selectedNodes.forEach(function(id){ if (nodeEls[id]) nodeEls[id].classList.remove("sw-selected"); });
      selectedNodes = [];
      selectedNode = null;
    }
  }

  function selectNode(el, clickX, clickY, additive) {
    var id = el.getAttribute("data-swarm-node");
    if (!id) return;
    if (!additive) {
      selectedNodes = [id];
    } else if (selectedNodes.indexOf(id) >= 0) {
      selectedNodes = selectedNodes.filter(function(item){ return item !== id; });
    } else {
      selectedNodes = selectedNodes.concat([id]);
    }
    Object.keys(nodeEls).forEach(function(nodeId){ nodeEls[nodeId].classList.remove("sw-selected"); });
    selectedNodes.forEach(function(nodeId){ if (nodeEls[nodeId]) nodeEls[nodeId].classList.add("sw-selected"); });
    if (!selectedNodes.length) {
      selectedNode = null;
      closeComposer(true);
      return;
    }
    selectedNode = id;
    var rect = el.getBoundingClientRect();
    notifyParent("node.selected", {
      nodeId: id,
      nodeIds: selectedNodes.slice(),
      clickX: clickX,
      clickY: clickY,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    });
  }

  function highlightNodes(ids) {
    highlightedNodes.forEach(function(id){ if (nodeEls[id]) nodeEls[id].classList.remove("sw-agent-highlight"); });
    highlightedNodes = Array.isArray(ids) ? ids : [];
    highlightedNodes.forEach(function(id){ if (nodeEls[id]) nodeEls[id].classList.add("sw-agent-highlight"); });
  }

  function updateComposerHead() {
    if (!composer) return;
    var owner = composer.querySelector(".sw-composer-owner");
    var role = composer.querySelector(".sw-composer-role");
    var dot = composer.querySelector(".sw-composer-dot");
    var count = composerNodeIds.length;
    if (owner) owner.textContent = count > 1 ? count + " elementos selecionados" : (composerOwnerLabels[0] || "Agente da seção");
    if (role) role.textContent = count > 1 ? composerOwnerLabels.slice(0, 3).join(", ") : (composerOwnerLabels[0] ? "" : "");
    if (dot) dot.style.background = "#0D99FF";
  }

  function applyUiScale() {
    if (!composer) return;
    composer.style.transformOrigin = "top left";
    composer.style.transform = "scale(" + uiScale + ")";
  }

  function positionComposer() {
    if (!composer || !composerNodeId) return;
    var el = nodeEls[composerNodeId];
    if (!el) {
      closeComposer(false);
      return;
    }
    var rect = el.getBoundingClientRect();
    var width = (composer.offsetWidth || 310) * uiScale;
    var height = (composer.offsetHeight || 150) * uiScale;
    var anchor = composerAnchor || { dx: 24, dy: 24 };
    var x = rect.left + anchor.dx;
    var y = rect.top + anchor.dy + 12;
    x = Math.max(12, Math.min(x, window.innerWidth - width - 12));
    if (y + height > window.innerHeight - 12) y = rect.top + anchor.dy - height - 10;
    y = Math.max(12, Math.min(y, window.innerHeight - height - 12));
    composer.style.left = x + "px";
    composer.style.top = y + "px";
  }

  function closeComposer(notify) {
    if (!composer) return;
    composer.remove();
    composer = null;
    composerNodeId = null;
    composerNodeIds = [];
    composerOwnerLabels = [];
    composerAgentId = null;
    composerConfirmed = false;
    composerAnchor = null;
    composerBusy = false;
    composerOpen = false;
    if (notify) {
      selectedNodes.forEach(function(id){ if (nodeEls[id]) nodeEls[id].classList.remove("sw-selected"); });
      selectedNodes = [];
      selectedNode = null;
      notifyParent("composer.cancel");
    }
  }

  function composerError(message) {
    if (!composer) {
      toast(message);
      return;
    }
    composerBusy = false;
    composerOpen = true;
    var textarea = composer.querySelector("textarea");
    var buttons = composer.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = false;
    if (textarea) textarea.disabled = false;
    var status = composer.querySelector(".sw-composer-status");
    if (status) status.textContent = "";
    var error = composer.querySelector(".sw-composer-error");
    if (error) {
      error.textContent = message || "Não foi possível aplicar a alteração.";
      error.style.display = "block";
    }
  }

  function showComposerConfirm() {
    if (!composer) return;
    var box = composer.querySelector(".sw-composer-confirm");
    if (!box) return;
    box.innerHTML = '<b>Aplicar a ' + composerNodeIds.length + ' elementos?</b><div class="sw-composer-confirm-list"></div><button type="button" data-act="confirm">Confirmar aplicação</button>';
    var list = box.querySelector(".sw-composer-confirm-list");
    list.textContent = composerNodeIds.join(", ");
    box.querySelector('[data-act="confirm"]').addEventListener("click", function(){ submitComposer(true); });
    box.style.display = "block";
    positionComposer();
  }

  function submitComposer(force) {
    if (!composer || composerBusy) return;
    if (composerNodeIds.length > 1 && !force) {
      composerConfirmed = false;
      showComposerConfirm();
      return;
    }
    var textarea = composer.querySelector("textarea");
    var value = textarea ? textarea.value.trim() : "";
    if (!value) {
      if (textarea) textarea.focus();
      return;
    }
    composerBusy = true;
    if (textarea) textarea.disabled = true;
    var buttons = composer.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;
    var status = composer.querySelector(".sw-composer-status");
    if (status) status.textContent = "aplicando…";
    var error = composer.querySelector(".sw-composer-error");
    if (error) error.style.display = "none";
    notifyParent("revision.request", {
      nodeIds: composerAgentId ? undefined : composerNodeIds.slice(),
      agentId: composerAgentId || undefined,
      request: value,
    });
  }

  function applyExpand(matches) {
    if (!composer || !Array.isArray(matches)) return;
    for (var i = 0; i < matches.length; i++) {
      var id = matches[i] && matches[i].nodeId;
      if (!id) continue;
      if (composerNodeIds.indexOf(id) < 0) composerNodeIds.push(id);
      if (matches[i].ownerName && composerOwnerLabels.indexOf(matches[i].ownerName) < 0) {
        composerOwnerLabels.push(matches[i].ownerName);
      }
      if (nodeEls[id]) nodeEls[id].classList.add("sw-selected");
    }
    selectedNodes = composerNodeIds.slice();
    selectedNode = composerNodeIds[composerNodeIds.length - 1] || null;
    updateComposerHead();
    var status = composer.querySelector(".sw-composer-status");
    if (status) status.textContent = matches.length + " ocorrência(s) adicionada(s)";
    positionComposer();
    notifyParent("selection.changed", { nodeIds: composerNodeIds.slice() });
  }

  function openComposer(data) {
    if (!data || !data.nodeId) return;
    var ids = data.nodeIds && data.nodeIds.length ? data.nodeIds.slice() : [data.nodeId];
    var labels = data.ownerLabels && data.ownerLabels.length ? data.ownerLabels.slice() : (data.agentName ? [data.agentName] : []);
    if (composer) {
      composerNodeIds = ids;
      composerNodeId = ids[ids.length - 1];
      composerOwnerLabels = labels;
      composerAgentId = data.agentId || null;
      var elExisting = nodeEls[composerNodeId];
      if (elExisting) {
        var rectExisting = elExisting.getBoundingClientRect();
        var clickXExisting = typeof data.clickX === "number" ? data.clickX : rectExisting.left + 24;
        var clickYExisting = typeof data.clickY === "number" ? data.clickY : rectExisting.top + 24;
        composerAnchor = { dx: clickXExisting - rectExisting.left, dy: clickYExisting - rectExisting.top };
      }
      applyUiScale();
      updateComposerHead();
      positionComposer();
      return;
    }
    closeComposer(false);
    var el = nodeEls[data.nodeId] || nodeEls[ids[0]];
    if (!el) return;
    composerNodeIds = ids;
    composerNodeId = ids[ids.length - 1];
    composerOwnerLabels = labels;
    composerAgentId = data.agentId || null;
    var rect = el.getBoundingClientRect();
    var clickX = typeof data.clickX === "number" ? data.clickX : rect.left + 24;
    var clickY = typeof data.clickY === "number" ? data.clickY : rect.top + 24;
    composerAnchor = { dx: clickX - rect.left, dy: clickY - rect.top };

    var box = document.createElement("div");
    box.className = "sw-composer";
    box.innerHTML = '<div class="sw-composer-head"><span class="sw-composer-dot"></span><span class="sw-composer-owner"></span><span class="sw-composer-role"></span></div>' +
      '<textarea placeholder="O que você quer mudar?"></textarea>' +
      '<div class="sw-composer-actions"><button class="primary" type="button" data-act="apply">Aplicar</button><button type="button" data-act="expand">Buscar iguais</button><button type="button" data-act="cancel">Cancelar</button><span class="sw-composer-status"></span></div>' +
      '<div class="sw-composer-confirm" style="display:none"></div>' +
      '<div class="sw-composer-error" style="display:none"></div>';
    overlay.appendChild(box);
    composer = box;
    composerOpen = true;
    composerBusy = false;
    applyUiScale();
    if (composerAgentId) {
      var expandButton = box.querySelector('[data-act="expand"]');
      if (expandButton) expandButton.style.display = "none";
    }
    updateComposerHead();
    var textarea = box.querySelector("textarea");
    textarea.addEventListener("keydown", function(event){
      if (event.key === "Escape") {
        event.preventDefault();
        closeComposer(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        submitComposer(false);
      }
    });
    box.querySelector('[data-act="cancel"]').addEventListener("click", function(){ closeComposer(true); });
    box.querySelector('[data-act="apply"]').addEventListener("click", function(){ submitComposer(false); });
    box.querySelector('[data-act="expand"]').addEventListener("click", function(){
      var status = composer.querySelector(".sw-composer-status");
      if (status) status.textContent = "buscando…";
      notifyParent("selection.expand", { nodeIds: composerNodeIds.slice() });
    });
    box.addEventListener("click", function(event){ event.stopPropagation(); });
    positionComposer();
    textarea.focus();
  }

  function openComposerForAgent(data) {
    if (!data || !data.sectionId) return;
    var el = nodeEls[data.sectionId] || document.querySelector('[data-swarm-node="' + data.sectionId + '"]');
    if (!el) return;
    var rect = el.getBoundingClientRect();
    openComposer({
      nodeId: data.sectionId,
      nodeIds: [data.sectionId],
      agentId: data.agentId,
      clickX: rect.left + 24,
      clickY: rect.top + 24,
      agentName: data.agentName,
      agentColor: data.agentColor,
      agentRole: data.agentRole,
      ownerLabels: data.agentName ? [data.agentName] : [],
    });
  }

  document.addEventListener("click", function(event){
    if (selectMode) return;
    var target = event.target;
    var link = target && target.closest ? target.closest('a[href^="#"]') : null;
    if (!link) return;
    var href = link.getAttribute("href") || "";
    if (href.length <= 1) return;
    var anchor = null;
    try { anchor = document.querySelector(href); } catch (_) { anchor = null; }
    if (!anchor) return;
    event.preventDefault();
    anchor.scrollIntoView({ behavior: "smooth", block: "start" });
    try { history.replaceState(null, "", href); } catch (_) {}
  }, true);

  document.addEventListener("click", function(event){
    var target = event.target;
    var nodeEl = target && target.closest ? target.closest("[data-swarm-node]") : null;
    if (composer && target && target.closest && !target.closest(".sw-composer") && !(selectMode && nodeEl)) closeComposer(true);
    if (!selectMode) return;
    var el = nodeEl;
    if (!el) return;
    if (target.closest(".sw-composer")) return;
    event.preventDefault();
    event.stopPropagation();
    selectNode(el, event.clientX, event.clientY, event.ctrlKey || event.metaKey || event.shiftKey);
  }, true);

  function clearSwarm() {
    Array.prototype.forEach.call(document.querySelectorAll('style[data-swarm-responsive]'), function(el){ el.remove(); });
    overlay.innerHTML = "";
    agents = Object.create(null);
    active = Object.create(null);
    cursors = Object.create(null);
    outline = null;
    toastEl = null;
    nodeEls = Object.create(null);
    renderQueues = [];
    activeQueues = 0;
    pendingSync = null;
    pendingDone = null;
    renderBusy = false;
    setSelectMode(false);
    highlightedNodes = [];
    selectedNode = null;
    selectedNodes = [];
    closeComposer(false);
  }

  window.addEventListener("message", function(message){
    var data = message.data;
    if (!data || data.source !== "swarm-studio") return;
    if (data.control) {
      if (typeof data.control.tour === "boolean") tourEnabled = data.control.tour;
      if (typeof data.control.select === "boolean") {
        setSelectMode(data.control.select);
        if (!data.control.select && composer) closeComposer(true);
      }
      if (Array.isArray(data.control.highlightNodes)) highlightNodes(data.control.highlightNodes);
      if (typeof data.control.uiScale === "number" && isFinite(data.control.uiScale)) {
        uiScale = Math.max(0.25, Math.min(4, data.control.uiScale));
        applyUiScale();
        positionComposer();
      }
      if (data.control.composer) openComposer(data.control.composer);
      if (data.control.composerForAgent) openComposerForAgent(data.control.composerForAgent);
      if (typeof data.control.composerError === "string") composerError(data.control.composerError);
      if (data.control.composerExpand) applyExpand(data.control.composerExpand);
      return;
    }
    if (!data.event) return;
    var event = data.event;
    if (event.type === "plan.ready") {
      clearSwarm();
      event.agents.forEach(function(agent){ agents[agent.id] = agent; });
      return;
    }
    if (event.type === "task.started") {
      agents[event.agent.id] = event.agent;
      moveCursor(event.agent, event.sectionId, true);
      followSection(event.sectionId);
      if (event.label) cursorLabel(event.agent, event.label);
      return;
    }
    if (event.type === "patch.applied") {
      markDone(event.agentId, event.label || (event.fallback ? "fallback" : "pronto"));
      return;
    }
    if (event.type === "task.failed") {
      markFailed(event.sectionId);
      return;
    }
    if (event.type === "task.fallback") {
      toast("Seção <b>" + event.sectionId + "</b> usando fallback");
      return;
    }
    if (event.type === "audit.ready") {
      if (event.available && event.issues > 0) toast("Auditoria de layout: <b>" + event.issues + "</b> problema(s)");
      return;
    }
    if (event.type === "variant.started") return;
    if (event.type === "variant.selected") {
      var selected = cursors[event.agent.id];
      if (selected) {
        selected.classList.remove("thinking");
        selected.classList.add("done");
        var selectedLabel = selected.querySelector(".sw-cursor-label");
        if (selectedLabel) selectedLabel.textContent = "escolhido";
      }
      return;
    }
    if (event.type === "variant.discarded") {
      var discarded = cursors[event.agent.id];
      if (discarded) {
        discarded.classList.remove("thinking");
        discarded.classList.add("discarded");
        var discardedLabel = discarded.querySelector(".sw-cursor-label");
        if (discardedLabel) discardedLabel.textContent = "descartado";
      }
      delete active[event.agent.id];
      return;
    }
    if (event.type === "critic.issue") {
      var issueRect = event.nodeId ? sectionRect(event.nodeId) : null;
      if (issueRect) {
        var issueOutline = ensureOutline();
        issueOutline.className = "sw-outline fixing";
        issueOutline.style.display = "block";
        issueOutline.style.left = issueRect.x + "px";
        issueOutline.style.top = issueRect.y + "px";
        issueOutline.style.width = Math.max(0, issueRect.w - 1) + "px";
        issueOutline.style.height = Math.max(0, issueRect.h - 1) + "px";
      }
      return;
    }
    if (event.type === "fix.started") {
      if (!event.nodeId) return;
      moveCursor(event.agent, event.nodeId, true);
      followSection(event.sectionId || event.nodeId);
      var fixCursor = cursors[event.agent.id];
      if (fixCursor) {
        var fixLabel = fixCursor.querySelector(".sw-cursor-label");
        if (fixLabel) fixLabel.textContent = "corrigindo";
        fixCursor.classList.add("thinking");
      }
      return;
    }
    if (event.type === "fix.applied") {
      var fixedCursor = cursors[event.agent.id];
      if (fixedCursor) {
        fixedCursor.classList.remove("thinking");
        fixedCursor.classList.add("done");
        var fixedLabel = fixedCursor.querySelector(".sw-cursor-label");
        if (fixedLabel) fixedLabel.textContent = "corrigido";
      }
      if (outline) outline.className = "sw-outline fixed";
      return;
    }
    if (event.type === "fix.done") {
      var doneCursor = cursors[event.agentId];
      if (doneCursor) {
        doneCursor.classList.remove("thinking");
        doneCursor.classList.add("done");
        var doneLabel = doneCursor.querySelector(".sw-cursor-label");
        if (doneLabel) doneLabel.textContent = event.success ? "corrigido" : "falhou";
        if (event.success) {
          setTimeout(function(){ doneCursor.style.opacity = "0"; }, 900);
        }
      }
      delete active[event.agentId];
      return;
    }
    if (event.type === "render.ops") {
      enqueueBatch(event.batch);
      return;
    }
    if (event.type === "preview.sync" || event.type === "preview.updated") {
      queueSync(event.html, !!event.force);
      return;
    }
    if (event.type === "critique.ready") {
      queueSync(event.html);
      toast("Revisão: <b>" + event.issues + "</b> problema(s) · <b>" + event.fixed + "</b> corrigido(s)");
      return;
    }
    if (event.type === "critique.verified") {
      toast("Auditoria final: <b>" + event.remaining + "</b> problema(s) restante(s)");
      return;
    }
    if (event.type === "section.add.done") {
      if (event.sectionId) {
        Object.keys(cursors).forEach(function(agentId){
          var agent = agents[agentId];
          if (!agent || agent.sectionId !== event.sectionId) return;
          var el = cursors[agentId];
          el.classList.remove("thinking");
          el.classList.add(event.success ? "done" : "failed");
          var label = el.querySelector(".sw-cursor-label");
          if (label) label.textContent = event.success ? "seção pronta" : "falhou";
          setTimeout(function(){ el.style.opacity = "0"; }, 1200);
          delete active[agentId];
        });
      }
      toast(event.success ? "Seção adicionada: <b>" + event.summary + "</b>" : "Falha ao adicionar seção: " + event.summary);
      return;
    }
    if (event.type === "run.done") {
      if (renderBusy || activeQueues > 0 || renderQueues.length > 0) pendingDone = event;
      else handleDone(event);
      return;
    }
    if (event.type === "run.failed") {
      toast("Build interrompido: " + event.message);
      return;
    }
    if (event.type === "revision.started") {
      agents[event.agent.id] = event.agent;
      if (composer) {
        var composerStatus = composer.querySelector(".sw-composer-status");
        if (composerStatus) composerStatus.textContent = "aplicando…";
      }
      if (event.nodeId) {
        moveCursor(event.agent, event.nodeId, true);
        cursorLabel(event.agent, "revisando");
        followSection(event.sectionId || event.nodeId);
      }
      return;
    }
    if (event.type === "revision.applied") {
      var revisionCursor = cursors[event.agent.id];
      if (revisionCursor) {
        revisionCursor.classList.remove("thinking");
        revisionCursor.classList.add("done");
        var revisionLabel = revisionCursor.querySelector(".sw-cursor-label");
        if (revisionLabel) revisionLabel.textContent = "revisado";
      }
      return;
    }
    if (event.type === "revision.done") {
      if (composer) {
        if (event.success) closeComposer(false);
        else composerError(event.summary || "A alteração falhou.");
      }
      if (event.agentId) {
        var reviseCursor = cursors[event.agentId];
        if (reviseCursor) {
          reviseCursor.classList.remove("thinking");
          reviseCursor.classList.add("done");
          var reviseLabel = reviseCursor.querySelector(".sw-cursor-label");
          if (reviseLabel) reviseLabel.textContent = event.success ? "revisado" : "falhou";
          if (event.success) setTimeout(function(){ reviseCursor.style.opacity = "0"; }, 900);
        }
        delete active[event.agentId];
      }
      toast("<b>" + (event.success ? "Alteração aplicada" : "Alteração falhou") + "</b> · US$ " + Number(event.cost || 0).toFixed(3));
      return;
    }
    if (event.type === "revision.undone") {
      toast("Alteração desfeita");
      return;
    }
  });

  function pauseTour() { tourPausedUntil = Date.now() + 5000; }
  window.addEventListener("scroll", function(){ requestAnimationFrame(function(){ reapply(); positionComposer(); }); }, { passive: true });
  window.addEventListener("resize", function(){ requestAnimationFrame(function(){ reapply(); positionComposer(); }); });
  window.addEventListener("wheel", pauseTour, { passive: true });
  window.addEventListener("touchstart", pauseTour, { passive: true });
  window.addEventListener("pointerdown", pauseTour, { passive: true });

})();
</script>
</body>
</html>`;
