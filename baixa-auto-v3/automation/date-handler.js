(function (root) {
  "use strict";

  function parseDate(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return new Date(value.getTime());
    const text = String(value ?? "").trim();
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/) ||
      text.match(/^(\d{4})-(\d{2})-(\d{2})$/) ||
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
      date.getHours() === hour && date.getMinutes() === minute && date.getSeconds() === second ? date : null;
  }

  function addHours(date, hours) {
    return formatDate(new Date(date.getTime() + hours * 60 * 60 * 1000));
  }

  function formatDate(result) {
    const pad = value => String(value).padStart(2, "0");
    return `${pad(result.getDate())}/${pad(result.getMonth() + 1)}/${result.getFullYear()} ${pad(result.getHours())}:${pad(result.getMinutes())}`;
  }

  function repairFromCreation(data) {
    const creation = parseDate(data.dataCriacao);
    return creation ? addHours(creation, 2) : "";
  }

  function midpointBetweenDates(startValue, endValue) {
    const start = parseDate(startValue);
    const end = parseDate(endValue);
    if (!start || !end || end.getTime() - start.getTime() < 2 * 60 * 1000) return "";
    const midpoint = new Date(Math.floor(((start.getTime() + end.getTime()) / 2) / 60000) * 60000);
    return midpoint.getTime() > start.getTime() && midpoint.getTime() < end.getTime() ? formatDate(midpoint) : "";
  }

  function validateDates(data) {
    const creation = parseDate(data.dataCriacao);
    const objective = parseDate(data.dataObjetivo);
    const originalRepair = parseDate(data.dataReparoOriginal);
    if (!creation) return { valid: false, reason: "Data Criação não identificada ou inválida; não é possível validar a Data de Reparo." };
    const slaEnd = new Date(creation.getTime() + 4 * 60 * 60 * 1000);
    const clockPaused = root.BaixaHelpers.normalizeText(data.paradaRelogio) === "sim";
    const pause = parseDate(data.dataInicioParadaRelogio || data.dataParadaRelogio);
    const pauseEnd = parseDate(data.dataFimParadaRelogio);

    if (clockPaused) {
      const base = { originalRepair, objective, pause, pauseEnd, slaEnd };
      const fail = reason => ({ valid: false, reason, ...base });
      if (!pause) return fail("Parada de Relógio ativa: a data/hora de início da parada não foi identificada ou é inválida; não é possível validar a Data de Reparo.");

      const fieldHasText = String(data.dataReparoOriginal ?? "").trim() !== "";
      if (!originalRepair && fieldHasText) return fail(`Parada de Relógio ativa: Data de Reparo original inválida (lido: "${data.dataReparoOriginal}"); a baixa foi interrompida sem inventar horário.`);

      const slaStart = parseDate(data.dataInicioSla) || creation;
      const pausedSlaEnd = new Date(slaStart.getTime() + 4 * 60 * 60 * 1000);
      base.slaEnd = pausedSlaEnd;

      const isUsableOriginal = repair => Boolean(repair &&
        repair.getTime() > creation.getTime() &&
        repair.getTime() < pause.getTime() &&
        repair.getTime() <= pausedSlaEnd.getTime() &&
        (!objective || repair.getTime() < objective.getTime()));

      let repairOriginal;
      let usedFallback = false;
      let usedCorrectedOriginal = false;

      if (isUsableOriginal(originalRepair)) {
        repairOriginal = originalRepair;
      } else {
        // Quando a data original da aba Data foi gravada depois da parada, use
        // automaticamente um horário seguro entre a Criação e o início da parada.
        const midpoint = parseDate(midpointBetweenDates(creation, pause));
        if (isUsableOriginal(midpoint)) {
          repairOriginal = midpoint;
          usedCorrectedOriginal = Boolean(originalRepair);
        } else {
          const fallback = parseDate(addHours(creation, 1));
          if (isUsableOriginal(fallback)) {
            repairOriginal = fallback;
            usedFallback = !originalRepair;
            usedCorrectedOriginal = Boolean(originalRepair);
          } else {
            if (originalRepair && originalRepair.getTime() >= pause.getTime()) {
              return fail(`Data de Reparo original (${formatDate(originalRepair)}) está depois ou no início da Parada de Relógio (${formatDate(pause)}). Não foi possível calcular um horário seguro entre a Criação e a parada.`);
            }
            if (originalRepair && originalRepair.getTime() <= creation.getTime()) {
              return fail("Data de Reparo deve ser posterior à Data Criação.");
            }
            if (originalRepair && originalRepair.getTime() > pausedSlaEnd.getTime()) {
              return fail(`Data de Reparo original (${formatDate(originalRepair)}) excede o SLA de 4 horas (limite ${formatDate(pausedSlaEnd)}, contado desde ${formatDate(slaStart)}).`);
            }
            if (objective && originalRepair && originalRepair.getTime() >= objective.getTime()) {
              return fail("Data de Reparo original deve ser anterior à Data Objetivo.");
            }
            return fail("Não foi possível calcular uma Data de Reparo segura antes da parada, dentro do SLA e antes da Data Objetivo.");
          }
        }
      }

      const warnings = [];
      if (usedCorrectedOriginal) {
        warnings.push(`Data de Reparo original (${originalRepair ? formatDate(originalRepair) : "inválida"}) estava fora da janela segura; usada uma data calculada antes da parada: ${formatDate(repairOriginal)}.`);
      } else if (usedFallback) {
        warnings.push("Data de Reparo original vazia na aba Data; usada Data Criação + 1 hora (validada contra parada, SLA e Objetivo).");
      }

      return { valid: true, repair: repairOriginal, repairValue: formatDate(repairOriginal), ...base, warnings };
    }

    const repair = parseDate(addHours(creation, 1));
    if (!repair) return { valid: false, reason: "Não foi possível calcular Data de Reparo + 1 hora." };
    const invalid = reason => ({ valid: false, reason, repair, repairValue: formatDate(repair), originalRepair, objective, pause, pauseEnd, slaEnd });
    if (!objective) return invalid("Data Objetivo não identificada ou inválida.");
    if (repair.getTime() >= objective.getTime()) return invalid("Data de Reparo deve ser anterior à Data Objetivo.");
    if (repair.getTime() > slaEnd.getTime()) return invalid("Data de Reparo excede o SLA de 4 horas.");
    return { valid: true, repair, repairValue: formatDate(repair), originalRepair, objective, pause, pauseEnd, slaEnd, warnings: [] };
  }

  const api = { parseDate, addHours, formatDate, repairFromCreation, midpointBetweenDates, validateDates };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaDateHandler = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
