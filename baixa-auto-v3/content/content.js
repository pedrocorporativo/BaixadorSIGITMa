(() => {
  "use strict";
  if (window.top !== window || !["sigitm.redecorp.br", "10.240.59.14"].includes(location.hostname.toLowerCase())) return;
  const CONTENT_PROTOCOL = "baixa-controller-v25";
  const controllerKey = "__BAIXADOR_AUTOMATICO_V24__";
  if (globalThis[controllerKey]) return;
  globalThis[controllerKey] = true;

  let stopRequested = false;
  let processing = false;
  let currentRunId = "";
  let queuedRunId = "";
  let queuedBatch = null;
  let queuedMode = "";
  let queuedDownloadMode = "single";

  const stopCheck = () => stopRequested;
  const norm = value => BaixaHelpers.normalizeText(value);
  const notify = (message, type = "info") => {
    try { BaixaNotifications.show(message, type); } catch { /* pode ser um content script antigo após recarregar a extensão */ }
    try {
      chrome.runtime.sendMessage({
        type: "AUTOMATION_STATUS",
        runId: currentRunId,
        status: type,
        message: String(message || "")
      }, () => { try { void chrome.runtime.lastError; } catch { /* contexto invalidado */ } });
    } catch { /* o Chrome invalida o runtime antigo ao recarregar a extensão */ }
  };

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, response => {
          let runtimeError = null;
          try { runtimeError = chrome.runtime.lastError; } catch { /* contexto invalidado */ }
          if (runtimeError) reject(new Error(runtimeError.message));
          else if (!response?.ok) reject(new Error(response?.error || "Falha na comunicação da extensão."));
          else resolve(response);
        });
      } catch (error) {
        reject(new Error(/context invalidated/i.test(String(error?.message || error))
          ? "A extensão foi recarregada durante a execução. Atualize a página SIGITM antes de tentar novamente."
          : String(error?.message || error || "Falha na comunicação da extensão.")));
      }
    });
  }

  function sendFinal(record) {
    return sendRuntimeMessage({ type: "RECORD_FINAL_RESULT", runId: currentRunId, record })
      .catch(error => { console.warn("[Baixador Automático] Não foi possível registrar o resultado final:", error?.message || error); });
  }

  function sendBatchTicketResult(batch, result) {
    if (!batch?.batchId) return Promise.resolve();
    return sendRuntimeMessage({ type: "BATCH_TICKET_FINISHED", batchId: batch.batchId, sequence: batch.sequence, ...result });
  }

  async function clickBatchSequence(sequence, doubleClick = false) {
    const wanted = String(sequence);
    for (const doc of BaixaNavigation.documents()) {
      for (const table of doc.querySelectorAll("table")) {
        const rows = [...table.querySelectorAll("tr")];
        const headerIndex = rows.findIndex(row => BaixaBatch.sequenceHeaderIndex([...row.querySelectorAll("th, td")]) >= 0);
        if (headerIndex < 0) continue;
        const headers = [...rows[headerIndex].querySelectorAll("th, td")];
        const seqIndex = BaixaBatch.sequenceHeaderIndex(headers);
        for (const row of rows.slice(headerIndex + 1)) {
          const cell = [...row.querySelectorAll("th, td")][seqIndex];
          if (cell && BaixaBatch.sequenceNumber(cell) === wanted && BaixaNavigation.visible(cell)) {
            const target = cell.querySelector("a, button, [role='link'], [onclick], [tabindex]") || cell;
            const link = target.closest?.("a") || cell.querySelector("a");
            const rawHref = String(link?.getAttribute("href") || "").trim();
            const clickHandler = String(link?.getAttribute("onclick") || target.getAttribute?.("onclick") || "");
            const openUrl = clickHandler.match(/(?:window\s*\.\s*)?open\s*\(\s*(['"])(.*?)\1/i)?.[2] ||
              rawHref.match(/^javascript:\s*(?:window\s*\.\s*)?open\s*\(\s*(['"])(.*?)\1/i)?.[2] || "";
            let href = "";
            const candidateHref = openUrl || (!/^(?:javascript:|#|mailto:)/i.test(rawHref) ? rawHref : "");
            if (candidateHref) {
              try { href = new URL(candidateHref, doc.location?.href || location.href).href; }
              catch { href = ""; }
            }
            if (!href || doubleClick) {
              const view = target.ownerDocument?.defaultView;
              // HTMLElement.click() aciona o comportamento padrão de links
              // (incluindo href/target), que uma MouseEvent criada manualmente
              // pode não executar no SIGITM legado. O intervalo curto reproduz
              // o duplo clique que abre a sequência na tabela.
              await BaixaNavigation.clickControl(target, stopCheck);
              if (doubleClick) {
                await BaixaNavigation.waitForLoadingToFinish(stopCheck);
                await BaixaNavigation.clickControl(target, stopCheck);
                if (view?.MouseEvent) {
                  target.dispatchEvent(new view.MouseEvent("dblclick", {
                    bubbles: true, cancelable: true, view, detail: 2, button: 0, buttons: 0
                  }));
                }
              }
            }
            return { clicked: true, href };
          }
        }
      }
    }
    return { clicked: false, href: "" };
  }

  // Não enumera nem consulta campos fora da lista autorizada.
  function certificationSummary(result) {
    const skipped = Array.isArray(result.skipped) && result.skipped.length
      ? ` Campo(s) ausente(s) ignorado(s): ${result.skipped.join(", ")}.`
      : "";
    return `Certificação verificada somente nos controles autorizados (${result.checked?.length ?? 7} localizado(s), ${result.changed} alteração(ões)); os demais campos não foram consultados nem alterados.${skipped}`;
  }

  function isBooleanYes(value) { return value === true || norm(value) === "sim"; }
  function isBooleanNo(value) { return value === false || norm(value) === "nao"; }

  function displayData(data) {
    return [
      `Chamado: ${data.numeroChamado || "não identificado"}`,
      `Tipo de Abertura: ${data.tipoAbertura || "não identificado"}`,
      `Procedência: ${data.procedencia || "não identificada"}`,
      `Tipo de Incidência: ${data.tipoIncidencia || "não identificada"}`,
      `Cliente: ${data.cliente || "não identificado"}`,
      `Intragov: ${isBooleanYes(data.intragov) ? "Sim" : isBooleanNo(data.intragov) ? "Não" : "não identificado"}`,
      `Serviço Afetado: ${data.servicoAfetado || "não identificado"}`,
      `Data Criação: ${data.dataCriacao || "não identificada"}`,
      `Data de Reparo original: ${data.dataReparoOriginal || "não identificada"}`,
      `Data de Reparo que será utilizada no Encerramento: ${data.dataReparo || data.dataReparoPrevista || "não calculável"}`,
      `Início do SLA: ${data.dataInicioSla || "não identificado"}`,
      `Data Objetivo: ${data.dataObjetivo || "não identificada"}`,
      `Parada de Relógio: ${data.paradaRelogio || "não identificada"}`,
      `Início da parada: ${data.dataInicioParadaRelogio || "não identificado"}`,
      `Fim da parada: ${data.dataFimParadaRelogio || "não identificado"}`,
      `Data/hora que será utilizada para a baixa: ${data.dataReparo || data.dataReparoPrevista || "não calculável"}`,
      `Validação de data e SLA: ${data.validacaoDataBaixa || "não executada"}`,
      `Acionamento: ${data.codigoAcionamento ? `${data.codigoAcionamento} (${data.acionamento})` : data.acionamento || "não identificado"}`
    ].join("\n");
  }

  function addOperationalPreview(data) {
    const validation = BaixaDateHandler.validateDates(data);
    data.dataReparoPrevista = validation.repairValue || "";
    data.dataReparo = validation.repairValue || "";
    data.validacaoDataBaixa = validation.valid
      ? validation.warnings?.length ? `Aprovada com avisos: ${validation.warnings.join(" ")}` : "Aprovada"
      : validation.reason;
  }

  async function requestDecision(data, mode = "") {
    const response = await sendRuntimeMessage({ type: "ANALYZE_CASE", runId: currentRunId, caseData: data, mode });
    return response.decision;
  }

  function askForBaixaCode(data, shouldStop = () => false) {
    return new Promise((resolve, reject) => {
      const style = document.createElement("style");
      style.textContent = `
        #baixa-code-choice-overlay{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:20px;background:#101828b3;backdrop-filter:blur(3px);font:14px 'Segoe UI',system-ui,sans-serif;color:#172033}
        #baixa-code-choice-dialog{width:min(540px,100%);max-height:90vh;overflow:auto;padding:28px;border-radius:24px;background:#fff;box-shadow:0 30px 90px #0006,0 0 0 1px #ffffff22}
        #baixa-code-choice-dialog h2{margin:0 0 8px;font-size:22px;font-weight:800;letter-spacing:-.03em}#baixa-code-choice-dialog p{margin:0 0 18px;color:#596579;line-height:1.55}
        #baixa-code-choice-dialog .baixa-case-fields{display:grid;grid-template-columns:minmax(110px,auto) 1fr;gap:8px 14px;margin:0 0 20px;padding:15px;border:1px solid #e3e7f0;border-radius:16px;background:#f8f9fc;font-size:12px}
        #baixa-code-choice-dialog .baixa-case-fields dt{color:#697386;font-size:11px;letter-spacing:.02em}#baixa-code-choice-dialog .baixa-case-fields dd{margin:0;color:#1b2640;font-weight:700;overflow-wrap:anywhere}
        #baixa-code-choice-dialog .baixa-choice-list{display:grid;gap:10px}
        #baixa-code-choice-dialog button{width:100%;padding:14px 16px;border:1px solid #d8deea;border-radius:16px;background:#fff;color:#1b2640;text-align:left;font:inherit;cursor:pointer;transition:border-color .15s,background .15s,transform .15s}
        #baixa-code-choice-dialog button:hover,#baixa-code-choice-dialog button:focus{border-color:#63308b;background:#f8f3fc;outline:3px solid #63308b2e;transform:translateY(-1px)}
        #baixa-code-choice-dialog button strong{display:block;color:#57247d;font-size:16px;font-weight:800;letter-spacing:.02em}#baixa-code-choice-dialog button span{display:block;margin-top:3px;color:#626d80;font-size:12px}
        #baixa-code-choice-dialog .baixa-cancel{margin-top:16px;text-align:center;border-radius:99px;color:#a02d2d;font-weight:700}
      `;
      const overlay = document.createElement("div");
      overlay.id = "baixa-code-choice-overlay";
      overlay.innerHTML = `
        <section id="baixa-code-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="baixa-code-choice-title">
          <h2 id="baixa-code-choice-title">Confirme o código de baixa</h2>
          <p>Confira os dados coletados e selecione o código que deve ser usado. Sua escolha será guardada neste computador para esta combinação.</p>
          <dl class="baixa-case-fields">
            <dt>Tipo de Abertura</dt><dd data-case-field="tipoAbertura"></dd>
            <dt>Procedência</dt><dd data-case-field="procedencia"></dd>
            <dt>Cliente</dt><dd data-case-field="cliente"></dd>
            <dt>Tipo de Incidência</dt><dd data-case-field="tipoIncidencia"></dd>
            <dt>Intragov</dt><dd data-case-field="intragov"></dd>
            <dt>Serviço Afetado</dt><dd data-case-field="servicoAfetado"></dd>
          </dl>
          <div class="baixa-choice-list">
            <button type="button" data-code="57033"><strong>57033</strong><span>Tipo de Incidência DDR</span></button>
            <button type="button" data-code="6Y200"><strong>6Y200</strong><span>Intragov marcado</span></button>
            <button type="button" data-code="2A082"><strong>2A082</strong><span>Repetido + Proativo</span></button>
            <button type="button" data-code="2A011"><strong>2A011</strong><span>Inicial + Preventivo/Reativo/Proativo ou Repetido + Reativo</span></button>
          </div>
          <button type="button" class="baixa-cancel" data-cancel>Cancelar execução</button>
        </section>`;
      const intragovValue = isBooleanYes(data.intragov) ? "Marcada (Sim)"
        : isBooleanNo(data.intragov) ? "Desmarcada (Não)" : "Não identificado";
      const caseFields = {
        tipoAbertura: data.tipoAbertura || "Não identificado",
        procedencia: data.procedencia || "Não identificada",
        cliente: data.cliente || "Não identificado",
        tipoIncidencia: data.tipoIncidencia || "Não identificada",
        intragov: intragovValue,
        servicoAfetado: data.servicoAfetado || "Não identificado"
      };
      for (const [key, value] of Object.entries(caseFields)) {
        overlay.querySelector(`[data-case-field="${key}"]`).textContent = value;
      }
      document.head.append(style);
      document.body.append(overlay);
      const list = overlay.querySelector(".baixa-choice-list");
      const cancelButton = overlay.querySelector("[data-cancel]");
      const stopTimer = setInterval(() => {
        if (shouldStop()) finish(new Error("Automação interrompida pelo usuário."));
      }, 200);
      const onKeyDown = event => {
        if (event.key === "Escape") finish(new Error("Seleção de código cancelada; nenhuma ação adicional será iniciada."));
      };
      let settled = false;
      const cleanup = () => {
        clearInterval(stopTimer);
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
        style.remove();
      };
      const finish = (error, code = "") => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(code);
      };
      list.addEventListener("click", event => {
        const button = event.target.closest("button[data-code]");
        if (button) finish(null, button.dataset.code);
      });
      cancelButton.addEventListener("click", () => finish(new Error("Seleção de código cancelada; nenhuma ação adicional será iniciada.")));
      document.addEventListener("keydown", onKeyDown, true);
      list.querySelector("button")?.focus();
    });
  }

  function applySelectedCode(decision, data, code, source) {
    const sourceLabel = source === "aprendido" ? "reutilizado da escolha salva"
      : source === "regra de cliente" ? "definido automaticamente pela regra do cliente" : "confirmado pelo usuário";
    const incidence = norm(decision?.normalizedFields?.tipoIncidencia || data?.tipoIncidencia);
    const diagnostico = incidence === "ddr" ? "00000032 Testado OK" : "00000017 Testado OK";
    return {
      ...decision,
      codigoBaixa: code,
      diagnostico,
      allowed: true,
      motivo: `Código ${code} ${sourceLabel}.`,
      codeSelection: { source, codigoBaixa: code },
      validation: {
        ...decision.validation,
        allowed: true,
        status: source === "aprendido" ? "CÓDIGO APRENDIDO" : source === "regra de cliente" ? "REGRA AUTOMÁTICA DO CLIENTE" : "CÓDIGO CONFIRMADO PELO USUÁRIO",
        reason: `Código ${code} ${sourceLabel}.`
      }
    };
  }

  async function chooseCodeForAutomaticRun(data, decision, shouldStop = () => false) {
    const automaticCode = BaixaRules.automaticCodeForClient(data.cliente);
    if (automaticCode) {
      if (!decision.allowed) return { decision, code: automaticCode };
      return { decision: applySelectedCode(decision, data, automaticCode, "regra de cliente"), code: automaticCode };
    }

    // Quando a pirâmide de regras já identificou o código, não interrompa a
    // automação para perguntar novamente. A pergunta fica reservada apenas às
    // combinações que as regras ainda não conhecem.
    if (decision.allowed && BaixaRules.CODES.includes(decision.codigoBaixa)) {
      return { decision, code: "", source: "regras locais" };
    }

    const learnedCode = BaixaRules.CODES.includes(decision.learnedCode?.codigoBaixa)
      ? decision.learnedCode.codigoBaixa : "";
    const selectedCode = learnedCode || await askForBaixaCode(data, shouldStop);
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    const response = await sendRuntimeMessage({
      type: "SAVE_CODE_LEARNING", runId: currentRunId, caseData: data, codigoBaixa: selectedCode,
      source: learnedCode ? "aprendido" : "usuário"
    });
    const source = learnedCode ? "aprendido" : "usuário";
    return { decision: applySelectedCode(decision, data, selectedCode, source), code: selectedCode, learning: response.learning };
  }

  function makeRecord(data, decision, result, error = "") {
    return {
      numeroChamado: data.numeroChamado || "",
      tipoAbertura: data.tipoAbertura || "",
      procedencia: data.procedencia || "",
      tipoIncidencia: data.tipoIncidencia || "",
      cliente: data.cliente || "",
      intragov: data.intragov ?? "",
      servicoAfetado: data.servicoAfetado || "",
      dataObjetivo: data.dataObjetivo || "",
      dataReparo: data.dataReparo || "",
      paradaRelogio: data.paradaRelogio ?? "",
      acionamento: data.codigoAcionamento || (data.acionamentoProcessado6Z036 ? "6Z036 (tratado)" : "Nenhum identificado"),
      codigoBaixa: decision?.codigoBaixa || "",
      origemCodigoBaixa: decision?.codeSelection?.source || "regras locais",
      diagnostico: decision?.diagnostico || "",
      resultado: result,
      iaUtilizada: decision?.ai?.available ? decision.ai.provider : "Motor determinístico (fallback)",
      confianca: decision?.ai?.confidence ?? "",
      motivo: decision?.allowed ? decision.motivo : decision?.validation?.reason || decision?.motivo || "",
      erro: error
    };
  }

  async function runAnalysis(runId, batch = null, requestedMode = "", downloadMode = "single") {
    if (processing) {
      if (runId && runId !== currentRunId) {
        stopRequested = true;
        queuedRunId = runId;
        queuedBatch = batch;
        queuedMode = requestedMode;
        queuedDownloadMode = downloadMode;
        notify("Substituindo a execução anterior pela nova solicitação…");
      }
      return;
    }
    processing = true;
    currentRunId = runId;
    stopRequested = false;
    let data = {};
    let decision = null;
    let mainClosureSubmitted = false;
    let finalRunStatus = "success";
    let finalRunMessage = "";
    let currentStage = "Leitura inicial do chamado";
    let stageStartedAt = Date.now();
    const stageTimings = [];
    const setStage = stage => {
      const now = Date.now();
      stageTimings.push({ stage: currentStage, durationMs: Math.max(0, now - stageStartedAt) });
      currentStage = stage;
      stageStartedAt = now;
    };
    const currentTimings = () => [
      ...stageTimings,
      { stage: currentStage, durationMs: Math.max(0, Date.now() - stageStartedAt) }
    ];
    const makeTimedRecord = (...args) => ({ ...makeRecord(...args), temposEtapas: currentTimings() });
    notify("Iniciando leitura rápida das abas do chamado…");
    try {
      data = await BaixaNavigation.readCase(stopCheck, tab => notify(`Leitura inicial: aguardando a aba ${tab}…`), partial => {
        void sendRuntimeMessage({ type: "PREFETCH_ANALYSIS", runId: currentRunId, caseData: partial }).catch(() => undefined);
      });
      if (stopCheck()) throw new Error("Automação interrompida pelo usuário.");
      addOperationalPreview(data);
      setStage("Classificação e validação das regras");
      notify("Campos lidos. Enviando apenas os campos de classificação à IA e às regras locais…");
      decision = await requestDecision(data, requestedMode);
      if (stopCheck()) throw new Error("Automação interrompida pelo usuário.");
      if (decision.mode === "automatic") {
        const selection = await chooseCodeForAutomaticRun(data, decision, stopCheck);
        decision = selection.decision;
      }
      const allowed = Boolean(decision.allowed);
      const validationText = decision.validation.reason || decision.motivo || "Classificação aprovada pelas regras locais.";
      decision = {
        ...decision,
        allowed,
        validation: {
          ...decision.validation,
          allowed,
          status: allowed ? decision.validation.status : "BLOQUEADO",
          reason: validationText
        }
      };
      const summary = [
        displayData(data),
        "",
        `Código de baixa previsto: ${decision.codigoBaixa || "não determinado — dados de classificação insuficientes"}`,
        `Diagnóstico previsto: ${decision.diagnostico || "não determinado — incidência/regra não identificada"}`,
        `Origem/regra do código: ${decision.motivo || decision.validation.reason}`,
        `Motivo: ${decision.motivo || decision.validation.reason}`,
        `Confiança da IA: ${decision.ai?.confidence == null ? "indisponível (fallback)" : `${Math.round(decision.ai.confidence * 100)}%`}`,
        `IA utilizada: ${decision.ai?.available ? decision.ai.provider : "Não — motor determinístico"}`,
        `Validação: ${allowed ? decision.validation.status : "BLOQUEADO — " + validationText}`
      ].join("\n");
      notify(summary, allowed ? "success" : "error");

      if (!allowed) {
        await sendFinal(makeTimedRecord(data, decision, decision.validation.status === "DIVERGÊNCIA IA × REGRAS" ? "DIVERGÊNCIA IA × REGRAS" : "BAIXA NÃO REALIZADA", validationText));
        await sendBatchTicketResult(batch, { success: false, uncertain: false, reason: validationText });
        return;
      }
      if (decision.mode !== "automatic") {
        await sendFinal(makeTimedRecord(data, decision, "ANÁLISE CONCLUÍDA"));
        notify(`${summary}\n\nModo análise: a leitura terminou; nenhuma baixa foi executada. Para prosseguir com as etapas automáticas, selecione “Modo automático” no popup.`, "success");
        await sendBatchTicketResult(batch, {
          success: false,
          uncertain: false,
          reason: "O ticket foi apenas analisado; nenhuma baixa foi executada. Selecione Baixar automaticamente para processar a lista."
        });
        return;
      }

      if (stopCheck()) throw new Error("Automação interrompida.");
      setStage("Validação das datas e do SLA");
      const dateValidation = BaixaDateHandler.validateDates(data);
      if (!dateValidation.valid) throw new Error(dateValidation.reason);
      data.dataReparo = dateValidation.repairValue;
      const dateWarnings = dateValidation.warnings || [];
      const validationSummary = dateWarnings.length
        ? `Aviso(s) não bloqueante(s): ${dateWarnings.join(" ")}`
        : "Validação de Data Objetivo, pausa de relógio e SLA de 4 horas aprovada.";
      const clockPausedCase = BaixaHelpers.normalizeText(data.paradaRelogio) === "sim";
      notify(`Data de Reparo para Encerramento: ${data.dataReparo}${clockPausedCase ? " (Data de Reparo original da aba Data, anterior ao início da parada)" : " (Data Criação + 1 hora)"}. ${validationSummary}`);
      if (clockPausedCase) {
        setStage("Pausa de Relógio - retorno para Ativo");
        const returned = await BaixaHandler.returnTicketToActive(data, stopCheck, message => notify(message));
        notify(returned ? "Ticket retornado para Ativo. Continuando a baixa…" : "Ticket já estava Ativo. Continuando a baixa…");
      }

      if (stopCheck()) throw new Error("Automação interrompida pelo usuário.");
      setStage("Bloquear e Baixar");
      notify("Executando sequência solicitada: Bloquear → tratar acionamento ativo, se houver → Baixar…");
      await BaixaHandler.beginMainClosure(stopCheck, async () => {
        setStage("Tratamento do acionamento ativo");
        const actionClosed = await BaixaHandler.closeActiveAction(decision.codigoBaixa, stopCheck, message => notify(message));
        if (data.acionamento === "Sim" && !actionClosed) {
          throw new Error("O acionamento estava ativo na leitura inicial, mas não foi possível localizar sua linha ativa após bloquear o chamado.");
        }
        if (actionClosed) notify("Acionamento ativo gravado com o código de baixa do chamado. Continuando a baixa principal…");
        setStage("Baixa principal - localizar botão Baixar");
      });
      if (stopCheck()) throw new Error("Automação interrompida pelo usuário.");
      setStage("Preenchimento do Diagnóstico");
      notify("Bloquear e clique no botão Baixar concluídos. Abrindo Definição para preencher e selecionar o Diagnóstico pela lupa…");
      const diagnosisSkipped = await BaixaFormHandler.fillDiagnosis(decision, stopCheck);
      if (diagnosisSkipped.length) notify(`Diagnóstico não editável; mantendo valor atual: ${diagnosisSkipped.join(", ")}.`);
      if (stopCheck()) throw new Error("Automação interrompida pelo usuário.");
      setStage("Preenchimento do Encerramento");
      notify("Diagnóstico selecionado. Seguindo para Encerramento sem repetir a ação Baixar.");
      const skippedFields = await BaixaFormHandler.fillClosure(decision, isBooleanYes(data.intragov), data.dataReparo, stopCheck, true);
      if (skippedFields.length) notify(`Tentativa continuará; campos não editáveis ou sem dado foram deixados como estão: ${skippedFields.join(", ")}.`);
      if (stopCheck()) throw new Error("Automação interrompida pelo usuário.");

      setStage("Pré-validação da Certificação");
      notify("Encerramento preenchido. Verificando a aba Certificação antes de clicar em Gravar Baixa…");
      const certificationPrecheck = await BaixaFormHandler.prepareCertificationForSave(stopCheck);
      notify(certificationSummary(certificationPrecheck) + " Voltando para Encerramento…");
      if (stopCheck()) throw new Error("Automação interrompida pelo usuário.");
      setStage("Gravar Baixa");
      notify("Certificação preenchida e confirmada. Agora sim, acionando Gravar Baixa…");
      let saveResult = await BaixaHandler.saveMainClosure(stopCheck);

      // Se o SIGITM rejeitar a gravação por campos obrigatórios da Certificação,
      // entrar na aba, repetir o preenchimento da lista fixa de campos (os campos
      // protegidos continuam sem preenchimento) e gravar novamente.
      if (saveResult?.validationError) {
        setStage("Correção da Certificação após Validation Error");
        notify("Gravar Baixa encontrou campos obrigatórios na Certificação. Fechando o aviso pelo X (ou aproveitando o fechamento manual) e abrindo a aba Certificação…");
        const validationPopupClosed = await BaixaHandler.closeValidationErrorPopup(stopCheck);
        if (validationPopupClosed) {
          notify("Aviso de validação fechado. Abrindo Certificação para corrigir somente os status pendentes…");
        } else if (saveResult.popupCloseObserved) {
          notify("O aviso de validação já foi fechado. Continuando automaticamente para a aba Certificação…");
        } else {
          notify("O SIGITM não expôs um popup identificável. A extensão seguirá diretamente para Certificação…");
        }
        const certification = await BaixaFormHandler.fixCertificationValidation(stopCheck);
        notify(`${certificationSummary(certification)} Tentando Gravar Baixa novamente…`);
        setStage("Nova tentativa de Gravar Baixa");
        saveResult = await BaixaHandler.saveMainClosure(stopCheck);
        if (saveResult?.validationError) {
          throw new Error("O SIGITM ainda retornou 'Validation Error: Value is required.' após corrigir a aba Certificação.");
        }
      }

      mainClosureSubmitted = true;
      setStage("Baixa gravada");
      // Erros do SIGITM aparecem em menos de 2s (tratados em saveMainClosure); sem erro, o ticket está liberado.
      notify("Gravar Baixa aceito sem erros.");
      const resultLabel = "GRAVAR BAIXA ACIONADO";
      // Só volta à Validação Massiva no modo Fila; em BD único apenas esta guia é fechada.
      const continueMassiveList = !batch && downloadMode === "queue";
      const closeSingleTicket = !batch && downloadMode !== "queue";
      // O histórico precisa ser gravado antes de o background fechar esta guia.
      await sendFinal(makeTimedRecord(data, decision, resultLabel));
      if (continueMassiveList) {
        notify("Ticket liberado. Voltando à Validação Massiva, atualizando a tabela e abrindo o próximo BD…");
        try { await sendRuntimeMessage({ type: "CONTINUE_MASSIVE_LIST" }); }
        catch (error) { console.warn("[Baixador Automático] Retorno à Validação Massiva não confirmado:", error?.message || error); }
      }
      notify(batch ? "Gravar Baixa aceito. Voltando à tabela; a confirmação do SIGITM segue sendo aguardada nesta guia."
        : "Gravar Baixa acionado automaticamente após o preenchimento e validação dos campos.", "success");
      await sendBatchTicketResult(batch, { success: true, uncertain: false, releasePending: true });
      if (closeSingleTicket) {
        try {
          if (await BaixaHandler.waitForTicketReleased(30000, stopCheck)) {
            notify("Ticket liberado. Fechando esta guia.", "success");
            await sendRuntimeMessage({ type: "CLOSE_SINGLE_TICKET_TAB", runId: currentRunId });
          } else notify("O SIGITM não confirmou a liberação do ticket. Guia mantida aberta para conferência.", "error");
        } catch (error) { console.warn("[Baixador Automático] Fechamento do BD único não concluído:", error?.message || error); }
      }
      if (batch) {
        // A tabela já foi retomada; esta guia só é fechada depois que o SIGITM confirmar. Sem confirmação ela fica aberta.
        try {
          if (await BaixaHandler.waitForTicketReleased(30000, stopCheck)) await sendRuntimeMessage({ type: "CLOSE_RELEASED_TICKET_TAB" });
          else notify(`O SIGITM não confirmou a liberação do ticket ${batch.sequence}. Guia mantida aberta para conferência.`, "error");
        } catch (error) { console.warn("[Baixador Automático] Confirmação em segundo plano não concluída:", error?.message || error); }
      }
    } catch (error) {
      const stopped = stopCheck() || /interrompida pelo usuário/i.test(error.message);
      const status = stopped ? "PROCESSAMENTO INTERROMPIDO" : mainClosureSubmitted ? "BAIXA INCERTA - CONFERIR" : "BAIXA NÃO REALIZADA";
      finalRunStatus = stopped ? "info" : "error";
      const errorMessage = String(error.message || error || "Erro desconhecido no SIGITM.");
      const failureDetails = `Etapa: ${currentStage}\n${errorMessage}`;
      finalRunMessage = failureDetails;
      const diagnosticLog = {
        stage: currentStage,
        message: errorMessage,
        stack: String(error.stack || "").slice(0, 5000)
      };
      console.error(`[Baixador Automático] Falha no fluxo SIGITM\n${JSON.stringify(diagnosticLog, null, 2)}`);
      const replacementPending = stopped && queuedRunId && queuedRunId !== currentRunId;
      if (!replacementPending) queuedRunId = "";
      if (replacementPending) {
        notify("Execução anterior cancelada; iniciando a solicitação mais recente…");
      } else {
        await sendFinal(makeTimedRecord(data, decision, status, failureDetails));
        notify(`${status}\n${failureDetails}\nNenhuma ação adicional será iniciada.`, "error");
        // Qualquer falha durante a preparação/preenchimento precisa manter o
        // ticket aberto para correção. Nunca avance ou feche a guia sem a baixa
        // ter concluído e o SIGITM ter confirmado o resultado.
        await sendBatchTicketResult(batch, { success: false, uncertain: mainClosureSubmitted, cancelled: stopped, reason: failureDetails });
      }
    } finally {
      const finalTimings = currentTimings();
      const totalDurationMs = finalTimings.reduce((total, item) => total + item.durationMs, 0);
      console.info("[Baixador Automático] Tempos por etapa", JSON.stringify({ runId: currentRunId, totalDurationMs, stages: finalTimings }));
      processing = false;
      const finishedRunId = currentRunId;
      try {
        chrome.runtime.sendMessage({
          type: "RUN_FINISHED", runId: finishedRunId,
          finalStatus: finalRunStatus, finalMessage: finalRunMessage
        }, () => { try { void chrome.runtime.lastError; } catch { /* contexto invalidado */ } });
      } catch { /* não há worker disponível após recarga da extensão */ }
      currentRunId = "";
      if (queuedRunId) {
        const nextRunId = queuedRunId;
        const nextBatch = queuedBatch;
        const nextMode = queuedMode;
        const nextDownloadMode = queuedDownloadMode;
        queuedRunId = "";
        queuedBatch = null;
        queuedMode = "";
        queuedDownloadMode = "single";
        void runAnalysis(nextRunId, nextBatch, nextMode, nextDownloadMode);
      }
    }
  }

  // Loader preso na tabela não pode travar a fila: após 5 s segue com a lista atual.
  const waitListIdle = () => BaixaNavigation.waitForLoadingToFinish(stopCheck, Date.now() + 5000)
    .catch(error => { if (stopCheck()) throw error; });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "GET_BAIXADOR_CONTENT_STATUS_V24") {
      sendResponse({ ok: true, protocol: CONTENT_PROTOCOL });
      return false;
    }
    if (message?.type === "START_ANALYSIS_V8" && message.protocol === CONTENT_PROTOCOL && message.runId) {
      void runAnalysis(message.runId, message.batch || null, message.mode || "", message.downloadMode === "queue" ? "queue" : "single");
      sendResponse({ ok: true, started: true, runId: message.runId });
      return false;
    }
    if (message?.type === "READ_BATCH_LIST_STATE_V8" && message.protocol === CONTENT_PROTOCOL) {
      void waitListIdle().then(() => sendResponse({ ok: true, state: BaixaBatch.readListState() }))
        .catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === "CLICK_BATCH_TICKET_V8" && message.protocol === CONTENT_PROTOCOL) {
      void waitListIdle().then(() => {
        return clickBatchSequence(message.sequence, message.doubleClick === true).then(result => {
          sendResponse({ ok: result.clicked, href: result.href, error: result.clicked ? "" : `Número da sequência ${message.sequence} não encontrado na coluna Seq.` });
        });
      }).catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === "REFRESH_BATCH_LIST_V8" && message.protocol === CONTENT_PROTOCOL) {
      void waitListIdle().then(async () => {
        const before = JSON.stringify(BaixaBatch.readListState());
        // Loader preso na tabela não pode bloquear o Atualizar; só exige botão visível e habilitado.
        const refreshButton = BaixaHandler.findUniqueButton(["Atualizar"]);
        if (!refreshButton || refreshButton.disabled) throw new Error("Botão Atualizar indisponível na tabela.");
        refreshButton.click();
        const startedAt = Date.now();
        let sawLoader = false;
        let stableSince = startedAt;
        let lastState = before;
        while (Date.now() - startedAt < 5000) {
          if (stopCheck()) throw new Error("Automação interrompida pelo usuário.");
          const loading = BaixaNavigation.loadingIndicators().length > 0;
          const currentState = JSON.stringify(BaixaBatch.readListState());
          if (loading) {
            sawLoader = true;
            stableSince = Date.now();
          } else if (currentState !== lastState) {
            lastState = currentState;
            stableSince = Date.now();
          } else if (Date.now() - startedAt >= 1000 && Date.now() - stableSince >= (sawLoader ? 400 : 1500)) {
            return { state: BaixaBatch.readListState(), sawLoader };
          }
          await BaixaNavigation.waitForDomChange(300, stopCheck);
        }
        // Sem confirmação de estabilidade, devolve a lista atual para a fila seguir em vez de travar.
        return { state: BaixaBatch.readListState(), sawLoader };
      }).then(result => sendResponse({ ok: true, ...result }))
        .catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === "BATCH_STATUS_V8" && message.protocol === CONTENT_PROTOCOL) {
      notify(message.message || "Processamento de lista em andamento…", message.status === "error" ? "error" : "info");
      if (message.status === "success" && /processamento encerrado|zero registros/i.test(message.message || "")) {
        BaixaNotifications.celebrate("Todos os BDs foram concluídos.");
      }
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "STOP_AUTOMATION") {
      if (message.runId && message.runId !== currentRunId) {
        if (message.runId === queuedRunId) {
          queuedRunId = "";
          queuedBatch = null;
          queuedMode = "";
          queuedDownloadMode = "single";
        }
        return false;
      }
      stopRequested = true;
      notify("PARAR AUTOMAÇÃO — processamento interrompido. O resultado atual foi mantido.", "error");
      return false;
    }
    return false;
  });
})();
