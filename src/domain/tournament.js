/**
 * Reglas del torneo por etapas: zonas iniciales, clasificados, zona única y
 * clasificación final. También define la modalidad +60 (zona única directa).
 *
 * Todo se DERIVA de los resultados registrados: no hay contadores mutables, no se
 * generan partidos, cruces, fixtures ni "partidos pendientes". La completitud de
 * una zona sólo se mide contando cuántos enfrentamientos distintos tienen
 * resultado frente a los n·(n−1)/2 necesarios de un todos contra todos.
 *
 * Contexto (`ctx`) que reciben las funciones de consulta:
 *   { category, teams: equipos de la categoría, matches: resultados de la categoría }
 *
 * Capa: domain. Las consultas son puras. Las funciones `create*`/`convert*`
 * documentan explícitamente cuando mutan el agregado recibido.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./constants.js'), require('./standings.js'));
  } else {
    const modules = root.PuntajeNewcomModules;
    modules.tournament = factory(modules.constants, modules.standings);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (constants, standings) {
  'use strict';

  const { STAGES, STATUS, ZONE_STATUS, FORMATS, PHASES, PHASE_LABELS, QUALIFIERS_PER_ZONE } = constants;

  // ---------------------------------------------------------------------------
  // Estructura de la categoría
  // ---------------------------------------------------------------------------

  /** Estado inicial de una categoría con zonas (Modalidad A). */
  function emptyZoneTournament() {
    return {
      status: ZONE_STATUS.CONFIGURING,
      firstStageStatus: 'CONFIGURING',
      secondStageStatus: null,
      zones: [],
      secondStageZoneId: null,
      qualified: [],
      confirmedAt: null,
      qualificationUpdatedAt: null,
      tieBreaks: []
    };
  }

  /** Estado inicial de una categoría de zona única (Modalidad B, +60). */
  function singleZoneTournament(zone) {
    return Object.assign(emptyZoneTournament(), {
      status: ZONE_STATUS.IN_PROGRESS,
      firstStageStatus: 'SKIPPED',
      secondStageStatus: 'IN_PROGRESS',
      zones: [zone],
      secondStageZoneId: zone.id
    });
  }

  function flow(category) {
    return category && category.zoneTournament ? category.zoneTournament : emptyZoneTournament();
  }

  function isSingleZoneFormat(category) {
    return Boolean(category) && category.format === FORMATS.SINGLE_ZONE;
  }

  /** Sugiere la modalidad según el nombre (las categorías "+60" usan zona única). */
  function inferFormat(name) {
    return constants.SINGLE_ZONE_CATEGORY_PATTERN.test(String(name || '')) ? FORMATS.SINGLE_ZONE : FORMATS.ZONES;
  }

  function isLegacyKnockout(category) {
    return Boolean(category) && constants.LEGACY_KNOCKOUT_STAGES.indexOf(category.currentStage) >= 0;
  }

  function zoneById(category, zoneId) {
    return flow(category).zones.filter(function (zone) { return zone.id === zoneId; })[0] || null;
  }

  /** Zonas de la primera etapa (excluye la zona única). */
  function initialZones(category) {
    const f = flow(category);
    return f.zones.filter(function (zone) { return zone.id !== f.secondStageZoneId; });
  }

  /** Zona única (segunda etapa en Modalidad A, o la única zona en +60). */
  function finalZone(category) {
    const f = flow(category);
    return f.secondStageZoneId ? zoneById(category, f.secondStageZoneId) : null;
  }

  function isInitialZone(category, zoneId) {
    return initialZones(category).some(function (zone) { return zone.id === zoneId; });
  }

  /** Zona inicial a la que pertenece un equipo. */
  function teamInitialZone(category, teamId) {
    return initialZones(category).filter(function (zone) { return zone.teamIds.indexOf(teamId) >= 0; })[0] || null;
  }

  function stageForZone(category, zoneId) {
    return zoneId && zoneId === flow(category).secondStageZoneId ? STAGES.ZONE_FINAL : STAGES.GENERAL;
  }

  function scopeKey(stage, zoneId) {
    return stage + '|' + zoneId;
  }

  // ---------------------------------------------------------------------------
  // Resultados, progreso y tablas por zona
  // ---------------------------------------------------------------------------

  /** Resultados vigentes (los archivados por cambio de clasificados no cuentan). */
  function liveMatches(matches) {
    return matches.filter(function (match) { return !match.archived; });
  }

  function scopeMatches(ctx, stage, zoneId) {
    return liveMatches(ctx.matches).filter(function (match) { return match.stage === stage && match.zoneId === zoneId; });
  }

  function zoneTeams(ctx, zone) {
    return zone.teamIds.map(function (id) {
      return ctx.teams.filter(function (team) { return team.id === id; })[0];
    }).filter(Boolean);
  }

  /** Clave canónica de un enfrentamiento (independiente del orden). */
  function pairKey(teamAId, teamBId) {
    return [teamAId, teamBId].sort().join('|');
  }

  /**
   * Progreso de un todos contra todos: cuántos enfrentamientos distintos entre
   * integrantes de la zona tienen resultado. NO enumera cuáles faltan.
   */
  function zoneProgress(ctx, zone, stage) {
    const members = {};
    zone.teamIds.forEach(function (id) { members[id] = true; });
    const pairs = {};
    scopeMatches(ctx, stage, zone.id).forEach(function (match) {
      if (members[match.winnerId] && members[match.loserId]) pairs[pairKey(match.winnerId, match.loserId)] = true;
    });
    const teamCount = zone.teamIds.length;
    const required = teamCount * (teamCount - 1) / 2;
    const played = Object.keys(pairs).length;
    return { teamCount, required, played, missing: Math.max(0, required - played), complete: teamCount >= 2 && played === required };
  }

  function tieResolutions(category, scope) {
    return (flow(category).tieBreaks || []).filter(function (item) { return item.scope === scope; });
  }

  /** Tabla de una zona con empates detectados y resoluciones manuales aplicadas. */
  function zoneRanking(ctx, zone, stage) {
    const rows = standings.computeStandings(zoneTeams(ctx, zone), scopeMatches(ctx, stage, zone.id), { scoreStage: stage });
    const ranked = standings.rankWithTies(rows, tieResolutions(ctx.category, scopeKey(stage, zone.id)));
    return Object.assign(ranked, { scope: scopeKey(stage, zone.id), stage, zoneId: zone.id });
  }

  // ---------------------------------------------------------------------------
  // Modalidad A: clasificación de zonas iniciales
  // ---------------------------------------------------------------------------

  /**
   * Estado de clasificación de una zona inicial.
   * status: INSUFFICIENT_TEAMS | INCOMPLETE | TIED | DEFINED
   * Un empate sólo bloquea si cruza el corte de clasificación (p. ej. 2.º vs 3.º).
   */
  function zoneQualification(ctx, zone) {
    const progress = zoneProgress(ctx, zone, STAGES.GENERAL);
    const ranking = zoneRanking(ctx, zone, STAGES.GENERAL);
    const cut = QUALIFIERS_PER_ZONE;
    const blockingTies = ranking.ties.filter(function (tie) { return !tie.resolved && tie.start < cut && tie.end >= cut; });
    let status = 'DEFINED';
    if (progress.teamCount < 2) status = 'INSUFFICIENT_TEAMS';
    else if (!progress.complete) status = 'INCOMPLETE';
    else if (blockingTies.length) status = 'TIED';
    const qualifierIds = ranking.rows.slice(0, cut).map(function (row) { return row.team.id; });
    return { zone, progress, ranking, blockingTies, status, qualifierIds, definitive: status === 'DEFINED' };
  }

  /** Problemas de asignación: equipos sin zona o en más de una zona. */
  function assignmentIssues(ctx) {
    const counts = {};
    initialZones(ctx.category).forEach(function (zone) {
      zone.teamIds.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });
    });
    const issues = [];
    const duplicated = ctx.teams.filter(function (team) { return counts[team.id] > 1; });
    if (duplicated.length) issues.push('Un equipo no puede estar en más de una zona: ' + duplicated.map(function (t) { return t.name; }).join(', ') + '.');
    const missing = ctx.teams.filter(function (team) { return !counts[team.id]; });
    if (missing.length) issues.push('Hay equipos sin zona: ' + missing.map(function (t) { return t.name; }).join(', ') + '.');
    return issues;
  }

  function zoneIssue(zq) {
    if (zq.status === 'INSUFFICIENT_TEAMS') return zq.zone.name + ': necesita al menos dos equipos.';
    if (zq.status === 'INCOMPLETE') return zq.zone.name + ': faltan ' + zq.progress.missing + ' resultado(s) para completar el todos contra todos.';
    if (zq.status === 'TIED') return zq.zone.name + ': hay un empate sin resolver que afecta la clasificación.';
    return null;
  }

  /**
   * Clasificación completa de la primera etapa.
   * @returns {{zones: Array, issues: string[], ready: boolean, qualifiers: Array<{teamId, sourceZoneId, position}>}}
   */
  function computeQualification(ctx) {
    const zones = initialZones(ctx.category).map(function (zone) { return zoneQualification(ctx, zone); });
    const issues = [];
    if (!zones.length) issues.push('Creá al menos una zona.');
    assignmentIssues(ctx).forEach(function (issue) { issues.push(issue); });
    zones.forEach(function (zq) { const issue = zoneIssue(zq); if (issue) issues.push(issue); });
    const qualifiers = [];
    zones.forEach(function (zq) {
      zq.qualifierIds.forEach(function (teamId, index) {
        qualifiers.push({ teamId, sourceZoneId: zq.zone.id, position: index + 1 });
      });
    });
    const unique = {};
    qualifiers.forEach(function (q) { unique[q.teamId] = true; });
    if (Object.keys(unique).length !== qualifiers.length) issues.push('Hay equipos clasificados duplicados.');
    return { zones, issues, ready: issues.length === 0, qualifiers };
  }

  /**
   * Compara los clasificados confirmados con los que surgen de los resultados
   * actuales de la primera etapa (p. ej. tras corregir un resultado).
   */
  function qualificationDrift(ctx) {
    const f = flow(ctx.category);
    if (isSingleZoneFormat(ctx.category) || !f.secondStageZoneId || ctx.category.currentStage !== STAGES.ZONE_FINAL) {
      return { applicable: false, determinable: true, changed: false, outgoing: [], incoming: [], issues: [], qualifiers: [] };
    }
    const confirmed = f.qualified.map(function (q) { return q.teamId; });
    const computed = computeQualification(ctx);
    if (!computed.ready) {
      return { applicable: true, determinable: false, changed: false, outgoing: [], incoming: [], issues: computed.issues, qualifiers: [] };
    }
    const computedIds = computed.qualifiers.map(function (q) { return q.teamId; });
    const outgoing = confirmed.filter(function (id) { return computedIds.indexOf(id) < 0; });
    const incoming = computedIds.filter(function (id) { return confirmed.indexOf(id) < 0; });
    return { applicable: true, determinable: true, changed: outgoing.length + incoming.length > 0, outgoing, incoming, issues: [], qualifiers: computed.qualifiers };
  }

  // ---------------------------------------------------------------------------
  // Zona única y clasificación final (ambas modalidades)
  // ---------------------------------------------------------------------------

  /**
   * Clasificación de la zona única. Es DEFINITIVA sólo si:
   *  - todos los enfrentamientos del todos contra todos tienen resultado,
   *  - no hay empates sin resolver,
   *  - (Modalidad A) los clasificados confirmados siguen coincidiendo con la primera etapa.
   */
  function finalClassification(ctx) {
    const zone = finalZone(ctx.category);
    if (!zone) {
      return { zone: null, progress: null, ranking: { rows: [], ties: [] }, unresolvedTies: [], reasons: ['La zona única todavía no fue creada.'], definitive: false, drift: null };
    }
    const progress = zoneProgress(ctx, zone, STAGES.ZONE_FINAL);
    const ranking = zoneRanking(ctx, zone, STAGES.ZONE_FINAL);
    const unresolvedTies = ranking.ties.filter(function (tie) { return !tie.resolved; });
    const drift = qualificationDrift(ctx);
    const reasons = [];
    if (progress.teamCount < 2) reasons.push('La zona única necesita al menos dos equipos.');
    else if (!progress.complete) reasons.push('Faltan ' + progress.missing + ' de ' + progress.required + ' resultado(s) del todos contra todos.');
    if (unresolvedTies.length) reasons.push('Hay ' + unresolvedTies.length + ' empate(s) sin resolver que afectan el orden final.');
    if (drift.applicable && !drift.determinable) reasons.push('La primera etapa quedó incompleta o con empates sin resolver después de confirmar la zona única.');
    if (drift.applicable && drift.changed) reasons.push('Los clasificados confirmados ya no coinciden con los resultados de la primera etapa.');
    return { zone, progress, ranking, unresolvedTies, reasons, definitive: reasons.length === 0, drift };
  }

  /** Estado de alto nivel de la categoría, para mostrar al usuario. */
  function phase(ctx) {
    const category = ctx.category;
    let code;
    if (category.currentStage === STAGES.FINISHED) code = PHASES.FINISHED;
    else if (isLegacyKnockout(category)) code = PHASES.LEGACY_KNOCKOUT;
    else if (category.currentStage === STAGES.ZONE_FINAL) {
      code = finalClassification(ctx).definitive ? PHASES.FINAL_AVAILABLE : PHASES.SINGLE_ZONE_IN_PROGRESS;
    } else if (!initialZones(category).length) code = PHASES.CONFIGURING;
    else {
      const qualification = computeQualification(ctx);
      const allComplete = qualification.zones.every(function (zq) { return zq.progress.complete; });
      if (qualification.ready) code = PHASES.QUALIFIED;
      else if (allComplete) code = PHASES.QUALIFICATION_PENDING;
      else code = PHASES.FIRST_STAGE_IN_PROGRESS;
    }
    return { code, label: PHASE_LABELS[code] };
  }

  // ---------------------------------------------------------------------------
  // Mutaciones del agregado (documentadas)
  // ---------------------------------------------------------------------------

  /**
   * Convierte una categoría con zonas (en primera etapa) a modalidad de zona única.
   * Conserva TODOS los datos: todos los equipos pasan a la zona única y los
   * resultados de la primera etapa se reetiquetan como resultados de la zona única
   * (guardando `originalZoneId` para trazabilidad). No se borra ningún resultado.
   *
   * MUTA `category`, `teams` y `matches` recibidos.
   * @param {{newId: function(string): string, name?: string}} deps
   */
  function convertCategoryToSingleZone(category, teams, matches, deps) {
    const zones = initialZones(category);
    // Con una sola zona existente se reutiliza (conserva id, nombre y resultados).
    const target = zones.length === 1
      ? zones[0]
      : { id: deps.newId('zone'), name: constants.SINGLE_ZONE_NAME, teamIds: [] };
    target.teamIds = teams.map(function (team) { return team.id; });
    matches.forEach(function (match) {
      if (match.stage !== STAGES.GENERAL) return;
      if (match.zoneId && match.zoneId !== target.id) match.originalZoneId = match.zoneId;
      match.zoneId = target.id;
      match.stage = STAGES.ZONE_FINAL;
    });
    teams.forEach(function (team) {
      team.stage = STAGES.ZONE_FINAL;
      if (team.status === STATUS.ELIMINATED) team.status = STATUS.ACTIVE;
    });
    const previous = flow(category);
    category.format = FORMATS.SINGLE_ZONE;
    category.currentStage = STAGES.ZONE_FINAL;
    category.zoneTournament = Object.assign(singleZoneTournament(target), {
      tieBreaks: (previous.tieBreaks || []).filter(function (item) { return item.scope.indexOf(STAGES.ZONE_FINAL + '|') === 0; })
    });
    return target;
  }

  return Object.freeze({
    emptyZoneTournament,
    singleZoneTournament,
    flow,
    isSingleZoneFormat,
    inferFormat,
    isLegacyKnockout,
    zoneById,
    initialZones,
    finalZone,
    isInitialZone,
    teamInitialZone,
    stageForZone,
    scopeKey,
    liveMatches,
    scopeMatches,
    zoneTeams,
    pairKey,
    zoneProgress,
    zoneRanking,
    zoneQualification,
    assignmentIssues,
    computeQualification,
    qualificationDrift,
    finalClassification,
    phase,
    convertCategoryToSingleZone
  });
}));
