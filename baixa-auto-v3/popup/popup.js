"use strict";

const $ = id => document.getElementById(id);

function friendlyError(error) {
  const message = String(error?.message || error || "Falha desconhecida.");
  if (/could not establish connection|receiving end does not exist/i.test(message)) {
    return "A extensão ainda não conectou à página. Recarregue a extensão em chrome://extensions e depois atualize a página do SIGITM.";
  }
  return message;
}

function renderQueueList(sectionId, listId, items, formatItem) {
  const section = $(sectionId);
  const list = $(listId);
  list.replaceChildren();
  for (const item of items) {
    const row = document.createElement("li");
    row.textContent = formatItem(item);
    list.append(row);
  }
  section.hidden = items.length === 0;
}

function setupLogo() {
  const logo = $("brandLogo");
  if (!logo || !chrome.runtime?.getURL) return;
  const sources = [
    chrome.runtime.getURL("icons/sigitm-v2-128.png"),
    chrome.runtime.getURL("assets/sigitm-v2.svg")
  ];
  let index = 0;
  const next = () => {
    if (index >= sources.length) return;
    logo.src = sources[index++];
  };
  logo.addEventListener("error", next);
  next();
}

function send(message) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else if (!response?.ok) reject(new Error(response?.error || "Falha de comunicação."));
    else resolve(response);
  }));
}

function updatePrimaryAction(mode = $("mode").value) {
  const automatic = mode === "automatic";
  $("executeLabel").textContent = automatic ? "Baixar automaticamente" : "Analisar chamado";
  $("executeIcon").textContent = automatic ? "▶" : "⌕";
  $("execute").setAttribute("aria-label", automatic ? "Baixar automaticamente" : "Analisar chamado");
}

function updateDownloadModeHint(value = $("downloadMode").value) {
  $("downloadModeHint").textContent = value === "queue"
    ? "Fila: após liberar o ticket, volta à tabela, atualiza e abre o próximo BD. Em uma lista SIGITM, processa um por vez."
    : "BD único: baixa somente o BD aberto e fecha a guia ao liberar o ticket, sem voltar à tabela nem abrir outros BDs.";
}

function renderState(state) {
  const result = state.current;
  $("mode").value = state.mode || "analysis";
  $("downloadMode").value = state.downloadMode === "queue" ? "queue" : "single";
  updateDownloadModeHint($("downloadMode").value);
  updatePrimaryAction($("mode").value);
  $("modeHint").textContent = state.mode === "automatic"
    ? "Preenche e grava o chamado atual; se estiver em uma lista SIGITM, processa um ticket por vez. Use PARAR a qualquer momento."
    : "Lê os campos e mostra o código recomendado; não altera o chamado.";
  const stopButton = $("stop");
  if (state.stopped) {
    stopButton.disabled = true;
    stopButton.dataset.state = "paused";
    stopButton.innerHTML = '<span aria-hidden="true">Ⅱ</span> Automação pausada';
  } else if (state.automationActive) {
    stopButton.disabled = false;
    stopButton.dataset.state = "active";
    stopButton.innerHTML = '<span aria-hidden="true">Ⅱ</span> Pausar automação';
  } else {
    stopButton.disabled = true;
    stopButton.dataset.state = "idle";
    stopButton.innerHTML = '<span aria-hidden="true">■</span> Automação inativa';
  }
  const live = state.liveStatus;
  const liveSection = $("liveStatus");
  if (liveSection) {
    const isActive = Boolean(state.automationActive);
    const liveType = live?.status === "error" ? "error"
      : live?.status === "success" ? "success"
      : isActive ? "active" : "idle";
    liveSection.dataset.state = liveType;
    $("liveTitle").textContent = isActive
      ? (state.activeBatch?.sequence ? `Processando BD ${state.activeBatch.sequence}` : "Executando automação")
      : (live?.phase === "concluído" ? "Última execução concluída" : state.stopped ? "Automação pausada" : "Aguardando comando");
    $("liveMessage").textContent = live?.message || (state.stopped
      ? "A automação foi pausada pelo usuário."
      : "Abra um chamado ou uma lista SIGITM e inicie a automação.");
    $("liveBadge").textContent = liveType === "error" ? "ATENÇÃO"
      : liveType === "success" ? "CONCLUÍDO"
      : isActive ? "EM ANDAMENTO"
      : state.stopped ? "PAUSADO" : "PARADO";
    const batchInfo = $("batchInfo");
    if (state.activeBatch && !state.activeBatch.finished) {
      batchInfo.hidden = false;
      $("batchList").textContent = state.activeBatch.listName || "Lista SIGITM";
      $("batchTicket").textContent = state.activeBatch.sequence ? `BD ${state.activeBatch.sequence}` : "Aguardando próximo BD";
      $("batchCount").textContent = `${state.activeBatch.processed || 0} concluído(s)`;
    } else {
      batchInfo.hidden = true;
    }
  }

  const activeRuns = Array.isArray(state.activeRuns) ? state.activeRuns : [];
  const pendingRuns = Array.isArray(state.pendingRuns) ? state.pendingRuns : [];
  const recentFailures = (Array.isArray(state.history) ? state.history : [])
    .filter(item => /BAIXA NÃO REALIZADA|BAIXA INCERTA|PROCESSAMENTO INTERROMPIDO|DIVERGÊNCIA|BLOQUEADO/i.test(item.resultado || ""))
    .slice(-3).reverse();
  const runQueueInfo = $("runQueueInfo");
  runQueueInfo.hidden = !activeRuns.length && !pendingRuns.length && !recentFailures.length;
  $("runCount").textContent = `Ativas: ${state.activeRunCount ?? activeRuns.length}/${state.maxConcurrentRuns ?? 2}`;
  $("waitingCount").textContent = `Na fila: ${pendingRuns.length}`;
  renderQueueList("activeQueueSection", "activeRunList", activeRuns,
    item => `${item.title || `Chamado ${item.tabId}`}${item.kind === "batch" ? " · lote" : ""}`);
  renderQueueList("waitingQueueSection", "waitingRunList", pendingRuns,
    item => `${item.position}. ${item.title || `Chamado ${item.tabId}`}`);
  renderQueueList("failedQueueSection", "failedRunList", recentFailures,
    item => `${item.numeroChamado ? `Chamado ${item.numeroChamado}: ` : ""}${item.resultado}${item.erro ? ` — ${item.erro}` : ""}`);

  const connection = state.aiConnection;
  const sameProviderTest = connection?.providerId === state.provider;
  if (!state.aiConfigured) {
    $("aiStatus").dataset.state = "fallback";
    $("aiStatusTitle").textContent = "Sem conexão — regras locais ativas";
    $("aiStatusText").textContent = `A IA não é necessária para baixar: as regras locais continuam classificando os chamados. Sem chave ${state.provider}, não há conferência online.`;
  } else if (sameProviderTest && connection.connected) {
    $("aiStatus").dataset.state = "ready";
    $("aiStatusTitle").textContent = `Conectada — validação adicional ativa (${connection.provider})`;
    const testedAt = connection.testedAt ? new Date(connection.testedAt).toLocaleString() : "";
    $("aiStatusText").textContent = `${connection.model || "Modelo configurado"} · teste aprovado. A IA confere as regras locais; se houver divergência, a baixa é bloqueada.${testedAt ? ` Testada: ${testedAt}.` : ""}`;
  } else if (sameProviderTest && connection.connected === false) {
    $("aiStatus").dataset.state = "error";
    $("aiStatusTitle").textContent = `IA indisponível — regras locais continuam ativas`;
    $("aiStatusText").textContent = `${connection.message || "O último teste da IA falhou."} A IA é opcional; se a consulta falhar, as regras locais são usadas. Uma divergência válida continua bloqueando a baixa.`;
  } else {
    $("aiStatus").dataset.state = "saved";
    $("aiStatusTitle").textContent = `Chave salva — conexão ainda não testada (${state.provider})`;
    $("aiStatusText").textContent = "A extensão tentará usar a IA e recorrerá às regras locais se ela falhar. Se a IA responder com uma classificação divergente, a baixa será bloqueada.";
  }
  if (!result) return;
  $("result").dataset.state = result.allowed ? "ready" : "blocked";
  $("resultTitle").textContent = result.executionResult || (result.allowed ? `${result.codigoBaixa} · ${result.validation?.status || "Validado"}` : (result.validation?.status || "Bloqueado"));
  const lines = [
    `Chamado: ${result.caseData?.numeroChamado || "não identificado"}`,
    `Tipo de Abertura: ${result.caseData?.tipoAbertura || "não identificado"}`,
    `Procedência: ${result.caseData?.procedencia || "não identificada"}`,
    `Tipo de Incidência: ${result.caseData?.tipoIncidencia || "não identificada"}`,
    `Cliente: ${result.caseData?.cliente || "não identificado"}`,
    `Intragov: ${result.caseData?.intragov === true ? "Sim" : result.caseData?.intragov === false ? "Não" : result.caseData?.intragov || "não identificado"}`,
    `Serviço Afetado: ${result.caseData?.servicoAfetado || "não identificado"}`,
    `Data Criação: ${result.caseData?.dataCriacao || "não identificada"}`,
    `Data de Reparo original: ${result.caseData?.dataReparoOriginal || "não identificada"}`,
    `Data/hora que será utilizada para a baixa: ${result.caseData?.dataReparo || result.caseData?.dataReparoPrevista || "não calculável"}`,
    `Validação de data e SLA: ${result.caseData?.validacaoDataBaixa || "não executada"}`,
    `Início do SLA: ${result.caseData?.dataInicioSla || "não identificado"}`,
    `Data Objetivo: ${result.caseData?.dataObjetivo || "não identificada"}`,
    `Pausa de Relógio: ${result.caseData?.paradaRelogio || "não identificada"}`,
    `Início da parada: ${result.caseData?.dataInicioParadaRelogio || result.caseData?.dataParadaRelogio || "não identificado"}`,
    `Fim da parada: ${result.caseData?.dataFimParadaRelogio || "não identificado"}`,
    `Acionamento: ${result.caseData?.codigoAcionamento || result.caseData?.acionamento || "não identificado"}`,
    `Código de baixa previsto: ${result.codigoBaixa || "não determinado — dados de classificação insuficientes"}`,
    `Diagnóstico previsto: ${result.diagnostico || "não determinado — incidência/regra não identificada"}`,
    `Origem/regra do código: ${result.codeSelection?.source || result.motivo || "não determinada"}`,
    `Motivo: ${result.motivo || result.validation?.reason || "—"}`,
    `Confiança IA: ${result.ai?.confidence == null ? "indisponível" : `${Math.round(result.ai.confidence * 100)}%`}`,
    `Validação: ${result.validation?.reason || result.validation?.status || "—"}`
  ];
  $("resultSummary").textContent = lines.join("\n");
}

async function refresh() {
  try { renderState(await send({ type: "GET_EXTENSION_STATE" })); }
  catch (error) { $("resultTitle").textContent = "Extensão desconectada"; $("resultSummary").textContent = friendlyError(error); }
}

$("mode").addEventListener("change", async event => {
  const mode = event.target.value;
  if (mode === "automatic" && !confirm("O modo automático preencherá e acionará Gravar Baixa após todas as validações. Deseja ativá-lo?")) {
    event.target.value = "analysis";
    updatePrimaryAction("analysis");
    return;
  }
  updatePrimaryAction(mode);
  try {
    const options = await send({ type: "GET_OPTIONS" });
    await send({ type: "SAVE_OPTIONS", settings: { ...options.settings, mode } });
    updatePrimaryAction(mode);
    await refresh();
  } catch (error) { $("resultSummary").textContent = friendlyError(error); }
});

$("downloadMode").addEventListener("change", async event => {
  const downloadMode = event.target.value === "queue" ? "queue" : "single";
  updateDownloadModeHint(downloadMode);
  try {
    const options = await send({ type: "GET_OPTIONS" });
    await send({ type: "SAVE_OPTIONS", settings: { ...options.settings, downloadMode } });
    await refresh();
  } catch (error) { $("resultSummary").textContent = friendlyError(error); }
});

async function startRun() {
  const mode = $("mode").value;
  const button = $("execute");
  button.disabled = true;
  $("executeLabel").textContent = mode === "automatic" ? "Iniciando fluxo…" : "Iniciando análise…";
  try {
    const options = await send({ type: "GET_OPTIONS" });
    await send({ type: "SAVE_OPTIONS", settings: { ...options.settings, mode, downloadMode: $("downloadMode").value } });
    await send({ type: "RUN_ACTIVE_TAB" });
    window.close();
  } catch (error) {
    $("resultTitle").textContent = "Não foi possível iniciar";
    $("resultSummary").textContent = friendlyError(error);
    button.disabled = false;
    updatePrimaryAction($("mode").value);
  }
}

$("execute").addEventListener("click", async () => {
  if ($("mode").value === "automatic") {
    const approved = confirm($("downloadMode").value === "queue"
      ? "Executar a baixa automática? Modo FILA: em uma tabela SIGITM, abrirá e processará os tickets da coluna Seq um por vez até a lista ficar vazia; em um chamado, ao liberar volta à tabela e segue para o próximo. A guia só fecha após confirmar “Ticket liberado”."
      : "Executar a baixa automática? BD único: processa somente este chamado e fecha a guia após confirmar “Ticket liberado”.");
    if (!approved) return;
  }
  await startRun();
});

$("stop").addEventListener("click", async () => {
  try {
    $("stop").disabled = true;
    $("stop").textContent = "Pausando…";
    await send({ type: "STOP_AUTOMATION" });
    await refresh();
    $("resultTitle").textContent = "Automação pausada";
    $("resultSummary").textContent = "A execução atual foi interrompida e nenhuma próxima ação será iniciada. Para rodar novamente, escolha o modo e use o botão principal.";
  }
  catch (error) {
    $("resultTitle").textContent = "Não foi possível parar";
    $("resultSummary").textContent = friendlyError(error);
    void refresh();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.baixaCurrentResult || changes.baixaSettings || changes.baixaStopRequested || changes.baixaAiConnectionStatus || changes.baixaBatchRun || changes.baixaActiveRun || changes.baixaActiveRuns || changes.baixaPendingRunQueue || changes.baixaHistory || changes.baixaLiveStatus)) void refresh();
});
setupLogo();
void refresh();
