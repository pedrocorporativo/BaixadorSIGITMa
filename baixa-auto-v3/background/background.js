"use strict";

importScripts(
  "../utils/helpers.js",
  "../automation/batch-handler.js",
  "../storage/storage.js",
  "../rules/baixa-rules.js",
  "../rules/validation.js",
  "../ai/ai-schema.js",
  "../ai/ai-provider.js",
  "../ai/ai-service.js",
  "run-guard.js"
);

const SIGITM_HOSTS = new Set(["sigitm.redecorp.br", "10.240.59.14"]);
const BATCH_STORAGE_KEY = "baixaBatchRun";
const RUN_QUEUE_KEY = "baixaPendingRunQueue";
const ACTIVE_RUNS_KEY = "baixaActiveRuns";
const MAX_CONCURRENT_RUNS = 2;
const MASSIVE_LIST_URL = "http://sigitm.redecorp.br/SIGITMWeb/pages/consulta/listConsulta.jsf?idConsulta=95803";
// O protocolo é versionado para impedir que um content script antigo, que
// ficou aberto após atualizar a extensão, execute uma automação desatualizada.
const CONTENT_PROTOCOL = "baixa-controller-v25";
const CONTENT_MESSAGES = Object.freeze({
  status: "GET_BAIXADOR_CONTENT_STATUS_V24",
  start: "START_ANALYSIS_V8",
  readBatch: "READ_BATCH_LIST_STATE_V8",
  clickBatch: "CLICK_BATCH_TICKET_V8",
  refreshBatch: "REFRESH_BATCH_LIST_V8",
  batchStatus: "BATCH_STATUS_V8"
});
const activeRuns = new Map();
const batchRuns = new Map();
let startQueue = Promise.resolve();
let activeRunStorageQueue = Promise.resolve();
let activeRunsLoaded = false;

function persistActiveRuns() {
  const snapshot = [...activeRuns.entries()].map(([tabId, run]) => ({
    tabId, runId: run.runId, title: run.title || `Chamado ${tabId}`, startedAt: run.startedAt || "",
    kind: run.kind || "ticket", batchId: run.batchId || ""
  }));
  const task = activeRunStorageQueue.then(() => BaixaStorage.set({ [ACTIVE_RUNS_KEY]: snapshot }));
  activeRunStorageQueue = task.catch(() => undefined);
  return task;
}

async function hydrateActiveRuns() {
  if (activeRunsLoaded) return;
  const [stored, tabs] = await Promise.all([BaixaStorage.get([ACTIVE_RUNS_KEY, "baixaActiveRun"]), queryTabs().catch(() => [])]);
  const openTabIds = new Set(tabs.map(tab => tab.id));
  const persistedRuns = Array.isArray(stored[ACTIVE_RUNS_KEY]) ? [...stored[ACTIVE_RUNS_KEY]] : [];
  if (stored.baixaActiveRun && !stored.baixaActiveRun.stopped) persistedRuns.push(stored.baixaActiveRun);
  for (const run of persistedRuns) {
    if (!Number.isInteger(run?.tabId) || !run.runId || !openTabIds.has(run.tabId) || activeRuns.has(run.tabId)) continue;
    activeRuns.set(run.tabId, { ...run, controller: new AbortController() });
  }
  activeRunsLoaded = true;
  await persistActiveRuns();
}

function activeRunCount() {
  let count = activeRuns.size;
  for (const batch of batchRuns.values()) {
    if (!batch.finished && batch.processing &&
      (typeof batch.ticketTabId !== "number" || !activeRuns.has(batch.ticketTabId))) count++;
  }
  return count;
}

function makeToolbarIcon(size) {
  if (typeof OffscreenCanvas === "undefined") return null;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");
  if (!context) return null;
  const center = size / 2;
  context.clearRect(0, 0, size, size);
  context.fillStyle = "#d8f522";
  context.beginPath();
  context.arc(center, center, size * 0.48, 0, Math.PI * 2);
  context.fill();
  const globe = context.createRadialGradient(center - size * 0.15, center - size * 0.18, size * 0.03, center, center, size * 0.34);
  globe.addColorStop(0, "#4264e8");
  globe.addColorStop(1, "#07105b");
  context.fillStyle = globe;
  context.beginPath();
  context.arc(center, center, size * 0.34, 0, Math.PI * 2);
  context.fill();
  context.save();
  context.beginPath();
  context.arc(center, center, size * 0.32, 0, Math.PI * 2);
  context.clip();
  context.strokeStyle = "#dfe6ff";
  context.globalAlpha = 0.45;
  context.lineWidth = Math.max(1, size * 0.025);
  context.beginPath();
  context.ellipse(center, center, size * 0.19, size * 0.32, 0, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.ellipse(center, center, size * 0.32, size * 0.12, 0, 0, Math.PI * 2);
  context.stroke();
  context.restore();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#11143a";
  context.lineWidth = size * 0.16;
  context.beginPath();
  context.moveTo(size * 0.27, size * 0.27);
  context.lineTo(size * 0.73, size * 0.73);
  context.moveTo(size * 0.73, size * 0.27);
  context.lineTo(size * 0.27, size * 0.73);
  context.stroke();
  context.strokeStyle = "#e3262e";
  context.lineWidth = size * 0.09;
  context.beginPath();
  context.moveTo(size * 0.27, size * 0.27);
  context.lineTo(size * 0.73, size * 0.73);
  context.moveTo(size * 0.73, size * 0.27);
  context.lineTo(size * 0.27, size * 0.73);
  context.stroke();
  return context.getImageData(0, 0, size, size);
}

function setToolbarIcon() {
  if (!chrome.action?.setIcon) return;
  const imageData = Object.fromEntries([16, 32, 48, 128].map(size => [size, makeToolbarIcon(size)]).filter(([, image]) => image));
  if (Object.keys(imageData).length) chrome.action.setIcon({ imageData }, () => void chrome.runtime.lastError);
}

setToolbarIcon();

const CONTENT_FILES = [
  "utils/helpers.js",
  "rules/baixa-rules.js",
  "rules/validation.js",
  "automation/navigation.js",
  "automation/batch-handler.js",
  "automation/date-handler.js",
  "automation/form-handler.js",
  "automation/baixa-handler.js",
  "ui/notifications.js",
  "content/content.js"
];

// Content scripts também têm sender.id igual ao da extensão; só páginas da
// própria extensão (popup/opções, URL chrome-extension://) são autorizadas.
function senderIsExtension(sender) {
  return sender.id === chrome.runtime.id && String(sender.url || "").startsWith(chrome.runtime.getURL(""));
}
function senderIsSigitm(sender) {
  try {
    const url = new URL(sender.url || "");
    return /^https?:$/.test(url.protocol) && SIGITM_HOSTS.has(url.hostname) && url.pathname.startsWith("/SIGITMWeb/");
  } catch { return false; }
}

function isSigitmHost(hostname) { return SIGITM_HOSTS.has(String(hostname || "").toLowerCase()); }

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => chrome.tabs.sendMessage(tabId, message, response => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else resolve(response);
  }));
}

function executeScriptFile(tabId, file) {
  return new Promise((resolve, reject) => chrome.scripting.executeScript({
    target: { tabId },
    files: [file]
  }, () => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else resolve();
  }));
}

async function injectContent(tabId) {
  for (const file of CONTENT_FILES) {
    try { await executeScriptFile(tabId, file); }
    catch (error) {
      throw new Error(`falha ao carregar “${file}”: ${error.message || "erro desconhecido do Chrome"}`);
    }
  }
}

async function hasCurrentContent(tabId) {
  try {
    const response = await sendTabMessage(tabId, { type: CONTENT_MESSAGES.status });
    return response?.ok === true && response.protocol === CONTENT_PROTOCOL;
  } catch {
    return false;
  }
}

async function ensureCurrentContent(tabId) {
  if (await hasCurrentContent(tabId)) return;
  // Recupera páginas carregadas antes da extensão e substitui controladores de
  // versões anteriores. Mensagens com protocolo antigo não são aceitas.
  try { await injectContent(tabId); }
  catch (error) {
    throw new Error(`Não foi possível carregar os scripts da extensão nesta guia (${error.message}). Recarregue a extensão em chrome://extensions e atualize a página SIGITM antes de iniciar novamente.`);
  }
  if (!await hasCurrentContent(tabId)) {
    throw new Error("O content script atualizado não respondeu após a reinjeção. Atualize a página SIGITM e tente novamente.");
  }
}

async function startContent(tabId, runId, batch = null, mode = "", downloadMode = "single") {
  await ensureCurrentContent(tabId);
  const response = await sendTabMessage(tabId, { type: CONTENT_MESSAGES.start, runId, batch, mode, downloadMode: downloadMode === "queue" ? "queue" : "single", protocol: CONTENT_PROTOCOL });
  if (!response?.ok) throw new Error(response?.error || "O content script não confirmou o início do ticket.");
}

async function sendBatchListMessage(tabId, message) {
  await ensureCurrentContent(tabId);
  let response;
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("A tabela não respondeu em 20 segundos.")), 20000); });
  try { response = await Promise.race([sendTabMessage(tabId, message), timeout]); }
  catch (error) { throw new Error(`Content script indisponível na tabela: ${error.message}`); }
  finally { clearTimeout(timer); }
  if (!response?.ok) throw new Error(response?.error || "A lista SIGITM não respondeu. Atualize a guia e tente novamente.");
  return response;
}

function setLiveStatus(message, status = "info", extra = {}) {
  return BaixaStorage.set({
    baixaLiveStatus: {
      message: String(message || ""),
      status: status === "error" ? "error" : status === "success" ? "success" : "info",
      updatedAt: new Date().toISOString(),
      ...extra
    }
  }).catch(() => undefined);
}

function sendBatchStatus(batch, message, status = "info") {
  if (!batch || typeof batch.listTabId !== "number") return;
  void setLiveStatus(message, status, {
    phase: status === "error" ? "atenção" : status === "success" ? "concluído" : "processando lista",
    listName: batch.listName,
    sequence: batch.sequence || "",
    processed: batch.processed?.size || 0
  });
  chrome.tabs.sendMessage(batch.listTabId, { type: CONTENT_MESSAGES.batchStatus, message, status, protocol: CONTENT_PROTOCOL }, () => void chrome.runtime.lastError);
}

function serializeBatch(batch) {
  return {
    batchId: batch.batchId,
    listTabId: batch.listTabId,
    listName: batch.listName,
    processed: [...batch.processed],
    sequence: batch.sequence,
    phase: batch.phase || "idle",
    ticketTabId: batch.ticketTabId,
    ticketRunId: batch.ticketRunId,
    refreshAttempted: batch.refreshAttempted,
    ticketUncertain: batch.ticketUncertain,
    finished: batch.finished
  };
}

async function persistBatch(batch) {
  if (batch && !batch.finished) await BaixaStorage.set({ [BATCH_STORAGE_KEY]: serializeBatch(batch) });
}

async function loadBatch(batchId) {
  const existing = batchRuns.get(batchId);
  if (existing) return existing;
  const stored = await BaixaStorage.get(BATCH_STORAGE_KEY);
  const value = stored[BATCH_STORAGE_KEY];
  if (!value || value.batchId !== batchId || value.finished) return null;
  const batch = {
    ...value,
    processed: new Set(value.processed || []),
    phase: value.phase || (value.ticketTabId ? "ticket-active" : "idle"),
    processing: false
  };
  batchRuns.set(batchId, batch);
  return batch;
}

function queryTabs() {
  return new Promise((resolve, reject) => chrome.tabs.query({}, tabs => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else resolve(tabs || []);
  }));
}

async function waitForTicketTabChange(previousTabs, timeout = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onCreated.removeListener(onCreated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onActivated.removeListener(onActivated);
    };
    const settle = (error, tabId) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(tabId);
    };
    const inspect = tab => {
      if (typeof tab?.id !== "number" || !tab.url) return false;
      try {
        const url = new URL(tab.url);
        if (!isSigitmHost(url.hostname) || !url.pathname.startsWith("/SIGITMWeb/") || url.pathname.toLowerCase().endsWith("/listconsulta.jsf")) return false;
        const previous = previousTabs.get(tab.id);
        if (!previous || previous.url !== tab.url || (tab.active && !previous.active)) {
          settle(null, tab.id);
          return true;
        }
      } catch { /* URL transitória ou inválida */ }
      return false;
    };
    const onCreated = tab => { inspect(tab); };
    const onUpdated = (tabId, changeInfo, tab) => { if (changeInfo.url || changeInfo.status === "complete") inspect(tab); };
    const onActivated = ({ tabId }) => {
      chrome.tabs.get(tabId, tab => {
        if (chrome.runtime.lastError) { void chrome.runtime.lastError; return; }
        inspect(tab);
      });
    };
    const timer = setTimeout(() => settle(new Error("Os dois cliques na sequência não abriram uma nova guia de chamado.")), timeout);
    chrome.tabs.onCreated.addListener(onCreated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onActivated.addListener(onActivated);
    // Os listeners são instalados antes do snapshot, então não há janela de
    // corrida e o snapshot cobre navegações ocorridas durante o clique inicial.
    queryTabs().then(tabs => {
      for (const tab of tabs) if (inspect(tab)) break;
    }).catch(error => settle(error));
  });
}

function ticketUrlFromLink(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || !isSigitmHost(url.hostname) ||
      !url.pathname.startsWith("/SIGITMWeb/") || url.pathname.toLowerCase().endsWith("/listconsulta.jsf")) return "";
    return url.href;
  } catch { return ""; }
}

function openTicketUrl(url, openerTabId) {
  return new Promise((resolve, reject) => chrome.tabs.create({ url, openerTabId, active: true }, tab => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else if (typeof tab?.id !== "number") reject(new Error("O Chrome não criou a guia do ticket."));
    else resolve(tab.id);
  }));
}

async function clickSequenceInPage(tabId, sequence) {
  const executions = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async wantedSequence => {
      const loaderSelector = "[aria-busy='true'], [data-loading='true'], [role='progressbar'], .loading, .loader, .spinner, .blockUI, .block-ui, .ui-blockui, .ajax-loader, .rf-st-start, [id*='loading' i], [class*='loading' i], [id*='carregando' i], [class*='carregando' i], [id*='spinner' i], [class*='spinner' i], [id*='processing' i], [class*='processing' i], [id*='processando' i], [class*='processando' i], img[src*='loading' i], img[src*='spinner' i], img[src*='processando' i]";
      const visible = element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return !element.hidden && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
      };
      const isLoading = () => [...document.querySelectorAll(loaderSelector)].some(element => {
        if (!visible(element)) return false;
        const metadata = normalize([element.id, element.className, element.getAttribute("src"), element.getAttribute("alt"), element.getAttribute("aria-label")].filter(Boolean).join(" "));
        return element.matches("[aria-busy='true'], [data-loading='true'], [role='progressbar'], .blockUI, .block-ui, .ui-blockui") || /loading|loader|spinner|aguarde|carregando|processing|processando/.test(metadata);
      });
      const waitForIdle = async (timeout = 5000) => {
        const deadline = Date.now() + timeout;
        while (isLoading()) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) return;
          await new Promise(resolve => {
            const observer = new MutationObserver(() => { observer.disconnect(); clearTimeout(timer); resolve(); });
            observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
            const timer = setTimeout(() => { observer.disconnect(); resolve(); }, Math.min(remaining, 750));
          });
        }
      };
      const guardedClick = async target => {
        await waitForIdle();
        if (!target || !target.isConnected || !visible(target) || target.disabled || target.getAttribute("aria-disabled") === "true") {
          throw new Error("Controle da sequência indisponível; clique bloqueado.");
        }
        target.click();
      };
      const normalize = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const cellsFor = row => [...row.querySelectorAll("th, td")];
      const seqIndex = cells => cells.findIndex(cell => {
        const label = normalize([cell.innerText, cell.textContent, cell.getAttribute("aria-label"), cell.title]
          .filter(Boolean).join(" ").replace(/[↕↔↑↓⇅⇵▲▼]/g, " "));
        return label === "seq" || label.startsWith("seq ");
      });
      const tables = [...document.querySelectorAll("table")];
      for (const table of tables) {
        const rows = [...table.querySelectorAll("tr")];
        const headerRow = rows.find(row => seqIndex(cellsFor(row)) >= 0);
        if (!headerRow) continue;
        const index = seqIndex(cellsFor(headerRow));
        for (const row of rows.slice(rows.indexOf(headerRow) + 1)) {
          const cell = cellsFor(row)[index];
          const number = normalize(cell?.innerText || cell?.textContent).match(/\b\d{5,20}\b/)?.[0];
          if (number !== String(wantedSequence)) continue;
          const target = cell.querySelector("a, button, [role='link'], [onclick], [tabindex]") || cell;
          const link = target.closest("a") || cell.querySelector("a");
          const rawHref = String(link?.getAttribute("href") || "").trim();
          const handler = String(link?.getAttribute("onclick") || target.getAttribute("onclick") || "");
          const literalWindowUrl = handler.match(/(?:window\s*\.\s*)?open\s*\(\s*(['"])(.*?)\1/i)?.[2] ||
            rawHref.match(/^javascript:\s*(?:window\s*\.\s*)?open\s*\(\s*(['"])(.*?)\1/i)?.[2] || "";
          let href = "";
          const rawUrl = literalWindowUrl || (!/^(?:javascript:|#|mailto:)/i.test(rawHref) ? rawHref : "");
          if (rawUrl) {
            try { href = new URL(rawUrl, location.href).href; } catch { href = ""; }
          }
          const openedUrls = [];
          const originalOpen = window.open;
          window.open = function (...args) {
            if (args[0]) {
              try { openedUrls.push(new URL(String(args[0]), location.href).href); }
              catch { /* URL dinâmica inválida: tab detector continua ativo */ }
            }
            return originalOpen.apply(this, args);
          };
          try {
            await guardedClick(target);
            await guardedClick(target);
            await waitForIdle();
            if (isLoading()) throw new Error("Indicador de carregamento visível; clique automatizado bloqueado.");
            target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window, detail: 2 }));
          } finally {
            window.open = originalOpen;
          }
          return { clicked: true, href: href || openedUrls.find(value => value) || "", openedUrls };
        }
      }
      return { clicked: false, href: "", openedUrls: [] };
    },
    args: [String(sequence)]
  });
  return executions?.[0]?.result || { clicked: false, href: "", openedUrls: [] };
}

// Nomes que nunca devem ser chamados como "função de fechamento" do popup.
const BLOCKED_PAGE_FUNCTIONS = /^(?:eval|alert|confirm|prompt|open|print|close|logout|setTimeout|setInterval|fetch|Function)$/i;

// Fecha um popup RichFaces/legado no mundo MAIN da página. A CSP da página
// bloqueia javascript: e scripts inline, mas chrome.scripting com `func` é
// permitido. Só aceita ids/nomes simples vindos do controle X já identificado.
async function closePopupInPage(tabId, request) {
  const kind = request?.kind === "richfaces" ? "richfaces" : request?.kind === "function" ? "function" : "";
  const value = String(request?.value || "");
  const valid = kind === "richfaces" ? /^[\w$.:\-]{1,200}$/.test(value)
    : kind === "function" && /^[A-Za-z_$][\w$]{0,80}$/.test(value) && !BLOCKED_PAGE_FUNCTIONS.test(value);
  if (!valid) throw new Error("Pedido de fechamento de popup inválido.");
  const executions = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [kind, value],
    func: (requestKind, requestValue) => {
      const windows = [];
      const collect = current => {
        windows.push(current);
        for (let index = 0; index < current.frames.length; index++) {
          try { collect(current.frames[index]); } catch { /* frame de outra origem */ }
        }
      };
      collect(window);
      for (const view of windows) {
        try {
          if (requestKind === "richfaces") {
            const richFaces = view.RichFaces || view.Richfaces;
            if (typeof richFaces?.hideModalPanel === "function") { richFaces.hideModalPanel(requestValue); return true; }
          } else if (typeof view[requestValue] === "function") {
            view[requestValue]();
            return true;
          }
        } catch { /* tenta o próximo frame */ }
      }
      return false;
    }
  });
  return executions?.some(item => item.result === true) === true;
}

function activateTab(tabId) {
  return new Promise((resolve, reject) => chrome.tabs.update(tabId, { active: true }, tab => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else resolve(tab);
  }));
}

async function returnToListAndRefresh(batch, skippedReason = "") {
  sendBatchStatus(batch, skippedReason
    ? `Ticket ${batch.sequence} não baixado (${String(skippedReason).split("\n").pop().slice(0, 160)}). Voltando à tabela para seguir ao próximo…`
    : `Ticket ${batch.sequence} confirmado. Voltando à guia da tabela e atualizando a consulta…`, skippedReason ? "error" : "info");
  await activateTab(batch.listTabId);
  // A lista precisa ser atualizada antes de procurar o próximo BD; o content
  // script só responde depois que o clique em Atualizar e o DOM estabilizam.
  const refreshed = await sendBatchListMessage(batch.listTabId, { type: CONTENT_MESSAGES.refreshBatch, protocol: CONTENT_PROTOCOL })
    .catch(error => {
      // Falha ao atualizar não interrompe a fila: o próximo BD é procurado na tabela como ela está.
      sendBatchStatus(batch, `Não foi possível atualizar a tabela (${error.message}). Procurando o próximo ticket mesmo assim…`, "error");
      return null;
    });
  if (refreshed && !refreshed.ok) throw new Error(refreshed.error || "Não foi possível atualizar a lista após fechar o ticket.");
  sendBatchStatus(batch, "Tabela atualizada. Procurando o próximo ticket da lista…");
  return refreshed?.state;
}

async function continueMassiveListFromTicket(ticketTabId) {
  await hydrateActiveRuns();
  const tabs = await queryTabs();
  const ticketTab = tabs.find(tab => tab.id === ticketTabId);
  let ticketUrl;
  try { ticketUrl = new URL(ticketTab?.url || ""); } catch { ticketUrl = null; }
  let listTab = tabs.find(tab => {
    if (BaixaBatch.listName(tab.url || "") !== "Validação Massiva") return false;
    try { return ticketUrl && new URL(tab.url).hostname === ticketUrl.hostname; } catch { return false; }
  }) || tabs.find(tab => BaixaBatch.listName(tab.url || "") === "Validação Massiva");
  if (!listTab) {
    const listUrl = ticketUrl && isSigitmHost(ticketUrl.hostname)
      ? `${ticketUrl.protocol}//${ticketUrl.host}/SIGITMWeb/pages/consulta/listConsulta.jsf?idConsulta=95803`
      : MASSIVE_LIST_URL;
    listTab = await new Promise((resolve, reject) => chrome.tabs.create({ url: listUrl, active: true }, tab => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!tab?.id) reject(new Error("Não foi possível abrir a consulta Validação Massiva."));
      else resolve(tab);
    }));
  }
  if (typeof listTab.id !== "number") throw new Error("A guia da consulta Validação Massiva não possui identificador válido.");

  // Só avança depois que o content script confirmou “Ticket liberado”.
  activeRuns.delete(ticketTabId);
  await persistActiveRuns();
  const activeState = await BaixaStorage.get("baixaActiveRun");
  if (activeState.baixaActiveRun?.tabId === ticketTabId) await BaixaStorage.set({ baixaActiveRun: null });
  await activateTab(listTab.id);
  const refreshed = await sendBatchListMessage(listTab.id, { type: CONTENT_MESSAGES.refreshBatch, protocol: CONTENT_PROTOCOL });
  if (!refreshed?.ok) throw new Error(refreshed?.error || "Não foi possível atualizar a consulta Validação Massiva.");

  try { await chrome.tabs.remove(ticketTabId); } catch { /* guia já fechada */ }
  if (refreshed.state?.empty) return { started: false, empty: true };
  const batch = await startBatchForTab(listTab.id, "Validação Massiva");
  sendBatchStatus(batch, "Consulta atualizada. Abrindo o próximo BD da coluna Seq…");
  void processNextBatchTicket(batch);
  return { started: true, empty: false, batchId: batch.batchId };
}

function waitForTicketTabReady(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
    const settle = (error, tab) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) reject(error);
      else resolve(tab);
    };
    const inspect = tab => {
      if (!tab?.url || tab.status !== "complete") return false;
      try {
        const url = new URL(tab.url);
        if (!isSigitmHost(url.hostname) || url.pathname.toLowerCase().endsWith("/listconsulta.jsf")) return false;
        settle(null, tab);
        return true;
      } catch { return false; }
    };
    const onUpdated = (updatedId, changeInfo, tab) => {
      if (updatedId === tabId && changeInfo.status === "complete") inspect(tab);
    };
    const timer = setTimeout(() => settle(new Error("A guia do chamado não terminou de carregar.")), timeout);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId, tab => {
      if (chrome.runtime.lastError) return settle(new Error(chrome.runtime.lastError.message));
      inspect(tab);
    });
  });
}

async function getPendingRunQueue() {
  const stored = await BaixaStorage.get(RUN_QUEUE_KEY);
  return BaixaRunQueue.normalize(stored[RUN_QUEUE_KEY]);
}

async function savePendingRunQueue(queue) {
  await BaixaStorage.set({ [RUN_QUEUE_KEY]: BaixaRunQueue.normalize(queue) });
}

function getTab(tabId) {
  return new Promise((resolve, reject) => chrome.tabs.get(tabId, tab => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else resolve(tab);
  }));
}

async function resumeIdleBatch() {
  await hydrateActiveRuns();
  const pending = await getPendingRunQueue();
  if (pending.length || !BaixaRunQueue.hasCapacity(activeRunCount(), MAX_CONCURRENT_RUNS)) return;
  const batch = [...batchRuns.values()].find(item => !item.finished && !item.processing && !item.ticketTabId &&
    (!item.phase || item.phase === "idle"));
  if (batch) void processNextBatchTicket(batch);
}

async function drainPendingRunQueue() {
  await hydrateActiveRuns();
  let queue = await getPendingRunQueue();
  let startedAny = false;

  while (queue.length) {
    const next = BaixaRunQueue.nextStartable(queue, activeRuns.keys(), activeRunCount(), MAX_CONCURRENT_RUNS);
    if (!next) break;

    queue = queue.filter(item => item.tabId !== next.tabId || item.requestId !== next.requestId);
    const runId = crypto.randomUUID();
    const controller = new AbortController();
    activeRuns.set(next.tabId, { runId, controller, title: next.title, startedAt: new Date().toISOString(), kind: "ticket" });
    await persistActiveRuns();
    try { await savePendingRunQueue(queue); }
    catch (error) { activeRuns.delete(next.tabId); await persistActiveRuns(); throw error; }
    let tab;
    try { tab = await getTab(next.tabId); }
    catch {
      activeRuns.delete(next.tabId);
      await persistActiveRuns();
      await setLiveStatus(`Chamado removido da fila: ${next.title} (guia fechada).`, "error", { phase: "atenção" });
      queue = await getPendingRunQueue();
      continue;
    }
    let url;
    try { url = new URL(tab.url || ""); } catch { url = null; }
    if (!url || !isSigitmHost(url.hostname) || !url.pathname.startsWith("/SIGITMWeb/") || BaixaBatch.listName(url.href)) {
      activeRuns.delete(next.tabId);
      await persistActiveRuns();
      await setLiveStatus(`Chamado removido da fila: ${next.title} (a guia já não contém esse chamado SIGITM).`, "error", { phase: "atenção" });
      queue = await getPendingRunQueue();
      continue;
    }
    await BaixaStorage.set({
      [BaixaStorage.KEYS.stop]: false,
      baixaActiveTabId: next.tabId,
      baixaActiveRun: { tabId: next.tabId, runId, startedAt: new Date().toISOString(), stopped: false }
    });
    await setLiveStatus(`Iniciando da fila: ${next.title}${queue.length ? ` · ${queue.length} chamado(s) aguardando` : ""}.`, "info", {
      phase: "processando", tabId: next.tabId, runId, pendingCount: queue.length
    });
    try {
      await waitForTicketTabReady(next.tabId);
      if (controller.signal.aborted || activeRuns.get(next.tabId)?.runId !== runId) {
        throw new Error("A execução foi interrompida antes de iniciar.");
      }
      await startContent(next.tabId, runId, null, next.mode, next.downloadMode);
      startedAny = true;
    } catch (error) {
      controller.abort();
      if (activeRuns.get(next.tabId)?.runId === runId) {
        activeRuns.delete(next.tabId);
        await persistActiveRuns();
      }
      const latest = await BaixaStorage.get("baixaActiveRun");
      if (latest.baixaActiveRun?.runId === runId) await BaixaStorage.set({ baixaActiveRun: null });
      await setLiveStatus(`Não foi possível iniciar ${next.title}: ${error.message}. A guia foi mantida aberta; seguindo para o próximo chamado da fila.`, "error", {
        phase: "atenção", tabId: next.tabId, runId
      });
    }
    queue = await getPendingRunQueue();
  }
  await resumeIdleBatch();
  return startedAny;
}

function startNextQueuedRun() {
  const task = startQueue.then(() => drainPendingRunQueue());
  startQueue = task.catch(() => undefined);
  return task;
}

async function finishBatch(batch, message, status = "success") {
  if (!batch || batch.finished) return;
  batch.finished = true;
  batchRuns.delete(batch.batchId);
  await BaixaStorage.set({ [BATCH_STORAGE_KEY]: null }).catch(() => undefined);
  await setLiveStatus(message, status === "error" ? "error" : "success", {
    phase: status === "error" ? "atenção" : "concluído",
    listName: batch.listName,
    sequence: batch.sequence || "",
    processed: batch.processed?.size || 0
  });
  sendBatchStatus(batch, message, status);
  // Não feche guias de ticket em caminhos genéricos de erro/parada. O único
  // fechamento automático ocorre no handler BATCH_TICKET_FINISHED, após a
  // confirmação de sucesso ter sido lida na página.
}

async function processNextBatchTicket(batch) {
  if (!batch || batch.finished || batch.processing || batch.ticketTabId || (batch.phase && batch.phase !== "idle")) return;
  await hydrateActiveRuns();
  if (batch.finished || batch.processing || batch.ticketTabId || (batch.phase && batch.phase !== "idle")) return;
  if (!BaixaRunQueue.hasCapacity(activeRunCount(), MAX_CONCURRENT_RUNS)) {
    sendBatchStatus(batch, `${batch.listName}: aguardando vaga para abrir o próximo ticket…`);
    setTimeout(() => void processNextBatchTicket(batch), 1500);
    return;
  }
  batch.processing = true;
  try {
    batch.phase = "reading-list";
    await persistBatch(batch);
    const response = await sendBatchListMessage(batch.listTabId, { type: CONTENT_MESSAGES.readBatch, protocol: CONTENT_PROTOCOL });
    const state = response.state || { tickets: [], empty: false };
    if (state.empty) {
      await finishBatch(batch, `Lista ${batch.listName}: zero registros. Processamento encerrado (${batch.processed.size} tickets concluídos).`);
      return;
    }
    const sequence = BaixaBatch.nextUnprocessedTicket(state.tickets, batch.processed);
    if (!sequence) {
      if (state.recordCount?.total > 0) {
        throw new Error(`A tabela informa ${state.recordCount.total} registros, mas a extensão não conseguiu ler nenhuma sequência na coluna Seq.`);
      }
      if (!batch.refreshAttempted) {
        batch.refreshAttempted = true;
        batch.phase = "refreshing-list";
        await persistBatch(batch);
        await sendBatchListMessage(batch.listTabId, { type: CONTENT_MESSAGES.refreshBatch, protocol: CONTENT_PROTOCOL });
        batch.phase = "idle";
        await persistBatch(batch);
        setTimeout(() => void processNextBatchTicket(batch), 0);
        return;
      }
      await finishBatch(batch, `Lista ${batch.listName}: não há novas sequências visíveis após atualizar (${batch.processed.size} tickets concluídos). A consulta ainda não confirmou zero registros.`, "error");
      return;
    }
    batch.refreshAttempted = false;
    batch.sequence = String(sequence);
    batch.phase = "opening-ticket";
    await persistBatch(batch);
    sendBatchStatus(batch, `${batch.listName}: abrindo ticket ${batch.sequence} (${batch.processed.size + 1} concluídos até agora)…`);
    const previousTabs = new Map((await queryTabs()).map(tab => [tab.id, { url: tab.url || "", active: Boolean(tab.active) }]));
    if (previousTabs.has(batch.listTabId)) previousTabs.get(batch.listTabId).active = true;
    const clickResult = await clickSequenceInPage(batch.listTabId, batch.sequence);
    if (!clickResult?.clicked) throw new Error(clickResult?.error || `Não foi possível clicar na sequência ${batch.sequence} da coluna Seq.`);
    const directTicketUrl = ticketUrlFromLink(clickResult.href || "");
    let ticketTabId = await waitForTicketTabChange(previousTabs, directTicketUrl ? 2500 : 30000).catch(() => null);
    if (ticketTabId === null && directTicketUrl) ticketTabId = await openTicketUrl(directTicketUrl, batch.listTabId);
    if (ticketTabId === null) throw new Error(`Os dois cliques rápidos na sequência ${batch.sequence} não abriram uma guia SIGITM.`);
    if (batch.finished) {
      return;
    }
    batch.ticketTabId = ticketTabId;
    batch.phase = "ticket-active";
    await persistBatch(batch);
    const readyTab = await waitForTicketTabReady(ticketTabId);
    if (batch.finished) {
      return;
    }
    const runId = crypto.randomUUID();
    batch.ticketRunId = runId;
    await persistBatch(batch);
    const controller = new AbortController();
    activeRuns.set(ticketTabId, {
      runId, controller, title: `BD ${batch.sequence}`, startedAt: new Date().toISOString(), kind: "batch", batchId: batch.batchId
    });
    await persistActiveRuns();
    await BaixaStorage.set({
      [BaixaStorage.KEYS.stop]: false,
      baixaActiveTabId: ticketTabId,
      baixaActiveRun: { tabId: ticketTabId, runId, startedAt: new Date().toISOString(), stopped: false }
    });
    if (readyTab.status !== "complete") throw new Error("A guia do ticket não terminou de carregar.");
    try {
      await startContent(ticketTabId, runId, { batchId: batch.batchId, sequence: batch.sequence }, "", "queue");
    } catch (error) {
      batch.ticketUncertain = true;
      throw new Error(`${error.message} A guia do ticket foi mantida aberta para conferência.`);
    }
  } catch (error) {
    await finishBatch(batch, `${batch.listName}: fila pausada. ${error.message}`, "error");
  } finally {
    batch.processing = false;
  }
}

async function startBatchForTab(tabId, listName) {
  const existingBatch = [...batchRuns.values()].find(batch => !batch.finished && batch.listTabId === tabId);
  if (existingBatch) return existingBatch;
  const stored = await BaixaStorage.get("baixaActiveRun");
  if (stored.baixaActiveRun && !stored.baixaActiveRun.stopped && stored.baixaActiveRun.tabId === tabId) {
    throw new Error("Já existe uma execução ativa nesta guia. Pare-a antes de iniciar o processamento da lista.");
  }
  const batch = {
    batchId: crypto.randomUUID(),
    listTabId: tabId,
    listName,
    processed: new Set(),
    sequence: "",
    ticketTabId: null,
    ticketRunId: "",
    phase: "idle",
    processing: false,
    refreshAttempted: false,
    ticketUncertain: false,
    finished: false
  };
  batchRuns.set(batch.batchId, batch);
  await persistBatch(batch);
  return batch;
}

const AI_PREFETCH_TTL_MS = 60000;
const aiPrefetch = new Map();

function aiPrefetchKey(tabId, runId, data, settings) {
  return JSON.stringify([tabId, runId, settings.provider, settings.model, settings.temperature, BaixaHelpers.buildAIPayload(data)]);
}

// Inicia a consulta à IA enquanto o content script ainda lê as demais abas.
function startAIPrefetch(tabId, runId, data, settings, signal) {
  const now = Date.now();
  for (const [key, entry] of aiPrefetch) if (now - entry.startedAt > AI_PREFETCH_TTL_MS) aiPrefetch.delete(key);
  aiPrefetch.set(aiPrefetchKey(tabId, runId, data, settings), { startedAt: now, promise: BaixaAIService.analyzeCase(data, settings, signal) });
}

function takeAIPrefetch(tabId, runId, data, settings) {
  const key = aiPrefetchKey(tabId, runId, data, settings);
  const entry = aiPrefetch.get(key);
  aiPrefetch.delete(key);
  return entry && Date.now() - entry.startedAt <= AI_PREFETCH_TTL_MS ? entry.promise : null;
}

async function saveCurrent(result) {
  const record = { ...result, updatedAt: new Date().toISOString() };
  await BaixaStorage.set({ [BaixaStorage.KEYS.current]: record });
  return record;
}

async function handleCase(message, sender) {
  if (!senderIsSigitm(sender) || typeof sender.tab?.id !== "number") throw new Error("Origem de chamado não autorizada.");
  await hydrateActiveRuns();
  const tabId = sender.tab.id;
  const runId = String(message.runId || "");
  let activeRun = activeRuns.get(tabId);
  const storedRun = (await BaixaStorage.get(["baixaActiveRun", BaixaStorage.KEYS.stop]));
  const persistentRun = storedRun.baixaActiveRun;
  const authorization = BaixaRunGuard.authorizeRun({
    tabId,
    runId,
    persistentRun,
    memoryRun: activeRun,
    stopRequested: storedRun[BaixaStorage.KEYS.stop] === true,
    hasOtherActiveRun: false
  });
  if (!authorization.allowed) {
    const guidance = authorization.reason === "ID da execução ausente."
      ? "ID da execução ausente. Feche e reabra a página SIGITM, depois inicie pela extensão."
      : authorization.reason === "A automação foi interrompida."
        ? "A execução foi parada ou abortada. Escolha o modo de operação e use o botão principal para iniciar uma nova execução."
        : authorization.reason;
    throw new Error(guidance);
  }
  if (authorization.repairStorage) {
    await BaixaStorage.set({
      [BaixaStorage.KEYS.stop]: false,
      baixaActiveTabId: tabId,
      baixaActiveRun: { tabId, runId, startedAt: new Date().toISOString(), stopped: false }
    });
  }

  if (activeRun?.runId === runId && activeRun.controller.signal.aborted) throw new Error("Automação interrompida pelo usuário.");
  if (!activeRun || activeRun.runId !== runId) {
    activeRun = {
      runId,
      controller: new AbortController(),
      title: String(sender.tab.title || `Chamado ${tabId}`),
      startedAt: new Date().toISOString(),
      kind: "ticket"
    };
    activeRuns.set(tabId, activeRun);
    await persistActiveRuns();
  }
  if (activeRun.controller.signal.aborted) throw new Error("Automação interrompida pelo usuário.");
  const rawCase = message.caseData;
  if (!rawCase || typeof rawCase !== "object" || Array.isArray(rawCase)) throw new Error("Dados do chamado inválidos.");

  const data = Object.fromEntries(BaixaHelpers.CASE_FIELDS.map(key => [key, rawCase[key] ?? ""]));
  const deterministic = BaixaRules.decide(data);
  const automaticClientCode = BaixaRules.automaticCodeForClient(data.cliente);
  const settings = await BaixaStorage.getSettings();
  const requestedMode = message.mode === "automatic" || message.mode === "analysis" ? message.mode : settings.mode;
  const controller = activeRun.controller;

  const ai = await (takeAIPrefetch(tabId, runId, data, settings) || BaixaAIService.analyzeCase(data, settings, controller.signal));
  if (controller.signal.aborted) throw new Error("Automação interrompida pelo usuário.");
  const validation = automaticClientCode
    ? {
      allowed: deterministic.allowed,
      status: "REGRA PRIORITÁRIA DO CLIENTE",
      reason: `Cliente SEDUC/FED: código ${automaticClientCode} aplicado sem perguntar e sem depender da resposta da IA.`
    }
    : BaixaValidation.compareAIWithRules(ai, deterministic, settings.minimumConfidence);
  const decision = {
    ...deterministic,
    validation,
    ai: ai.available ? {
      available: true,
      provider: ai.provider,
      confidence: ai.decision.confianca,
      motivo: ai.decision.motivo,
      proposedCode: ai.decision.codigoBaixa
    } : {
      available: false,
      provider: settings.provider,
      confidence: null,
      motivo: ai.reason
    },
    allowed: deterministic.allowed && validation.allowed,
    mode: requestedMode,
    caseData: {
      ...data,
      dataReparoOriginal: String(rawCase.dataReparoOriginal ?? ""),
      dataInicioParadaRelogio: String(rawCase.dataInicioParadaRelogio ?? ""),
      dataFimParadaRelogio: String(rawCase.dataFimParadaRelogio ?? ""),
      dataReparoPrevista: String(rawCase.dataReparoPrevista ?? ""),
      validacaoDataBaixa: String(rawCase.validacaoDataBaixa ?? "")
    },
    analyzedAt: new Date().toISOString()
  };
  decision.learnedCode = await BaixaStorage.getLearnedCode(data);
  await saveCurrent(decision);
  return decision;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "RUN_ACTIVE_TAB") {
    if (!senderIsExtension(sender)) { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0];
      let url;
      try { url = new URL(tab?.url || ""); } catch { url = null; }
      if (!tab?.id || !url || !isSigitmHost(url.hostname) || !url.pathname.startsWith("/SIGITMWeb/")) {
        sendResponse({ ok: false, error: "Abra um chamado SIGITM ou uma tabela compatível na aba atual." });
        return;
      }
      const listName = BaixaBatch.listName(url.href);
      if (listName) {
        const batchStart = startQueue.then(async () => {
          // Fila só roda quando o usuário escolheu "Fila"; no padrão (BD único) a tabela não dispara lote.
          const currentSettings = await BaixaStorage.getSettings();
          if (currentSettings.downloadMode !== "queue") {
            throw new Error("Tipo de baixa está em “BD único”. Abra o chamado para baixar um BD, ou mude para “Fila” no popup para processar a lista.");
          }
          return startBatchForTab(tab.id, listName);
        });
        startQueue = batchStart.catch(() => undefined);
        batchStart.then(batch => {
          sendBatchStatus(batch, `Iniciando ${listName}. Os tickets da coluna Seq serão tratados um por vez; a guia só fecha após “Ticket liberado”.`);
          sendResponse({ ok: true, batchId: batch.batchId, listName });
          void processNextBatchTicket(batch);
        }).catch(error => sendResponse({ ok: false, error: error.message || "Não foi possível iniciar a lista SIGITM." }));
        return;
      }
      const enqueue = startQueue.then(async () => {
        const stored = await BaixaStorage.get(["baixaActiveRun", RUN_QUEUE_KEY]);
        const current = stored.baixaActiveRun;
        if (current && !current.stopped && current.tabId === tab.id) {
          activeRuns.get(tab.id)?.controller.abort();
          current.stopped = true;
          await BaixaStorage.set({
            [BaixaStorage.KEYS.stop]: true,
            baixaActiveRun: { ...current, stopped: true, stoppedAt: new Date().toISOString() }
          });
          chrome.tabs.sendMessage(tab.id, { type: "STOP_AUTOMATION", runId: current.runId }, () => void chrome.runtime.lastError);
        }
        const active = stored.baixaActiveRun;
        const pending = BaixaRunQueue.normalize(stored[RUN_QUEUE_KEY]);
        if (active && !active.stopped && active.tabId === tab.id) {
          throw new Error("Este chamado já está em execução; não será colocado duas vezes na fila.");
        }
        const settings = await BaixaStorage.getSettings();
        const entry = {
          tabId: tab.id,
          url: tab.url || url.href,
          title: String(tab.title || `Chamado ${tab.id}`),
          mode: settings.mode,
          downloadMode: settings.downloadMode,
          queuedAt: new Date().toISOString(),
          requestId: crypto.randomUUID()
        };
        const result = BaixaRunQueue.enqueue(pending, entry);
        await savePendingRunQueue(result.queue);
        const position = result.position;
        await setLiveStatus(result.added
          ? `${entry.title} entrou na fila (posição ${position}). Será executado quando o chamado atual terminar.`
          : `${entry.title} já está aguardando na fila (posição ${position}); solicitação duplicada ignorada.`, "info", {
          phase: "fila", tabId: tab.id, pendingCount: result.queue.length
        });
        return { queued: true, added: result.added, position, pendingCount: result.queue.length, title: entry.title };
      });
      startQueue = enqueue.catch(() => undefined);
      enqueue.then(result => {
        sendResponse({ ok: true, ...result });
        void startNextQueuedRun();
      }).catch(error => sendResponse({ ok: false, error: error.message || "Não foi possível adicionar o chamado à fila." }));
    });
    return true;
  }

  if (message?.type === "CONTINUE_MASSIVE_LIST") {
    if (!senderIsSigitm(sender) || typeof sender.tab?.id !== "number") { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    continueMassiveListFromTicket(sender.tab.id)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => sendResponse({ ok: false, error: error.message || "Não foi possível voltar à Validação Massiva." }));
    return true;
  }

  if (message?.type === "CHECK_TICKET_RELEASED") {
    if (!senderIsSigitm(sender) || typeof sender.tab?.id !== "number") { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, allFrames: true },
      world: "MAIN",
      func: () => {
        const normalize = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const released = value => /(?:ticket|tiquete)[\s\S]{0,100}liberado/.test(normalize(value));
        const body = document.body;
        if (!body) return false;
        if (released(body.innerText || body.textContent || "")) return true;
        const status = "[role='dialog'], [role='alert'], [role='status'], [aria-modal='true'], .modal, .ui-dialog, table, div, td, span, p";
        return [...document.querySelectorAll(status)].some(element => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const visible = !element.hidden && style.display !== "none" && style.visibility !== "hidden" &&
            Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
          return visible && released(element.innerText || element.textContent || "");
        });
      }
    }).then(results => sendResponse({
      ok: true,
      released: results.some(item => item.result === true)
    })).catch(() => sendResponse({ ok: true, released: false }));
    return true;
  }

  if (message?.type === "STOP_AUTOMATION") {
    if (!senderIsExtension(sender)) { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    const stop = startQueue.then(async () => {
      await hydrateActiveRuns();
      const stopRuns = new Map([...activeRuns].map(([tabId, active]) => [tabId, active.runId]));
      activeRuns.forEach(active => active.controller.abort());
      const stored = await BaixaStorage.get("baixaActiveRun");
      const run = stored.baixaActiveRun;
      if (typeof run?.tabId === "number" && !stopRuns.has(run.tabId)) stopRuns.set(run.tabId, run.runId);
      await BaixaStorage.set({
        [BaixaStorage.KEYS.stop]: true,
        baixaActiveRun: run ? { ...run, stopped: true, stoppedAt: new Date().toISOString() } : null
      });
      const pendingRuns = await getPendingRunQueue();
      await savePendingRunQueue([]);
      if (pendingRuns.length) {
        await setLiveStatus(`Automação interrompida. ${pendingRuns.length} chamado(s) pendente(s) foram removidos da fila.`, "info", { phase: "pausado", pendingCount: 0 });
      }
      stopRuns.forEach((runId, tabId) => chrome.tabs.sendMessage(tabId, { type: "STOP_AUTOMATION", runId }, () => void chrome.runtime.lastError));
      const storedBatch = await BaixaStorage.get(BATCH_STORAGE_KEY);
      if (storedBatch[BATCH_STORAGE_KEY]?.batchId && !batchRuns.has(storedBatch[BATCH_STORAGE_KEY].batchId)) {
        await loadBatch(storedBatch[BATCH_STORAGE_KEY].batchId);
      }
      for (const batch of batchRuns.values()) {
        batch.ticketUncertain = Boolean(batch.ticketTabId);
        await finishBatch(batch, `Processamento da lista ${batch.listName} interrompido pelo usuário.`, "error");
      }
    });
    startQueue = stop.catch(() => undefined);
    stop.then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "CLEAR_HISTORY") {
    if (!senderIsExtension(sender)) { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    BaixaStorage.clearHistory().then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (["LIST_LEARNING", "DELETE_LEARNING", "CLEAR_LEARNING", "IMPORT_LEARNING"].includes(message?.type)) {
    if (!senderIsExtension(sender)) { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    const work = message.type === "LIST_LEARNING" ? BaixaStorage.listLearnedCodes().then(entries => ({ entries }))
      : message.type === "DELETE_LEARNING" ? BaixaStorage.deleteLearnedCode(String(message.key || "")).then(deleted => ({ deleted }))
        : message.type === "CLEAR_LEARNING" ? BaixaStorage.clearLearnedCodes().then(() => ({}))
          : BaixaStorage.importLearnedCodes(message.entries).then(summary => ({ ...summary }));
    work.then(result => sendResponse({ ok: true, ...result })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "PAGE_CLOSE_POPUP") {
    if (!senderIsSigitm(sender) || typeof sender.tab?.id !== "number") { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    closePopupInPage(sender.tab.id, message)
      .then(closed => sendResponse({ ok: true, closed }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "PREFETCH_ANALYSIS") {
    if (!senderIsSigitm(sender) || typeof sender.tab?.id !== "number") { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    const activeRun = activeRuns.get(sender.tab.id);
    const rawCase = message.caseData;
    if (!activeRun || activeRun.runId !== String(message.runId || "") || activeRun.controller.signal.aborted ||
      !rawCase || typeof rawCase !== "object" || Array.isArray(rawCase)) {
      sendResponse({ ok: true, started: false });
      return false;
    }
    const data = Object.fromEntries(BaixaHelpers.CASE_FIELDS.map(key => [key, rawCase[key] ?? ""]));
    BaixaStorage.getSettings().then(settings => {
      startAIPrefetch(sender.tab.id, activeRun.runId, data, settings, activeRun.controller.signal);
      sendResponse({ ok: true, started: true });
    }).catch(() => sendResponse({ ok: true, started: false }));
    return true;
  }

  if (message?.type === "ANALYZE_CASE") {
    handleCase(message, sender).then(decision => sendResponse({ ok: true, decision }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "SAVE_CODE_LEARNING") {
    if (!senderIsSigitm(sender) || typeof sender.tab?.id !== "number") { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    const code = String(message.codigoBaixa || "");
    const rawCase = message.caseData;
    if (!BaixaRules.CODES.includes(code) || !rawCase || typeof rawCase !== "object" || Array.isArray(rawCase)) {
      sendResponse({ ok: false, error: "Código ou dados de aprendizagem inválidos." });
      return false;
    }
    BaixaStorage.get("baixaActiveRun").then(async stored => {
      await hydrateActiveRuns();
      const run = stored.baixaActiveRun;
      if (run?.runId !== message.runId || run?.tabId !== sender.tab.id || run.stopped) throw new Error("A execução não está mais ativa para salvar a escolha.");
      const caseData = Object.fromEntries(BaixaHelpers.CASE_FIELDS.map(key => [key, rawCase[key] ?? ""]));
      const learning = await BaixaStorage.saveLearnedCode(caseData, code);
      const currentState = await BaixaStorage.get(BaixaStorage.KEYS.current);
      const current = currentState[BaixaStorage.KEYS.current] || {};
      const source = message.source === "aprendido" ? "aprendido" : "usuário";
      const sourceLabel = source === "aprendido" ? "reutilizado da escolha salva" : "escolhido pelo usuário";
      await saveCurrent({
        ...current,
        codigoBaixa: code,
        motivo: `Código ${code} ${sourceLabel}.`,
        validation: {
          ...current.validation,
          allowed: true,
          status: source === "aprendido" ? "CÓDIGO APRENDIDO" : "CÓDIGO CONFIRMADO PELO USUÁRIO",
          reason: `Código ${code} ${sourceLabel}.`
        },
        codeSelection: { source, codigoBaixa: code, ocorrencias: learning.ocorrencias }
      });
      return { codigoBaixa: code, ocorrencias: learning.ocorrencias };
    }).then(learning => sendResponse({ ok: true, learning }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "AUTOMATION_STATUS") {
    if (!senderIsSigitm(sender) || typeof sender.tab?.id !== "number") { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    setLiveStatus(message.message, message.status, {
      phase: message.status === "error" ? "atenção" : "processando",
      tabId: sender.tab.id,
      runId: String(message.runId || "")
    }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "RUN_FINISHED") {
    if (!senderIsSigitm(sender) || typeof sender.tab?.id !== "number") { sendResponse({ ok: false }); return false; }
    BaixaStorage.get("baixaActiveRun").then(async stored => {
      await hydrateActiveRuns();
      const run = stored.baixaActiveRun;
      const matchesRun = run?.tabId === sender.tab.id && run?.runId === message.runId;
      if (matchesRun) await BaixaStorage.set({ baixaActiveRun: null });
      if (activeRuns.get(sender.tab.id)?.runId === message.runId) {
        activeRuns.delete(sender.tab.id);
        await persistActiveRuns();
      }
      const failed = message.finalStatus === "error";
      const interrupted = message.finalStatus === "info";
      const finalMessage = failed
        ? `BAIXA NÃO REALIZADA\n${String(message.finalMessage || "Erro informado pelo SIGITM.")}\nNenhuma ação adicional será iniciada.`
        : interrupted ? "Processamento interrompido pelo usuário." : "Execução encerrada. O resultado final foi salvo no histórico.";
      await setLiveStatus(finalMessage, failed ? "error" : interrupted ? "info" : "success", {
        phase: failed ? "atenção" : interrupted ? "pausado" : "concluído",
        tabId: sender.tab.id, runId: message.runId
      });
      sendResponse({ ok: true, cleared: matchesRun });
      void startNextQueuedRun();
    }).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "BATCH_TICKET_FINISHED") {
    if (!senderIsSigitm(sender) || typeof sender.tab?.id !== "number") { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    const batchId = String(message.batchId || "");
    hydrateActiveRuns().then(() => loadBatch(batchId)).then(async batch => {
      if (!batch || batch.ticketTabId !== sender.tab.id || batch.sequence !== String(message.sequence || "")) {
        sendResponse({ ok: false, error: "O ticket não corresponde à execução em lote ativa." });
        return;
      }
      const succeeded = BaixaBatch.ticketSucceeded(message);
      // Falha definitiva (baixa não gravada) segue para o próximo BD; incerteza ou cancelamento pausam a fila.
      const skipFailed = !succeeded && message.uncertain !== true && message.cancelled !== true;
      if (!succeeded && !skipFailed) {
        batch.ticketUncertain = true;
        const cancelled = message.cancelled === true;
        const reason = cancelled ? "fila cancelada durante o ticket" : message.reason || "a baixa não foi confirmada como concluída";
        await finishBatch(batch, `Fila pausada no ticket ${batch.sequence}: ${reason}. A guia foi mantida aberta para conferência; nenhum BD seguinte será iniciado.`, "error");
        sendResponse({ ok: true, paused: !cancelled, cancelled });
        return;
      }
      batch.processing = true;
      batch.phase = "closing-ticket";
      batch.processed.add(batch.sequence);
      const finishedTicketTabId = batch.ticketTabId;
      activeRuns.delete(finishedTicketTabId);
      await persistActiveRuns();
      await persistBatch(batch);
      try {
        // Sucesso: a guia fica aberta até o SIGITM confirmar (CLOSE_RELEASED_TICKET_TAB); falha definitiva fecha a guia.
        if (!message.releasePending) {
          try { await chrome.tabs.remove(finishedTicketTabId); } catch { /* guia já fechada */ }
        }
        batch.phase = "refreshing-list";
        await persistBatch(batch);
        await returnToListAndRefresh(batch, skipFailed ? message.reason || "falha na baixa" : "");
        batch.ticketTabId = null;
        batch.ticketRunId = "";
        batch.phase = "idle";
        batch.ticketUncertain = false;
        await persistBatch(batch);
        sendResponse({ ok: true, success: message.success === true, refreshed: true });
        // processNextBatchTicket lê a lista de novo e confirma zero registros por conta própria.
        if ((await getPendingRunQueue()).length) void startNextQueuedRun();
        else setTimeout(() => void processNextBatchTicket(batch), 0);
      } catch (error) {
        await finishBatch(batch, `Fila pausada após fechar o ticket ${batch.sequence}: ${error.message}`, "error");
        sendResponse({ ok: false, error: error.message });
      } finally {
        batch.processing = false;
      }
    }).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "CLOSE_SINGLE_TICKET_TAB") {
    // BD único: depois de “Ticket liberado”, fecha somente esta guia e não volta à tabela.
    const tabId = sender.tab?.id;
    if (!senderIsSigitm(sender) || typeof tabId !== "number") { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    hydrateActiveRuns().then(async () => {
      const inBatch = [...batchRuns.values()].some(batch => !batch.finished && (batch.ticketTabId === tabId || batch.listTabId === tabId));
      if (inBatch) { sendResponse({ ok: false, error: "A guia pertence a uma fila ativa." }); return; }
      const runId = String(message.runId || "");
      const stored = await BaixaStorage.get("baixaActiveRun");
      if (stored.baixaActiveRun?.tabId === tabId && (!runId || stored.baixaActiveRun.runId === runId)) await BaixaStorage.set({ baixaActiveRun: null });
      if (activeRuns.get(tabId) && (!runId || activeRuns.get(tabId).runId === runId)) { activeRuns.delete(tabId); await persistActiveRuns(); }
      await setLiveStatus("Ticket liberado. Guia do BD fechada (BD único).", "success", { phase: "concluído", tabId, runId });
      chrome.tabs.remove(tabId, () => { void chrome.runtime.lastError; sendResponse({ ok: true }); });
    }).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "CLOSE_RELEASED_TICKET_TAB") {
    const tabId = sender.tab?.id;
    if (!senderIsSigitm(sender) || typeof tabId !== "number") { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    const inUse = activeRuns.has(tabId) || [...batchRuns.values()].some(batch => !batch.finished && (batch.ticketTabId === tabId || batch.listTabId === tabId));
    if (inUse) { sendResponse({ ok: false, error: "A guia ainda está em uso pela fila." }); return false; }
    chrome.tabs.remove(tabId, () => { void chrome.runtime.lastError; sendResponse({ ok: true }); });
    return true;
  }

  if (message?.type === "RECORD_FINAL_RESULT") {
    if (!senderIsSigitm(sender)) { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    const record = message.record;
    BaixaStorage.get("baixaActiveRun").then(async stored => {
      const run = stored.baixaActiveRun;
      if (run?.runId !== message.runId || run?.tabId !== sender.tab?.id) return;
      await BaixaStorage.addHistory(record || {});
      if (record?.resultado === "PROCESSAMENTO INTERROMPIDO") return;
      const currentState = await BaixaStorage.get(BaixaStorage.KEYS.current);
      const current = currentState[BaixaStorage.KEYS.current] || {};
      return saveCurrent({ ...current, executionResult: record?.resultado || "", executionError: record?.erro || "" });
    })
      .then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_EXTENSION_STATE") {
    if (!senderIsExtension(sender)) { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    hydrateActiveRuns().then(() => Promise.all([BaixaStorage.get([BaixaStorage.KEYS.current, BaixaStorage.KEYS.history, BaixaStorage.KEYS.stop, "baixaAiConnectionStatus", "baixaActiveRun", "baixaLiveStatus", BATCH_STORAGE_KEY, RUN_QUEUE_KEY, ACTIVE_RUNS_KEY]), BaixaStorage.getSettings()]))
      .then(([stored, settings]) => {
        const activeRun = stored.baixaActiveRun;
        const activeBatch = stored[BATCH_STORAGE_KEY];
        const pendingRuns = BaixaRunQueue.normalize(stored[RUN_QUEUE_KEY]);
        const liveStatus = stored.baixaLiveStatus || null;
        const stopped = stored[BaixaStorage.KEYS.stop] === true || activeRun?.stopped === true;
        const activeRunMap = new Map((Array.isArray(stored[ACTIVE_RUNS_KEY]) ? stored[ACTIVE_RUNS_KEY] : [])
          .filter(run => Number.isInteger(run?.tabId) && run.runId)
          .map(run => [run.tabId, run]));
        for (const [tabId, run] of activeRuns) activeRunMap.set(tabId, {
          tabId, runId: run.runId, title: run.title || `Chamado ${tabId}`, startedAt: run.startedAt || "", kind: run.kind || "ticket"
        });
        if (activeRun && !activeRun.stopped && !activeRunMap.has(activeRun.tabId)) {
          activeRunMap.set(activeRun.tabId, {
            tabId: activeRun.tabId, runId: activeRun.runId,
            title: `Chamado ${activeRun.tabId}`, startedAt: activeRun.startedAt || "", kind: "ticket"
          });
        }
        const activeRunList = [...activeRunMap.values()];
        const automationActive = !stopped && Boolean(
          activeRunList.length > 0 || (activeBatch && !activeBatch.finished) || pendingRuns.length > 0
        );
        sendResponse({
        ok: true,
        current: stored[BaixaStorage.KEYS.current] || null,
        history: stored[BaixaStorage.KEYS.history] || [],
        stopped,
        automationActive,
        activeRuns: activeRunList,
        activeRunCount: Math.max(activeRunCount(), activeRunList.length),
        maxConcurrentRuns: MAX_CONCURRENT_RUNS,
        mode: settings.mode,
        downloadMode: settings.downloadMode,
        aiConfigured: Boolean(settings.apiKey),
        provider: settings.provider,
        aiConnection: stored.baixaAiConnectionStatus || null,
        liveStatus,
        activeBatch: activeBatch ? {
          batchId: activeBatch.batchId,
          listName: activeBatch.listName,
          sequence: activeBatch.sequence || "",
          processed: Array.isArray(activeBatch.processed) ? activeBatch.processed.length : 0,
          ticketOpen: typeof activeBatch.ticketTabId === "number" && activeBatch.ticketTabId > 0,
          finished: Boolean(activeBatch.finished)
        } : null,
        pendingRuns: pendingRuns.map((item, index) => ({
          tabId: item.tabId, title: item.title, position: index + 1, queuedAt: item.queuedAt
        }))
        });
      }).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_OPTIONS") {
    if (!senderIsExtension(sender)) { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    Promise.all([BaixaStorage.getSettings(), BaixaStorage.get([BaixaStorage.KEYS.history])])
      .then(([settings, stored]) => {
        const requestedProvider = message.provider === "groq" ? "groq" : message.provider === "gemini" ? "gemini" : settings.provider;
        const hasApiKey = Boolean(settings.apiKeys?.[requestedProvider] || (requestedProvider === "gemini" && settings.apiKey));
        sendResponse({
        ok: true,
        settings: {
          provider: requestedProvider,
          model: settings.model,
          temperature: settings.temperature,
          minimumConfidence: settings.minimumConfidence,
          mode: settings.mode,
          downloadMode: settings.downloadMode
        },
        hasApiKey,
        history: stored[BaixaStorage.KEYS.history] || []
        });
      })
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "TEST_AI_API") {
    if (!senderIsExtension(sender)) { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    BaixaStorage.getSettings().then(async current => {
      const provider = message.settings?.provider === "groq" ? "groq" : "gemini";
      const savedProviderKey = current.apiKeys?.[provider] || (provider === "gemini" ? current.apiKey : "");
      const apiKey = String(message.settings?.apiKey || savedProviderKey || "").trim();
      if (!apiKey) throw new Error("Informe e salve uma API Key antes de testar.");

      // Apenas dados sintéticos e públicos; nunca enviar dados de um chamado real neste teste.
      const sample = {
        tipoAbertura: "INICIAL",
        procedencia: "REATIVO",
        tipoIncidencia: "DADOS",
        cliente: "SEDUC - SECRETARIA DE EDUCAÇÃO",
        intragov: false,
        servicoAfetado: "Internet"
      };
      const result = await BaixaAIService.analyzeCase(sample, {
        provider,
        apiKey,
        model: String(message.settings?.model || current.model || BaixaHelpers.DEFAULT_MODELS[provider]).trim(),
        temperature: Number(message.settings?.temperature ?? current.temperature)
      });
      if (!result.available) {
        const safeReason = String(result.reason || "Falha desconhecida.").split(apiKey).join("[chave ocultada]");
        throw new Error(safeReason);
      }
      return { provider: provider === "groq" ? "Groq Cloud" : "Gemini API", providerId: provider, model: String(message.settings?.model || current.model), structuredJson: true };
    }).then(async test => {
      const status = { connected: true, ...test, testedAt: new Date().toISOString(), message: "Conexão e resposta JSON validadas." };
      await BaixaStorage.set({ baixaAiConnectionStatus: status });
      sendResponse({ ok: true, test });
    }).catch(async error => {
      const provider = message.settings?.provider === "groq" ? "groq" : "gemini";
      const status = { connected: false, providerId: provider, provider: provider === "groq" ? "Groq Cloud" : "Gemini API", testedAt: new Date().toISOString(), message: error.message || "Não foi possível testar a API." };
      try { await BaixaStorage.set({ baixaAiConnectionStatus: status }); } catch { /* estado do teste é apenas indicativo */ }
      sendResponse({ ok: false, error: status.message });
    });
    return true;
  }

  if (message?.type === "SAVE_OPTIONS") {
    if (!senderIsExtension(sender)) { sendResponse({ ok: false, error: "Origem não autorizada." }); return false; }
    const value = message.settings || {};
    BaixaStorage.getSettings().then(current => {
      const temperature = Number(value.temperature);
      const confidence = Number(value.minimumConfidence);
      const provider = value.provider === "groq" ? "groq" : "gemini";
      const settings = {
      provider,
      apiKeys: {
        ...(current.apiKeys || {}),
        ...(current.provider === "gemini" && current.apiKey && !current.apiKeys?.gemini ? { gemini: current.apiKey } : {}),
        [provider]: value.deleteApiKey
          ? ""
          : String(value.apiKey || "").trim() || (current.apiKeys?.[provider] || (current.provider === provider ? current.apiKey : ""))
      },
      model: String(value.model || BaixaHelpers.DEFAULT_MODELS[provider]).trim(),
      temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : current.temperature,
      minimumConfidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : current.minimumConfidence,
      mode: value.mode === "automatic" ? "automatic" : "analysis",
      downloadMode: value.downloadMode === "queue" ? "queue" : value.downloadMode === "single" ? "single" : current.downloadMode
      };
      return BaixaStorage.set({ [BaixaStorage.KEYS.settings]: settings });
    }).then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener(tabId => {
  void (async () => {
    await hydrateActiveRuns();
    activeRuns.get(tabId)?.controller.abort();
    activeRuns.delete(tabId);
    await persistActiveRuns();
    for (const batch of batchRuns.values()) {
      const expectedClose = ["closing-ticket", "refreshing-list"].includes(batch.phase);
      if (batch.ticketTabId === tabId && !batch.finished && !expectedClose) {
        batch.ticketUncertain = true;
        void finishBatch(batch, `Fila pausada: a guia do ticket ${batch.sequence} foi fechada antes da confirmação.`, "error");
      } else if (batch.listTabId === tabId && !batch.finished) {
        batch.ticketUncertain = Boolean(batch.ticketTabId);
        void finishBatch(batch, `Fila da lista ${batch.listName} encerrada porque a guia da tabela foi fechada.`, "error");
      }
    }
    const stored = await BaixaStorage.get(["baixaActiveRun", RUN_QUEUE_KEY]);
    const pending = BaixaRunQueue.removeTab(stored[RUN_QUEUE_KEY], tabId);
    if (pending.length !== BaixaRunQueue.normalize(stored[RUN_QUEUE_KEY]).length) await savePendingRunQueue(pending);
    if (stored.baixaActiveRun?.tabId === tabId) await BaixaStorage.set({ baixaActiveRun: null });
    await startNextQueuedRun();
  })().catch(() => undefined);
});
