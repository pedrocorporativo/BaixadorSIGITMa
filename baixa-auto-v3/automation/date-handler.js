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

  // Legado: mantido apenas por compatibilidade com testes e integrações. O
  // Encerramento usa validateDates(), que calcula Data Criação + 1 hora.
  function repairFromCreation(data) {
    const creation = parseDate(data.dataCriacao);
    return creation ? addHours(creation, 2) : "";
  }

  function midpointBetweenDates(startValue, endValue) {
    const start = parseDate(startValue);
    const end = parseDate(endValue);
    if (!start || !end || end.getTime() - start.getTime() < 2 * 60 * 1000) return "";
    // Arredonda para o minuto inferior para o formato aceito pelo SIGITM.
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
      // Com Pausa de Relógio, a Data de Reparo é a original da aba Data (nunca
      // Fim da parada + 1 minuto): deve ficar entre a Criação e o início da parada,
      // dentro do SLA de 4 horas e antes da Data Objetivo (quando conhecida).
      const base = { originalRepair, objective, pause, pauseEnd, slaEnd };
      const fail = reason => ({ valid: false, reason, ...base });
      if (!pause) return fail("Parada de Relógio ativa: a data/hora de início da parada não foi identificada ou é inválida; não é possível validar a Data de Reparo.");
      // Campo Data de Reparo vazio na aba Data (comum em ticket pausado): usa a regra padrão
      // Data Criação + 1 hora, sujeita às mesmas validações (antes da parada, SLA, Objetivo).
      // Se o campo tem texto que não é data, continua bloqueando.
      const fieldHasText = String(data.dataReparoOriginal ?? "").trim() !== "";
      if (!originalRepair && fieldHasText) return fail(`Parada de Relógio ativa: Data de Reparo original inválida (lido: "${data.dataReparoOriginal}"); a baixa foi interrompida sem inventar horário.`);
      const usedFallback = !originalRepair;
      const repairOriginal = originalRepair || parseDate(addHours(creation, 1));
      // O SLA de 4h conta a partir do Início do SLA (quando legível); antes da parada o relógio
      // ainda corria, então a janela é [início do SLA, início do SLA + 4h].
      const slaStart = parseDate(data.dataInicioSla) || creation;
      const pausedSlaEnd = new Date(slaStart.getTime() + 4 * 60 * 60 * 1000);
      base.slaEnd = pausedSlaEnd;
      if (repairOriginal.getTime() <= creation.getTime()) return fail("Data de Reparo deve ser posterior à Data Criação.");
      if (repairOriginal.getTime() >= pause.getTime()) return fail(`Data de Reparo original (${formatDate(repairOriginal)}) deve ser anterior ao início da Parada de Relógio (${formatDate(pause)}).`);
      if (repairOriginal.getTime() > pausedSlaEnd.getTime()) return fail(`Data de Reparo original (${formatDate(repairOriginal)}) excede o SLA de 4 horas (limite ${formatDate(pausedSlaEnd)}, contado desde ${formatDate(slaStart)}; início da parada ${formatDate(pause)}).`);
      if (objective && repairOriginal.getTime() >= objective.getTime()) return fail("Data de Reparo original deve ser anterior à Data Objetivo.");
      return { valid: true, repair: repairOriginal, repairValue: formatDate(repairOriginal), ...base, warnings: usedFallback ? ["Data de Reparo original vazia na aba Data; usada Data Criação + 1 hora (validada contra parada, SLA e Data Objetivo)."] : [] };
    }

    // Sem pausa: Data Criação + 1 hora (regra inalterada).
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
