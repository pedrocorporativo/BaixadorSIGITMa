(function (root) {
  "use strict";
  // Qualquer indicador de processamento visível bloqueia a automação, inclusive
  // o ícone pequeno central usado pelo SIGITM durante chamadas AJAX.
  let lastActivatedTabName = "";

  function documents() {
    const result = [];
    const queue = [document];
    const seen = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      result.push(current);
      for (const frame of current.querySelectorAll("iframe, frame")) {
        try { if (frame.contentDocument) queue.push(frame.contentDocument); } catch { /* cross-origin: fields remain unidentified */ }
      }
    }
    return result;
  }

  function visible(element) {
    if (!element || element.hidden) return false;
    const style = getComputedStyleSafe(element);
    if (style && (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0)) return false;
    if (style?.pointerEvents === "none" && (style.position === "fixed" || style.position === "absolute")) return false;
    const rects = element.getClientRects?.();
    if (rects?.length) {
      const rect = element.getBoundingClientRect?.();
      if (rect && rect.width === 0 && rect.height === 0) return false;
      return true;
    }
    return Boolean(element.offsetParent);
  }

  function normalize(value) { return root.BaixaHelpers.normalizeText(value); }
  function textOf(element) { return String(element?.innerText || element?.textContent || "").trim(); }

  function loadingIndicators() {
    const selectors = "[aria-busy='true'], [data-loading='true'], [role='progressbar'], .loading, .loader, .spinner, .blockUI, .block-ui, .ui-blockui, .ajax-loader, .rf-st-start, [id*='loading' i], [class*='loading' i], [id*='carregando' i], [class*='carregando' i], [id*='spinner' i], [class*='spinner' i], [id*='processing' i], [class*='processing' i], [id*='processando' i], [class*='processando' i], img[src*='loading' i], img[src*='spinner' i], img[src*='processando' i]";
    return documents().flatMap(doc => [...doc.querySelectorAll(selectors)])
      .filter(isBlockingLoadingIndicator);
  }

  function isBlockingLoadingIndicator(element) {
    if (!visible(element)) return false;
    const style = getComputedStyleSafe(element);
    const rect = element.getBoundingClientRect?.();
    if (!style || !rect) return false;
    const width = Math.max(0, Number(rect.width) || 0);
    const height = Math.max(0, Number(rect.height) || 0);
    const area = width * height;
    const metadata = normalize([
      element.id, element.className, element.getAttribute?.("src"), element.getAttribute?.("alt"),
      element.getAttribute?.("aria-label")
    ].filter(Boolean).join(" "));
    const explicitBlock = element.matches?.("[aria-busy='true'], [data-loading='true'], .blockUI, .block-ui, .ui-blockui");
    if (explicitBlock) return true;
    // A classe/id/src é a identificação do indicador real; tamanho e posição
    // não podem transformar um loader pequeno em permissão para clicar.
    return /loading|loader|spinner|aguarde|carregando|processing|processando/.test(metadata);
  }

  function getComputedStyleSafe(element) {
    try { return element.ownerDocument.defaultView.getComputedStyle(element); }
    catch { return null; }
  }

  // Aguarda mutações reais; o timeout único também revalida animações CSS que
  // terminam sem uma mutação observável. Não há timer de polling contínuo.
  function waitForDomChange(timeout = 250, shouldStop = () => false) {
    return new Promise((resolve, reject) => {
      if (shouldStop()) return reject(new Error("Automação interrompida pelo usuário."));
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        observer?.disconnect();
        clearTimeout(timer);
        resolve(value);
      };
      const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(() => finish(true)) : null;
      for (const doc of documents()) {
        if (doc.documentElement) observer?.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      }
      const timer = setTimeout(() => finish(false), timeout);
      // Se não houver mutações, o timeout também observa o pedido de parada.
      if (shouldStop()) {
        settled = true;
        observer?.disconnect(); clearTimeout(timer);
        reject(new Error("Automação interrompida pelo usuário."));
      }
    });
  }

  async function waitForLoadingToFinish(shouldStop = () => false, hardDeadline = Infinity) {
    while (true) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      if (!loadingIndicators().length) return true;
      if (Date.now() >= hardDeadline) throw new Error("A tela SIGITM continua carregando; ação automatizada bloqueada.");
      // O indicador pode permanecer vários segundos durante o AJAX. Aguarde a
      // mutação que o remove; o timeout só revalida animações sem mutação.
      await waitForDomChange(750, shouldStop);
    }
  }

  function diagnosticValue(value, limit = 90) {
    return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, limit);
  }

  function describeControl(control) {
    if (!control) return "ausente";
    const tag = String(control.tagName || "desconhecido").toUpperCase();
    const type = String(control.type || control.getAttribute?.("type") || "").toLowerCase();
    const buttonLike = ["BUTTON", "A"].includes(tag) || control.getAttribute?.("role") === "button" ||
      (tag === "INPUT" && ["button", "submit", "image", "reset"].includes(type));
    const labels = [control.getAttribute?.("aria-label"), control.getAttribute?.("title"), control.getAttribute?.("alt")];
    if (buttonLike) labels.push(textOf(control), control.value);
    const label = diagnosticValue([...new Set(labels.filter(Boolean).map(value => diagnosticValue(value)))].join(" | "), 120);
    let visibleState = "desconhecido";
    try { visibleState = visible(control) ? "sim" : "não"; } catch { /* diagnóstico não pode mascarar erro */ }
    const connected = control.isConnected === false ? "não" : control.isConnected === true ? "sim" : "desconhecido";
    const disabled = control.disabled === true ? "sim" : control.disabled === false ? "não" : "desconhecido";
    const ariaDisabled = diagnosticValue(control.getAttribute?.("aria-disabled") || "não informado", 20);
    return `tag=${tag}; id=${diagnosticValue(control.id || "(vazio)", 80)}; name=${diagnosticValue(control.name || "(vazio)", 80)}; tipo=${diagnosticValue(type || "(vazio)", 24)}; rótulo=${label ? `"${label}"` : "(vazio)"}; conectado=${connected}; visível=${visibleState}; disabled=${disabled}; aria-disabled=${ariaDisabled}`;
  }

  function describeLoadingIndicators(indicators) {
    return indicators.slice(0, 3).map(element => {
      const rect = element.getBoundingClientRect?.();
      const identity = [element.tagName, element.id, typeof element.className === "string" ? element.className : ""]
        .filter(Boolean).map(value => diagnosticValue(value, 60)).join("#");
      const size = rect ? `${Math.round(Number(rect.width) || 0)}x${Math.round(Number(rect.height) || 0)}` : "tamanho desconhecido";
      return `${identity || "indicador sem identificador"} (${size})`;
    }).join(", ");
  }

  function assertActionReady(control, stage = "checagem pré-clique") {
    const loaders = loadingIndicators();
    const details = `etapa=${diagnosticValue(stage, 50)}; controle{${describeControl(control)}}`;
    if (loaders.length) {
      throw new Error(`A tela SIGITM está carregando; ação automatizada bloqueada. Diagnóstico: ${details}; indicadores=${loaders.length} [${describeLoadingIndicators(loaders)}].`);
    }
    const reasons = [];
    if (!control) reasons.push("referência ausente");
    else {
      if (control.isConnected === false) reasons.push("elemento removido do DOM");
      try { if (!visible(control)) reasons.push("elemento invisível"); }
      catch { reasons.push("não foi possível verificar visibilidade"); }
      if (control.disabled) reasons.push("controle desabilitado");
      if (control.getAttribute?.("aria-disabled") === "true") reasons.push("aria-disabled=true");
    }
    if (reasons.length) {
      throw new Error(`O controle necessário não está disponível para ação; clique bloqueado. Diagnóstico: ${details}; motivo=${reasons.join(", ")}.`);
    }
  }

  async function clickControl(control, shouldStop = () => false, beforeClick = null, refreshControl = null) {
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    const hardDeadline = Date.now() + 60000;
    let deadline = Date.now() + 2500;
    let lastError = null;
    let activeControl = control;
    let attempts = 0;
    let refreshFailure = "";
    while (Date.now() < deadline && Date.now() < hardDeadline) {
      attempts++;
      try {
        if (!activeControl || activeControl.isConnected === false || !visible(activeControl)) {
          if (typeof refreshControl === "function") {
            activeControl = await refreshControl();
          }
        }
        await api.waitForLoadingToFinish(shouldStop, hardDeadline);
        // O tempo gasto aguardando o AJAX não pode consumir o prazo de revalidação do controle.
        deadline = Math.max(deadline, Date.now() + 2500);
        assertActionReady(activeControl, "imediatamente antes do clique");
        if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
        beforeClick?.(activeControl);
        assertActionReady(activeControl, "após preparação do clique");
        activeControl.click();
        return true;
      } catch (error) {
        lastError = error;
        if (!/bloqueado|não está disponível|carregando|interrompida/i.test(error.message || "")) throw error;
        // Loader que reaparece entre a espera e o clique não pode esgotar o prazo de revalidação.
        if (/carregando/i.test(error.message || "")) deadline = Math.max(deadline, Date.now() + 2500);
        if (typeof refreshControl === "function") {
          try { activeControl = await refreshControl(); }
          catch (refreshError) { refreshFailure = diagnosticValue(refreshError?.message || refreshError, 180); }
        }
        await api.waitForDomChange(250, shouldStop);
      }
    }
    const reason = lastError?.message || "O controle necessário não está disponível para ação; clique bloqueado.";
    throw new Error(`${reason} Diagnóstico da tentativa: tentativas=${attempts}; controle final{${describeControl(activeControl)}}${refreshFailure ? `; atualização do controle falhou: ${refreshFailure}` : ""}.`);
  }

  function controlsFor(aliases, editableOnly = false) {
    const wanted = new Set(aliases.map(normalize));
    const found = new Set();
    for (const doc of documents()) {
      for (const control of doc.querySelectorAll("input, select, textarea")) {
        if (!visible(control) || control.type === "hidden") continue;
        const metadata = [control.id, control.name, control.title, control.getAttribute("aria-label"),
          ...(control.labels ? [...control.labels].map(textOf) : [])].map(normalize);
        if (metadata.some(value => wanted.has(value))) found.add(control);
      }
      for (const label of doc.querySelectorAll("label, th, td, span, div")) {
        if (!visible(label) || label.children.length > 4 || textOf(label).length > 90 || !wanted.has(normalize(textOf(label).replace(/:$/, "")))) continue;
        if (label.tagName === "LABEL" && label.htmlFor) {
          const associated = doc.getElementById(label.htmlFor);
          if (associated && visible(associated) && associated.type !== "hidden") found.add(associated);
        }
        const cell = label.matches("td, th") ? label : label.closest("td, th");
        if (cell) {
          for (let sibling = cell.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
            const controls = [...sibling.querySelectorAll("input, select, textarea")].filter(item => visible(item) && item.type !== "hidden");
            if (controls.length) { controls.forEach(item => found.add(item)); break; }
          }
        }
        const row = label.closest("tr, [role='row'], .form-group, fieldset") || label.parentElement;
        const candidates = [...(row?.querySelectorAll("input, select, textarea") || [])].filter(item => visible(item) && item.type !== "hidden");
        if (candidates.length === 1) found.add(candidates[0]);
      }
    }
    const controls = [...found];
    return editableOnly ? controls.filter(control => !control.disabled && !control.readOnly) : controls;
  }

  function valueOf(control) {
    if (!control || !visible(control)) return "";
    if (control.type === "checkbox" || control.type === "radio") return control.checked ? "Sim" : "Não";
    if (control.tagName === "SELECT") return control.selectedOptions?.[0]?.textContent?.trim() || control.value || "";
    return String(control.value ?? "").trim();
  }

  function readField(aliases) {
    const controls = controlsFor(aliases);
    if (controls.length === 1) return valueOf(controls[0]);
    if (controls.length > 1) return "";
    const wanted = new Set(aliases.map(normalize));
    for (const doc of documents()) {
      for (const node of doc.querySelectorAll("label, th, td, span, div")) {
        if (!visible(node) || node.children.length > 3) continue;
        const lines = textOf(node).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const inline = lines[0]?.match(/^([^:]{2,80}):\s*(.+)$/);
        if (inline && wanted.has(normalize(inline[1]))) return inline[2].trim();
        if (lines.length > 1 && wanted.has(normalize(lines[0].replace(/:$/, "")))) return lines[1];
      }
    }
    return "";
  }

  const DATE_IN_TEXT = /\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?|\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/;

  // Lê um campo de data tolerando: vários controles com o mesmo rótulo (usa o único valor
  // de data distinto), texto extra ao redor da data e valor somente-texto. Retorna também
  // o diagnóstico do que foi encontrado, para mensagens de erro objetivas.
  function readDateField(aliases) {
    const raws = controlsFor(aliases).map(valueOf);
    const dates = [...new Set(raws.map(raw => String(raw).match(DATE_IN_TEXT)?.[0]).filter(Boolean))];
    if (dates.length === 1) return { value: dates[0], diagnostic: "" };
    if (dates.length > 1) return { value: "", diagnostic: `campo "${aliases[0]}" ambíguo (valores: ${dates.join(" | ")})` };
    const fallback = String(readField(aliases) || "").match(DATE_IN_TEXT)?.[0] || "";
    if (fallback) return { value: fallback, diagnostic: "" };
    return { value: "", diagnostic: `campo "${aliases[0]}" ${raws.length ? `encontrado (${raws.length}) sem data legível: ${raws.map(item => `"${String(item).slice(0, 30)}"`).join(", ")}` : "não encontrado na aba Data"}` };
  }

  function readIntragov() {
    // O SIGITM exibe Intragov como checkbox ao lado do texto, em vez de um
    // campo convencional. Quando não existir, ele é tratado como desmarcado.
    for (const doc of documents()) {
      const checkboxes = [...doc.querySelectorAll("input[type='checkbox']")]
        .filter(visible);
      for (const control of checkboxes) {
        const metadata = normalize([
          control.id, control.name, control.title, control.getAttribute("aria-label"),
          ...(control.labels ? [...control.labels].map(textOf) : [])
        ].filter(Boolean).join(" "));
        if (metadata.includes("intragov")) return control.checked ? "Sim" : "Não";
      }
      for (const label of doc.querySelectorAll("label, th, td, span, div")) {
        if (!visible(label) || normalize(textOf(label).replace(/:$/, "")) !== "intragov") continue;
        const labelRect = label.getBoundingClientRect?.();
        if (!labelRect) continue;
        const nearby = checkboxes.map(control => ({ control, rect: control.getBoundingClientRect?.() }))
          .filter(item => item.rect && item.rect.left >= labelRect.right - 12 &&
            Math.abs((item.rect.top + item.rect.bottom) / 2 - (labelRect.top + labelRect.bottom) / 2) <= 34)
          .sort((first, second) => first.rect.left - second.rect.left);
        if (nearby.length) return nearby[0].control.checked ? "Sim" : "Não";
      }
    }
    return "Não";
  }

  function clockDateTimestamp(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/) ||
      text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const br = text.includes("/");
    let year = Number(br ? match[3] : match[1]);
    if (br && year < 100) year += 2000;
    const month = Number(match[2]);
    const day = Number(br ? match[1] : match[3]);
    const hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    const second = Number(match[6] || 0);
    const date = new Date(year, month - 1, day, hour, minute, second);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day &&
      date.getHours() === hour && date.getMinutes() === minute && date.getSeconds() === second ? date.getTime() : null;
  }

  function clockPauseTableSnapshot() {
    const values = [];
    let foundTable = false;
    let tableLoading = false;
    let malformedRows = false;
    for (const doc of documents()) {
      for (const table of doc.querySelectorAll("table[id*='listParadaRelogio']")) {
        if (!visible(table)) continue;
        foundTable = true;
        const loadingControls = [...table.querySelectorAll("[aria-busy='true'], [data-loading='true'], [role='progressbar'], [id*='status.start' i], [id*='loading' i], [class*='loading' i], [class*='carregando' i]")]
          .some(control => visible(control));
        if (loadingControls) tableLoading = true;
        const rows = [...table.querySelectorAll("tr")];
        const headerIndex = rows.findIndex(row => [...row.querySelectorAll("th, td")]
          .some(cell => normalize(textOf(cell)) === "fim"));
        if (headerIndex < 0) { malformedRows = true; continue; }
        const headers = [...rows[headerIndex].querySelectorAll("th, td")];
        const endIndex = headers.findIndex(cell => normalize(textOf(cell)) === "fim");
        const startIndex = headers.findIndex(cell => normalize(textOf(cell)) === "inicio");
        if (endIndex < 0 || startIndex < 0) { malformedRows = true; continue; }
        for (const row of rows.slice(headerIndex + 1)) {
          const rowMetadata = normalize([row.className, row.id].filter(Boolean).join(" "));
          if (/footer|datascr|dscr|pagination|paginacao/.test(rowMetadata) ||
            row.querySelector?.("[class*='datascr' i], [class*='dscr' i], [class*='pagination' i], [class*='paginacao' i]")) continue;
          const cells = [...row.querySelectorAll("td")];
          if (cells.length <= Math.max(startIndex, endIndex)) continue;
          const start = startIndex >= 0 ? textOf(cells[startIndex]) : "";
          const end = endIndex >= 0 ? textOf(cells[endIndex]) : "";
          const startTimestamp = clockDateTimestamp(start);
          const endTimestamp = clockDateTimestamp(end);
          if (startTimestamp !== null || endTimestamp !== null) {
            values.push({ start, end, startTimestamp, endTimestamp, timestamp: endTimestamp ?? startTimestamp });
          } else if (start || end) {
            malformedRows = true;
          }
        }
      }
    }
    const latest = values.sort((first, second) => second.timestamp - first.timestamp)[0];
    if (tableLoading) return { start: "", end: "", detected: false, status: "loading" };
    if (latest) return { start: latest.start || "", end: latest.end || "", detected: true, status: "found" };
    if (!foundTable) return { start: "", end: "", detected: false, status: "absent" };
    if (malformedRows) return { start: "", end: "", detected: false, status: "inconclusive" };
    return { start: "", end: "", detected: false, status: "empty" };
  }

  async function readClockPauseData(shouldStop = () => false, timeout = 1000) {
    const deadline = Date.now() + timeout;
    let stableEmptySnapshots = 0;
    while (Date.now() < deadline) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      const snapshot = clockPauseTableSnapshot();
      if (snapshot.status === "found") return snapshot;
      if (snapshot.status === "empty") {
        stableEmptySnapshots++;
        if (stableEmptySnapshots >= 2) return snapshot;
      } else {
        stableEmptySnapshots = 0;
      }
      await waitForDomChange(Math.min(350, Math.max(1, deadline - Date.now())), shouldStop);
    }
    const lastSnapshot = clockPauseTableSnapshot();
    if (["empty", "absent", "loading"].includes(lastSnapshot.status)) {
      return { ...lastSnapshot, status: "empty" };
    }
    return { ...lastSnapshot, status: "inconclusive" };
  }

  function applyClockPauseData(data, clockPause) {
    data.dataInicioParadaRelogio = clockPause.start || data.dataParadaRelogio || "";
    data.dataFimParadaRelogio = clockPause.end || "";
    const currentState = normalize(data.paradaRelogio);
    if (clockPause.detected) {
      if (!["sim", "nao"].includes(currentState)) data.paradaRelogio = "Sim";
      return "";
    }
    if (currentState === "sim") {
      // Pausa ainda aberta (sem fim) é válida se o início for conhecido: o ticket será
      // retornado para Ativo antes da baixa. Sem início, não há como validar a Data de Reparo.
      if (clockDateTimestamp(data.dataInicioParadaRelogio) !== null) return "";
      return "Parada de Relógio está marcada como Sim, mas não foi possível identificar o horário de início da parada; baixa bloqueada por segurança.";
    }
    // Uma tabela ausente, vazia ou sem uma linha de parada válida representa
    // ausência de pausa, inclusive quando o HTML legado mantém elementos de
    // paginação/status que tornam a estrutura inconclusiva.
    data.paradaRelogio = "Não";
    return "";
  }

  function resolveActionState(foundAction, rowText) {
    if (!foundAction) return { acionamento: "Não", codigoAcionamento: "" };
    const status = normalize(rowText);
    if (/\bativo\b|\bativa\b|\baberto\b/.test(status)) return { acionamento: "Sim", codigoAcionamento: /\b6z036\b/.test(status) ? "6Z036" : "" };
    if (/\bbaixado\b|\bfechado\b|\bencerrado\b|\binativo\b/.test(status)) return { acionamento: "Não", codigoAcionamento: "" };
    return { acionamento: "", codigoAcionamento: "" };
  }

  function findActiveActionRows() {
    const activeStatuses = new Set(["ativo", "ativa", "aberto", "aberta"]);
    const found = [];
    for (const doc of documents()) {
      for (const table of doc.querySelectorAll("table")) {
        const rows = [...table.querySelectorAll("tr")];
        const headerIndex = rows.findIndex(row => {
          const cells = [...row.querySelectorAll("th, td")];
          return cells.some(cell => normalize(textOf(cell)) === "status") &&
            cells.some(cell => normalize(textOf(cell)) === "codigo");
        });
        if (headerIndex < 0) continue;
        const headers = [...rows[headerIndex].querySelectorAll("th, td")];
        const statusIndex = headers.findIndex(cell => normalize(textOf(cell)) === "status");
        for (const row of rows.slice(headerIndex + 1)) {
          if (!visible(row)) continue;
          const statusCell = [...row.querySelectorAll("th, td")][statusIndex];
          if (statusCell && activeStatuses.has(normalize(textOf(statusCell)))) found.push(row);
        }
      }
    }
    return [...new Set(found)];
  }

  function findTabCandidates(name) {
    const target = normalize(name);
    const matches = [];
    for (const doc of documents()) {
      const actionableSelector = "a, button, [role='tab'], input[type='button'], input[type='submit'], [onclick], [tabindex]";
      const actionable = [...doc.querySelectorAll(actionableSelector)].filter(tab => {
        // RichFaces coloca onclick no wrapper TABLE da aba. Ele pode ser
        // recriado durante o clique e deixar uma referência obsoleta; o texto
        // correspondente será localizado abaixo em seu TD/SPAN filho e o
        // evento continuará borbulhando até o handler da tabela.
        if (/^(TABLE|TBODY|THEAD|TR)$/.test(String(tab.tagName || "").toUpperCase())) return false;
        if (!visible(tab) || tab.disabled || tab.getAttribute("aria-disabled") === "true") return false;
        return normalize(textOf(tab) || tab.value || tab.getAttribute("aria-label")) === target;
      });
      if (actionable.length) {
        matches.push(...actionable);
        continue;
      }

      // O SIGITM usa abas antigas desenhadas como células de tabela; elas podem
      // receber o clique diretamente ou delegá-lo ao elemento pai.
      for (const label of doc.querySelectorAll("td, th, li, span, div")) {
        if (!visible(label) || normalize(textOf(label)) !== target) continue;
        const cell = label.matches("td, th") ? label : label.closest("td, th");
        const tabContainer = label.closest("[role='tab'], [class*='tab' i], [id*='tab' i], [class*='aba' i], [id*='aba' i], li");
        // Algumas abas RichFaces usam a própria TABLE como controle delegado.
        // Clique no rótulo/célula interna para deixar o evento borbulhar, sem
        // manter uma referência ao wrapper que o SIGITM pode substituir.
        const tableWrapper = tabContainer?.tagName === "TABLE";
        const candidate = cell || (tableWrapper ? label : tabContainer && normalize(textOf(tabContainer)) === target ? tabContainer : label);
        if (visible(candidate) && !candidate.disabled) matches.push(candidate);
      }
    }
    return [...new Set(matches)].filter(candidate => !matches.some(other =>
      other !== candidate && candidate.contains?.(other) && normalize(textOf(other)) === target));
  }

  function tabLooksActive(element) {
    if (!element) return false;
    const ariaSelected = String(element.getAttribute?.("aria-selected") || "").toLowerCase();
    if (ariaSelected === "true") return true;
    const metadata = normalize([
      element.className,
      element.getAttribute?.("data-state"),
      element.getAttribute?.("data-active"),
      element.getAttribute?.("aria-current"),
      element.getAttribute?.("title")
    ].filter(Boolean).join(" "));
    return /(^| )(active|ativo|selected|selecionado|current|atual)( |$)/.test(metadata);
  }

  function tabLooksActiveInTree(element) {
    let current = element;
    for (let depth = 0; current && depth < 4; depth++, current = current.parentElement) {
      if (tabLooksActive(current)) return true;
    }
    return false;
  }

  // Fallback quando o contexto da aba ativa não desambigua: a barra de abas real
  // é o ancestral mais próximo que contém várias outras abas conhecidas.
  function selectByTabsetDensity(name, candidates) {
    const others = ["Cliente", "Definição", "Data", "Acionamento", "Encerramento", "Certificação"]
      .filter(tabName => normalize(tabName) !== normalize(name))
      .map(tabName => ({ tabName, elements: findTabCandidates(tabName) }));
    // Títulos de seção (ex.: "Encerramento" dentro do painel Certificação) não
    // ficam na mesma faixa horizontal das demais abas.
    const centerY = element => {
      const rect = element.getBoundingClientRect?.();
      return rect ? (rect.top + rect.bottom) / 2 : NaN;
    };
    const sameRow = candidates.filter(candidate => {
      const y = centerY(candidate);
      if (!Number.isFinite(y)) return false;
      return others.filter(item => item.elements.some(element => Math.abs(centerY(element) - y) <= 12)).length >= 3;
    });
    if (sameRow.length === 1) return sameRow[0];
    if (sameRow.length > 1) candidates = sameRow;
    const depthOf = candidate => {
      let current = candidate.parentElement;
      for (let depth = 1; current && depth <= 9; depth++, current = current.parentElement) {
        const found = others.filter(item => item.elements.some(element => current.contains(element)));
        if (found.length >= 3) return depth;
      }
      return Infinity;
    };
    const ranked = candidates.map(candidate => ({ candidate, depth: depthOf(candidate) }))
      .filter(item => Number.isFinite(item.depth)).sort((first, second) => first.depth - second.depth);
    if (!ranked.length || (ranked[1] && ranked[1].depth === ranked[0].depth)) return null;
    return ranked[0].candidate;
  }

  function selectTabCandidate(name, candidates, contextName = lastActivatedTabName) {
    if (candidates.length <= 1) return candidates[0] || null;
    const activeTarget = candidates.filter(tabLooksActiveInTree);
    if (activeTarget.length === 1) return activeTarget[0];

    const knownNames = ["Cliente", "Definição", "Data", "Acionamento", "Encerramento", "Certificação"]
      .filter(tabName => normalize(tabName) !== normalize(name));
    const nearbyTabs = knownNames.flatMap(tabName => findTabCandidates(tabName).map(element => ({ tabName, element })));
    const activeTabs = nearbyTabs
      .filter(item => tabLooksActiveInTree(item.element));
    const contextualTabs = activeTabs.length ? activeTabs
      : nearbyTabs.filter(item => normalize(item.tabName) === normalize(contextName));
    const knownTabs = contextualTabs;
    if (!knownTabs.length) return selectByTabsetDensity(name, candidates);

    const ancestors = element => {
      const result = [];
      let current = element;
      for (let depth = 0; current && depth < 9; depth++, current = current.parentElement) result.push({ element: current, depth });
      return result;
    };
    const ranked = candidates.map(candidate => {
      const candidateAncestors = ancestors(candidate);
      let bestDistance = Infinity;
      let bestScope = null;
      for (const active of knownTabs) {
        const activeAncestors = ancestors(active.element);
        for (const first of candidateAncestors) {
          const second = activeAncestors.find(item => item.element === first.element);
          if (!second) continue;
          const distance = first.depth + second.depth;
          const metadata = normalize([first.element.id, first.element.className, first.element.getAttribute?.("role")].filter(Boolean).join(" "));
          const isTabScope = /tab|aba|tabset|tablist/.test(metadata) ||
            first.element.tagName === "TABLE" || first.element.tagName === "TR" || first.element.tagName === "UL";
          if (isTabScope && distance < bestDistance) {
            bestDistance = distance;
            bestScope = first.element;
          }
        }
      }
      return { candidate, distance: bestDistance, scope: bestScope };
    }).filter(item => Number.isFinite(item.distance)).sort((first, second) => first.distance - second.distance);
    if (!ranked.length) return selectByTabsetDensity(name, candidates);
    if (ranked[1] && ranked[0].distance === ranked[1].distance) {
      const closest = ranked.filter(item => item.distance === ranked[0].distance);
      if (closest.some(item => item.scope !== closest[0].scope)) return selectByTabsetDensity(name, candidates);
      // Nós duplicados equivalentes dentro do mesmo tabset correspondem à
      // mesma aba; escolha a primeira ocorrência estável no DOM.
    }
    return ranked[0].candidate;
  }

  function tabPanelVisible(name) {
    const panelIds = {
      cliente: "tabCliente",
      definicao: "tabDefinicao",
      data: "tabData",
      acionamento: "tabAcionamento",
      encerramento: "tabEncerramento",
      certificacao: "tabCertificacao"
    };
    const suffix = panelIds[normalize(name)];
    if (!suffix) return false;
    return documents().some(doc => [...doc.querySelectorAll(`[id$=":${suffix}"]`)].some(visible));
  }

  async function waitForTabActivation(name, shouldStop = () => false, timeout = 1600) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      const candidates = findTabCandidates(name);
      if (candidates.some(tabLooksActive)) return true;
      // O texto de todas as abas pode permanecer no DOM RichFaces, mesmo em
      // painéis ocultos. Confirme a ativação pelo painel correspondente visível.
      if (tabPanelVisible(name)) return true;
      await waitForDomChange(250, shouldStop);
    }
    return false;
  }

  async function waitForTabCandidate(name, shouldStop = () => false, timeout = 3200) {
    const deadline = Date.now() + timeout;
    let candidates = [];
    while (Date.now() < deadline) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      candidates = findTabCandidates(name).filter(candidate => candidate.isConnected !== false && visible(candidate));
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) {
        const selected = selectTabCandidate(name, candidates);
        if (selected) return selected;
      }
      await waitForDomChange(Math.min(250, deadline - Date.now()), shouldStop);
    }
    throw new Error(`Aba ${name} ${candidates.length ? `ambígua (${candidates.length} candidatas: ${candidates.slice(0, 3).map(item => `{${describeControl(item)}}`).join(" ")})` : "não encontrada"} após atualizar o DOM.`);
  }

  async function clickTab(name, shouldStop = () => false) {
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    const clicked = await waitForTabCandidate(name, shouldStop);
    const refreshTab = () => waitForTabCandidate(name, shouldStop, 1600);
    // Não force focus(): algumas versões RichFaces reconstroem tabDefinicao
    // durante o foco e deixam obsoleta a referência que seria clicada.
    await clickControl(clicked, shouldStop, null, refreshTab);
    const activated = await waitForTabActivation(name, shouldStop);
    if (!activated) {
      throw new Error(`Aba ${name} foi clicada, mas o SIGITM não confirmou que seu painel está ativo; leitura/ação bloqueada para evitar usar outra aba.`);
    }
    await waitForLoadingToFinish(shouldStop);
    lastActivatedTabName = name;
    return !shouldStop();
  }

  async function readCase(shouldStop = () => false, onTab = () => {}, onClassification = null) {
    onTab("Cliente");
    if (!await clickTab("Cliente", shouldStop)) throw new Error("Automação interrompida.");
    const cliente = readField(["Cliente"]);
    const servicoAfetado = readField(["Serviço Afetado", "Servico Afetado"]);

    onTab("Definição");
    if (!await clickTab("Definição", shouldStop)) throw new Error("Automação interrompida.");
    const ticket = readField(["Nº tíquete", "Número do chamado", "Número do tíquete", "Tíquete", "Sequência", "BD"]);
    const data = { numeroChamado: String(ticket).match(/\d{5,20}/)?.[0] || "" };
    data.tipoAbertura = readField(["Tipo de Abertura", "Tipo abertura", "Tipo Abertura"]);
    data.procedencia = readField(["Procedência", "Procedencia"]);
    data.tipoIncidencia = readField(["Tipo de Incidência", "Tipo de Incidencia", "Tipo incidência", "Tipo incidencia"]);
    data.cliente = cliente || readField(["Cliente"]);
    data.intragov = readIntragov();
    data.servicoAfetado = servicoAfetado || readField(["Serviço Afetado", "Servico Afetado"]);
    // Os seis campos de classificação já estão lidos; o chamador pode iniciar a IA em paralelo.
    try { onClassification?.({ ...data }); } catch { /* otimização opcional */ }

    onTab("Data");
    if (!await clickTab("Data", shouldStop)) throw new Error("Automação interrompida.");
    data.dataCriacao = readField(["Data Criação", "Data Criacao", "Data de Criação", "Data de Criacao"]);
    data.dataObjetivo = readField(["Data Objetivo"]);
    // A data já existente na aba Data é o limite superior. O Encerramento usa
    // uma data intermediária, calculada posteriormente, e não a copia.
    const originalRepairRead = readDateField(["Data de Reparo", "Data Reparo", "Data do Reparo", "Data de Reparo Original", "Dt. Reparo", "Dt Reparo"]);
    data.dataReparoOriginal = originalRepairRead.value;
    data.dataReparoOriginalDiag = originalRepairRead.diagnostic;
    data.dataReparo = "";
    data.dataInicioSla = readField(["Início do SLA", "Inicio do SLA", "Data de Início do SLA", "Data de Inicio do SLA"]);
    data.paradaRelogio = readField(["Parada de Relógio"]);
    data.dataParadaRelogio = readField(["Data da Parada de Relógio", "Data da Parada do Relógio", "Data Parada de Relógio", "Data Pausa", "Data/Hora da Pausa"]);
    const clockPause = await readClockPauseData(shouldStop);
    const clockPauseError = applyClockPauseData(data, clockPause);
    if (clockPauseError) throw new Error(clockPauseError);

    onTab("Acionamento");
    if (!await clickTab("Acionamento", shouldStop)) throw new Error("Automação interrompida.");
    const actionText = documents().map(doc => textOf(doc.body)).join("\n");
    const actionRows = documents().flatMap(doc => [...doc.querySelectorAll("tr, [role='row'], li")])
      .filter(row => visible(row) && /\b6Z036\b/i.test(textOf(row)))
      .sort((a, b) => textOf(a).length - textOf(b).length);
    const activeRows = findActiveActionRows();
    const actionRowText = normalize(textOf(activeRows[0] || actionRows[0]));
    const actionCode = readField(["Código do Acionamento", "Código Completo do Acionamento"]);
    const foundAction = activeRows.length > 0 || /\b6Z036\b/i.test(`${actionCode} ${actionText}`);
    Object.assign(data, resolveActionState(foundAction, `${actionCode} ${actionRowText}`));
    return data;
  }

  const api = { documents, visible, normalize, textOf, controlsFor, valueOf, readField, readIntragov, readDateField, clockPauseTableSnapshot, readClockPauseData, applyClockPauseData, resolveActionState, findActiveActionRows, loadingIndicators, waitForDomChange, waitForLoadingToFinish, assertActionReady, clickControl, findTabCandidates, tabLooksActive, tabPanelVisible, selectTabCandidate, clickTab, readCase };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaNavigation = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
