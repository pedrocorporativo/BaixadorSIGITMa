(function (root) {
  "use strict";

  function findUniqueButton(labels) {
    const wanted = new Set(labels.map(root.BaixaNavigation.normalize));
    const selector = "button, input, a, [role='button'], [onclick], [tabindex]";
    const candidates = root.BaixaNavigation.documents().flatMap(doc => [...doc.querySelectorAll(selector)])
      .filter(element => root.BaixaNavigation.visible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true" && !isCloseControl(element));
    const exact = candidates.filter(element => buttonLabels(element).some(label => wanted.has(label)));
    const selected = exact.length ? exact : candidates.filter(element =>
      buttonLabels(element).some(label => [...wanted].some(term => term.length >= 4 && labelHasPhrase(label, term))));
    const unique = [...new Set(selected)].filter(candidate => !selected.some(other =>
      other !== candidate && candidate.contains?.(other)));
    if (unique.length !== 1) {
      const action = labels.join(" / ");
      throw new Error(`Botão “${action}” ${unique.length ? `ambíguo (${unique.length} correspondências)` : "não encontrado"}; ação bloqueada.`);
    }
    return unique[0];
  }

  async function waitForUniqueButton(labels, timeout = 10000, shouldStop = () => false) {
    await root.BaixaNavigation.waitForLoadingToFinish(shouldStop);
    const button = await waitFor(() => {
      try { return findUniqueButton(labels); }
      catch (error) {
        if (/não encontrado/.test(error.message)) return false;
        throw error;
      }
    }, timeout, shouldStop);
    if (!button) throw new Error(`Botão “${labels.join(" / ")}" não apareceu após o carregamento da tela; ação bloqueada.`);
    return button;
  }

  function feedbackText() {
    const selectors = "[role='alert'], [role='status'], [role='dialog'], [aria-modal='true'], .alert, .ui-messages, .ui-message, .toast, .notification, .modal, .swal2-popup";
    return root.BaixaNavigation.documents().flatMap(doc => [...doc.querySelectorAll(selectors)])
      .filter(root.BaixaNavigation.visible).map(root.BaixaNavigation.textOf).join(" ");
  }

  function isCloseControl(element) {
    const raw = [
      element.getAttribute?.("aria-label"), element.getAttribute?.("title"), element.value,
      element.getAttribute?.("alt"), element.getAttribute?.("data-dismiss"),
      element.getAttribute?.("data-close"), element.getAttribute?.("name"), element.id,
      root.BaixaNavigation.textOf(element), String(element.className || "")
    ].filter(Boolean).join(" ");
    const normalized = root.BaixaNavigation.normalize(raw);
    const rawLower = raw.toLowerCase();
    const closeWord = /(^|[\s:_\-])(?:fechar|fecha|close|dismiss|cancelar)(?=$|[\s:_\-])/i;
    const closeSymbol = /(^|[\s"'=>(])(?:x|×|✕|✖|✗|✘)(?=$|[\s"'=<),.:-])/iu;
    const dataClose = String(element.getAttribute?.("data-dismiss") || element.getAttribute?.("data-close") || "").toLowerCase();
    const compact = rawLower.replace(/[^a-z0-9]+/g, "");
    return closeWord.test(rawLower) || closeSymbol.test(rawLower) || closeWord.test(normalized) ||
      /^(?:close|dismiss|fechar)$/i.test(dataClose) ||
      /(?:close|dismiss|fechar)(?:button|icon|btn|popup)/i.test(rawLower) ||
      /(?:btn|button)(?:close|fechar|dismiss)/i.test(compact);
  }

  function buttonLabels(element) {
    const image = element.querySelector?.("img");
    const values = [
      root.BaixaNavigation.textOf(element), element.value, element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"), element.getAttribute?.("alt"), image?.alt,
      image?.title, image?.getAttribute?.("src"), element.getAttribute?.("src"),
      element.getAttribute?.("onclick"), element.id, element.name
    ];
    return [...new Set(values.filter(Boolean).map(root.BaixaNavigation.normalize))];
  }

  function labelHasPhrase(label, phrase) {
    return label === phrase || label.startsWith(`${phrase} `) || label.endsWith(` ${phrase}`) || label.includes(` ${phrase} `);
  }

  function visiblePopups() {
    // O SIGITM legado usa RichFaces: a janela do print é um rich-mpnl-panel,
    // sem role=dialog, modal ou popup no nome. Incluímos suas variações para
    // conseguir fechar o X antes de trocar para a aba Certificação.
    const selector = "[role='dialog'], [aria-modal='true'], .modal, .swal2-popup, .ui-dialog, .ui-dialog-content, [class*='popup' i], [id*='popup' i], .rich-mpnl-panel, .rich-mpnl-content, [class*='rich-mpnl' i], [id*='rich-mpnl' i], [class*='modalpanel' i], [id*='modalpanel' i]";
    const semantic = root.BaixaNavigation.documents().flatMap(doc => [...doc.querySelectorAll(selector)])
      .filter(root.BaixaNavigation.visible);
    const messageWindows = root.BaixaNavigation.documents().flatMap(doc => {
      const candidates = [...doc.querySelectorAll("div, table, section, fieldset, form")].filter(node => {
        if (!root.BaixaNavigation.visible(node)) return false;
        const text = root.BaixaNavigation.normalize(root.BaixaNavigation.textOf(node));
        const rect = node.getBoundingClientRect();
        if (/tiquete bloqueado/.test(text) && rect.width >= 300 && rect.height >= 150) return true;
        const style = node.ownerDocument.defaultView?.getComputedStyle?.(node);
        const isOverlay = ["fixed", "absolute"].includes(style?.position) || Number(style?.zIndex) >= 100;
        // Algumas mensagens do SIGITM após Baixar não têm role="dialog". Para
        // evitar tocar no restante da página, só tratamos um contêiner flutuante
        // que tenha exatamente um X reconhecido no canto superior direito.
        return isOverlay && rect.width >= 180 && rect.height >= 70 && closeImageCandidates(node).length === 1;
      });
      return candidates.sort((a, b) => {
        const aHasClose = closeImageCandidates(a).length > 0;
        const bHasClose = closeImageCandidates(b).length > 0;
        if (aHasClose !== bHasClose) return aHasClose ? -1 : 1;
        const first = a.getBoundingClientRect();
        const second = b.getBoundingClientRect();
        return first.width * first.height - second.width * second.height;
      }).slice(0, 1);
    });
    return [...new Set([...semantic, ...messageWindows])];
  }

  function popupControlMetadata(element) {
    return root.BaixaNavigation.normalize([
      element?.id, element?.name, element?.title, element?.alt, element?.value,
      element?.getAttribute?.("aria-label"), element?.getAttribute?.("data-dismiss"),
      element?.getAttribute?.("data-close"), element?.getAttribute?.("src"),
      element?.getAttribute?.("onclick"), element?.onclick?.toString?.(),
      root.BaixaNavigation.textOf(element)
    ].filter(Boolean).join(" "));
  }

  function closeImageCandidates(popup) {
    const rootRect = popup.getBoundingClientRect?.();
    if (!rootRect) return [];
    const selector = "button, input[type='image'], input[type='button'], a, [onclick], [role='button'], [tabindex], img, svg, i";
    const scored = [];
    for (const element of popup.querySelectorAll(selector)) {
      if (!root.BaixaNavigation.visible(element) || element.disabled) continue;
      const visual = element.matches("img, svg, i") ? element : element.querySelector?.("img, svg, i");
      const target = visual?.closest?.("a, button, input[type='image'], [onclick], [role='button'], [tabindex]") || element;
      const rect = (visual || target).getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      const raw = [popupControlMetadata(element), popupControlMetadata(visual), popupControlMetadata(target)].filter(Boolean).join(" ");
      const small = rect.width <= 52 && rect.height <= 52;
      const topRight = rect.right >= rootRect.right - 65 && rect.top <= rootRect.top + 70;
      const symbol = /(?:^|[\s:._-])(?:x|×|✕|✖|✗|✘)(?:$|[\s:._-])/iu.test(raw);
      const named = /(?:fechar|fecha|close|dismiss|botao x|btnclose|closebutton|fechar\.gif|close\.gif)/i.test(raw);
      if ((small && topRight) || symbol || named) {
        const score = (topRight ? 100 : 0) + (small ? 40 : 0) + (named ? 35 : 0) + (symbol ? 30 : 0);
        scored.push({ target, score, rect });
      }
    }
    const grouped = new Map();
    for (const item of scored) {
      const previous = grouped.get(item.target);
      if (!previous || item.score > previous.score) grouped.set(item.target, item);
    }
    return [...grouped.values()]
      .sort((a, b) => b.score - a.score || a.rect.top - b.rect.top || b.rect.right - a.rect.right)
      .map(item => item.target);
  }

  function popupCloseControls(popup) {
    const visual = closeImageCandidates(popup);
    if (visual.length) return visual;
    const selector = "button, input[type='button'], input[type='submit'], input[type='image'], a, [role='button'], [onclick], [tabindex], img, svg, i";
    const candidates = [...popup.querySelectorAll(selector)]
      .filter(element => root.BaixaNavigation.visible(element) && !element.disabled && isCloseControl(element))
      .map(element => element.matches("img, svg, i")
        ? element.closest("a, button, input[type='image'], [onclick], [role='button'], [tabindex]") || element
        : element);
    return [...new Set(candidates)];
  }

  function findCloseControlNearPopup(popup) {
    const doc = popup?.ownerDocument;
    const popupRect = popup?.getBoundingClientRect?.();
    if (!doc || !popupRect) return null;
    const selector = "button, input[type='button'], input[type='image'], a, [role='button'], [onclick], [tabindex], img, svg, i";
    const candidates = [];
    for (const element of doc.querySelectorAll(selector)) {
      if (!root.BaixaNavigation.visible(element) || element.disabled) continue;
      const visual = element.matches("img, svg, i") ? element : element.querySelector?.("img, svg, i");
      const target = visual?.closest?.("a, button, input[type='image'], [onclick], [role='button'], [tabindex]") || element;
      const rect = (visual || target).getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      const metadata = popupControlMetadata(target) + " " + popupControlMetadata(visual);
      const nearTopRight = rect.top <= popupRect.top + 85 && rect.right >= popupRect.right - 90 && rect.left >= popupRect.right - 120;
      const tiny = rect.width <= 60 && rect.height <= 60;
      const named = /fechar|fecha|close|dismiss|btnclose|closebutton|botao x|fechar\.(?:gif|png)/i.test(metadata);
      const symbol = /(?:^|[\s:._-])(?:x|×|✕|✖|✗|✘)(?:$|[\s:._-])/iu.test(metadata);
      if (nearTopRight && tiny || named || symbol) {
        const score = (nearTopRight ? 130 : 0) + (tiny ? 45 : 0) + (named ? 35 : 0) + (symbol ? 30 : 0);
        candidates.push({ element: target, score, distance: Math.abs(rect.right - popupRect.right) + Math.abs(rect.top - popupRect.top) });
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.distance - b.distance);
    return candidates[0]?.element || null;
  }

  function selectBestPopupCloseControl(popup) {
    const visual = closeImageCandidates(popup);
    if (visual.length) return visual[0];
    const candidates = popupCloseControls(popup);
    if (candidates.length === 1) return candidates[0];
    if (!candidates.length) return findCloseControlNearPopup(popup);
    const rootRect = popup.getBoundingClientRect?.();
    if (!rootRect) return null;
    const ranked = candidates.map(element => {
      const rect = element.getBoundingClientRect?.() || {};
      const metadata = popupControlMetadata(element);
      const topRight = Number.isFinite(rect.right) && rect.right >= rootRect.right - 70 && rect.top <= rootRect.top + 80;
      const small = rect.width > 0 && rect.width <= 60 && rect.height > 0 && rect.height <= 60;
      const named = /fechar|fecha|close|dismiss|btnclose|closebutton|botao x/i.test(metadata);
      const symbol = /(?:^|[\s:._-])(?:x|×|✕|✖|✗|✘)(?:$|[\s:._-])/iu.test(metadata);
      const score = (topRight ? 100 : 0) + (small ? 40 : 0) + (named ? 30 : 0) + (symbol ? 30 : 0);
      return { element, score };
    }).sort((a, b) => b.score - a.score);
    return ranked[0]?.score > 0 ? ranked[0].element : null;
  }

  // Extrai o nome da função de um href "javascript:nomeDaFuncao()" simples.
  // Qualquer outra expressão é ignorada: a extensão nunca avalia código livre.
  function safeCloseFunctionName(control) {
    const href = String(control?.getAttribute?.("href") || "").trim();
    if (!/^javascript:/i.test(href)) return "";
    const expression = href.replace(/^javascript:/i, "").trim();
    const match = expression.match(/^(?:(?:window|self)\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\(\s*\)\s*;?$/i);
    return match ? match[1] : "";
  }

  function invokeSafeJavaScriptClose(control) {
    const functionName = safeCloseFunctionName(control);
    if (!functionName) return false;
    const view = control.ownerDocument?.defaultView;
    if (!view) return false;
    if (functionName.toLowerCase() === "close") {
      if (!view.opener) return false;
      view.close();
      return true;
    }
    // Content scripts vivem em um mundo isolado e normalmente não enxergam as
    // funções da página; nesse caso o fechamento é feito por pageCloseRequest().
    const handler = view[functionName];
    if (typeof handler !== "function") return false;
    handler.call(view);
    return true;
  }

  function richFacesPanelId(control, popup) {
    const snippets = [
      control?.getAttribute?.("onclick"), control?.getAttribute?.("href"), control?.onclick?.toString?.(),
      popup?.getAttribute?.("onclick"), popup?.id
    ].filter(Boolean).join(" ");
    // Somente a chamada nativa já presente na página é reconhecida.
    return snippets.match(/richfaces?\s*\.\s*hideModalPanel\s*\(\s*['\"]([^'\"]+)['\"]\s*\)/i)?.[1] || "";
  }

  function invokeRichFacesModalClose(control, popup) {
    const view = control.ownerDocument?.defaultView || popup?.ownerDocument?.defaultView;
    const richFaces = view?.RichFaces || view?.Richfaces;
    if (typeof richFaces?.hideModalPanel !== "function") return false;
    const panelId = richFacesPanelId(control, popup);
    if (!panelId) return false;
    richFaces.hideModalPanel(panelId);
    return true;
  }

  // Descreve o fechamento seguro que precisa rodar no mundo da própria página.
  function pageCloseRequest(control, popup) {
    const panelId = richFacesPanelId(control, popup);
    if (panelId) return { kind: "richfaces", value: panelId };
    const functionName = safeCloseFunctionName(control);
    if (functionName && functionName.toLowerCase() !== "close") return { kind: "function", value: functionName };
    return null;
  }

  // O mundo isolado do content script não acessa RichFaces nem funções da
  // página, e um href javascript: é bloqueado pela CSP. O background executa a
  // chamada simples no mundo MAIN via chrome.scripting (permitido pela CSP).
  function requestPageClose(request) {
    const runtime = root.chrome?.runtime;
    if (!request || !runtime?.sendMessage) return Promise.resolve(false);
    return new Promise(resolve => {
      try {
        runtime.sendMessage({ type: "PAGE_CLOSE_POPUP", ...request }, response => {
          void runtime.lastError;
          resolve(response?.ok === true && response.closed === true);
        });
      } catch { resolve(false); }
    });
  }

  // Impede que o clique em <a href="javascript:..."> dispare a navegação
  // bloqueada pela CSP (erro "Running the JavaScript URL violates..."). Os
  // manipuladores onclick continuam executando normalmente.
  function suppressJavascriptNavigation(control) {
    if (!/^javascript:/i.test(String(control?.getAttribute?.("href") || "").trim())) return () => {};
    const guard = event => event.preventDefault();
    control.addEventListener("click", guard);
    return () => control.removeEventListener("click", guard);
  }

  function popupClosedAfterClick(popup, control, previousMessage = "") {
    if (!popup) return true;
    if (!root.BaixaNavigation.visible(popup)) return true;
    // RichFaces pode manter o painel no DOM enquanto o conteúdo é trocado por
    // um loader. Nesse momento o popup já foi fechado para fins da automação.
    if (control && !root.BaixaNavigation.visible(control)) return true;
    const controls = popupCloseControls(popup).filter(root.BaixaNavigation.visible);
    if (!controls.length) {
      const current = root.BaixaNavigation.normalize(root.BaixaNavigation.textOf(popup));
      if (!current) return true;
      // Se o painel foi reaproveitado pelo SIGITM para exibir o loader, o texto
      // original da mensagem desaparece antes do painel sair do DOM. Isso já é
      // fechamento suficiente para a automação avançar.
      if (previousMessage && !current.includes(previousMessage)) return true;
      if (previousMessage && current !== previousMessage && /loader|loading|aguarde|processando|carregando/.test(current)) return true;
    }
    return false;
  }

  async function clickPopupClose(control, popup, shouldStop = () => false) {
    const href = String(control?.getAttribute?.("href") || "").trim();
    const javascriptHref = /^javascript:/i.test(href);
    if (!control) throw new Error("Controle X do popup não encontrado.");
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    await root.BaixaNavigation.waitForLoadingToFinish(shouldStop);
    const previousMessage = root.BaixaNavigation.normalize(root.BaixaNavigation.textOf(popup));
    try { control.focus?.(); } catch { /* foco não é essencial */ }
    let releaseNavigationGuard = () => {};
    try {
      await root.BaixaNavigation.clickControl(control, shouldStop, () => {
        releaseNavigationGuard = suppressJavascriptNavigation(control);
      });
    } catch { /* tentamos os fechamentos nativos abaixo */ }
    finally { releaseNavigationGuard(); }
    if (await waitFor(() => popupClosedAfterClick(popup, control, previousMessage), 2200, shouldStop, 25)) return;
    if (invokeRichFacesModalClose(control, popup)) {
      if (await waitFor(() => popupClosedAfterClick(popup, control, previousMessage), 2200, shouldStop, 25)) return;
    }
    if (invokeSafeJavaScriptClose(control)) {
      if (await waitFor(() => popupClosedAfterClick(popup, control, previousMessage), 2200, shouldStop, 25)) return;
    }
    if (await requestPageClose(pageCloseRequest(control, popup))) {
      if (await waitFor(() => popupClosedAfterClick(popup, control, previousMessage), 2200, shouldStop, 25)) return;
    }
    if (await waitFor(() => popupClosedAfterClick(popup, control, previousMessage), 3200, shouldStop, 35)) return;
    if (javascriptHref) throw new Error("O X do SIGITM não fechou o popup.");
    throw new Error("O X do SIGITM não foi confirmado como fechado; a automação não avançará sem segurança.");
  }

  function classifySigItmPopup(action, text) {
    const message = String(text || "").replace(/\s+/g, " ").trim();
    // Após o clique em Baixar, o SIGITM pode montar por um instante um popup
    // vazio durante o AJAX. Não é evidência de falha; feche-o pelo X se houver
    // controle reconhecível e deixe a validação das próximas etapas decidir.
    if (!message) return { kind: "empty", message };
    const normalized = root.BaixaNavigation.normalize(message);
    if (action === "Bloquear" && /\b(?:ticket|tiquete) bloqueado\b/.test(normalized)) {
      return { kind: "expected", message };
    }
    const explicitError = /\b(erro|error|falha|falhou|inv[aá]lid[oa]|obrigat[oó]ri[oa]|recusad[oa]|negad[oa]|n[aã]o foi poss[ií]vel|n[aã]o autorizado|exce[cç][aã]o|validation error)\b/i.test(message);
    if (explicitError || action === "Baixar") return { kind: "error", message };
    return { kind: "notice", message };
  }

  async function closeBlockPopup(shouldStop = () => false, action = "Bloquear", appearanceTimeout = action === "Baixar" ? 900 : 7000) {
    const popup = await waitFor(() => visiblePopups().find(candidate => {
      const text = root.BaixaNavigation.normalize(root.BaixaNavigation.textOf(candidate));
      return action === "Baixar" || Boolean(selectBestPopupCloseControl(candidate)) || Boolean(text && /tiquete bloqueado|baixa|mensagem|erro|falha|inv[aá]lid|obrigat|recusad/.test(text));
    }) || null, appearanceTimeout, shouldStop, 40);
    if (!popup) return false;
    const rawMessage = root.BaixaNavigation.textOf(popup);
    const classification = classifySigItmPopup(action, rawMessage);
    const errorMessage = classification.kind === "error"
      ? `SIGITM retornou um popup após ${action}: ${classification.message || "mensagem sem texto"}` : "";
    const controlTimeout = action === "Baixar" ? 1800 : 7000;
    const control = await waitFor(() => {
      if (!root.BaixaNavigation.visible(popup)) return true;
      const current = visiblePopups().find(candidate => candidate === popup || candidate.contains?.(popup) || popup.contains?.(candidate)) || popup;
      return selectBestPopupCloseControl(current) || findCloseControlNearPopup(current) || false;
    }, controlTimeout, shouldStop, 35);
    if (!root.BaixaNavigation.visible(popup)) {
      if (errorMessage) throw new Error(errorMessage);
      return true;
    }
    if (!control || control === true) {
      // O SIGITM pode iniciar a animação de fechamento antes de o detector
      // conseguir ler o X. Nesse caso o popup já está saindo: não transforme
      // um fechamento legítimo em falha.
      if (errorMessage) throw new Error(`${errorMessage}${control === true ? "" : " (popup mantido aberto: não foi possível localizar o X)"}`);
      return !root.BaixaNavigation.visible(popup);
    }
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    try { await clickPopupClose(control, popup, shouldStop); }
    catch (error) {
      if (errorMessage) throw new Error(`${errorMessage}; falha ao fechar a janela: ${error.message}`);
      throw error;
    }
    if (errorMessage) throw new Error(errorMessage);
    return true;
  }

  function validationErrorPopup() {
    const requiredError = /Validation Error:\s*Value is required/i;
    const matches = visiblePopups().filter(popup => requiredError.test(root.BaixaNavigation.textOf(popup)));
    return matches.sort((first, second) => {
      const firstControl = selectBestPopupCloseControl(first);
      const secondControl = selectBestPopupCloseControl(second);
      return (firstControl ? 0 : 1) - (secondControl ? 0 : 1);
    })[0] || null;
  }

  function isActionBaixaPopup(popup) {
    const text = root.BaixaNavigation.normalize(root.BaixaNavigation.textOf(popup));
    return text.includes("acionamento") && text.includes("codigo completo da baixa");
  }

  async function closeValidationErrorPopup(shouldStop = () => false) {
    const popup = await waitFor(() => validationErrorPopup(), 700, shouldStop, 40);
    if (!popup) return false;
    const control = selectBestPopupCloseControl(popup);
    if (!control) return false;
    await clickPopupClose(control, popup, shouldStop);
    return true;
  }

  async function beginMainClosure(shouldStop = () => false, afterBlock = null) {
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    await root.BaixaNavigation.waitForLoadingToFinish(shouldStop);
    const blockLabels = ["Bloquear"];
    let blockButton;
    try {
      blockButton = await waitForUniqueButton(blockLabels, 12000, shouldStop);
    } catch (error) {
      const visibleNextAction = ["Gravar Baixa", "Baixar"].find(label => {
        try { findUniqueButton([label]); return true; } catch { return false; }
      });
      if (visibleNextAction) {
        throw new Error(`O botão “Bloquear” não está disponível, mas “${visibleNextAction}” já aparece na tela. O chamado pode estar em uma etapa de baixa já iniciada; nenhuma ação foi repetida. Confira o status no SIGITM e, se necessário, atualize a página antes de tentar novamente.`);
      }
      throw error;
    }
    const refreshBlockButton = async () => waitForUniqueButton(blockLabels, 2000, shouldStop);
    await root.BaixaNavigation.clickControl(blockButton, shouldStop, null, refreshBlockButton);
    const blockPopupClosed = await closeBlockPopup(shouldStop);
    if (!blockPopupClosed && blockButton.isConnected !== false && !blockButton.disabled) {
      throw new Error("O SIGITM não confirmou o bloqueio do tíquete; Baixar foi cancelado para evitar continuar em estado incerto.");
    }
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    if (afterBlock) await afterBlock();
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    if (!await root.BaixaNavigation.clickTab("Cliente", shouldStop)) throw new Error("Aba Cliente indisponível após fechar a mensagem de bloqueio.");
    let downloadButton;
    try {
      downloadButton = await waitForUniqueButton(["Baixar"], 10000, shouldStop);
    } catch (error) {
      if (/interrompida/i.test(error.message || "")) throw error;
      throw new Error(`Aba Cliente foi confirmada como ativa, mas o botão “Baixar” não apareceu após aguardar o SIGITM. Nenhum clique foi feito. ${error.message}`);
    }
    await root.BaixaNavigation.waitForLoadingToFinish(shouldStop);
    const refreshDownloadButton = async () => {
      const button = await waitForUniqueButton(["Baixar"], 2000, shouldStop);
      return button;
    };
    await root.BaixaNavigation.clickControl(downloadButton, shouldStop, null, refreshDownloadButton);
    // O SIGITM pode exibir uma mensagem sobre a baixa inicial. Ela deve ser
    // fechada pelo X antes de navegar para o Encerramento.
    await closeBlockPopup(shouldStop, "Baixar");
    return true;
  }

  async function saveMainClosure(shouldStop = () => false) {
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    let validationErrorObserved = false;
    let popupCloseObserved = false;
    const rootNode = document.documentElement;
    const validationPattern = /Validation Error:\s*Value is required/i;
    const hasValidationErrorNow = () => root.BaixaNavigation.documents().some(doc =>
      validationPattern.test(root.BaixaNavigation.textOf(doc.body))
    );
    const looksLikeClose = target => {
      let node = target;
      for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
        if (isCloseControl(node)) return true;
      }
      return false;
    };
    const observer = rootNode && typeof MutationObserver !== "undefined"
      ? new MutationObserver(() => { if (hasValidationErrorNow()) validationErrorObserved = true; })
      : null;
    const clickListener = event => {
      if (looksLikeClose(event.target)) {
        popupCloseObserved = true;
        return;
      }
      try {
        const popup = validationErrorPopup();
        if (!popup) return;
        const control = selectBestPopupCloseControl(popup);
        if (control && (event.target === control || control.contains?.(event.target) || event.target?.closest?.("a,button,input,[role='button'],[onclick],[tabindex]") === control)) {
          popupCloseObserved = true;
        }
      } catch { /* clique fora do popup não interfere no fluxo */ }
    };
    try {
      await root.BaixaNavigation.waitForLoadingToFinish(shouldStop);
      const button = findUniqueButton(["Gravar Baixa"]);
      if (observer) observer.observe(rootNode, { subtree: true, childList: true, characterData: true, attributes: true });
      document.addEventListener("click", clickListener, true);
      await root.BaixaNavigation.clickControl(button, shouldStop);
      // Capture both synchronous and asynchronous SIGITM validation. The observer
      // keeps the error known even when the user closes its popup immediately.
      const end = Date.now() + 2000;
      let validationPopupSeen = false;
      while (Date.now() < end) {
        if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
        if (hasValidationErrorNow()) validationErrorObserved = true;
        const visibleValidationPopup = validationErrorPopup();
        if (visibleValidationPopup) validationPopupSeen = true;
        if (validationErrorObserved) return { saved: false, validationError: true, popupCloseObserved };
        if (validationPopupSeen && !visibleValidationPopup && root.BaixaNavigation.findTabCandidates) {
          const hasCertificationTab = root.BaixaNavigation.findTabCandidates("Certificação").length > 0;
          if (hasCertificationTab) return { saved: false, validationError: true, popupCloseObserved: true };
        }
        if (popupCloseObserved && root.BaixaNavigation.findTabCandidates) {
          const hasCertificationTab = root.BaixaNavigation.findTabCandidates("Certificação").length > 0;
          if (hasCertificationTab) return { saved: false, validationError: true, popupCloseObserved: true };
        }
        await root.BaixaNavigation.waitForDomChange(250, shouldStop);
      }
      return { saved: true, validationError: false, popupCloseObserved };
    } finally {
      observer?.disconnect();
      document.removeEventListener("click", clickListener, true);
    }
  }

  async function waitForTicketReleased(timeout = 30000, shouldStop = () => false) {
    const hasTicketReleased = (doc, fullScan = true) => {
      const released = text => /(?:ticket|tiquete)[\s\S]{0,100}liberado/.test(root.BaixaNavigation.normalize(text));
      // O modal da tela final pode ser montado sem role/classe semântica. Ler
      // o body garante a identificação do texto “Tíquete Liberado.” da janela.
      if (released(root.BaixaNavigation.textOf(doc.body))) return true;
      // A varredura por elemento força layout em toda a página; só é feita esporadicamente.
      if (!fullScan) return false;
      const selectors = "[role='dialog'], [role='alert'], [role='status'], [aria-modal='true'], .modal, .ui-dialog, table, div, td, span, p";
      return [...doc.querySelectorAll(selectors)].some(element => root.BaixaNavigation.visible(element) && released(root.BaixaNavigation.textOf(element)));
    };
    const deadline = Date.now() + timeout;
    let lastFullScan = 0;
    let lastFrameCheck = 0;
    let found = false;
    while (Date.now() < deadline) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      const now = Date.now();
      const fullScan = now - lastFullScan >= 1000;
      if (fullScan) lastFullScan = now;
      found = root.BaixaNavigation.documents().some(doc => hasTicketReleased(doc, fullScan));
      if (found) break;

      // RichFaces pode renderizar a confirmação dentro de um frame que o
      // content script superior não consegue ler. O background verifica os
      // frames em MAIN world sem clicar nem alterar o chamado.
      if (now - lastFrameCheck >= 750) {
        lastFrameCheck = now;
        try {
          const response = await new Promise(resolve => {
            root.chrome.runtime.sendMessage({ type: "CHECK_TICKET_RELEASED" }, result => {
              try { void root.chrome.runtime.lastError; } catch { /* extensão recarregada */ }
              resolve(result || null);
            });
          });
          found = response?.released === true;
        } catch { found = false; }
        if (found) break;
      }
      await root.BaixaNavigation.waitForDomChange(Math.min(250, Math.max(1, deadline - Date.now())), shouldStop);
    }
    const released = found;
    if (!released) return false;
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    return released;
  }

  async function waitFor(predicate, timeout = 12000, shouldStop = () => false, pollMs = 250) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
      const value = predicate();
      if (value) return value;
      await root.BaixaNavigation.waitForDomChange(Math.min(pollMs, end - Date.now()), shouldStop);
    }
    return false;
  }

  function actionPopupOpen() {
    return visiblePopups().some(isActionBaixaPopup) || root.BaixaNavigation.documents().some(doc => {
      const modal = doc.getElementById?.("modalListBaixaAcionamento");
      return modal && root.BaixaNavigation.visible(modal);
    });
  }

  // Erro explícito do SIGITM logo após Gravar no popup do acionamento.
  function actionSaveError() {
    const text = root.BaixaNavigation.normalize(feedbackText());
    if (/validation error|value is required|campo obrigatorio/.test(text)) return "o SIGITM retornou erro de validação ao gravar o acionamento";
    if (/erro.{0,40}(acionamento|gravar|baixa)|falha.{0,40}(acionamento|gravar|baixa)/.test(text)) return "o SIGITM retornou erro ao gravar o acionamento";
    return "";
  }

  async function closeActiveAction(baixaCode, shouldStop = () => false, log = () => {}) {
    const step = message => { try { log(`[Acionamento] ${message}`); } catch { /* log opcional */ } };
    step("1/6 abrindo aba Acionamento");
    if (!await root.BaixaNavigation.clickTab("Acionamento", shouldStop)) throw new Error("Aba Acionamento indisponível.");
    const activeRows = root.BaixaNavigation.findActiveActionRows();
    if (!activeRows.length) { step("nenhum acionamento ativo; nada a baixar"); return false; }
    if (activeRows.length !== 1) throw new Error(`Há ${activeRows.length} acionamentos ativos; a baixa foi interrompida para evitar selecionar a linha errada.`);
    const links = [...activeRows[0].querySelectorAll('a.down[title="baixar"]')]
      .filter(link => root.BaixaNavigation.visible(link) && !link.disabled && link.getAttribute("aria-disabled") !== "true");
    if (links.length !== 1) throw new Error(`O controle “baixar” do acionamento ativo ${links.length ? "está ambíguo" : "não foi encontrado"}; nenhuma ação foi executada.`);
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    step("2/6 abrindo popup de baixa do acionamento ativo");
    await root.BaixaNavigation.waitForLoadingToFinish(shouldStop);
    await root.BaixaNavigation.clickControl(links[0], shouldStop);
    const popup = await waitFor(() => visiblePopups().find(isActionBaixaPopup) || false, 10000, shouldStop);
    if (!popup) throw new Error("O SIGITM não exibiu o popup de baixa do acionamento ativo.");
    step("3/6 preenchendo campos do popup");
    await root.BaixaFormHandler.fillActionBaixa(baixaCode, () => visiblePopups().find(isActionBaixaPopup) || null, shouldStop);
    const saveButton = await waitForUniqueButton(["Gravar"], 10000, shouldStop);
    step("4/6 clicando em Gravar (uma única vez)");
    await root.BaixaNavigation.clickControl(saveButton, shouldStop);

    // Confirmação: (a) popup fechou, sem erro; (b) a tabela deixou de mostrar o acionamento como
    // ativo. O SIGITM nem sempre atualiza a tabela sozinho, então, com o popup já fechado, a aba
    // Acionamento é reaberta (sem novo Gravar) para forçar a releitura em vez de esperar em vão.
    step("5/6 aguardando fechamento do popup e atualização da tabela");
    let saveError = "";
    const popupClosed = await waitFor(() => {
      saveError = actionSaveError();
      return saveError || !actionPopupOpen();
    }, 15000, shouldStop);
    if (saveError) throw new Error(`Acionamento não gravado: ${saveError}; a baixa principal foi cancelada.`);
    if (!popupClosed) throw new Error("O popup de baixa do acionamento continuou aberto após Gravar; a baixa principal foi cancelada.");
    await root.BaixaNavigation.waitForLoadingToFinish(shouldStop);
    let confirmed = await waitFor(() => root.BaixaNavigation.findActiveActionRows().length === 0, 4000, shouldStop);
    if (!confirmed) {
      step("tabela ainda mostra acionamento ativo; reabrindo a aba Acionamento para atualizar a leitura");
      await root.BaixaNavigation.clickTab("Acionamento", shouldStop);
      await root.BaixaNavigation.waitForLoadingToFinish(shouldStop);
      confirmed = await waitFor(() => root.BaixaNavigation.findActiveActionRows().length === 0, 8000, shouldStop);
    }
    if (!confirmed) throw new Error("O popup do acionamento fechou, mas a tabela continua exibindo acionamento ativo; a baixa principal foi cancelada.");
    step("6/6 acionamento baixado e confirmado; retornando ao fluxo principal");
    return true;
  }

  // Estado do ticket lido da aba Data. "" = não legível.
  function classifyTicketStatus(value) {
    const text = root.BaixaNavigation.normalize(value);
    if (!text) return "";
    if (/\b(paus|parad|suspens|aguardando)/.test(text)) return "pausado";
    if (/\bativ[oa]\b/.test(text)) return "ativo";
    return "outro";
  }

  function findClockReturnControl() {
    const labelPattern = /\b(retornar|reativar|ativar|voltar)\b.*\b(ativo|ticket|tiquete|chamado)?|\b(finalizar|encerrar|fim)\b.*\b(parada|pausa)\b|\b(retornar|reativar|ativar)\b/;
    const controls = root.BaixaNavigation.documents().flatMap(doc => [...doc.querySelectorAll("table[id*='listParadaRelogio']")])
      .filter(table => root.BaixaNavigation.visible(table))
      .flatMap(table => [...table.querySelectorAll("a, button, input[type='button'], input[type='submit'], input[type='image'], img, [role='button'], [onclick]")])
      .map(element => element.matches?.("img") ? (element.closest?.("a, button, [onclick]") || element) : element)
      .filter(element => root.BaixaNavigation.visible(element) && !element.disabled && element.getAttribute?.("aria-disabled") !== "true")
      .filter(element => labelPattern.test(root.BaixaNavigation.normalize([
        element.title, element.alt, element.value, element.getAttribute?.("aria-label"), root.BaixaNavigation.textOf(element)
      ].filter(Boolean).join(" "))));
    return [...new Set(controls)];
  }

  // Parada de Relógio: retorna o ticket para Ativo (uma única vez) antes de Bloquear/Baixar.
  async function returnTicketToActive(clockData = {}, shouldStop = () => false, log = () => {}) {
    const step = message => { try { log(`[Pausa de Relógio] ${message}`); } catch { /* log opcional */ } };
    step("1/4 abrindo aba Data para conferir o status do ticket");
    if (!await root.BaixaNavigation.clickTab("Data", shouldStop)) throw new Error("Aba Data indisponível para retornar o ticket para Ativo.");
    await root.BaixaNavigation.waitForLoadingToFinish(shouldStop);
    const readStatus = () => classifyTicketStatus(root.BaixaNavigation.readField(["Status", "Situação", "Situacao"]));
    const before = readStatus();
    if (before === "ativo") { step("ticket já está Ativo; nenhuma ação necessária"); return false; }
    const controls = findClockReturnControl();
    if (controls.length > 1) throw new Error(`Parada de Relógio: ${controls.length} controles de retorno para Ativo encontrados; a baixa foi interrompida para evitar clicar no errado.`);
    if (!controls.length) {
      if (before === "" && clockData.dataFimParadaRelogio) {
        step("status não legível, mas a parada já possui fim registrado; seguindo sem nova ação");
        return false;
      }
      throw new Error("Parada de Relógio: não foi possível retornar o ticket para Ativo (controle de retorno não localizado na aba Data). Retorne manualmente e execute novamente; nenhuma data foi inventada.");
    }
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    step("2/4 acionando retorno para Ativo (uma única vez)");
    await root.BaixaNavigation.clickControl(controls[0], shouldStop);
    step("3/4 aguardando confirmação do status Ativo");
    const active = await waitFor(() => readStatus() === "ativo", 12000, shouldStop);
    if (!active) throw new Error("Parada de Relógio: o SIGITM não confirmou o status Ativo após o retorno; a baixa foi interrompida.");
    step("4/4 ticket Ativo confirmado; seguindo para Bloquear/Baixar");
    return true;
  }

  async function confirmMainClosure(shouldStop = () => false) {
    if (!await root.BaixaNavigation.clickTab("Encerramento", shouldStop)) throw new Error("Aba Encerramento indisponível.");
    const button = findUniqueButton(["Confirmar Baixa", "Confirmar", "Baixar", "Salvar", "Encerrar", "Concluir"]);
    if (shouldStop()) throw new Error("Automação interrompida pelo usuário.");
    await root.BaixaNavigation.waitForLoadingToFinish(shouldStop);
    await root.BaixaNavigation.clickControl(button, shouldStop);
    const result = await waitFor(() => {
      const feedback = feedbackText();
      const message = root.BaixaNavigation.normalize(feedback);
      if (/erro.{0,50}(baixa|encerramento|log)|falha.{0,50}(baixa|encerramento|log)|nao foi possivel.{0,50}(baix|encerr)|log.{0,50}(erro|falha)/.test(message)) {
        return `ERRO NO SISTEMA — ${feedback || "o SIGITM recusou a baixa."}`;
      }
      if (/baixa realizada com sucesso|chamado baixado com sucesso|encerrado com sucesso/.test(message)) return "BAIXA REALIZADA";
      const status = root.BaixaNavigation.normalize(root.BaixaNavigation.readField(["Status", "Situação", "Situacao"]));
      if (["baixado", "baixada", "encerrado", "encerrada", "fechado", "fechada"].includes(status)) return "BAIXA REALIZADA";
      return "";
    }, 12000, shouldStop);
    return result || "ERRO NO SISTEMA — o SIGITM não confirmou a baixa; o pop-up foi mantido aberto.";
  }

  const api = { findUniqueButton, waitForUniqueButton, classifySigItmPopup, isCloseControl, closeImageCandidates, popupCloseControls, findCloseControlNearPopup, selectBestPopupCloseControl, invokeSafeJavaScriptClose, invokeRichFacesModalClose, pageCloseRequest, suppressJavascriptNavigation, clickPopupClose, closeBlockPopup, closeValidationErrorPopup, isActionBaixaPopup, beginMainClosure, saveMainClosure, waitForTicketReleased, closeActiveAction, classifyTicketStatus, findClockReturnControl, returnTicketToActive, confirmMainClosure };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaHandler = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
