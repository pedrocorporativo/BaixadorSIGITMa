"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const base = path.join(__dirname, "..");
const helpers = require(path.join(base, "utils/helpers.js"));
global.BaixaHelpers = helpers;
const rules = require(path.join(base, "rules/baixa-rules.js"));
global.BaixaRules = rules;
const validation = require(path.join(base, "rules/validation.js"));
const navigation = require(path.join(base, "automation/navigation.js"));
global.BaixaNavigation = navigation;
const batchHandler = require(path.join(base, "automation/batch-handler.js"));
global.BaixaBatch = batchHandler;
const baixaHandler = require(path.join(base, "automation/baixa-handler.js"));
const formHandler = require(path.join(base, "automation/form-handler.js"));
const runGuard = require(path.join(base, "background/run-guard.js"));
const runQueue = require(path.join(base, "background/run-queue.js"));
const aiSchema = require(path.join(base, "ai/ai-schema.js"));
global.BaixaAISchema = aiSchema;
const aiProvider = require(path.join(base, "ai/ai-provider.js"));
global.BaixaAIProvider = aiProvider;
const aiService = require(path.join(base, "ai/ai-service.js"));
const dateHandler = require(path.join(base, "automation/date-handler.js"));
global.BaixaDateHandler = dateHandler;
const queue = require(path.join(base, "automation/queue.js"));
const storage = require(path.join(base, "storage/storage.js"));

function fields(overrides = {}) {
  return {
    numeroChamado: "123456",
    tipoAbertura: "INICIAL",
    procedencia: "REATIVO",
    tipoIncidencia: "DADOS",
    cliente: "CEDRO",
    intragov: "Não",
    servicoAfetado: "Internet",
    dataCriacao: "02/10/2026 08:00",
    dataInicioSla: "02/10/2026 08:00",
    dataReparo: "02/10/2026 10:00",
    dataObjetivo: "02/10/2026 12:00",
    paradaRelogio: "Não",
    dataParadaRelogio: "",
    dataFimParadaRelogio: "",
    acionamento: "Não",
    codigoAcionamento: "",
    ...overrides
  };
}

async function main() {
  const runId = "run-current-123";
  const controller = new AbortController();
  assert.equal(runGuard.authorizeRun({
    tabId: 9, runId,
    persistentRun: null,
    memoryRun: { runId, controller }
  }).repairStorage, true, "Um run ainda ativo em memória deve recuperar um lock ausente no storage");
  assert.equal(runGuard.authorizeRun({
    tabId: 9, runId,
    persistentRun: { tabId: 9, runId, stopped: false },
    memoryRun: null
  }).allowed, true, "O storage deve reconhecer a execução após reinício do service worker");
  assert.equal(runGuard.authorizeRun({
    tabId: 9, runId,
    persistentRun: { tabId: 9, runId, stopped: true },
    memoryRun: null
  }).allowed, false, "Execução parada não pode ser recuperada automaticamente");
  assert.equal(runGuard.authorizeRun({
    tabId: 9, runId,
    persistentRun: null,
    memoryRun: { runId: "different-run", controller: new AbortController() }
  }).allowed, false, "Run ID estranho não pode ser aceito");
  assert.equal(runGuard.authorizeRun({
    tabId: 9, runId,
    persistentRun: { tabId: 8, runId: "other-run", stopped: false },
    memoryRun: { runId, controller }
  }).allowed, true, "Execuções em guias diferentes devem operar em filas independentes");
  assert.equal(runGuard.authorizeRun({
    tabId: 9, runId,
    persistentRun: { tabId: 9, runId: "newer-run", stopped: false },
    memoryRun: { runId, controller }
  }).source, "memory", "O run atual em memória deve reparar um lock antigo da mesma guia");
  assert.equal(runGuard.authorizeRun({
    tabId: 9, runId,
    persistentRun: { tabId: 9, runId: "newer-run", stopped: false },
    memoryRun: { runId: "older-run", controller: new AbortController() }
  }).reason, "Esta solicitação foi substituída por uma execução mais recente.", "Um run antigo não deve suplantar o run persistido mais recente");
  assert.equal(runGuard.authorizeRun({
    tabId: 9, runId,
    persistentRun: null,
    memoryRun: null,
    stopRequested: false
  }).source, "recovered-request", "Um lock perdido pode ser recuperado quando não existe parada explícita");
  assert.equal(runGuard.authorizeRun({
    tabId: 9, runId,
    persistentRun: null,
    memoryRun: null,
    stopRequested: true
  }).allowed, false, "Um pedido explícito de parada não pode ser recuperado");
  assert.equal(runGuard.authorizeRun({
    tabId: 9, runId,
    persistentRun: null,
    memoryRun: null,
    stopRequested: false,
    hasOtherActiveRun: true
  }).allowed, true, "Guia concorrente não deve bloquear outra execução quando as filas são independentes por aba");

  let clickedTab = false;
  const legacyTab = {
    tagName: "TD",
    className: "rich-tab-active",
    innerText: "Definição",
    textContent: "Definição",
    disabled: false,
    offsetParent: {},
    getClientRects: () => [{ width: 70, height: 28 }],
    getAttribute: () => null,
    matches: selector => selector.includes("td"),
    closest() { return this; },
    contains: () => false,
    click() { clickedTab = true; }
  };
  global.document = {
    querySelectorAll(selector) {
      if (selector === "iframe, frame") return [];
      if (selector.startsWith("a, button")) return [];
      if (selector === "td, th, li, span, div") return [legacyTab];
      return [];
    }
  };
  assert.equal(await navigation.clickTab("Definição"), true, "Deve clicar em abas SIGITM desenhadas como células antigas de tabela");
  assert.equal(clickedTab, true);
  const previousDocumentForShiftedTab = global.document;
  const shiftedTabDoc = {
    body: { innerText: "Tipo de Abertura" },
    defaultView: { getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto", position: "static" }) },
    querySelectorAll(selector) {
      if (selector === "iframe, frame") return [];
      if (selector.startsWith("a, button")) return [shiftedTable];
      if (selector === "td, th, li, span, div") return currentDefinitionLabel ? [currentDefinitionLabel] : [];
      return [];
    }
  };
  const shiftedTable = { tagName: "TABLE", id: "formTiquete:tabDefinicao_shifted", getAttribute: name => name === "onclick" ? "return abrirAba()" : null };
  let currentDefinitionLabel = null;
  let initialDefinitionLabel = null;
  let replacementDefinitionLabel = null;
  const makeDefinitionLabel = () => ({
    tagName: "SPAN", innerText: "Definição", textContent: "Definição", isConnected: true,
    ownerDocument: shiftedTabDoc, offsetParent: {}, className: "",
    getClientRects: () => [{ width: 90, height: 24 }],
    getBoundingClientRect: () => ({ width: 90, height: 24 }),
    getAttribute: () => null, matches: () => false,
    closest: selector => selector === "td, th" ? null : shiftedTable,
    contains: () => false,
    focus() {
      if (this === initialDefinitionLabel && replacementDefinitionLabel) {
        this.isConnected = false;
        currentDefinitionLabel = replacementDefinitionLabel;
      }
    },
    click() { this.wasClicked = true; this.className = "rich-tab-active"; }
  });
  initialDefinitionLabel = makeDefinitionLabel();
  currentDefinitionLabel = initialDefinitionLabel;
  replacementDefinitionLabel = makeDefinitionLabel();
  global.document = shiftedTabDoc;
  assert.deepEqual(navigation.findTabCandidates("Definição"), [initialDefinitionLabel],
    "Mesmo com handler, uma tabela *_shifted não deve ser escolhida no lugar do rótulo interno da aba");
  assert.equal(await navigation.clickTab("Definição"), true);
  assert.equal(initialDefinitionLabel.wasClicked, true,
    "O clique deve atingir o rótulo interno sem forçar foco no wrapper RichFaces");
  global.document = previousDocumentForShiftedTab;

  const previousDocumentForDuplicateTabs = global.document;
  const certificationGroup = { tagName: "TABLE", id: "form:tabset-principal", className: "rich-tab-header" };
  const duplicateGroup = { tagName: "TABLE", id: "form:tabset-antigo", className: "rich-tab-header" };
  const tabRow = group => ({ tagName: "TR", parentElement: group, getAttribute: () => null });
  const makeTabLabel = (text, group, className = "") => {
    const row = tabRow(group);
    return {
      tagName: "SPAN", innerText: text, textContent: text, className,
      parentElement: row, isConnected: true, disabled: false, offsetParent: {},
      getClientRects: () => [{ width: 80, height: 24 }], getAttribute: () => null,
      matches: () => false, contains: () => false,
      closest: selector => selector.includes("tab") || selector.includes("aba") ? group : null,
      click() { this.wasClicked = true; }
    };
  };
  const activeCertificationTab = makeTabLabel("Certificação", certificationGroup);
  const wantedEncerramentoTab = makeTabLabel("Encerramento", certificationGroup);
  const duplicateEncerramentoTab = makeTabLabel("Encerramento", certificationGroup);
  const staleEncerramentoTab = makeTabLabel("Encerramento", duplicateGroup);
  global.document = {
    querySelectorAll(selector) {
      if (selector === "iframe, frame") return [];
      if (selector.startsWith("a, button")) return [];
      if (selector === "td, th, li, span, div") return [activeCertificationTab, wantedEncerramentoTab, duplicateEncerramentoTab, staleEncerramentoTab];
      return [];
    }
  };
  assert.equal(navigation.selectTabCandidate("Encerramento", [wantedEncerramentoTab, duplicateEncerramentoTab, staleEncerramentoTab], "Certificação"), wantedEncerramentoTab,
    "Sem marcação ARIA/classe de ativo, usar a aba visitada imediatamente antes para resolver rótulos Encerramento duplicados");
  global.document = previousDocumentForDuplicateTabs;
  const previousDocumentForTabPanelVisibility = global.document;
  const hiddenTabPanelStyle = { display: "none", visibility: "visible", opacity: "1", pointerEvents: "auto", position: "static" };
  const tabPanel = {
    id: "formTiquete:tabCliente", ownerDocument: null,
    getClientRects: () => hiddenTabPanelStyle.display === "none" ? [] : [{ width: 300, height: 200 }],
    offsetParent: null
  };
  const tabPanelDocument = {
    body: { innerText: "Cliente Serviço Afetado" },
    defaultView: { getComputedStyle: () => hiddenTabPanelStyle },
    querySelectorAll: selector => selector === "iframe, frame" ? [] : selector === '[id$=":tabCliente"]' ? [tabPanel] : []
  };
  tabPanel.ownerDocument = tabPanelDocument;
  global.document = tabPanelDocument;
  assert.equal(navigation.tabPanelVisible("Cliente"), false,
    "Texto de Cliente no documento não deve confirmar ativação quando o painel Cliente está oculto");
  hiddenTabPanelStyle.display = "block";
  tabPanel.offsetParent = {};
  assert.equal(navigation.tabPanelVisible("Cliente"), true, "O painel Cliente visível deve confirmar a ativação da aba");
  if (previousDocumentForTabPanelVisibility === undefined) delete global.document;
  else global.document = previousDocumentForTabPanelVisibility;
  assert.deepEqual(navigation.resolveActionState(false, ""), { acionamento: "Não", codigoAcionamento: "" }, "Sem 6Z036, o fluxo normal não deve ser bloqueado por texto ausente de acionamento");
  assert.deepEqual(navigation.resolveActionState(true, "6Z036 acionamento ativo"), { acionamento: "Sim", codigoAcionamento: "6Z036" });
  assert.deepEqual(navigation.resolveActionState(true, "04785620 acionamento ativo"), { acionamento: "Sim", codigoAcionamento: "" },
    "Um acionamento ativo deve ser identificado pelo status sem presumir que seu código seja 6Z036");
  assert.deepEqual(navigation.resolveActionState(true, "acionamento encerrado"), { acionamento: "Não", codigoAcionamento: "" });
  assert.deepEqual(navigation.resolveActionState(true, "status não identificado"), { acionamento: "", codigoAcionamento: "" }, "Se 6Z036 existe mas estado não é legível, o fluxo continua bloqueado por segurança");
  const previousDocumentForPauseTable = global.document;
  const pauseTableStyle = { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto", position: "static" };
  const pauseDoc = {
    defaultView: { getComputedStyle: () => pauseTableStyle },
    querySelectorAll(selector) {
      if (selector === "iframe, frame") return [];
      if (selector === "table[id*='listParadaRelogio']") return [pauseTable];
      return [];
    }
  };
  const pauseCell = text => ({ innerText: text, textContent: text });
  const pauseHeader = { querySelectorAll: () => ["Código", "Motivo", "Contato", "Telefone", "Início", "Fim"].map(pauseCell) };
  const makePauseTable = ({ text = "Parada relógio", rows = [pauseHeader], loading = false } = {}) => {
    const loader = {
      id: "pause-loading", className: "loading", innerText: "carregando...", textContent: "carregando...",
      ownerDocument: pauseDoc, getClientRects: () => [{ width: 40, height: 20 }],
      getBoundingClientRect: () => ({ width: 40, height: 20 }), getAttribute: () => null
    };
    return {
      id: "formTiquete:incFrmTqt9:listParadaRelogio", innerText: text, textContent: text,
      ownerDocument: pauseDoc, getClientRects: () => [{ width: 500, height: 100 }],
      getBoundingClientRect: () => ({ width: 500, height: 100 }),
      querySelectorAll(selector) {
        if (selector === "tr") return rows;
        if (selector.includes("aria-busy") || selector.includes("status.start") || selector.includes("loading") || selector.includes("carregando")) return loading ? [loader] : [];
        return [];
      }
    };
  };
  let pauseTable = makePauseTable({ rows: [pauseHeader, { querySelectorAll: () => ["10156468", "Ausente", "", "", "21/10/26 04:04", "21/10/26 09:00"].map(pauseCell) }] });
  global.document = pauseDoc;
  assert.deepEqual(navigation.clockPauseTableSnapshot(), {
    start: "21/10/26 04:04", end: "21/10/26 09:00", detected: true, status: "found"
  }, "A tabela de parada carregada deve retornar início e fim válidos");
  pauseTable = makePauseTable();
  assert.equal(navigation.clockPauseTableSnapshot().status, "empty", "Cabeçalhos carregados sem linhas de dados indicam tabela vazia");
  const pagerRow = {
    className: "dr-table-footer rich-table-footer",
    querySelectorAll: () => ["", "««", "«", "", "", "»", "»»"].map(pauseCell),
    querySelector: () => null
  };
  pauseTable = makePauseTable({ rows: [pauseHeader, pagerRow] });
  assert.equal(navigation.clockPauseTableSnapshot().status, "empty",
    "Rodapé de paginação com setas não deve ser tratado como linha de parada inválida");
  pauseTable = makePauseTable({ text: "Parada relógio carregando..." });
  assert.equal(navigation.clockPauseTableSnapshot().status, "empty",
    "Texto residual carregando sem indicador visível não deve manter a tabela em estado de loading");
  pauseTable = makePauseTable({ text: "Parada relógio carregando...", loading: true });
  assert.equal(navigation.clockPauseTableSnapshot().status, "loading", "Tabela com indicador de carregamento não deve ser tratada como vazia");
  assert.equal((await navigation.readClockPauseData(() => false, 50)).status, "empty",
    "Depois do prazo de espera, ausência de linhas da parada deve permitir seguir como sem pausa");
  const emptyPauseCase = { paradaRelogio: "", dataParadaRelogio: "" };
  assert.equal(navigation.applyClockPauseData(emptyPauseCase, { detected: false, status: "inconclusive", start: "", end: "" }), "",
    "Tabela vazia/inconclusiva sem registro válido deve permitir continuar como sem pausa");
  assert.equal(emptyPauseCase.paradaRelogio, "Não");
  const explicitlyPausedCase = { paradaRelogio: "Sim", dataParadaRelogio: "" };
  assert.match(navigation.applyClockPauseData(explicitlyPausedCase, { detected: false, status: "inconclusive", start: "", end: "" }), /marcada como Sim/,
    "Uma pausa explicitamente ativa sem horário final continua bloqueada");
  const foundPauseCase = { paradaRelogio: "não identificado", dataParadaRelogio: "" };
  assert.equal(navigation.applyClockPauseData(foundPauseCase, { detected: true, status: "found", start: "21/10/26 04:04", end: "21/10/26 09:00" }), "");
  assert.equal(foundPauseCase.paradaRelogio, "Sim");
  assert.equal(foundPauseCase.dataFimParadaRelogio, "21/10/26 09:00");
  pauseDoc.querySelectorAll = selector => selector === "iframe, frame" ? [] : [];
  assert.equal(navigation.clockPauseTableSnapshot().status, "absent", "Tabela de parada ausente deve ser tratada como ausência de parada");
  assert.equal(navigation.clockPauseTableSnapshot().detected, false);
  if (previousDocumentForPauseTable === undefined) delete global.document;
  else global.document = previousDocumentForPauseTable;
  const previousDocumentForActionRows = global.document;
  const makeActionCell = text => ({ innerText: text, textContent: text });
  const makeActionRow = cells => ({ querySelectorAll: () => cells, getClientRects: () => [{}] });
  const actionHeader = makeActionRow([makeActionCell("Código"), makeActionCell("LP"), makeActionCell("Status"), makeActionCell("Tipo")]);
  const activeActionRow = makeActionRow([makeActionCell("04785620"), makeActionCell(""), makeActionCell("Ativo"), makeActionCell("Parceiro")]);
  const inactiveActionRow = makeActionRow([makeActionCell("04785621"), makeActionCell(""), makeActionCell("Baixado"), makeActionCell("Parceiro")]);
  const actionTable = { querySelectorAll: selector => selector === "tr" ? [actionHeader, activeActionRow, inactiveActionRow] : [] };
  global.document = { querySelectorAll: selector => selector === "iframe, frame" ? [] : selector === "table" ? [actionTable] : [] };
  assert.deepEqual(navigation.findActiveActionRows(), [activeActionRow], "Deve identificar somente a linha cujo Status está Ativo");
  global.document = previousDocumentForActionRows;

  assert.equal(baixaHandler.isActionBaixaPopup({ textContent: "Acionamento Código Completo da Baixa Técnico Telefone técnico Descrição GRAVAR" }), true,
    "O popup deve ser reconhecido pelo título e campo de código, sem exigir que todos os controles já estejam localizados");
  assert.equal(baixaHandler.isActionBaixaPopup({ textContent: "Código Completo da Baixa" }), false,
    "Um campo de código isolado fora do popup não deve ser suficiente para reconhecê-lo");
  const actionPopupCode = { tagName: "INPUT", type: "text", name: "codigoBaixa", disabled: false, readOnly: false, getClientRects: () => [{}] };
  const actionPopupAreaCode = { tagName: "INPUT", type: "text", name: "areaCodigo", disabled: false, readOnly: false, getClientRects: () => [{}] };
  const actionPopupTechnician = { tagName: "INPUT", type: "text", name: "tecnico", disabled: false, readOnly: false, getClientRects: () => [{}] };
  const actionPopupPhone = { tagName: "INPUT", type: "text", name: "telefoneTecnico", disabled: false, readOnly: false, getClientRects: () => [{}] };
  const actionPopupDescription = { tagName: "TEXTAREA", type: "textarea", name: "descricao", disabled: false, readOnly: false, getClientRects: () => [{}] };
  const actionPopupLocked = { tagName: "INPUT", type: "text", name: "somenteLeitura", disabled: false, readOnly: true, getClientRects: () => [{}] };
  const actionPopupHidden = { tagName: "INPUT", type: "hidden", name: "hidden", disabled: false, readOnly: false, getClientRects: () => [{}] };
  const actionPopupButton = { tagName: "INPUT", type: "button", name: "gravar", disabled: false, readOnly: false, getClientRects: () => [{}] };
  const actionPopupScope = {
    querySelectorAll: selector => selector === "input, textarea"
      ? [actionPopupCode, actionPopupAreaCode, actionPopupTechnician, actionPopupPhone, actionPopupDescription, actionPopupLocked, actionPopupHidden, actionPopupButton]
      : []
  };
  assert.deepEqual(formHandler.editableActionTextFields(actionPopupScope, actionPopupCode),
    [actionPopupAreaCode, actionPopupTechnician, actionPopupPhone, actionPopupDescription],
    "Deve preencher todos os campos de texto editáveis no popup, inclusive sem rótulo, sem alterar o código, campos bloqueados ou botões");
  assert.equal(batchHandler.listName("http://sigitm.redecorp.br/SIGITMWeb/pages/consulta/listConsulta.jsf?idConsulta=138550"), "Ativos e Parados");
  assert.equal(batchHandler.listName("http://sigitm.redecorp.br/SIGITMWeb/pages/consulta/listConsulta.jsf?idConsulta=95803"), "Validação Massiva");
  assert.equal(batchHandler.listName("http://sigitm.redecorp.br/SIGITMWeb/pages/consulta/listConsulta.jsf?idConsulta=unknown"), "");
  assert.equal(batchHandler.nextUnprocessedTicket(["BD1", "BD2"], new Set(["BD1"])), "BD2",
    "A fila deve escolher o primeiro BD ainda não concluído após a atualização da tabela");
  assert.equal(batchHandler.nextUnprocessedTicket(["BD1"], new Set(["BD1"])), "",
    "A fila não deve repetir um BD já confirmado enquanto aguarda zero registros");
  const runRequests = [
    { tabId: 11, url: "http://sigitm.redecorp.br/SIGITMWeb/ticket1", title: "Chamado 1" },
    { tabId: 12, url: "http://sigitm.redecorp.br/SIGITMWeb/ticket2", title: "Chamado 2" },
    { tabId: 13, url: "http://sigitm.redecorp.br/SIGITMWeb/ticket3", title: "Chamado 3" }
  ];
  assert.equal(runQueue.hasCapacity(1, 2), true, "Uma vaga deve permanecer disponível abaixo do limite de duas execuções");
  assert.equal(runQueue.hasCapacity(2, 2), false, "A fila deve bloquear novos inícios ao atingir duas execuções");
  assert.equal(runQueue.nextStartable(runRequests, new Set([11]), 1, 2).tabId, 12,
    "A fila deve escolher um chamado diferente da guia já ativa quando ainda há vaga");
  assert.equal(runQueue.nextStartable(runRequests, new Set([11, 12]), 2, 2), null,
    "A terceira baixa deve aguardar até que uma das duas execuções termine");
  assert.equal(runQueue.nextStartable(runRequests, new Set([11]), 1, 2).title, "Chamado 2",
    "O chamado aguardando deve manter seus dados para apresentação no popup");
  assert.equal(batchHandler.ticketSucceeded({ success: true }), true, "Somente confirmação explícita de sucesso permite avançar");
  for (const outcome of [{ success: false }, { success: true, uncertain: true }, { success: true, cancelled: true }, {}]) {
    assert.equal(batchHandler.ticketSucceeded(outcome), false, "Falha, incerteza, cancelamento ou resposta ausente não pode avançar a fila");
  }
  const emptyListDoc = { body: { innerText: "Ativos e Parados (Registros: 0 de 0)" }, querySelectorAll: () => [] };
  assert.deepEqual(batchHandler.readListState([emptyListDoc]), { tickets: [], empty: true, recordCount: { shown: 0, total: 0 } }, "Deve parar ao identificar consulta com zero registros");
  const mockText = text => ({ innerText: text, textContent: text, getClientRects: () => [{}], offsetParent: {} });
  const sequenceLink = mockText("6969062");
  const sequenceCell = { ...mockText("6969062"), querySelector: () => sequenceLink };
  const headerRow = { querySelectorAll: () => [mockText("Seq↕"), mockText("Status")] };
  const ticketRow = { querySelectorAll: () => [sequenceCell, mockText("Ativo")] };
  const table = { querySelectorAll: selector => selector === "tr" ? [headerRow, ticketRow] : [] };
  const listDoc = { body: { innerText: "Ativos e Parados (Registros: 1 de 1)" }, querySelectorAll: selector => selector === "table" ? [table] : [] };
  assert.deepEqual(batchHandler.readListState([listDoc]), { tickets: ["6969062"], empty: false, recordCount: { shown: 1, total: 1 } }, "Deve obter o número da coluna Seq mesmo se o alvo de clique não puder ser lido");
  const noAnchorCell = { ...mockText("6969157") };
  const unlinkedTicketRow = { querySelectorAll: () => [noAnchorCell, mockText("Ativo")] };
  const twoTicketsTable = { querySelectorAll: selector => selector === "tr" ? [headerRow, ticketRow, unlinkedTicketRow] : [] };
  const twoTicketsDoc = { body: { innerText: "Ativos e Parados (Registros: 2 de 2)" }, querySelectorAll: selector => selector === "table" ? [twoTicketsTable] : [] };
  assert.deepEqual(batchHandler.readListState([twoTicketsDoc]), { tickets: ["6969062", "6969157"], empty: false, recordCount: { shown: 2, total: 2 } }, "Deve ler todos os tickets da coluna Seq mesmo quando uma célula não contém uma âncora reconhecida");
  const blockControl = {
    tagName: "INPUT", type: "button", value: "BLOQUEAR", disabled: false,
    offsetParent: {}, getClientRects: () => [{ width: 90, height: 28 }],
    getAttribute: () => null, querySelector: () => null, click() {}
  };
  global.document.querySelectorAll = selector => selector === "iframe, frame" ? [] : [blockControl];
  assert.equal(baixaHandler.findUniqueButton(["Bloquear"]), blockControl, "Deve reconhecer botões antigos do SIGITM pelo value independente de maiúsculas");
  global.document.querySelectorAll = selector => selector === "iframe, frame" ? [] : [];
  assert.throws(() => baixaHandler.findUniqueButton(["Baixar"]), /Botão “Baixar” não encontrado/);
  const customPopupX = {
    disabled: false, onclick: "fecharMensagem()", className: "icone", ownerDocument: { defaultView: {} },
    offsetParent: {}, getClientRects: () => [{ width: 18, height: 18 }],
    getBoundingClientRect: () => ({ left: 724, right: 742, top: 158, bottom: 176 }),
    getAttribute: () => "", matches: () => false, querySelector: () => null,
    querySelectorAll: () => [], closest: () => null, click() {}
  };
  const popupPanel = {
    getBoundingClientRect: () => ({ left: 179, right: 743, top: 151, bottom: 529 }),
    querySelectorAll: () => [customPopupX]
  };
  assert.deepEqual(baixaHandler.closeImageCandidates(popupPanel), [customPopupX], "Deve localizar o X customizado pela posição superior direita mesmo sem texto alt/aria");
  const footerClose = {
    disabled: false, onclick: "fecharRodape()", className: "botao-fechar", ownerDocument: { defaultView: {} },
    offsetParent: {}, getClientRects: () => [{ width: 22, height: 22 }],
    getBoundingClientRect: () => ({ left: 300, right: 322, top: 500, bottom: 522 }),
    getAttribute: () => "", matches: () => false, querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, click() {}
  };
  const popupWithTwoClosers = {
    getBoundingClientRect: () => ({ left: 179, right: 743, top: 151, bottom: 529 }),
    querySelectorAll: () => [footerClose, customPopupX]
  };
  assert.equal(baixaHandler.selectBestPopupCloseControl(popupWithTwoClosers), customPopupX, "Quando existirem vários controles de fechar, o X no canto superior direito deve ser escolhido automaticamente");
  assert.ok(baixaHandler.findCloseControlNearPopup, "O detector deve ter fallback global para um X renderizado fora do contêiner lógico do popup");
  let customCloseCalled = false;
  const javascriptCloseLink = {
    getAttribute: name => name === "href" ? "javascript:closeMensagem()" : "",
    ownerDocument: { defaultView: { closeMensagem() { customCloseCalled = true; } } }
  };
  assert.equal(baixaHandler.invokeSafeJavaScriptClose(javascriptCloseLink), true, "Deve contornar href javascript: CSP por chamada segura à função de fechamento disponível");
  assert.equal(customCloseCalled, true);
  assert.equal(baixaHandler.invokeSafeJavaScriptClose({ getAttribute: name => name === "href" ? "javascript:alert(document.cookie)" : "", ownerDocument: { defaultView: {} } }), false, "Não deve avaliar expressões javascript arbitrárias");
  let richFacesPanelId = "";
  const richFacesCloseLink = {
    getAttribute: name => name === "onclick" ? "RichFaces.hideModalPanel('mensagemValidacao')" : "",
    ownerDocument: { defaultView: { RichFaces: { hideModalPanel(id) { richFacesPanelId = id; } } } }
  };
  assert.equal(baixaHandler.invokeRichFacesModalClose(richFacesCloseLink, { id: "mensagemValidacao" }), true, "Deve fechar o modal RichFaces pelo manipulador seguro da própria página");
  assert.equal(richFacesPanelId, "mensagemValidacao");
  assert.throws(() => formHandler.setValue({ name: "repairDate", disabled: true, readOnly: false }, "02/10/2026 10:00"), /repairDate indisponível: está desabilitado/);
  class MockDateInput {
    constructor() {
      this.tagName = "INPUT";
      this.type = "text";
      this.name = "repairDate";
      this.id = "repairDate";
      this.disabled = true;
      this.readOnly = true;
      this._value = "";
      this.events = [];
      this.flagsAtEvents = [];
      this.ownerDocument = { defaultView: { HTMLInputElement: MockDateInput, Event: class { constructor(type) { this.type = type; } } } };
    }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    getClientRects() { return [{ width: 140, height: 22 }]; }
    dispatchEvent(event) { this.events.push(event.type); this.flagsAtEvents.push([this.disabled, this.readOnly]); return true; }
  }
  const lockedDateField = new MockDateInput();
  formHandler.setValue(lockedDateField, "02/10/2026 10:00", { allowLocked: true });
  assert.equal(lockedDateField.value, "02/10/2026 10:00", "Data de Reparo readonly/desabilitada deve receber valor via setter quando autorizada pelo fluxo específico");
  assert.deepEqual(lockedDateField.flagsAtEvents, [[false, false], [false, false], [false, false]], "Eventos de alteração devem ser despachados enquanto o campo está temporariamente editável");
  assert.equal(lockedDateField.disabled, true, "O estado original disabled deve ser restaurado depois do preenchimento");
  assert.equal(lockedDateField.readOnly, true, "O estado original readonly deve ser restaurado depois do preenchimento");
  const originalPhoneControls = navigation.controlsFor;
  const originalPhoneDocuments = navigation.documents;
  const phoneYellow = (name, top, left) => ({
    name, disabled: false, readOnly: false, type: "text", style: { backgroundColor: "rgb(248, 255, 200)" },
    getBoundingClientRect: () => ({ top, left })
  });
  const phoneControls = [phoneYellow("phone-number", 30, 185), phoneYellow("phone-extra", 52, 145), phoneYellow("phone-ddd", 30, 145),
    { name: "historical-phone", disabled: false, readOnly: false, type: "text", style: { backgroundColor: "rgb(255, 255, 255)" } }];
  navigation.controlsFor = () => phoneControls;
  navigation.documents = () => [];
  assert.deepEqual(formHandler.closurePhoneControls(), [phoneControls[2], phoneControls[0], phoneControls[1]],
    "Deve selecionar e ordenar os três Telefones amarelos, ignorando os controles históricos brancos");
  assert.throws(() => formHandler.phoneValuesForLayout(true, 2), /caixas de DDD e número/, "Intragov exige DDD, número e segundo Telefone");
  assert.deepEqual(formHandler.phoneValuesForLayout(true, 3), ["00", "000000000", "xx"], "Layout Intragov aplica DDD/número ao primeiro Telefone e xx ao segundo");
  assert.deepEqual(formHandler.phoneValuesForLayout(false, 2), ["xx", "xx"], "Layout comum mantém dois Telefones com xx");
  navigation.controlsFor = originalPhoneControls;
  navigation.documents = originalPhoneDocuments;
  const originalControlsFor = navigation.controlsFor;
  const serviceOptions = [{ value: "service-sai", textContent: "Acesso à Internet" }];
  let selectedServiceValue = "";
  const serviceSelect = {
    tagName: "SELECT", type: "select-one", name: "servicoAfetado", disabled: false, readOnly: false,
    options: serviceOptions,
    get value() { return selectedServiceValue; },
    set value(value) { selectedServiceValue = value; },
    get selectedOptions() { return serviceOptions.filter(option => option.value === selectedServiceValue); },
    getClientRects: () => [{ width: 160, height: 24 }],
    ownerDocument: { defaultView: { Event: class { constructor(type) { this.type = type; } } } },
    dispatchEvent() { return true; }
  };
  formHandler.setValue(serviceSelect, "SAI - Serviço de Acesso à Internet");
  assert.equal(serviceSelect.value, "service-sai", "O Encerramento deve aceitar rótulos equivalentes de SAI sem repetir o prefixo ou a palavra Serviço");
  const scmOption = { value: "03913923", textContent: "03913923 - SCM" };
  let selectedScmValue = "";
  const scmSelect = {
    ...serviceSelect,
    options: [scmOption],
    get value() { return selectedScmValue; },
    set value(value) { selectedScmValue = value; },
    get selectedOptions() { return [scmOption].filter(option => option.value === selectedScmValue); }
  };
  formHandler.setValue(scmSelect, "SCM - Serviço de Comunicação Multimídia");
  assert.equal(scmSelect.value, "03913923", "O Encerramento deve reconhecer opções codificadas por serviço, como SCM com número antes da sigla");
  const readonlyDiagnosis = { name: "diagnosis", disabled: false, readOnly: true };
  navigation.controlsFor = (_aliases, editableOnly = false) => editableOnly ? [] : [readonlyDiagnosis];
  const skippedReadonlyFields = [];
  formHandler.fillBestEffort(["Diagnóstico"], "00000017 Testado OK", skippedReadonlyFields);
  assert.deepEqual(skippedReadonlyFields, ["Diagnóstico"], "Campo readonly é ignorado para deixar o SIGITM decidir a tentativa");
  const skippedMissingDate = [];
  assert.throws(() => formHandler.fillBestEffort(["Data de Reparo"], "", skippedMissingDate), /Data de Reparo não pôde ser calculada/);
  const originalDocuments = navigation.documents;
  const baixaCodeField = {
    disabled: false, readOnly: true,
    getBoundingClientRect: () => ({ left: 100, right: 260, top: 20, bottom: 44 })
  };
  let lupaClicked = false;
  const lupa = {
    tagName: "IMG", alt: "lupa", disabled: false, ownerDocument: { defaultView: {} },
    getClientRects: () => [{ width: 16, height: 16 }], offsetParent: {},
    getBoundingClientRect: () => ({ left: 264, right: 280, top: 24, bottom: 40 }),
    getAttribute: name => name === "alt" ? "lupa" : "", matches: selector => selector.includes("img"),
    closest: () => ({ getClientRects: () => [{ width: 16, height: 16 }], offsetParent: {}, getAttribute: () => null, click() { lupaClicked = true; } }),
    querySelector: () => null, click() { lupaClicked = true; }
  };
  global.document = { querySelectorAll: selector => selector === "iframe, frame" ? [] : [lupa] };
  navigation.controlsFor = () => [baixaCodeField];
  navigation.documents = () => [{ querySelectorAll: selector => selector === "iframe, frame" ? [] : [lupa] }];
  assert.equal(await formHandler.clickBaixaCodeLookup("2A011"), true, "A lupa sem rótulo deve ser achada por proximidade ao campo");
  assert.equal(lupaClicked, true);
  navigation.documents = originalDocuments;
  navigation.controlsFor = originalControlsFor;
  const originalDocumentsForCode = navigation.documents;
  const originalControlsForCode = navigation.controlsFor;
  const codeControl = {
    id: "", name: "", title: "", disabled: false, readOnly: true,
    tagName: "INPUT", type: "text", value: "",
    getAttribute: () => "", labels: [],
    getClientRects: () => [{ width: 180, height: 24 }], offsetParent: {},
    closest: () => codeRow
  };
  const codeRow = {
    textContent: "Código Completo da Baixa",
    getClientRects: () => [{ width: 300, height: 30 }], offsetParent: {},
    querySelectorAll: () => [codeControl]
  };
  navigation.controlsFor = () => [];
  navigation.documents = () => [{ querySelectorAll: selector => selector.includes("input") ? [codeControl] : [] }];
  assert.equal(formHandler.findBaixaCodeField(), codeControl, "Deve localizar Código Completo da Baixa pela linha mesmo sem metadados de campo");
  navigation.documents = originalDocumentsForCode;
  navigation.controlsFor = originalControlsForCode;
  delete global.document;

  assert.equal(rules.decide(fields({ procedencia: "PREVENTIVO" })).codigoBaixa, "2A011", "Inicial + Preventivo");
  assert.equal(rules.decide(fields({ procedencia: "REATIVO" })).codigoBaixa, "2A011", "Inicial + Reativo");
  assert.equal(rules.decide(fields({ procedencia: "PROATIVO" })).codigoBaixa, "2A011", "Inicial + Proativo");
  assert.equal(rules.decide(fields({ tipoAbertura: "REPETIDA 7 DIAS", procedencia: "REATIVO" })).codigoBaixa, "2A011", "Repetida + Reativo");
  const installation30Days = rules.decide(fields({
    tipoAbertura: "Instalação 30 Dias", procedencia: "Reativo", tipoIncidencia: "Dados",
    cliente: "CASA DI CONTI LTDA", intragov: "Não"
  }));
  assert.equal(installation30Days.allowed, true, "Instalação 30 Dias deve ser reconhecida como Repetida 30 Dias");
  assert.equal(installation30Days.codigoBaixa, "2A011", "Instalação 30 Dias + Reativo deve indicar o código 2A011");
  assert.equal(installation30Days.diagnostico, "00000017 Testado OK", "Incidência Dados deve indicar o diagnóstico padrão");
  assert.match(installation30Days.motivo, /REPETIDA 30 DIAS \+ REATIVO/);
  assert.equal(rules.decide(fields({ tipoAbertura: "REPETIDA 30 DIAS", procedencia: "PROATIVO", cliente: "CEDRO" })).codigoBaixa, "2A082", "Repetida + Proativo");
  assert.equal(rules.decide(fields({ tipoAbertura: "REPETIDA 7 DIAS", procedencia: "PROATIVO", cliente: "CEDRO" })).codigoBaixa, "2A082");
  assert.equal(rules.decide(fields({ tipoAbertura: "REPETIDA 30 DIAS", procedencia: "PROATIVO", cliente: "CEDRO" })).codigoBaixa, "2A082");
  assert.equal(rules.decide(fields({ tipoAbertura: "REPETIDA 7 DIAS", procedencia: "REATIVO", cliente: "FED - FUNDO PARA O DESENVOLVIMENTO DA EDUCAÇÃO", intragov: "", servicoAfetado: "" })).codigoBaixa, "2A011", "Repetida + Reativo usa 2A011 para FED");
  assert.equal(rules.decide(fields({ tipoAbertura: "INICIAL", procedencia: "REATIVO", cliente: "SEDUC - SECRETARIA DE EDUCAÇÃO", intragov: "Sim", servicoAfetado: "SAI - Serviço de Acesso à Internet" })).codigoBaixa, "2A011", "SEDUC determina 2A011 acima de Intragov + SAI");
  assert.equal(rules.decide(fields({ tipoAbertura: "INICIAL", procedencia: "REATIVO", cliente: "CEDRO", intragov: "Sim", servicoAfetado: "SAI - Serviço de Acesso à Internet" })).codigoBaixa, "6Y200", "Intragov marcado usa 6Y200 para os demais clientes");
  assert.equal(rules.decide(fields({ tipoAbertura: "REPETIDA 7 DIAS", procedencia: "PROATIVO", cliente: "CEDRO", intragov: "Sim", servicoAfetado: "Serviço corporativo" })).codigoBaixa, "6Y200", "Intragov marcado não depende do Serviço Afetado");
  assert.equal(rules.decide(fields({ tipoAbertura: "REPETIDO", procedencia: "PROATIVO", cliente: "CEDRO" })).codigoBaixa, "2A082", "A forma genérica Repetido + Proativo usa 2A082");
  assert.equal(rules.decide(fields({ tipoAbertura: "REPETIDA 30 DIAS", procedencia: "PREVENTIVO", cliente: "CEDRO" })).allowed, false);
  assert.equal(rules.decide(fields({ tipoAbertura: "REPETIDA 7 DIAS", procedencia: "PREVENTIVO", cliente: "CEDRO" })).allowed, false);
  assert.equal(rules.decide(fields({ tipoAbertura: "REPETIDA 7 DIAS", procedencia: "PROATIVO", tipoIncidencia: "DDR", cliente: "CEDRO", intragov: "Sim", servicoAfetado: "SAI - Serviço de Acesso à Internet" })).codigoBaixa, "57033", "DDR tem prioridade sobre SAI e repetida para clientes que não são SEDUC");
  assert.equal(rules.decide({ tipoIncidencia: "DDR" }).codigoBaixa, "57033", "DDR não depende dos outros campos de classificação");
  assert.equal(rules.decide(fields({ cliente: "SEDUC - SECRETARIA DE EDUCAÇÃO", tipoIncidencia: "DDR", tipoAbertura: "REPETIDA 7 DIAS", procedencia: "PROATIVO", intragov: "Sim", servicoAfetado: "SAI - Serviço de Acesso à Internet" })).codigoBaixa, "2A011", "SEDUC determina 2A011 mesmo quando outros campos indicariam códigos prioritários");
  assert.equal(rules.decide(fields({ cliente: "SEDUC - SECRETARIA DE EDUCAÇÃO", tipoIncidencia: "DDR", tipoAbertura: "REPETIDA 7 DIAS", procedencia: "PROATIVO", intragov: "Sim", servicoAfetado: "SAI - Serviço de Acesso à Internet" })).diagnostico, "00000032 Testado OK", "Mesmo com prioridade SEDUC, DDR deve usar diagnóstico 32");
  assert.equal(rules.decide({ cliente: "SEDUC" }).codigoBaixa, "2A011", "SEDUC determina 2A011 mesmo com os demais campos ausentes");
  assert.equal(rules.automaticCodeForClient("FED - FUNDO PARA O DESENVOLVIMENTO DA EDUCAÇÃO"), "2A011", "FED recebe código automático sem perguntar");
  assert.equal(rules.automaticCodeForClient("Fundação para o Desenvolvimento da Educação"), "2A011", "Fundação para o Desenvolvimento da Educação recebe 2A011 automático");
  assert.equal(rules.decide(fields({ cliente: "Fundação para o Desenvolvimento da Educação", intragov: "Sim", tipoAbertura: "REPETIDA 7 DIAS", procedencia: "PROATIVO", tipoIncidencia: "DADOS", servicoAfetado: "SCM - Serviço de Comunicação Multimídia" })).codigoBaixa, "2A011", "Fundação para o Desenvolvimento da Educação prevalece sobre Intragov");
  assert.equal(rules.automaticCodeForClient("SAO PAULO SECRETARIA DA EDUCACAO"), "2A011", "SEDUC de São Paulo com SECRETARIA DA EDUCACAO deve ser reconhecida");
  assert.equal(rules.decide(fields({
    tipoAbertura: "REPETIDA 30 DIAS",
    procedencia: "PROATIVO",
    tipoIncidencia: "DADOS",
    cliente: "SAO PAULO SECRETARIA DA EDUCACAO",
    intragov: "Sim",
    servicoAfetado: "SCM - Serviço de Comunicação Multimídia"
  })).codigoBaixa, "2A011", "Caso real SEDUC São Paulo não deve cair em 6Y200 por Intragov");
  assert.equal(rules.decide(fields({ cliente: "FUNDO PARA O DESENVOLVIMENTO DA EDUCAÇÃO", intragov: "Sim", tipoIncidencia: "DDR" })).codigoBaixa, "2A011", "FED prevalece sobre Intragov e DDR");
  assert.equal(rules.decide({ cliente: "FED" }).codigoBaixa, "2A011", "A sigla FED determina 2A011 mesmo sem os demais campos");
  assert.equal(rules.decide(fields({ cliente: "CEDRO CONSTRUTORA E INCORPORADORA LTDA" })).codigoBaixa, "2A011", "2A011 não depende de cliente específico");
  assert.equal(rules.decide(fields({ cliente: "" })).codigoBaixa, "2A011", "Cliente ausente não impede 2A011 quando abertura e procedência determinam o código");
  const sai = rules.decide(fields({ cliente: "CEDRO", intragov: "Sim", servicoAfetado: "SAI - Serviço de Acesso à Internet" }));
  assert.equal(sai.codigoBaixa, "6Y200");
  assert.equal(sai.diagnostico, "00000017 Testado OK", "SAI também deve usar o diagnóstico 17");
  assert.equal(rules.decide(fields({ tipoIncidencia: "DADOS", cliente: "CEDRO" })).diagnostico, "00000017 Testado OK", "Incidência não DDR deve continuar no diagnóstico 17");
  assert.equal(rules.decide(fields({ tipoIncidencia: "DDR", cliente: "CEDRO", servicoAfetado: "SAI - Serviço de Acesso à Internet" })).diagnostico, "00000032 Testado OK", "DDR deve usar diagnóstico 32");
  assert.equal(rules.decide(fields({ cliente: "CEDRO", tipoIncidencia: "DADOS", tipoAbertura: "INICIAL", procedencia: "INDEFINIDA" })).allowed, false);

  const clean = helpers.buildAIPayload(fields({ numeroChamado: "987654", dataObjetivo: "segredo" }));
  assert.deepEqual(Object.keys(clean).sort(), ["cliente", "intragov", "procedencia", "servicoAfetado", "tipoAbertura", "tipoIncidencia"].sort());
  assert.equal(clean.intragov, false);
  assert.equal(helpers.buildAIPayload(fields({ intragov: "desconhecido" })).intragov, null);
  assert.equal(helpers.escapeCsv("=1+1"), "\"'=1+1\"");
  assert.equal(helpers.escapeCsv("  @SUM(A1:A2)"), "\"'  @SUM(A1:A2)\"");
  assert.equal((await aiService.analyzeCase(fields(), { provider: "gemini", apiKey: "" })).available, false);

  const contentSourceForDiagnosis = fs.readFileSync(path.join(base, "content/content.js"), "utf8");
  assert.ok(contentSourceForDiagnosis.includes('const diagnostico = incidence === "ddr" ? "00000032 Testado OK" : "00000017 Testado OK";'), "Seleção manual/aprendida deve preservar diagnóstico 32 para DDR");

  const verdict = {
    codigoBaixa: "2A011", diagnostico: "00000017 Testado OK", motivo: "Inicial + Reativo", confianca: 0.98, podeExecutar: true,
    normalizedFields: rules.canonicalize(fields())
  };
  assert.equal(aiSchema.validateDecision(verdict).codigoBaixa, "2A011");
  const ddrVerdict = { ...verdict, diagnostico: "00000032 Testado OK", normalizedFields: rules.canonicalize(fields({ tipoIncidencia: "DDR" })) };
  assert.equal(aiSchema.validateDecision(ddrVerdict).diagnostico, "00000032 Testado OK", "Schema da IA deve aceitar o diagnóstico 32 para DDR");
  assert.throws(() => aiSchema.validateDecision({ ...verdict, diagnostico: "00000039 Testado OK" }), /Código ou diagnóstico fora da lista/);
  assert.throws(() => aiSchema.validateDecision({ ...verdict, codigoBaixa: "99999" }), /fora da lista/);
  assert.equal(validation.compareAIWithRules({ available: true, decision: verdict, provider: "Gemini" }, rules.decide(fields())).allowed, true);
  assert.equal(validation.compareAIWithRules({ available: true, decision: { ...verdict, codigoBaixa: "57033" } }, rules.decide(fields())).status, "DIVERGÊNCIA IA × REGRAS");
  assert.equal(validation.compareAIWithRules({ available: false, reason: "sem conexão" }, rules.decide(fields())).status, "FALLBACK DETERMINÍSTICO");

  const originalFetch = global.fetch;
  let groqRequest;
  global.fetch = async (url, options) => {
    groqRequest = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(verdict) } }] })
    };
  };
  const groqResult = await aiProvider.request({
    provider: "groq",
    apiKey: "test-key-not-real",
    model: "openai/gpt-oss-120b",
    temperature: 0,
    payload: clean
  });
  global.fetch = originalFetch;
  assert.equal(groqRequest.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(groqRequest.options.headers.authorization, "Bearer test-key-not-real");
  assert.deepEqual(groqRequest.body.response_format, { type: "json_object" });
  assert.equal(groqRequest.body.model, "openai/gpt-oss-120b");
  assert.ok(groqRequest.body.messages.every(message => message.content.toLowerCase().includes("json")), "Groq JSON mode requer menção explícita a json nas mensagens");
  assert.ok(groqRequest.body.messages[1].content.endsWith(JSON.stringify(clean)), "O adaptador Groq recebe apenas o payload allowlisted, precedido por instrução de formato");
  assert.deepEqual(aiSchema.validateDecision(groqResult).normalizedFields, rules.canonicalize(fields()));
  global.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { code: "json_validate_failed", message: "Failed to generate JSON. Please adjust your prompt." } })
  });
  await assert.rejects(aiProvider.request({ provider: "groq", apiKey: "test-key-not-real", model: "openai/gpt-oss-120b", temperature: 0, payload: clean }), /Groq não conseguiu gerar uma resposta JSON válida/);
  const unavailableAI = await aiService.analyzeCase(fields(), { provider: "groq", apiKey: "test-key-not-real", model: "openai/gpt-oss-120b" });
  const fallbackDecision = validation.compareAIWithRules(unavailableAI, rules.decide(fields()));
  assert.equal(fallbackDecision.allowed, true, "JSON inválido do Groq deve permitir fallback se as regras locais aprovarem");
  assert.equal(fallbackDecision.status, "FALLBACK DETERMINÍSTICO");
  assert.match(unavailableAI.reason, /motor determinístico local/);
  global.fetch = originalFetch;

  assert.equal(dateHandler.repairFromCreation(fields()), "02/10/2026 10:00", "Data de Reparo deve ser criada duas horas após Data Criação");
  assert.equal(dateHandler.midpointBetweenDates("02/10/2026 08:00", "02/10/2026 10:00"), "02/10/2026 09:00", "Encerramento deve usar o meio entre Data Criação e Data de Reparo original");
  assert.equal(dateHandler.parseDate("2026-10-02").getDate(), 2, "Campo HTML date deve aceitar o formato ISO sem hora");
  assert.equal(dateHandler.repairFromCreation(fields({ dataCriacao: "28/09/26 19:51" })), "28/09/2026 21:51", "Data Criação com ano de dois dígitos deve ser aceita");
  assert.equal(dateHandler.validateDates(fields()).valid, true);
  assert.equal(dateHandler.validateDates({ ...fields(), dataReparoOriginal: "02/10/2026 10:00" }).repairValue, "02/10/2026 09:00", "Data do Encerramento deve usar uma hora após a Criação, sem copiar a Data de Reparo original");
  assert.match(dateHandler.validateDates(fields({ dataCriacao: "02/10/2026 10:00", dataObjetivo: "02/10/2026 11:00" })).reason, /anterior à Data Objetivo/);
  assert.equal(dateHandler.validateDates(fields({ dataCriacao: "02/10/2026 11:00", dataObjetivo: "02/10/2026 14:00" })).valid, true, "Início do SLA não é usado para bloquear o reparo calculado");
  // Pausa de Relógio: Data de Reparo = original da aba Data, antes do início da parada, dentro do SLA de 4h.
  const pausedFields = overrides => fields({
    dataCriacao: "02/10/2026 08:00", dataObjetivo: "02/10/2026 12:00", dataReparoOriginal: "02/10/2026 09:30",
    paradaRelogio: "Sim", dataParadaRelogio: "02/10/2026 10:00", dataFimParadaRelogio: "02/10/2026 14:00", ...overrides
  });
  const adjustedForPause = dateHandler.validateDates(pausedFields());
  assert.equal(adjustedForPause.valid, true, "Pausa com Data de Reparo original anterior à parada e dentro do SLA deve ser aprovada");
  assert.equal(adjustedForPause.repairValue, "02/10/2026 09:30", "Com pausa, usa a Data de Reparo original, nunca fim da parada + 1 minuto");
  assert.equal(dateHandler.validateDates(pausedFields({ dataFimParadaRelogio: "" })).repairValue, "02/10/2026 09:30", "Pausa aberta (sem fim) também usa a data original");
  assert.equal(dateHandler.validateDates(pausedFields({ dataInicioParadaRelogio: "02/10/2026 10:00", dataParadaRelogio: "" })).valid, true, "Início da parada pode vir da tabela");
  const emptyOriginal = dateHandler.validateDates(pausedFields({ dataReparoOriginal: "" }));
  assert.equal(emptyOriginal.valid, true, "Data de Reparo original vazia usa Criação + 1h validada");
  assert.equal(emptyOriginal.repairValue, "02/10/2026 09:00");
  assert.equal(emptyOriginal.warnings.length, 1);
  assert.equal(dateHandler.validateDates(pausedFields({ dataReparoOriginal: "", dataParadaRelogio: "02/10/2026 08:30" })).valid, false, "Fallback também deve ficar antes do início da parada");
  assert.match(dateHandler.validateDates(pausedFields({ dataReparoOriginal: "abc" })).reason, /inválida/, "Texto que não é data continua bloqueando");
  assert.match(dateHandler.validateDates(pausedFields({ dataParadaRelogio: "", dataInicioParadaRelogio: "" })).reason, /início da parada/, "Sem início da parada, interrompe");
  assert.equal(typeof navigation.readDateField, "function");
  assert.match(dateHandler.validateDates(pausedFields({ dataReparoOriginal: "02/10/2026 10:00" })).reason, /anterior ao início da Parada/, "Reparo igual ao início da parada é inválido");
  assert.match(dateHandler.validateDates(pausedFields({ dataReparoOriginal: "02/10/2026 10:30" })).reason, /anterior ao início da Parada/, "Reparo depois da parada é inválido");
  assert.match(dateHandler.validateDates(pausedFields({ dataReparoOriginal: "02/10/2026 08:00" })).reason, /posterior à Data Criação/);
  assert.match(dateHandler.validateDates(pausedFields({ dataParadaRelogio: "02/10/2026 13:00", dataReparoOriginal: "02/10/2026 12:01", dataObjetivo: "" })).reason, /SLA de 4 horas/, "Reparo acima de 4h da criação excede o SLA");
  assert.equal(dateHandler.validateDates(pausedFields({ dataParadaRelogio: "02/10/2026 13:00", dataReparoOriginal: "02/10/2026 12:00", dataObjetivo: "" })).valid, true, "Exatamente 4h ainda respeita o SLA");
  assert.match(dateHandler.validateDates(pausedFields({ dataObjetivo: "02/10/2026 09:30" })).reason, /Data Objetivo/);
  assert.equal(dateHandler.validateDates(fields({
    dataCriacao: "19/10/2026 10:20", dataObjetivo: "19/10/2026 11:00",
    paradaRelogio: "Não"
  })).valid, false, "Sem parada ativa, Data Objetivo/SLA continuam bloqueando como antes");
  assert.equal(dateHandler.validateDates(fields({ paradaRelogio: "desconhecida" })).valid, true, "Pausa não confirmada não impede o fluxo");
  assert.match(dateHandler.validateDates(fields({ dataCriacao: "", dataReparo: "" })).reason, /Data Criação não identificada/);
  const blockedClassification = fields({ tipoAbertura: "Instalação 60 Dias" });
  assert.equal(rules.decide(blockedClassification).allowed, false, "Tipo de abertura sem regra conhecida deve continuar bloqueando o código");
  assert.equal(dateHandler.validateDates(blockedClassification).repairValue, "02/10/2026 09:00",
    "O horário calculado deve continuar disponível independentemente do bloqueio de classificação");
  assert.equal(dateHandler.validateDates(fields({ dataObjetivo: "" })).repairValue, "02/10/2026 09:00",
    "A previsão deve ser mostrada mesmo quando não há Data Objetivo para aprovar a validação");

  const queued = await queue.runSequential([1, 2, 3], async value => {
    if (value === 2) throw new Error("simulated");
    return value * 2;
  });
  assert.deepEqual(queued.map(item => item.ok), [true, false, true], "Falha em lote não deve bloquear próximos itens seguros");
  let stopped = false;
  const stoppedQueue = await queue.runSequential([1, 2], async value => value, { shouldStop: () => stopped, onResult: () => { stopped = true; } });
  assert.equal(stoppedQueue.length, 1);

  const fakeData = { baixaHistory: [] };
  global.chrome = {
    runtime: { lastError: null },
    storage: { local: {
      get(keys, callback) {
        setImmediate(() => callback(typeof keys === "string" ? { [keys]: fakeData[keys] } : { ...fakeData }));
      },
      set(values, callback) {
        setImmediate(() => { Object.assign(fakeData, values); callback(); });
      }
    } }
  };
  await Promise.all(Array.from({ length: 20 }, (_, index) => storage.addHistory({ numeroChamado: String(index) })));
  assert.equal(fakeData.baixaHistory.length, 20, "Gravações concorrentes devem manter todo o histórico");
  fakeData.baixaSettings = {
    provider: "groq",
    apiKeys: { gemini: "gemini-test-key", groq: "groq-test-key" },
    model: "openai/gpt-oss-120b"
  };
  assert.equal((await storage.getSettings()).apiKey, "groq-test-key", "A seleção Groq deve usar apenas sua própria chave");
  fakeData.baixaSettings.provider = "gemini";
  assert.equal((await storage.getSettings()).apiKey, "gemini-test-key", "A seleção Gemini deve usar apenas sua própria chave");
  const learningCase = fields({ cliente: "ABC", tipoIncidencia: "DADOS", intragov: "Sim" });
  assert.equal(await storage.getLearnedCode(learningCase), null, "Combinação ainda não aprendida deve pedir confirmação");
  await storage.saveLearnedCode(learningCase, "6Y200");
  const learned = await storage.getLearnedCode({ ...learningCase, cliente: "DFG", tipoAbertura: "Inicial", intragov: true, numeroChamado: "999999" });
  assert.equal(learned.codigoBaixa, "6Y200", "Código aprendido deve ser reutilizado entre clientes não SEDUC com os mesmos campos decisivos");
  assert.equal(learned.ocorrencias, 1);
  await assert.rejects(storage.saveLearnedCode(learningCase, "12345"), /fora da lista permitida/);

  const originalDocumentsForDiagnosis = navigation.documents;
  const originalControlsForDiagnosis = navigation.controlsFor;
  const previousDocumentForDiagnosis = global.document;
  const staleDiagnosisField = {
    tagName: "INPUT", type: "text", value: "", disabled: false, readOnly: false,
    getClientRects: () => [{ width: 180, height: 24 }], getAttribute: () => null, labels: []
  };
  const selectedDiagnosisField = {
    ...staleDiagnosisField, value: "00000017 - Testado OK"
  };
  let currentDiagnosisField = staleDiagnosisField;
  const diagnosisOption = {
    textContent: "00000017", disabled: false, getAttribute: () => null,
    getClientRects: () => [{ width: 100, height: 24 }],
    click() { currentDiagnosisField = selectedDiagnosisField; }
  };
  const diagnosisDocument = {
    querySelectorAll(selector) {
      if (selector.startsWith("a, button")) return [diagnosisOption];
      if (selector.startsWith("input:not")) return [currentDiagnosisField];
      return [];
    }
  };
  global.document = diagnosisDocument;
  navigation.documents = () => [diagnosisDocument];
  navigation.controlsFor = () => [currentDiagnosisField];
  assert.equal(await formHandler.selectDiagnosisFromLookup("00000017 Testado OK", () => false, staleDiagnosisField), true,
    "A confirmação do diagnóstico deve acompanhar o novo input renderizado após selecionar a opção");
  navigation.documents = originalDocumentsForDiagnosis;
  navigation.controlsFor = originalControlsForDiagnosis;
  if (previousDocumentForDiagnosis === undefined) delete global.document;
  else global.document = previousDocumentForDiagnosis;

  const originalDocumentsForCertification = navigation.documents;
  const originalClickTabForCertification = navigation.clickTab;
  const originalWaitForLoadingForCertification = navigation.waitForLoadingToFinish;
  function certificationSelect(value, optionValues) {
    return {
      tagName: "SELECT", disabled: false, readOnly: false, _value: value, options: optionValues,
      get value() { return this._value; },
      set value(next) {
        this._value = next;
        this._selectedIndex = this.options.findIndex(option => option.value === next);
      },
      get selectedIndex() {
        return Number.isInteger(this._selectedIndex) ? this._selectedIndex
          : this.options.findIndex(option => option.value === this._value);
      },
      set selectedIndex(index) {
        this._selectedIndex = index;
        this._value = this.options[index]?.value ?? "";
      },
      get selectedOptions() {
        const selected = this.options[this.selectedIndex];
        return selected ? [selected] : [];
      },
      getClientRects: () => [{ width: 180, height: 24 }], dispatchEvent() { return true; }
    };
  }
  const placeholder = { value: "", textContent: "Selecione um status da lista" };
  const sim = { value: "S", textContent: "Sim" };
  const notApplicable = { value: "NA", textContent: "Não se aplica" };
  const no = { value: "N", textContent: "Não" };
  const labeled = (label, value, options) => {
    const select = certificationSelect(value, options);
    select.ownerDocument = null;
    select.isConnected = true;
    select.changeEvents = 0;
    select.getAttribute = name => name === "aria-label" ? label : "";
    select.dispatchEvent = () => { select.changeEvents++; return true; };
    return select;
  };
  const gerencia = labeled("Circuito é passível de gerência?", "", [placeholder, sim, no, notApplicable]);
  const medicoes = labeled("Medições", "", [placeholder, sim, no, { value: "P", textContent: "Parcial" }]);
  const roteador = labeled("Roteador", "", [placeholder, { value: "C", textContent: "Cliente" }, no, notApplicable]);
  const modem = labeled("Gerência de Modem", "", [placeholder, { value: "A", textContent: "Aplica" }, no, notApplicable]);
  const modemCliente = labeled("Modem Cliente", "", [placeholder, { value: "C", textContent: "Cliente" }, notApplicable]);
  const tx = labeled("TX", "", [placeholder, { value: "A", textContent: "Aplica" }, notApplicable]);
  const dg = labeled("DG", "", [placeholder, { value: "A", textContent: "Aplica" }, notApplicable]);
  const extra = labeled("Outro campo qualquer", "", [placeholder, sim, no]);
  const circuitoValidado = labeled("Circuito validado?", "", [placeholder, sim, no]);
  const pendenciasReparo = labeled("Pendências de reparo", "", [placeholder, sim, no, notApplicable]);
  const allCertification = [gerencia, medicoes, roteador, modem, modemCliente, tx, dg, circuitoValidado, extra, pendenciasReparo];
  const certificationQueries = [];
  let nativeCertificationSetterCalls = 0;
  const certificationSelectPrototype = {};
  Object.defineProperty(certificationSelectPrototype, "selectedIndex", {
    set(index) { nativeCertificationSetterCalls++; this.selectedIndex = index; }
  });
  const certificationDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
      HTMLSelectElement: { prototype: certificationSelectPrototype }
    },
    querySelectorAll(selector) {
      if (selector.startsWith("select")) certificationQueries.push(selector);
      const match = selector.match(/^select\[(?:aria-label|title|name|id)="(.*)"\]$/);
      if (!match) return [];
      return allCertification.filter(select => select.getAttribute("aria-label") === match[1]);
    }
  };
  for (const select of allCertification) select.ownerDocument = certificationDocument;
  global.document = certificationDocument;
  navigation.documents = () => [certificationDocument];
  const preparedTabs = [];
  navigation.clickTab = async name => { preparedTabs.push(name); return true; };
  navigation.waitForLoadingToFinish = async () => true;
  const certificationFix = await formHandler.fixCertificationValidation();
  assert.equal(certificationFix.changed, 7, "Deve preencher os sete campos da Certificação");
  assert.equal(gerencia.value, "N", "Circuito é passível de gerência? = Não");
  assert.equal(medicoes.value, "N", "Medições = Não");
  for (const item of [roteador, modem, modemCliente, tx, dg]) assert.equal(item.value, "NA", "Demais campos = Não se aplica");
  assert.equal(extra.value, "", "Campos fora da lista (Selecione um item da lista) não devem ser preenchidos");
  assert.equal(circuitoValidado.value, "", "Circuito validado? deve permanecer sem preenchimento");
  assert.equal(pendenciasReparo.value, "", "Pendências de reparo deve permanecer sem preenchimento");
  assert.deepEqual(certificationFix.checked, formHandler.CERTIFICATION_ANSWERS.map(item => item.label));
  assert.equal(nativeCertificationSetterCalls, 7, "Cada status deve ser aplicado pelo setter nativo do select");
  assert.ok(certificationQueries.length > 0 && certificationQueries.every(selector =>
    /^select\[(?:aria-label|title|name|id)="/.test(selector) && formHandler.CERTIFICATION_ANSWERS.some(item => selector.endsWith(`="${item.label}"]`))),
  "A busca deve consultar somente seletores dos sete controles permitidos, sem varredura geral");
  assert.ok(allCertification.filter(item => formHandler.CERTIFICATION_ANSWERS.some(entry => entry.label === item.getAttribute("aria-label")))
    .every(item => item.changeEvents === 3), "Cada alteração deve disparar input, change e blur");

  const legacyCertificationControls = formHandler.CERTIFICATION_ANSWERS.map((entry, index) => {
    const expected = entry.answer === "Não" ? "N" : "NA";
    const select = certificationSelect(expected, [placeholder, no, notApplicable]);
    select.ownerDocument = certificationDocument;
    select.getClientRects = () => [{ width: 180, height: 24 }];
    select.getAttribute = () => "";
    select.isConnected = true;
    const nextCell = { tagName: "TD", querySelectorAll: selector => selector === "select" ? [select] : [] };
    const combinedCell = index % 2 === 1;
    const labelCell = {
      tagName: "TD", innerText: combinedCell ? `${entry.label} ${entry.answer}` : entry.label,
      textContent: combinedCell ? `${entry.label} ${entry.answer}` : entry.label,
      ownerDocument: certificationDocument, getClientRects: () => [{ width: 170, height: 24 }],
      querySelectorAll: selector => combinedCell && selector === "select" ? [select] : [],
      getAttribute: () => null, matches: selector => selector === "td, th", closest: () => labelCell,
      nextElementSibling: nextCell
    };
    const row = { tagName: "TR", children: [labelCell, nextCell], querySelectorAll: selector => selector === "select" ? [select] : [] };
    labelCell.parentElement = row;
    nextCell.parentElement = row;
    select.isConnected = true;
    return labelCell;
  });
  certificationDocument.querySelectorAll = selector => {
    if (selector.startsWith("select[")) return [];
    if (selector === "label, th, td, span, div, b, strong, p, legend") return legacyCertificationControls;
    return [];
  };
  const legacyCertificationRead = await formHandler.fixCertificationValidation();
  assert.equal(legacyCertificationRead.checked.length, 7,
    "A Certificação em tabela legada deve ser lida pelos rótulos e selects adjacentes, mesmo sem aria-label");
  certificationDocument.querySelectorAll = selector => {
    if (selector.startsWith("select")) certificationQueries.push(selector);
    const match = selector.match(/^select\[(?:aria-label|title|name|id)="(.*)"\]$/);
    if (!match) return [];
    return allCertification.filter(select => select.getAttribute("aria-label") === match[1]);
  };

  const secondRun = await formHandler.fixCertificationValidation();
  assert.equal(secondRun.changed, 0, "Campos já preenchidos não devem ser alterados de novo");

  const replacedGerencia = labeled("Circuito é passível de gerência?", "", [placeholder, sim, no, notApplicable]);
  replacedGerencia.ownerDocument = certificationDocument;
  const originalGerenciaDispatch = gerencia.dispatchEvent;
  gerencia.value = "";
  gerencia.dispatchEvent = event => {
    gerencia.changeEvents++;
    if (event.type === "change") {
      allCertification[0] = replacedGerencia;
      setTimeout(() => { replacedGerencia.value = "N"; }, 40);
    }
    return true;
  };
  const delayedCertification = await formHandler.fixCertificationValidation();
  assert.equal(delayedCertification.changed, 1,
    "A confirmação deve aguardar o status após o SIGITM substituir e atualizar o select");
  assert.equal(replacedGerencia.value, "N", "O select recém-renderizado deve ser relocalizado e confirmado");
  allCertification[0] = gerencia;
  gerencia.value = "N";
  gerencia.dispatchEvent = originalGerenciaDispatch;

  const duplicateValueGerencia = labeled("Circuito é passível de gerência?", "", [
    placeholder, { value: "", textContent: "Não" }, notApplicable
  ]);
  duplicateValueGerencia.ownerDocument = certificationDocument;
  allCertification[0] = duplicateValueGerencia;
  const duplicateValueRun = await formHandler.fixCertificationValidation();
  assert.equal(duplicateValueRun.changed, 1, "Status deve ser selecionado mesmo quando seu value coincide com o placeholder");
  assert.equal(duplicateValueGerencia.selectedIndex, 1, "A seleção deve apontar para a opção 'Não' pelo índice exato");
  assert.equal(duplicateValueGerencia.selectedOptions[0].textContent, "Não");
  allCertification[0] = gerencia;
  gerencia.value = "N";

  gerencia.value = "S";
  medicoes.value = "P";
  roteador.value = "N";
  modem.value = "N";
  const preservedRun = await formHandler.fixCertificationValidation();
  assert.equal(preservedRun.changed, 2, "Somente Não/Não se aplica incompatíveis com a regra existente podem ser corrigidos");
  assert.equal(gerencia.value, "S", "Valor Sim diferente do destino deve ser preservado");
  assert.equal(medicoes.value, "P", "Valor Parcial diferente do destino deve ser preservado");
  assert.equal(roteador.value, "NA", "Não deve ser convertido para o destino Não se aplica já definido");
  assert.equal(modem.value, "NA", "Não se aplica já definido deve permanecer");
  assert.equal(tx.value, "NA");
  assert.equal(dg.value, "NA");
  gerencia.value = "NA";
  const notApplicableToNo = await formHandler.fixCertificationValidation();
  assert.equal(notApplicableToNo.changed, 1, "Não se aplica deve ser identificado como estado elegível para a regra existente");
  assert.equal(gerencia.value, "N");
  for (const item of [gerencia, medicoes, roteador, modem, modemCliente, tx, dg]) item.value = "";
  preparedTabs.length = 0;
  const prepared = await formHandler.prepareCertificationForSave();
  assert.equal(prepared.changed, 7);
  assert.equal(extra.value, "");
  assert.equal(circuitoValidado.value, "", "A pré-validação também não pode tocar em Circuito validado?");
  assert.equal(pendenciasReparo.value, "", "A pré-validação também não pode tocar em Pendências de reparo");
  assert.deepEqual(preparedTabs, ["Certificação", "Encerramento"], "A pré-validação deve conferir Certificação antes de voltar ao Encerramento");
  // Um rótulo desconhecido não é procurado nem usado como substituto de um campo permitido.
  const unlabeled = certificationSelect("", [placeholder, sim, no]);
  unlabeled.getAttribute = () => "";
  allCertification.splice(0, allCertification.length, gerencia, medicoes, modem, modemCliente, tx, dg,
    unlabeled, extra, circuitoValidado, pendenciasReparo);
  const normalDeadline = formHandler.CERTIFICATION_TIMING.deadline;
  const normalMissingGrace = formHandler.CERTIFICATION_TIMING.missingGrace;
  formHandler.CERTIFICATION_TIMING.deadline = 100;
  formHandler.CERTIFICATION_TIMING.missingGrace = 0;
  const skippedCertification = await formHandler.prepareCertificationForSave();
  assert.deepEqual(skippedCertification.skipped, ["Roteador"], "Um único campo autorizado ausente deve ser ignorado e reportado");
  assert.equal(skippedCertification.checked.length, 6, "Os demais seis controles autorizados devem continuar sendo validados");
  assert.deepEqual(preparedTabs.slice(-2), ["Certificação", "Encerramento"], "A ausência de um campo não deve impedir o retorno ao Encerramento");
  assert.equal(unlabeled.value, "", "Select sem rótulo não pode ser preenchido por posição");
  assert.equal(circuitoValidado.value, "");
  allCertification.splice(0, allCertification.length, unlabeled, extra, circuitoValidado, pendenciasReparo);
  const allSkippedCertification = await formHandler.fixCertificationValidation();
  assert.deepEqual(allSkippedCertification.checked, [], "A automação deve continuar mesmo quando nenhum controle autorizado existe");
  assert.deepEqual(allSkippedCertification.skipped, formHandler.CERTIFICATION_ANSWERS.map(item => item.label),
    "Todos os controles autorizados ausentes devem ser listados como ignorados");
  formHandler.CERTIFICATION_TIMING.deadline = normalDeadline;
  formHandler.CERTIFICATION_TIMING.missingGrace = normalMissingGrace;
  assert.ok(certificationQueries.every(selector => formHandler.CERTIFICATION_ANSWERS.some(item => selector.endsWith(`="${item.label}"]`))),
    "Mesmo com controles ausentes, a automação não consulta os demais campos");
  navigation.documents = originalDocumentsForCertification;
  navigation.clickTab = originalClickTabForCertification;
  navigation.waitForLoadingToFinish = originalWaitForLoadingForCertification;
  if (previousDocumentForDiagnosis === undefined) delete global.document;
  else global.document = previousDocumentForDiagnosis;

  const manifest = JSON.parse(fs.readFileSync(path.join(base, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.description.length <= 132, "A descrição da extensão deve respeitar o limite do Chrome Web Store");
  assert.ok(manifest.permissions.includes("storage") && manifest.permissions.includes("activeTab") && manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("tabs"), "O processamento de listas precisa identificar e fechar guias de tickets");
  assert.ok(manifest.icons?.[16] && manifest.icons?.[48] && manifest.icons?.[128] && manifest.action?.default_icon?.[16], "O manifesto deve oferecer ícones PNG estáticos para o Chrome, inclusive a página de detalhes da extensão");
  for (const iconPath of Object.values(manifest.icons || {})) assert.ok(fs.existsSync(path.join(base, iconPath)), `Ícone não encontrado: ${iconPath}`);
  for (const script of manifest.content_scripts[0].js) assert.ok(fs.existsSync(path.join(base, script)), `Script de conteúdo ausente: ${script}`);
  for (const file of ["background/background.js", "ai/ai-service.js", "ai/ai-provider.js", "ai/ai-schema.js", "automation/form-handler.js", "automation/baixa-handler.js", "automation/batch-handler.js", "options/options.html"]) {
    assert.ok(fs.existsSync(path.join(base, file)), `Arquivo do projeto ausente: ${file}`);
  }
  const source = fs.readFileSync(path.join(base, "utils/helpers.js"), "utf8");
  assert.ok(source.includes("buildAIPayload"), "Payload de IA deve ser explicitamente allowlisted.");
  const aiProviderSource = fs.readFileSync(path.join(base, "ai/ai-provider.js"), "utf8");
  assert.ok(aiProviderSource.includes("não controla o navegador") && aiProviderSource.includes("classificar os campos"), "O prompt deve limitar a IA à classificação e deixar os cliques para a automação local.");
  const navigationSource = fs.readFileSync(path.join(base, "automation/navigation.js"), "utf8");
  assert.ok(navigationSource.includes("[onclick]") && navigationSource.includes("td, th, li, span, div"), "A navegação precisa cobrir as abas legadas do SIGITM");
  assert.ok(navigationSource.includes("Tipo abertura") && navigationSource.includes("Tipo incidencia"), "Os rótulos de tipo devem refletir o cabeçalho real da página");
  assert.ok(navigationSource.includes("readClockPauseData") && navigationSource.includes("table[id*='listParadaRelogio']") &&
    navigationSource.includes('normalize(textOf(cell)) === "fim"') && navigationSource.includes('data.paradaRelogio = "Sim"'),
  "Início/fim da parada devem ser lidos da tabela SIGITM, inferindo pausa quando o campo não estiver disponível");
  const popupSource = fs.readFileSync(path.join(base, "popup/popup.js"), "utf8");
  const contentPreviewSource = fs.readFileSync(path.join(base, "content/content.js"), "utf8");
  assert.ok(contentPreviewSource.includes("addOperationalPreview(data)") && contentPreviewSource.indexOf("addOperationalPreview(data)") < contentPreviewSource.indexOf("requestDecision(data, requestedMode)"),
    "A previsão operacional deve ser calculada antes da classificação para aparecer também em casos bloqueados");
  assert.ok(contentPreviewSource.includes("data.dataReparo = validation.repairValue || \"\";") &&
    contentPreviewSource.includes("Data/hora que será utilizada para a baixa:") &&
    popupSource.includes("Data/hora que será utilizada para a baixa:") && popupSource.includes("Fim da parada:") && popupSource.includes("Código de baixa previsto:"),
  "O aviso e o popup devem apresentar horário, parada e código previsto mesmo quando a classificação bloquear");
  const background = fs.readFileSync(path.join(base, "background/background.js"), "utf8");
  assert.ok(background.includes("DIVERGÊNCIA IA") || background.includes("BaixaValidation.compareAIWithRules"));
  assert.ok(background.includes("BaixaRules.automaticCodeForClient(data.cliente)") && background.includes('status: "REGRA PRIORITÁRIA DO CLIENTE"'), "SEDUC/FED devem ignorar divergências da IA e manter a regra automática 2A011");
  assert.ok(background.includes("chrome.scripting.executeScript") && background.includes("await injectContent(tabId)"), "Se não houver receptor, o background deve reinjetar o content script na aba SIGITM atual.");
  assert.ok(background.includes("async function injectContent(tabId)") && background.includes("for (const file of CONTENT_FILES)") &&
    background.includes("executeScriptFile(tabId, file)") && background.includes("falha ao carregar “${file}”"),
  "A reinjeção deve identificar o arquivo específico quando o Chrome falhar ao carregá-lo");
  assert.ok(fs.readFileSync(path.join(base, "content/content.js"), "utf8").includes("__BAIXADOR_AUTOMATICO_V24__"), "A reinjeção deve identificar o controller atualizado.");
  assert.ok(background.includes("GET_BAIXADOR_CONTENT_STATUS_V24") && contentSourceForDiagnosis.includes("GET_BAIXADOR_CONTENT_STATUS_V24") &&
    background.includes("baixa-controller-v25") && contentSourceForDiagnosis.includes("baixa-controller-v25") && background.includes("START_ANALYSIS_V8"),
  "O background deve exigir o protocolo v24 e uma mensagem de estado exclusiva para rejeitar controladores antigos.");
  assert.ok(background.includes("BaixaRunGuard.authorizeRun") && background.includes('"run-guard.js"'), "O background deve aplicar o guard para lock persistido e runId efêmero.");
  assert.ok(background.includes("MAX_CONCURRENT_RUNS = 2") && background.includes("BaixaRunQueue.nextStartable") &&
    background.includes("activeRuns: activeRunList") && background.includes("persistActiveRuns()") && background.includes("hydrateActiveRuns()"),
  "O background deve limitar a duas execuções, restaurar estado e expor a lista ativa ao popup.");
  assert.ok(background.includes("stopRuns.forEach((runId, tabId)") && background.includes("activeRunCount()"),
    "O limite deve contar execuções ativas e parar cada guia usando seu próprio runId.");
  const queuePopupSource = fs.readFileSync(path.join(base, "popup/popup.js"), "utf8");
  const queuePopupMarkup = fs.readFileSync(path.join(base, "popup/popup.html"), "utf8");
  assert.ok(queuePopupSource.includes("activeRunList") && queuePopupSource.includes("waitingRunList") && queuePopupSource.includes("failedRunList"),
    "O popup deve renderizar execuções ativas, aguardando e falhas recentes.");
  assert.ok(queuePopupMarkup.includes('id="runQueueInfo"') && queuePopupMarkup.includes('id="runCount"'),
    "O popup deve incluir o resumo de capacidade e estado da fila.");
  assert.ok(background.includes("TEST_AI_API") && background.includes("dados sintéticos"), "Teste de API deve usar somente dados fictícios e nunca dados de um chamado.");
  const optionsHtml = fs.readFileSync(path.join(base, "options/options.html"), "utf8");
  const optionsJs = fs.readFileSync(path.join(base, "options/options.js"), "utf8");
  const testApiHandler = background.slice(background.indexOf('message?.type === "TEST_AI_API"'), background.indexOf('message?.type === "SAVE_OPTIONS"'));
  assert.ok(!optionsHtml.includes("privacyConsent") && !optionsHtml.includes("Entendi e autorizo") && optionsHtml.includes("Privacidade e limites do provedor"),
    "A confirmação explícita do Google/Gemini deve ser removida, mantendo o aviso informativo de privacidade");
  assert.ok(!optionsJs.includes("privacyConsent") && !optionsJs.includes("Confirme o aviso de privacidade") &&
    !testApiHandler.includes("privacyConsent") && !testApiHandler.includes("Confirme o aviso de privacidade"),
  "Salvar configurações e testar a API não devem exigir confirmação de privacidade");
  assert.ok(background.includes("baixaAiConnectionStatus") && fs.readFileSync(path.join(base, "popup/popup.html"), "utf8").includes("aiStatusTitle"), "O resultado de configuração/teste da IA deve aparecer no popup da extensão.");
  assert.ok(JSON.parse(fs.readFileSync(path.join(base, "manifest.json"), "utf8")).host_permissions.includes("https://api.groq.com/*"));
  const extensionManifest = JSON.parse(fs.readFileSync(path.join(base, "manifest.json"), "utf8"));
  assert.ok(!extensionManifest.content_scripts[0].js.includes("automation/user-progress.js"), "O rastreamento de baixa manual deve estar removido do content script");
  assert.ok(extensionManifest.content_scripts[0].matches.includes("http://10.240.59.14/SIGITMWeb/*") &&
    extensionManifest.host_permissions.includes("http://10.240.59.14/SIGITMWeb/*"),
  "O manifesto deve habilitar scripts e chamadas no host SIGITM interno por IP");
  const backgroundSource = fs.readFileSync(path.join(base, "background/background.js"), "utf8");
  assert.ok(backgroundSource.includes('new Set(["sigitm.redecorp.br", "10.240.59.14"])') &&
    backgroundSource.includes("function isSigitmHost(hostname)"),
  "O background deve aceitar explicitamente somente o host oficial e o IP interno SIGITM");
  assert.ok(!backgroundSource.includes("USER_BAIXA_PROGRESS") && !backgroundSource.includes("GET_USER_BAIXA_PROGRESS") &&
    !contentSourceForDiagnosis.includes("A automação foi bloqueada para evitar repetir etapas"),
  "A verificação e o bloqueio baseados em progresso manual devem estar removidos");
  assert.ok(!contentSourceForDiagnosis.includes("etapaBaixaManual") && !fs.readFileSync(path.join(base, "popup/popup.js"), "utf8").includes("Baixa iniciada manualmente"),
    "O resultado e o popup não devem mais apresentar o estado de baixa manual");
  assert.ok(contentSourceForDiagnosis.includes("catch { /* contexto invalidado */ }") && contentSourceForDiagnosis.includes("não há worker disponível após recarga"),
    "Chamadas runtime de content scripts antigos devem tolerar recarga da extensão sem exceções não capturadas");
  assert.ok(backgroundSource.includes("Recarregue a extensão em chrome://extensions e atualize a página SIGITM"),
    "Falhas do Chrome ao buscar scripts devem orientar recuperação clara");
  const optionsMessage = background.slice(background.indexOf('message?.type === "GET_OPTIONS"'), background.indexOf('message?.type === "TEST_AI_API"'));
  assert.ok(!optionsMessage.includes("apiKeys:") && !optionsMessage.includes("settings: { ...settings"), "GET_OPTIONS não pode serializar o mapa de chaves à página de opções.");
  assert.ok(background.includes("current.tabId === tab.id") && background.includes("STOP_AUTOMATION"), "Uma nova análise explícita na mesma guia deve substituir um lock antigo.");
  assert.ok(background.includes("current.stopped = true") && background.includes("const active = stored.baixaActiveRun"),
    "A execução antiga deve ser marcada como parada antes de validar a nova solicitação da mesma guia");
  assert.ok(background.includes("waitForTicketTabChange(previousTabs") && background.includes("previous.url !== tab.url") && background.includes("tab.active && !previous.active"), "A fila deve identificar novas guias e guias SIGITM existentes reutilizadas pelo sistema");
  assert.ok(background.includes("if (!clickResult?.clicked)"), "O coordenador deve verificar a propriedade clicked retornada pelo clique MAIN-world, não uma propriedade ok inexistente");
  assert.ok(background.includes("await returnToListAndRefresh(batch,") && background.includes("await activateTab(batch.listTabId)"), "Após cada ticket, deve voltar à guia da tabela e atualizar antes de abrir o próximo");
  assert.ok(background.includes('phase = "closing-ticket"') && background.includes('phase = "refreshing-list"') && background.includes('phase = "idle"'),
    "A fila deve persistir as fases de fechamento, atualização e prontidão para impedir avanço concorrente");
  assert.ok(background.includes('const expectedClose = ["closing-ticket", "refreshing-list"].includes(batch.phase)') &&
    background.includes("!item.processing && !item.ticketTabId"),
  "O evento esperado de fechamento da guia não pode iniciar outro BD durante a atualização da tabela");
  assert.ok(background.includes("const skipFailed = !succeeded && message.uncertain !== true") &&
    background.includes("nenhum BD seguinte será iniciado"),
  "Baixa incerta ou cancelada deve pausar e manter a guia; falha definitiva segue para o próximo BD");
  const batchCompletion = background.slice(background.indexOf('if (message?.type === "BATCH_TICKET_FINISHED")'), background.indexOf('if (message?.type === "RECORD_FINAL_RESULT")'));
  assert.ok(batchCompletion.indexOf("chrome.tabs.remove(finishedTicketTabId)") < batchCompletion.indexOf("returnToListAndRefresh(batch,") &&
    batchCompletion.indexOf("returnToListAndRefresh(batch,") < batchCompletion.indexOf("processNextBatchTicket(batch)"),
  "O ciclo deve fechar o BD confirmado, atualizar a guia da tabela e somente depois abrir o próximo");
  assert.ok(background.includes("CONTINUE_MASSIVE_LIST") && background.includes("MASSIVE_LIST_URL") && background.includes("continueMassiveListFromTicket"), "Ticket individual liberado deve voltar à consulta 95803, atualizar e iniciar o próximo BD");
  assert.ok(!background.slice(background.indexOf("async function finishBatch"), background.indexOf("async function processNextBatchTicket")).includes("chrome.tabs.remove"), "Falhas genéricas da fila nunca devem fechar a guia do ticket antes da confirmação explícita");
  assert.ok(background.includes('const listName = BaixaBatch.listName(url.href)') && background.includes("startBatchForTab(tab.id, listName)"), "O botão Baixar automaticamente deve detectar e iniciar o lote quando a guia ativa for uma das tabelas SIGITM");
  assert.ok(background.includes("chrome.action.setIcon") && background.includes("function makeToolbarIcon(size)") && background.includes("#e3262e"), "O ícone da extensão deve mostrar o globo azul em aro verde-amarelo com X vermelho");
  assert.ok(background.includes("automationActive") && background.includes("activeBatch && !activeBatch.finished"), "O estado do popup deve saber quando um processamento em lista está ativo mesmo entre dois tickets");
  assert.ok(JSON.parse(fs.readFileSync(path.join(base, "manifest.json"), "utf8")).name === "Baixador Automático v3", "A extensão deve aparecer como versão 3 no Chrome");
  assert.ok(!fs.readFileSync(path.join(base, "popup/popup.html"), "utf8").includes("executeBatch") && !fs.readFileSync(path.join(base, "popup/popup.js"), "utf8").includes("RUN_BATCH_ACTIVE_TAB"), "Não deve existir um botão separado para processar a lista");
  const contentSource = fs.readFileSync(path.join(base, "content/content.js"), "utf8");
  assert.ok(contentSource.includes("Etapa: ${currentStage}") && contentSource.includes("JSON.stringify(diagnosticLog, null, 2)") && contentSource.includes("baixa-controller-v25"),
    "Falhas devem exibir a etapa e o stack como JSON legível no console e identificar o controller atualizado");
  assert.ok(contentSource.includes('BaixaHandler.findUniqueButton(["Atualizar"])') && contentSource.includes("sawLoader ? 400 : 1500"), "O retorno à tabela deve aguardar carregamento e proteger o clique em Atualizar");
  assert.ok(background.includes('world: "MAIN"') && background.includes("async function clickSequenceInPage") && background.includes("await guardedClick(target)") && background.includes("await waitForIdle()") && background.includes("target.dispatchEvent(new MouseEvent(\"dblclick\""), "A página SIGITM deve guardar cada clique sequencial por prontidão/loader no contexto principal");
  assert.ok(contentSource.includes("temposEtapas: currentTimings()") && contentSource.includes("Tempos por etapa") && contentSource.includes("durationMs"),
    "A execução deve registrar durações por etapa sem adicionar pausas ao fluxo");
  assert.ok(background.includes("chrome.tabs.onCreated.addListener(onCreated)") && background.includes("chrome.tabs.onUpdated.addListener(onUpdated)") &&
    background.includes("chrome.tabs.onActivated.addListener(onActivated)"),
  "A detecção de nova guia deve reagir a eventos do Chrome");
  assert.ok(!background.slice(background.indexOf("async function waitForTicketTabChange"), background.indexOf("function ticketUrlFromLink"))
    .includes("setTimeout(resolve, 150)"), "A espera de guias não deve usar polling fixo de 150 ms");
  assert.ok(contentSource.includes("sendResponse({ ok: true, started: true, runId: message.runId })"), "O novo content script precisa confirmar a mensagem de início para o background não reinjetar e fechar o ticket.");
  assert.ok(contentSource.includes("BaixaHandler.beginMainClosure(stopCheck, async () =>") && contentSource.includes("BaixaHandler.closeActiveAction(decision.codigoBaixa, stopCheck, message => notify(message))"),
    "O acionamento ativo deve ser tratado após Bloquear, com o mesmo código decidido para o chamado");
  assert.ok(contentSource.includes("Confirme o código de baixa") && contentSource.includes('type: "SAVE_CODE_LEARNING"'), "O fluxo automático deve perguntar e salvar localmente a escolha do código");
  assert.ok(contentSource.includes('data-case-field="tipoAbertura"') && contentSource.includes('data-case-field="procedencia"') && contentSource.includes('data-case-field="cliente"') && contentSource.includes('data-case-field="intragov"') && contentSource.includes('data-case-field="tipoIncidencia"') && contentSource.includes('data-case-field="servicoAfetado"') && contentSource.includes('"Marcada (Sim)"') && contentSource.includes('"Desmarcada (Não)"'), "A pergunta deve exibir os campos de regra e estado marcado/desmarcado do Intragov");
  assert.ok(fs.readFileSync(path.join(base, "background/background.js"), "utf8").includes('message?.type === "SAVE_CODE_LEARNING"'), "O background deve validar e persistir a escolha do código do usuário");
  assert.ok(contentSource.indexOf("BaixaHandler.beginMainClosure(stopCheck, async () =>") < contentSource.indexOf("BaixaFormHandler.fillDiagnosis(decision, stopCheck)"), "Diagnóstico deve ser preenchido somente após Bloquear, tratar acionamento e Baixar");
  assert.ok(contentSource.indexOf("BaixaFormHandler.fillClosure(") < contentSource.indexOf("BaixaFormHandler.prepareCertificationForSave(stopCheck)"), "A Certificação deve ser pré-validada depois do Encerramento e antes do envio");
  assert.ok(contentSource.indexOf("BaixaFormHandler.prepareCertificationForSave(stopCheck)") < contentSource.indexOf("BaixaHandler.saveMainClosure(stopCheck)"), "Gravar Baixa só pode ocorrer depois de validar a Certificação");
  assert.ok(contentSource.includes("BaixaDateHandler.validateDates(data)"), "Data de Reparo deve ser calculada e validada antes de alterar o chamado");
  assert.ok(fs.readFileSync(path.join(base, "automation/form-handler.js"), "utf8").includes('"Data do Reparo", "Dt Reparo", "Dt. Reparo"'), "Encerramento deve reconhecer variações legadas de Data de Reparo");
  const formHandlerSource = fs.readFileSync(path.join(base, "automation/form-handler.js"), "utf8");
  assert.ok(!formHandlerSource.includes("scanCertificationSelects") && !formHandlerSource.includes('doc.querySelectorAll("select")'), "A Certificação não pode enumerar os selects do formulário inteiro");
  assert.ok(!formHandlerSource.includes(".click()"), "Os cliques de formulário devem passar pelo guard central de carregamento");
  assert.ok(formHandlerSource.includes("async function fillRepairDate") && formHandlerSource.includes("await fillRepairDate(dataReparo, shouldStop)") && formHandlerSource.includes("setValue(field, expected, { allowLocked: true })"), "Data de Reparo deve ser preenchida inclusive se SIGITM marcar o campo como readonly/disabled e depois verificada");
  const closureSource = formHandlerSource.slice(formHandlerSource.indexOf("async function fillClosure"));
  assert.ok(!closureSource.includes("serviceAliases") && !closureSource.includes("servicoAfetado"), "Serviço Afetado não deve ser preenchido no Encerramento");
  assert.ok(formHandlerSource.includes("function phoneValuesForLayout(intragov, count)"), "Os valores de telefone devem adaptar-se aos layouts físicos com dois ou três inputs");
  assert.ok(!formHandlerSource.includes('fillBestEffort(["Intragov"], intragov ? "Sim" : "Não", skippedFields, { blur: true })'), "Encerramento não deve procurar Intragov, pois o checkbox pertence à aba Definição");
  assert.ok(formHandlerSource.includes("function verifyClosureValues(intragov)") && formHandlerSource.includes("await waitForClosureValues(intragov, shouldStop)") && formHandlerSource.includes("Encerramento não confirmou todos os campos"), "A automação não deve acionar Gravar Baixa se os Telefones não persistirem após o blur");
  assert.ok(formHandlerSource.includes('if (options.blur || options.allowLocked) control.dispatchEvent(new EventType("blur"))') && formHandlerSource.includes('setValue(control, values[index], { blur: true })'), "Os campos de Encerramento devem disparar blur para confirmar valores em formulários legados SIGITM");
  assert.ok(contentSource.includes("uncertain: mainClosureSubmitted"), "Falha antes de Gravar Baixa segue para o próximo BD mantendo a guia aberta; após Gravar Baixa a fila pausa");
  assert.ok(formHandlerSource.includes("const expectedPhones = phoneValuesForLayout(intragov, phoneControls.length)"), "Deve confirmar os zeros/xx nos campos Telefone após preencher o Encerramento");
  assert.ok(formHandlerSource.includes('fillBestEffort(["Responsável"], "xx"'), "Responsável deve receber xx no Encerramento");
  assert.ok(formHandlerSource.includes('fillBestEffort(["Descrição"], "xx"') && formHandlerSource.includes('fillBestEffort(["Técnico"], "xx"') && formHandlerSource.includes('fillBestEffort(["Área Técnica"], "xx"'), "Todos os campos amarelos definidos devem receber xx");
  const baixaHandlerSource = fs.readFileSync(path.join(base, "automation/baixa-handler.js"), "utf8");
  assert.ok(baixaHandlerSource.includes('const visibleNextAction = ["Gravar Baixa", "Baixar"]') && baixaHandlerSource.includes("nenhuma ação foi repetida"),
    "A ausência de Bloquear com uma etapa posterior visível deve gerar diagnóstico seguro, sem repetir a ação");
  assert.ok(!baixaHandlerSource.includes(".click()"), "Os cliques de baixa devem passar pelo guard central de carregamento");
  assert.ok(baixaHandlerSource.includes('a.down[title="baixar"]') && baixaHandlerSource.includes("visiblePopups().find(isActionBaixaPopup)"),
    "A baixa deve clicar no controle da linha ativa e reconhecer o popup RichFaces por seu conteúdo");
  assert.ok(formHandlerSource.includes("async function fillActionBaixa(code, resolveScope") &&
    formHandlerSource.includes("editableActionTextFields(scope, codeField)") &&
    formHandlerSource.includes("async function waitForActionPopupReady(resolveScope") &&
    formHandlerSource.includes("await root.BaixaNavigation.waitForLoadingToFinish(shouldStop, deadline)") &&
    formHandlerSource.includes("ready = await waitForActionPopupReady(resolveScope, shouldStop)") &&
    formHandlerSource.includes('candidate => root.BaixaNavigation.normalize(root.BaixaNavigation.valueOf(candidate)) !== "xx"') &&
    baixaHandlerSource.includes("fillActionBaixa(baixaCode, () => visiblePopups().find(isActionBaixaPopup) || null, shouldStop)"),
  "O popup deve esperar loaders, relocalizar os campos após AJAX/blur e preencher xx sem ambiguidade com o chamado");
  assert.ok(baixaHandlerSource.includes('waitForUniqueButton(["Gravar"]') && baixaHandlerSource.includes("findActiveActionRows().length === 0"),
    "A gravação do acionamento deve aguardar confirmação de status inativo antes da baixa principal");
  assert.ok(baixaHandlerSource.includes("!actionPopupOpen()") && baixaHandlerSource.includes("reabrindo a aba Acionamento para atualizar a leitura") &&
    baixaHandlerSource.includes("actionSaveError()") && (baixaHandlerSource.match(/clickControl\(saveButton/g) || []).length === 1,
    "Confirmação do acionamento: popup fechado, releitura da tabela, erro explícito e um único clique em Gravar");
  assert.ok(contentSource.includes("BaixaHandler.returnTicketToActive(data, stopCheck") &&
    contentSource.indexOf("returnTicketToActive") < contentSource.indexOf("BaixaHandler.beginMainClosure"),
    "Com pausa, o retorno para Ativo ocorre uma vez, antes de Bloquear/Baixar");
  assert.equal(baixaHandler.classifyTicketStatus("Ativo"), "ativo");
  assert.equal(baixaHandler.classifyTicketStatus("Pausado"), "pausado");
  assert.equal(baixaHandler.classifyTicketStatus(""), "");
  assert.equal(navigation.applyClockPauseData({ paradaRelogio: "Sim", dataParadaRelogio: "21/10/26 04:04" }, { detected: false, status: "empty", start: "", end: "" }), "",
    "Pausa aberta com início conhecido não bloqueia: o ticket será retornado para Ativo");
  assert.ok(formHandlerSource.includes("function closurePhoneControls()") && formHandlerSource.includes("isYellowField") && formHandlerSource.includes("yellow.length === 3"), "A automação deve reconhecer os três inputs amarelos de telefone do layout atual e ignorar os brancos históricos");
  assert.ok(formHandlerSource.includes("waitForBaixaCodeField") && formHandlerSource.includes("Código Completo Baixa"), "Encerramento deve aguardar e reconhecer variações do campo de código");
  assert.ok(formHandlerSource.includes("selectDiagnosisFromLookup") && formHandlerSource.includes("clickLookupAdjacentTo(field, \"Diagnóstico\""), "Diagnóstico deve abrir a lupa e selecionar o código definido pelas regras");
  assert.ok(formHandlerSource.includes("waitForDiagnosisField") && formHandlerSource.includes("mesma altura"), "Diagnóstico deve aguardar o campo e localizar o input pelo rótulo no layout legado");
  assert.ok(formHandlerSource.includes("[code, description]") && formHandlerSource.includes("diagnosisField || await waitForDiagnosisField"), "Após a seleção, Diagnóstico deve aceitar Testado OK e confirmar o mesmo campo usado na lupa");
  assert.ok(!contentSource.includes("BaixaHandler.confirmMainClosure(stopCheck)"), "O fluxo não deve clicar Baixar novamente após preencher Encerramento");
  assert.ok(contentSource.includes("BaixaHandler.saveMainClosure(stopCheck)") && contentSource.includes('const resultLabel = "GRAVAR BAIXA ACIONADO"'), "Após preencher Encerramento, o fluxo individual deve acionar Gravar Baixa automaticamente");
  assert.ok(contentSource.includes('type: "CONTINUE_MASSIVE_LIST"') && contentSource.includes("Ticket liberado. Voltando à Validação Massiva"), "Após Ticket liberado em execução individual, deve retornar e continuar a lista 95803");
  assert.ok(contentSource.includes("O ticket foi apenas analisado; nenhuma baixa foi executada") &&
    contentSource.includes("await sendBatchTicketResult(batch, {"),
  "A fila deve ser notificada quando um ticket terminar sem execução automática");
  const batchSubmitFlow = contentSource.slice(contentSource.indexOf('notify("Certificação preenchida e confirmada. Agora sim, acionando Gravar Baixa…")'), contentSource.indexOf('await sendFinal(makeTimedRecord(data, decision, resultLabel))'));
  assert.ok(!batchSubmitFlow.includes("waitForTicketReleased") && !batchSubmitFlow.includes("waitForLoadingToFinish"), "Após Gravar Baixa sem erro, o ticket é considerado liberado sem esperar confirmação nem loaders");
  assert.ok(background.includes("BaixaDateHandler") || contentSource.includes("BaixaDateHandler.validateDates"), "Data de Reparo deve ser validada contra Data Objetivo, pausa e SLA antes da baixa");
  assert.ok(fs.readFileSync(path.join(base, "automation/date-handler.js"), "utf8").includes("Data de Reparo deve ser posterior à Data Criação."), "Data de Reparo deve ficar depois da Data Criação antes de permitir a baixa");
  assert.ok(fs.readFileSync(path.join(base, "automation/baixa-handler.js"), "utf8").includes('closeBlockPopup(shouldStop, "Baixar")'), "Popup informativo após Baixar deve ser fechado pelo X antes do Encerramento");
  assert.ok(baixaHandlerSource.includes("closeValidationErrorPopup") && baixaHandlerSource.includes("rich-mpnl-panel") && contentSource.includes("abrindo a aba Certificação"), "Erro Validation Error no popup RichFaces deve fechar antes de abrir Certificação");
  assert.deepEqual(baixaHandler.classifySigItmPopup("Bloquear", "Tíquete bloqueado."), { kind: "expected", message: "Tíquete bloqueado." }, "A confirmação esperada de bloqueio não é erro");
  assert.deepEqual(baixaHandler.classifySigItmPopup("Bloquear", "Erro ao bloquear: permissão negada."), { kind: "error", message: "Erro ao bloquear: permissão negada." }, "Erro ao bloquear deve manter o texto original para exibição");
  const originalDocumentsForBlockButton = navigation.documents;
  const originalVisibleForBlockButton = navigation.visible;
  const blockImage = { alt: "", title: "", getAttribute: name => name === "src" ? "/SIGITMWeb/images/ico_bloquear.gif" : null };
  const legacyBlockControl = {
    innerText: "", textContent: "", value: "", id: "form:acao1", name: "acao1", className: "",
    disabled: false, getAttribute: name => name === "onclick" ? "bloquearTiquete()" : null,
    querySelector: selector => selector === "img" ? blockImage : null, contains: () => false
  };
  navigation.documents = () => [{ querySelectorAll: () => [legacyBlockControl] }];
  navigation.visible = () => true;
  assert.equal(baixaHandler.findUniqueButton(["Bloquear"]), legacyBlockControl,
    "Deve reconhecer botão legado de Bloquear identificado pelo src do ícone mesmo sem texto acessível");
  navigation.documents = originalDocumentsForBlockButton;
  navigation.visible = originalVisibleForBlockButton;
  assert.ok(baixaHandlerSource.includes("waitForUniqueButton(blockLabels, 12000, shouldStop)") && baixaHandlerSource.includes("refreshBlockButton"),
    "O fluxo deve aguardar e relocalizar o botão Bloquear antes de clicar");
  assert.ok(baixaHandlerSource.includes("O SIGITM não confirmou o bloqueio do tíquete") && baixaHandlerSource.includes("Baixar foi cancelado"),
    "O fluxo não deve seguir para Baixar sem confirmação do bloqueio");
  assert.deepEqual(baixaHandler.classifySigItmPopup("Baixar", "Falha: chamado já encerrado."), { kind: "error", message: "Falha: chamado já encerrado." }, "Popup inesperado após Baixar deve ser reportado com sua mensagem");
  assert.deepEqual(baixaHandler.classifySigItmPopup("Baixar", ""), { kind: "empty", message: "" }, "Popup temporário sem texto após Baixar não deve gerar falso erro");
  assert.ok(baixaHandlerSource.includes('action === "Baixar" ? 900 : 7000') && baixaHandlerSource.includes('action === "Baixar" ? 1800 : 7000'), "A etapa Baixar não deve esperar sete segundos por um popup que normalmente não aparece");
  assert.ok(contentSource.includes("finalStatus: finalRunStatus") && background.includes("message.finalMessage") && background.includes("failed ? \"error\""), "O erro do SIGITM deve permanecer no status visível do popup da extensão após RUN_FINISHED");
  assert.ok(formHandlerSource.includes("Circuito é passível de gerência?"), "Certificação deve responder somente Circuito é passível de gerência? e confirmar o resultado");
  assert.ok(baixaHandlerSource.includes('await waitForUniqueButton(["Baixar"], 10000, shouldStop)'), "Após Bloquear, a automação deve aguardar o botão Baixar aparecer antes de clicar");
  assert.ok(baixaHandlerSource.includes("popupClosedAfterClick") && !baixaHandlerSource.includes('await root.BaixaNavigation.waitForLoadingToFinish(shouldStop);\n    return true;'), "Após fechar o popup de Baixar, a automação deve confirmar o fechamento sem bloquear no loader central");
  assert.ok(baixaHandlerSource.includes("waitForTicketReleased") && baixaHandlerSource.includes("return released;") &&
    baixaHandlerSource.includes('type: "CHECK_TICKET_RELEASED"') && !baixaHandlerSource.includes("sleep(400)"),
  "A guia em lote deve aceitar a confirmação local ou a encontrada em outro frame antes de fechar");
  assert.ok(baixaHandlerSource.includes("root.BaixaNavigation.textOf(doc.body)") && baixaHandlerSource.includes("(?:ticket|tiquete)"), "A confirmação SIGITM “Tíquete Liberado” deve ser identificada pelo texto inteiro do modal antes de fechar a guia");
  const originalDocumentsForTicketRelease = navigation.documents;
  const originalWaitForDomChangeForTicketRelease = navigation.waitForDomChange;
  const previousChromeForTicketRelease = global.chrome;
  navigation.documents = () => [{ body: { innerText: "" }, querySelectorAll: () => [] }];
  navigation.waitForDomChange = async () => true;
  global.chrome = { runtime: { sendMessage: (_message, callback) => callback({ ok: true, released: true }) } };
  assert.equal(await baixaHandler.waitForTicketReleased(1000), true,
    "A confirmação encontrada nos frames do background deve completar mesmo quando o content script superior não lê o popup");
  navigation.documents = () => [{ body: { innerText: "Mensagem Tíquete Liberado." }, querySelectorAll: () => [] }];
  assert.equal(await baixaHandler.waitForTicketReleased(1000), true,
    "A confirmação textual acessível localmente deve continuar sendo aceita sem consulta adicional");
  navigation.documents = originalDocumentsForTicketRelease;
  navigation.waitForDomChange = originalWaitForDomChangeForTicketRelease;
  if (previousChromeForTicketRelease === undefined) delete global.chrome;
  else global.chrome = previousChromeForTicketRelease;
  const backgroundSourceForRelease = fs.readFileSync(path.join(base, "background/background.js"), "utf8");
  const ticketReleaseHandler = backgroundSourceForRelease.slice(backgroundSourceForRelease.indexOf('if (message?.type === "CHECK_TICKET_RELEASED")'), backgroundSourceForRelease.indexOf('if (message?.type === "STOP_AUTOMATION")'));
  assert.ok(ticketReleaseHandler.includes("allFrames: true") && ticketReleaseHandler.includes("world: \"MAIN\"") &&
    ticketReleaseHandler.includes("results.some(item => item.result === true)"),
  "O fallback deve consultar todas as molduras da página no contexto principal, somente para leitura");
  assert.ok(baixaHandlerSource.includes("×|✕|✖|✗|✘") && baixaHandlerSource.includes("const rawLower = raw.toLowerCase()") && baixaHandlerSource.includes("selectBestPopupCloseControl"), "O detector de popup deve reconhecer X em Unicode e escolher automaticamente o fechamento no canto superior direito");
  assert.ok(baixaHandlerSource.includes("MutationObserver") && baixaHandlerSource.includes("popupCloseObserved") && baixaHandlerSource.includes("validationErrorPopup()"), "A validação do Gravar Baixa deve sobreviver ao fechamento manual do popup pelo usuário");
  assert.ok(navigationSource.includes("waitForTabActivation") && navigationSource.includes("tabPanelVisible(name)") &&
    !navigationSource.includes("tabContentHint(name)") && !navigationSource.includes("candidates[0] !== clickedElement") &&
    navigationSource.includes("não confirmou que seu painel está ativo"),
  "A ativação de qualquer aba deve ser confirmada pelo cabeçalho ou painel correspondente, nunca por texto de painéis ocultos");
  assert.ok(contentSource.includes('setStage("Baixa principal - localizar botão Baixar")') &&
    baixaHandlerSource.includes("Aba Cliente foi confirmada como ativa, mas o botão"),
  "O erro da baixa principal deve aparecer em uma etapa distinta do tratamento de acionamento e indicar o estado da aba Cliente");
  assert.ok(fs.readFileSync(path.join(base, "background/background.js"), "utf8").includes("baixaLiveStatus") && background.includes("AUTOMATION_STATUS"), "O popup deve receber o status vivo da automação");
  const popupMarkup = fs.readFileSync(path.join(base, "popup/popup.html"), "utf8");
  assert.ok(popupMarkup.includes('id="brandLogo"') && popupSource.includes("function setupLogo"), "A logo do popup deve ter carregamento explícito e fallback");
  assert.equal((popupMarkup.match(/class="primary"/g) || []).length, 1, "O popup deve ter um único botão principal");
  assert.ok(!popupMarkup.includes('id="analyze"') && !popupSource.includes('$("analyze")'), "O botão separado de análise deve ser removido");
  assert.ok(popupSource.includes('updatePrimaryAction($("mode").value)') && popupSource.includes('$("mode").value === "automatic"') && popupSource.includes("await startRun();"),
    "O botão principal deve refletir e executar o modo selecionado");
  assert.ok(popupSource.includes("if (!approved) return;") && popupSource.includes("Executar a baixa automática?"),
    "O modo automático deve manter confirmação explícita antes de iniciar");

  assert.ok(contentSource.includes("READ_BATCH_LIST_STATE") && contentSource.includes("BATCH_TICKET_FINISHED"), "O fluxo em lote deve ler a lista e notificar o resultado de cada ticket");
  assert.ok(popupSource.includes("A IA não é necessária para baixar") && popupSource.includes("se houver divergência, a baixa é bloqueada"), "A tela inicial deve explicar que IA é opcional e que divergência de IA conectada pode bloquear a baixa");
  assert.ok(popupSource.includes("Automação pausada") && popupSource.includes("Pausar automação") && popupSource.includes("Automação inativa"), "O botão de controle deve indicar claramente estados ativo, pausado e inativo");
  assert.ok(!fs.readFileSync(path.join(base, "popup/popup.html"), "utf8").includes("Chamado atual ou lista Seq"), "O botão principal deve permanecer curto, sem subtítulo explicativo longo");
  assert.ok(navigationSource.includes("waitForLoadingToFinish") && navigationSource.includes("loadingIndicators") && navigationSource.includes("assertActionReady") && navigationSource.includes("clickControl"), "Todo clique deve ser bloqueado enquanto qualquer loader visível estiver ativo");
  const styleDocument = {
    defaultView: { innerWidth: 1000, innerHeight: 700, getComputedStyle: () => ({ display: "block", visibility: "visible", position: "absolute" }) },
    querySelectorAll: () => []
  };
  const hiddenPanel = { hidden: false, ownerDocument: styleDocument, getClientRects: () => [{ width: 500, height: 300 }], getBoundingClientRect: () => ({ width: 500, height: 300 }), offsetParent: {} };
  styleDocument.defaultView.getComputedStyle = () => ({ display: "none", visibility: "hidden", position: "absolute" });
  assert.equal(navigation.visible(hiddenPanel), false, "Painel RichFaces oculto no DOM não deve ser tratado como popup aberto");
  const previousDocumentForLoader = global.document;
  const originalWaitForLoadingForLoader = navigation.waitForLoadingToFinish;
  const loaderDocument = {
    defaultView: { innerWidth: 1000, innerHeight: 700, getComputedStyle: () => ({ display: "block", visibility: "visible", position: "absolute" }) },
    querySelectorAll: selector => selector.includes(".spinner") ? [smallLoader] : []
  };
  const smallLoader = { ownerDocument: loaderDocument, className: "spinner", id: "", hidden: false, offsetParent: {}, getClientRects: () => [{ width: 70, height: 70 }], getBoundingClientRect: () => ({ left: 465, top: 300, right: 535, bottom: 370, width: 70, height: 70 }), matches: selector => selector.includes(".spinner"), getAttribute: () => null };
  global.document = loaderDocument;
  assert.deepEqual(navigation.loadingIndicators(), [smallLoader], "O loader central pequeno visível do SIGITM deve bloquear ações");
  const bigLoader = { ...smallLoader, className: "spinner overlay", getClientRects: () => [{ width: 900, height: 700 }], getBoundingClientRect: () => ({ left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700 }) };
  loaderDocument.querySelectorAll = selector => selector.includes(".spinner") ? [bigLoader] : [];
  assert.deepEqual(navigation.loadingIndicators(), [bigLoader], "Overlay de carregamento grande deve continuar sendo tratado como bloqueio");
  const processPanel = {
    ...smallLoader, className: "process-panel", id: "processDetails",
    getAttribute: () => null
  };
  loaderDocument.querySelectorAll = () => [processPanel];
  assert.deepEqual(navigation.loadingIndicators(), [], "Um painel estático de processo não pode ser confundido com loader ativo");
  assert.ok(!navigationSource.includes('[class*="process" i]') && !navigationSource.includes('[id*="process" i]'), "A detecção não pode usar o fragmento genérico 'process'");
  loaderDocument.querySelectorAll = selector => selector.includes(".spinner") ? [bigLoader] : [];
  let staleLoaderIndicators = [{
      ownerDocument: { defaultView: { getComputedStyle: () => ({ display: "block", visibility: "visible", position: "absolute" }) } },
      className: "spinner", id: "static-loader", hidden: false, offsetParent: {},
      getClientRects: () => [{ width: 90, height: 90 }],
      getBoundingClientRect: () => ({ left: 400, top: 250, right: 490, bottom: 340, width: 90, height: 90 }),
      matches: selector => selector.includes(".spinner"),
      getAttribute: () => null,
      isConnected: true,
      disabled: false
    }];
  const staleLoaderDocument = {
    defaultView: { innerWidth: 1000, innerHeight: 700, getComputedStyle: () => ({ display: "block", visibility: "visible", position: "absolute" }) },
    querySelectorAll: () => staleLoaderIndicators
  };
  const previousForStaleLoader = global.document;
  global.document = staleLoaderDocument;
  let loaderStopChecks = 0;
  await assert.rejects(navigation.waitForLoadingToFinish(() => ++loaderStopChecks >= 3), /interrompida/);
  assert.equal(loaderStopChecks, 3, "O loader persistente deve continuar aguardando sem virar falha automática, até o usuário parar");
  global.document = previousForStaleLoader;
  navigation.waitForLoadingToFinish = async () => true;
  let guardedClickCount = 0;
  const testClickTarget = {
    ownerDocument: loaderDocument, isConnected: true, disabled: false,
    tagName: "BUTTON", id: "test-control", name: "saveClosure", textContent: "Gravar Baixa",
    getClientRects: () => [{ width: 20, height: 20 }],
    getBoundingClientRect: () => ({ width: 20, height: 20 }),
    getAttribute: () => null,
    click: () => { guardedClickCount++; }
  };
  let clickLoaderWaits = 0;
  const originalWaitControl = navigation.waitForDomChange;
  navigation.waitForDomChange = async () => {
    clickLoaderWaits++;
    assert.equal(guardedClickCount, 0, "Nenhum clique pode ocorrer enquanto a logo/spinner de carregamento estiver visível");
    loaderDocument.querySelectorAll = () => [];
    return true;
  };
  await navigation.clickControl(testClickTarget);
  navigation.waitForDomChange = originalWaitControl;
  assert.equal(clickLoaderWaits, 1, "O clique deve aguardar o loader desaparecer");
  assert.equal(guardedClickCount, 1, "O clique deve prosseguir imediatamente após o loader desaparecer");
  let disabledButtonError;
  try {
    navigation.assertActionReady({ ...testClickTarget, disabled: true, id: "btn-gravar-baixa" }, "Gravar Baixa");
  } catch (error) { disabledButtonError = error; }
  assert.match(disabledButtonError?.message || "", /controle necessário não está disponível/i);
  assert.match(disabledButtonError.message, /etapa=Gravar Baixa/);
  assert.match(disabledButtonError.message, /id=btn-gravar-baixa/);
  assert.match(disabledButtonError.message, /rótulo="Gravar Baixa"/);
  assert.match(disabledButtonError.message, /motivo=controle desabilitado/);
  navigation.waitForLoadingToFinish = originalWaitForLoadingForLoader;
  global.document = previousDocumentForLoader;
  assert.ok(navigationSource.includes("waitForTabCandidate(name") && navigationSource.includes("const refreshTab = () => waitForTabCandidate(name"), "A navegação deve aguardar e relocalizar uma aba se o SIGITM trocar seu nó no DOM");
  const notificationSource = fs.readFileSync(path.join(base, "ui/notifications.js"), "utf8");
  assert.ok(!notificationSource.includes("Ampliar mensagem") && !notificationSource.includes("Copiar erro") && !notificationSource.includes("navigator.clipboard"),
    "O aviso não deve oferecer recursos para ampliar mensagem ou copiar texto");
  assert.ok(notificationSource.includes('class="close"') && notificationSource.includes('aria-label="Fechar aviso"') && notificationSource.includes("clearNotice()"),
    "O aviso deve ter um botão X que fecha e limpa o aviso persistido");
  assert.ok(notificationSource.includes("}, remaining)") && notificationSource.includes("noticeMeta") && notificationSource.includes("icons/sigitm-v2-48.png"), "A notificação deve manter estado, temporizador e logo");
  assert.ok(manifest.web_accessible_resources?.[0]?.resources.includes("icons/sigitm-v2-48.png"), "A logo do aviso na página SIGITM deve ser um recurso acessível à página.");
  assert.ok(notificationSource.includes("function celebrate") && contentSource.includes("BaixaNotifications.celebrate"), "Ao terminar a lista sem BDs, a interface deve exibir confetes");
  assert.ok(notificationSource.includes("sessionStorage.setItem") && notificationSource.includes("function restore()") && notificationSource.includes("saved.expiresAt"), "O aviso deve ser restaurado no reload pelo tempo restante dos cinco segundos");
  assert.ok(notificationSource.includes("chrome.storage.local.set") && notificationSource.includes("chrome.storage.local.get"), "O aviso deve ser persistido no armazenamento da extensão para sobreviver ao reload do SIGITM");
  assert.ok(formHandlerSource.includes('clickTab("Definição", shouldStop)') && !formHandlerSource.includes('async function fixCertificationValidation(shouldStop = () => false) {\n    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");\n    await root.BaixaNavigation.waitForLoadingToFinish(shouldStop);'), "A aba Definição/Certificação deve prosseguir sem ficar presa pelo loader visual central");


  // ---- v3.0: regressões da correção de CSP, ponte MAIN e consistência ----
  const pkg = JSON.parse(fs.readFileSync(path.join(base, "package.json"), "utf8"));
  assert.equal(manifest.version, pkg.version, "manifest.json e package.json devem ter a mesma versão");
  assert.equal(helpers.VERSION, manifest.version, "BaixaHelpers.VERSION deve acompanhar o manifest");
  const jsonSchema = aiProvider.toJsonSchema(aiSchema.outputSchema);
  assert.equal(jsonSchema.type, "object", "Schema enviado ao Gemini deve usar tipos JSON Schema em minúsculas");
  assert.equal(jsonSchema.properties.normalizedFields.properties.intragov.type, "boolean");
  assert.deepEqual(jsonSchema.properties.codigoBaixa.enum, aiSchema.outputSchema.properties.codigoBaixa.enum, "Enums não podem ser alterados");
  assert.equal(aiSchema.outputSchema.type, "OBJECT", "O schema interno não deve ser mutado");
  // ---- v3.1: estatísticas, filtro e gerenciador de códigos aprendidos ----
  const hist = [
    { dataHora: "2026-10-08T10:00:00Z", numeroChamado: "111111", codigoBaixa: "2A011", resultado: "TICKET LIBERADO", cliente: "ABC" },
    { dataHora: "2026-10-08T11:00:00Z", numeroChamado: "222222", codigoBaixa: "57033", resultado: "GRAVAR BAIXA ACIONADO" },
    { dataHora: "2026-10-07T09:00:00Z", numeroChamado: "333333", resultado: "BAIXA NÃO REALIZADA", erro: "Campo Técnico ambíguo" }
  ];
  const sum = helpers.summarizeHistory(hist);
  assert.deepEqual([sum.total, sum.success, sum.failed], [3, 2, 1]);
  assert.equal(Math.round(sum.successRate * 100), 67);
  assert.deepEqual(sum.byCode, { "2A011": 1, "57033": 1 });
  assert.equal(sum.byDay["2026-10-08"], 2);
  assert.equal(helpers.summarizeHistory(undefined).total, 0, "Histórico ausente não deve quebrar");
  assert.equal(helpers.filterHistory(hist, { text: "tecnico ambiguo" }).length, 1, "Busca ignora acentos e maiúsculas");
  assert.equal(helpers.filterHistory(hist, { result: "TICKET LIBERADO" }).length, 1);
  assert.equal(helpers.filterHistory(hist, {}).length, 3);
  const keyInfo = helpers.describeLearningKey(storage.codeLearningKey(learningCase));
  assert.equal(keyInfo.intragov, "Sim");
  assert.equal(helpers.describeLearningKey("não é json"), null);
  const listed = await storage.listLearnedCodes();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].codigoBaixa, "6Y200");
  const backup = JSON.parse(JSON.stringify(listed));
  assert.equal(await storage.deleteLearnedCode(listed[0].key), true, "Remover uma escolha errada");
  assert.equal((await storage.listLearnedCodes()).length, 0);
  const imp = await storage.importLearnedCodes([...backup, { key: "x", codigoBaixa: "6Y200" }, { key: backup[0].key, codigoBaixa: "99999" }, null]);
  assert.deepEqual(imp, { imported: 1, ignored: 3 }, "Importação descarta entradas inválidas");
  assert.equal((await storage.getLearnedCode(learningCase)).codigoBaixa, "6Y200", "Backup restaurado é reutilizado");
  await assert.rejects(storage.importLearnedCodes("lixo"), /Backup inválido/);
  await storage.clearLearnedCodes();
  assert.equal((await storage.listLearnedCodes()).length, 0);
  const bgForLearning = fs.readFileSync(path.join(base, "background/background.js"), "utf8");
  assert.ok(["LIST_LEARNING", "DELETE_LEARNING", "CLEAR_LEARNING", "IMPORT_LEARNING"].every(type => bgForLearning.includes(type)), "Background deve expor o gerenciador de códigos");
  assert.ok(/^3\./.test(manifest.version), "A versão do app deve ser 3.x");
  assert.equal(helpers.DEFAULT_MODELS.groq, aiProvider.defaults.groq, "Modelos padrão devem vir de uma única fonte");
  const protocolOf = file => fs.readFileSync(path.join(base, file), "utf8").match(/CONTENT_PROTOCOL = "([^"]+)"/)?.[1];
  assert.equal(protocolOf("content/content.js"), protocolOf("background/background.js"), "Protocolo do content script e do background devem coincidir");

  // Link X com href javascript: não pode navegar (CSP); onclick segue executando.
  const listeners = new Map();
  const cspLink = {
    getAttribute: name => name === "href" ? "javascript:fecharMensagem()" : "",
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: type => listeners.delete(type)
  };
  const release = baixaHandler.suppressJavascriptNavigation(cspLink);
  assert.ok(listeners.has("click"), "Deve instalar o guard de clique para href javascript:");
  let prevented = false;
  listeners.get("click")({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, "O guard deve cancelar a navegação javascript: bloqueada pela CSP");
  release();
  assert.equal(listeners.size, 0, "O guard deve ser removido após o clique");
  const plainLink = { getAttribute: () => "#", addEventListener: () => { throw new Error("não deve instalar guard"); }, removeEventListener() {} };
  assert.doesNotThrow(() => baixaHandler.suppressJavascriptNavigation(plainLink)(), "Links comuns não recebem guard");
  assert.deepEqual(baixaHandler.pageCloseRequest(cspLink, { id: "x" }), { kind: "function", value: "fecharMensagem" }, "Função simples deve ir para a ponte MAIN");
  assert.equal(baixaHandler.pageCloseRequest({ getAttribute: () => "javascript:alert(1)+1" }, { id: "x" }), null, "Expressões arbitrárias nunca viram pedido de fechamento");
  assert.deepEqual(baixaHandler.pageCloseRequest({ getAttribute: name => name === "onclick" ? "Richfaces.hideModalPanel('j_id1:painel')" : "" }, { id: "p" }), { kind: "richfaces", value: "j_id1:painel" });
  const bgSource = fs.readFileSync(path.join(base, "background/background.js"), "utf8");
  assert.ok(bgSource.includes("PAGE_CLOSE_POPUP") && bgSource.includes("BLOCKED_PAGE_FUNCTIONS") && bgSource.includes("baixaLiveStatus\", BATCH_STORAGE_KEY"), "Background deve atender a ponte MAIN e devolver o status vivo ao popup");
  assert.ok(bgSource.includes('startsWith(chrome.runtime.getURL(""))'), "senderIsExtension deve exigir página da própria extensão");
  assert.ok(fs.readFileSync(path.join(base, "popup/popup.js"), "utf8").includes("changes.baixaLiveStatus"), "Popup deve reagir ao status vivo");
  let slept = false;
  assert.equal(await helpers.waitFor(() => { slept = true; return "ok"; }, 50, () => false, 5), "ok");
  assert.equal(await helpers.waitFor(() => false, 20, () => false, 5), false, "waitFor devolve false ao estourar o tempo");
  await assert.rejects(helpers.waitFor(() => false, 50, () => true, 5), /interrompida/, "waitFor deve respeitar a parada");
  assert.ok(slept);

  // Regressões das correções de revisão geral.
  const longVerdict = aiSchema.validateDecision({ ...verdict, motivo: "x".repeat(500) });
  assert.equal(longVerdict.motivo.length, 300, "Motivo longo da IA deve ser truncado, não rejeitar a decisão");
  const callbackCalls = [];
  const once = await queue.runSequential([1], async value => value, { onResult: entry => { callbackCalls.push(entry); throw new Error("falha no callback"); } }).catch(() => null);
  assert.equal(callbackCalls.length, 1, "onResult que lança erro não deve registrar o mesmo item duas vezes");
  assert.equal(once, null);
  assert.ok(contentSource.indexOf('await sendFinal(makeTimedRecord(data, decision, resultLabel))') < contentSource.indexOf('type: "CONTINUE_MASSIVE_LIST"'), "O histórico deve ser gravado antes de o background fechar a guia");
  assert.ok(contentSource.includes("BAIXA INCERTA - CONFERIR") && contentSource.includes("queuedMode"), "Falha após Gravar Baixa deve ser incerta e a fila deve preservar o modo");
  assert.ok(!/queuedRunId = "";\s*stopRequested = true;/.test(contentSource), "Parar um run enfileirado não pode parar o run atual");
  assert.ok(typeof storage.clearHistory === "function" && background.includes("CLEAR_HISTORY"), "Limpar histórico deve passar pela fila de escrita do background");
  assert.ok(navigationSource.includes("hardDeadline") && navigationSource.includes("api.waitForLoadingToFinish(shouldStop, hardDeadline)"), "clickControl deve limitar a espera do loader pelo prazo máximo");
  assert.ok(baixaHandlerSource.includes("hasTicketReleased(doc, fullScan)") && baixaHandlerSource.includes("now - lastFullScan >= 1000") &&
    baixaHandlerSource.includes("now - lastFrameCheck >= 750"),
  "A verificação deve ler o body em cada ciclo, varrer elementos esporadicamente e consultar frames em intervalo controlado");
  assert.ok(navigationSource.includes("onClassification?.(") && contentSource.includes('type: "PREFETCH_ANALYSIS"'), "A IA deve ser iniciada logo após a leitura dos campos de classificação");
  assert.ok(background.includes("takeAIPrefetch(tabId, runId, data, settings)") && background.includes('message?.type === "PREFETCH_ANALYSIS"'), "O background deve reaproveitar a consulta antecipada da IA");

    {
    // BD único (padrão) × Fila: baixa individual não pode iniciar a fila sozinha.
    const contentSrc = fs.readFileSync(path.join(base, "content/content.js"), "utf8");
    const bgSrc = fs.readFileSync(path.join(base, "background/background.js"), "utf8");
    const popupSrc = fs.readFileSync(path.join(base, "popup/popup.js"), "utf8");
    assert.ok(contentSrc.includes('const continueMassiveList = !batch && downloadMode === "queue"'), "CONTINUE_MASSIVE_LIST só pode rodar no modo Fila");
    assert.ok(contentSrc.includes('type: "CLOSE_SINGLE_TICKET_TAB"') && contentSrc.includes("closeSingleTicket"), "BD único deve apenas fechar a guia após Ticket liberado");
    assert.ok(bgSrc.includes('message?.type === "CLOSE_SINGLE_TICKET_TAB"') && bgSrc.includes('currentSettings.downloadMode !== "queue"'), "Background deve tratar o fechamento único e bloquear lote fora do modo Fila");
    assert.ok(popupSrc.includes('$("downloadMode")'), "Popup deve expor a opção BD único/Fila");
    const storageFresh = require(path.join(base, "storage/storage.js"));
    assert.ok(storageFresh, "storage carregável");
    const runQueue = require(path.join(base, "background/run-queue.js"));
    assert.equal(runQueue.normalize([{ tabId: 1, url: "u" }])[0].downloadMode, "single", "Padrão da fila de execuções deve ser BD único");
    assert.equal(runQueue.normalize([{ tabId: 1, url: "u", downloadMode: "queue" }])[0].downloadMode, "queue");
  }
  console.log("All deterministic rules, AI schema, privacy, date, fallback, queue, and manifest tests passed.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
