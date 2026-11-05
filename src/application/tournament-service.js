/**
 * Servicio de aplicación de PuntajeNewcom: casos de uso sobre el estado.
 *
 * - Orquesta reglas del dominio (`tournament`, `standings`, `scoring`).
 * - Depende sólo del puerto `StateRepository { load(), save(state) }`.
 * - Cada mutación pasa por `commit`: si la regla falla o no se puede guardar,
 *   el estado en memoria se restaura (no quedan cambios a medias).
 * - Las operaciones actúan sobre la categoría seleccionada (igual que antes),
 *   y nunca modifican datos de otras categorías.
 *
 * Restricciones de alcance: este servicio NO genera partidos, cruces, fixtures,
 * calendarios ni listas de partidos pendientes. Sólo registra resultados
 * cargados manualmente y deriva tablas y clasificaciones.
 *
 * Capa: application.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../domain/constants.js'), require('../domain/errors.js'), require('../domain/scoring.js'),
      require('../domain/standings.js'), require('../domain/tournament.js')
    );
  } else {
    const m = root.PuntajeNewcomModules;
    m.tournamentService = factory(m.constants, m.errors, m.scoring, m.standings, m.tournament);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (constants, errors, scoring, standingsLib, tournament) {
  'use strict';

  const { STAGES, STATUS, ZONE_STATUS, FORMATS, ARCHIVE_REASONS } = constants;
  const { DomainError, PersistenceError, ensure } = errors;
  const LOCKED_STATUSES = [STATUS.ELIMINATED, STATUS.CHAMPION, STATUS.RUNNER_UP];

  /**
   * @param {{repository: {load: Function, save: Function}, newId: function(string): string, now?: function(): string, logger?: object}} deps
   */
  function createTournamentService(deps) {
    const repository = deps.repository;
    const newId = deps.newId;
    const now = deps.now || function () { return new Date().toISOString(); };
    let state = repository.load();

    // -------------------------------------------------------------------------
    // Transacciones
    // -------------------------------------------------------------------------

    /** Ejecuta una mutación atómica: valida, guarda y revierte si algo falla. */
    function commit(mutator, failureMessage) {
      const snapshot = JSON.stringify(state);
      let result;
      try {
        result = mutator();
      } catch (error) {
        state = JSON.parse(snapshot);
        throw error;
      }
      if (!repository.save(state)) {
        state = JSON.parse(snapshot);
        throw new PersistenceError(failureMessage || 'No se pudo guardar el cambio. Los datos anteriores se conservaron.');
      }
      return result;
    }

    /** Ejecuta una mutación de prueba, calcula una consulta y descarta los cambios. */
    function simulate(mutator, query) {
      const snapshot = JSON.stringify(state);
      try {
        mutator();
        return query();
      } finally {
        state = JSON.parse(snapshot);
      }
    }

    // -------------------------------------------------------------------------
    // Consultas básicas
    // -------------------------------------------------------------------------

    function getState() { return JSON.parse(JSON.stringify(state)); }
    function rawState() { return state; }
    function categoryById(id) { return state.categories.filter(function (c) { return c.id === id; })[0] || null; }
    function selectedCategory() { return categoryById(state.selectedCategoryId); }
    function requireCategory() {
      const category = selectedCategory();
      ensure(category, 'Seleccioná una categoría.', 'NO_CATEGORY');
      return category;
    }
    function teamsOf(categoryId) { return state.teams.filter(function (t) { return t.categoryId === categoryId; }); }
    function teamById(id) { return state.teams.filter(function (t) { return t.id === id; })[0] || null; }
    function matchById(id) { return state.matchResults.filter(function (r) { return r.id === id; })[0] || null; }
    function matchesOf(categoryId) { return state.matchResults.filter(function (r) { return r.categoryId === categoryId; }); }
    function activeTeams(categoryId) {
      return teamsOf(categoryId).filter(function (t) { return t.status === STATUS.ACTIVE || t.status === STATUS.QUALIFIED; });
    }
    function categoryEntries(categoryId) {
      return teamsOf(categoryId).reduce(function (all, team) {
        return all.concat(team.scoreEntries.map(function (entry) { return { team, entry }; }));
      }, []);
    }
    function context(categoryId) {
      const category = categoryById(categoryId);
      return category ? { category, teams: teamsOf(category.id), matches: matchesOf(category.id) } : null;
    }

    /** Tabla genérica (compatibilidad con la API anterior). */
    function standings(categoryId, stage, zoneId) {
      const category = categoryById(categoryId);
      const zone = zoneId && category ? tournament.zoneById(category, zoneId) : null;
      const teams = teamsOf(categoryId).filter(function (team) { return !zoneId || (zone && zone.teamIds.indexOf(team.id) >= 0); });
      const matches = tournament.liveMatches(matchesOf(categoryId)).filter(function (r) {
        return (!stage || r.stage === stage) && (!zoneId || r.zoneId === zoneId);
      });
      return standingsLib.computeStandings(teams, matches, { scoreStage: stage });
    }

    function zoneRanking(categoryId, zoneId, stage) {
      const ctx = context(categoryId);
      const zone = ctx && tournament.zoneById(ctx.category, zoneId);
      if (!zone) return { rows: [], ties: [] };
      return tournament.zoneRanking(ctx, zone, stage || tournament.stageForZone(ctx.category, zoneId));
    }
    function zoneProgress(categoryId, zoneId) {
      const ctx = context(categoryId);
      const zone = ctx && tournament.zoneById(ctx.category, zoneId);
      return zone ? tournament.zoneProgress(ctx, zone, tournament.stageForZone(ctx.category, zoneId)) : null;
    }
    function qualification(categoryId) { return tournament.computeQualification(context(categoryId)); }
    function finalClassification(categoryId) { return tournament.finalClassification(context(categoryId)); }
    function qualificationDrift(categoryId) { return tournament.qualificationDrift(context(categoryId)); }
    function phase(categoryId) { return tournament.phase(context(categoryId)); }

    // -------------------------------------------------------------------------
    // Preferencias y categorías
    // -------------------------------------------------------------------------

    function selectCategory(id) {
      ensure(categoryById(id), 'Categoría inexistente.', 'CATEGORY_NOT_FOUND');
      return commit(function () { state.selectedCategoryId = id; });
    }

    function setTheme(theme) {
      return commit(function () { state.theme = theme === 'dark' ? 'dark' : 'light'; });
    }

    /**
     * Crea una categoría. Si no se indica modalidad se infiere del nombre
     * ("+60"/"+68" → zona única; resto → zonas + zona única).
     */
    function createCategory(name, format) {
      const trimmed = String(name || '').trim();
      ensure(trimmed, 'La categoría necesita un nombre.', 'CATEGORY_NAME_REQUIRED');
      const chosen = format === FORMATS.ZONES_AND_FINAL || format === FORMATS.ROUND_ROBIN || format === 'ZONES' || format === 'SINGLE_ZONE'
        ? (format === 'SINGLE_ZONE' || format === FORMATS.ROUND_ROBIN ? FORMATS.ROUND_ROBIN : FORMATS.ZONES_AND_FINAL)
        : tournament.inferFormat(trimmed);
      return commit(function () {
        const category = { id: newId('cat'), name: trimmed, format: chosen, currentStage: STAGES.GENERAL, championId: null, runnerUpId: null, zoneTournament: tournament.emptyZoneTournament() };
        if (chosen === FORMATS.ROUND_ROBIN) {
          category.currentStage = STAGES.ZONE_FINAL;
          category.zoneTournament = tournament.singleZoneTournament({ id: newId('zone'), name: constants.SINGLE_ZONE_NAME, phase: constants.ZONE_PHASES.FINAL, teamIds: [] });
        }
        state.categories.push(category);
        state.selectedCategoryId = category.id;
        return category;
      });
    }

    function editCategory(id, name) {
      const category = categoryById(id);
      const trimmed = String(name || '').trim();
      ensure(category, 'Categoría inexistente.', 'CATEGORY_NOT_FOUND');
      ensure(trimmed, 'La categoría necesita un nombre.', 'CATEGORY_NAME_REQUIRED');
      return commit(function () { categoryById(id).name = trimmed; });
    }

    function deleteCategory(id) {
      ensure(categoryById(id), 'Categoría inexistente.', 'CATEGORY_NOT_FOUND');
      return commit(function () {
        state.categories = state.categories.filter(function (c) { return c.id !== id; });
        state.teams = state.teams.filter(function (t) { return t.categoryId !== id; });
        state.matchResults = state.matchResults.filter(function (r) { return r.categoryId !== id; });
        state.selectedCategoryId = state.categories[0] ? state.categories[0].id : null;
      });
    }

    /** Conversión manual y explícita a zona única (sin pérdida de datos). */
    function convertToSingleZone(categoryId) {
      const category = categoryById(categoryId || state.selectedCategoryId);
      ensure(category, 'Seleccioná una categoría.', 'NO_CATEGORY');
      ensure(category.format !== FORMATS.SINGLE_ZONE, 'La categoría ya usa la modalidad de zona única.', 'ALREADY_SINGLE_ZONE');
      ensure(category.currentStage === STAGES.GENERAL, 'Sólo se puede convertir una categoría que todavía está en la primera etapa.', 'STAGE_LOCKED');
      return commit(function () {
        const c = categoryById(category.id);
        return tournament.convertCategoryToSingleZone(c, teamsOf(c.id), matchesOf(c.id), { newId });
      });
    }

    // -------------------------------------------------------------------------
    // Equipos y cargas de puntaje
    // -------------------------------------------------------------------------

    /**
     * Registra un equipo en la categoría seleccionada.
     * En zona única (+60/+68) se incorpora automáticamente a la única zona.
     * @param {string} name
     * @param {string} [zoneId] Zona inicial opcional donde asignarlo (Modalidad A).
     */
    function createTeam(name, zoneId) {
      const category = requireCategory();
      const trimmed = String(name || '').trim();
      const single = tournament.isSingleZoneFormat(category);
      if (single) {
        ensure(category.currentStage === STAGES.ZONE_FINAL, 'La categoría ya finalizó.', 'STAGE_LOCKED');
      } else {
        ensure(tournament.initialZones(category).length, 'Primero tenés que crear al menos una zona.', 'NO_ZONES');
        ensure(category.currentStage === STAGES.GENERAL, 'No se pueden agregar equipos después de iniciar el torneo.', 'STAGE_LOCKED');
      }
      ensure(trimmed, 'El equipo necesita un nombre.', 'TEAM_NAME_REQUIRED');
      ensure(!teamsOf(category.id).some(function (t) { return t.name.toLowerCase() === trimmed.toLowerCase(); }), 'Ya existe un equipo con ese nombre en esta categoría.', 'DUPLICATE_TEAM');
      if (zoneId && !single) ensure(tournament.isInitialZone(category, zoneId), 'Zona inexistente.', 'ZONE_NOT_FOUND');
      return commit(function () {
        const c = categoryById(category.id);
        const team = { id: newId('team'), name: trimmed, categoryId: c.id, status: STATUS.ACTIVE, stage: single ? STAGES.ZONE_FINAL : STAGES.GENERAL, scoreEntries: [] };
        state.teams.push(team);
        if (single) tournament.finalZone(c).teamIds.push(team.id);
        else if (zoneId) tournament.zoneById(c, zoneId).teamIds.push(team.id);
        return team;
      });
    }

    /** Elimina un equipo SÓLO si no tiene resultados ni cargas (evita perder datos). */
    function deleteTeam(teamId) {
      const category = requireCategory();
      const team = teamById(teamId);
      ensure(team && team.categoryId === category.id, 'Equipo inválido para esta categoría.', 'TEAM_NOT_FOUND');
      ensure(!matchesOf(category.id).some(function (r) { return r.winnerId === teamId || r.loserId === teamId; }), 'No se puede eliminar un equipo con resultados registrados.', 'TEAM_HAS_RESULTS');
      ensure(!team.scoreEntries.length, 'No se puede eliminar un equipo con cargas de puntaje.', 'TEAM_HAS_SCORES');
      ensure(!tournament.flow(category).qualified.some(function (q) { return q.teamId === teamId; }), 'No se puede eliminar un equipo clasificado a la zona única.', 'TEAM_QUALIFIED');
      return commit(function () {
        const c = categoryById(category.id);
        tournament.flow(c).zones.forEach(function (zone) { zone.teamIds = zone.teamIds.filter(function (id) { return id !== teamId; }); });
        state.teams = state.teams.filter(function (t) { return t.id !== teamId; });
      });
    }

    function validateTeamForScore(teamId) {
      const category = requireCategory();
      const team = teamById(teamId);
      ensure(team && team.categoryId === category.id, 'Equipo inválido para esta categoría.', 'TEAM_NOT_FOUND');
      ensure(LOCKED_STATUSES.indexOf(team.status) < 0, 'Este equipo no puede recibir puntajes.', 'TEAM_LOCKED');
      ensure(category.currentStage !== STAGES.FINISHED, 'El torneo ya finalizó.', 'FINISHED');
      return { category, team };
    }

    function parsePoints(value, message) {
      const points = Number(value);
      ensure(Number.isInteger(points) && points >= 0, message, 'INVALID_POINTS');
      return points;
    }

    function createScoreEntry(teamId, value) {
      const found = validateTeamForScore(teamId);
      const points = parsePoints(value, 'El puntaje debe ser un número entero mayor o igual a 0.');
      return commit(function () {
        teamById(found.team.id).scoreEntries.push({ id: newId('score'), points, createdAt: now(), stage: found.category.currentStage });
      });
    }

    function addQuickScores(entries) {
      const category = requireCategory();
      const pending = [];
      entries.forEach(function (item) {
        if (item.value === '' || item.value === null || typeof item.value === 'undefined') return;
        const found = validateTeamForScore(item.teamId);
        const points = parsePoints(item.value, 'Cada puntaje debe ser un número entero mayor o igual a 0.');
        pending.push({ teamId: found.team.id, points });
      });
      ensure(pending.length, 'Ingresá al menos un puntaje para guardar.', 'NO_SCORES');
      return commit(function () {
        pending.forEach(function (item) {
          teamById(item.teamId).scoreEntries.push({ id: newId('score'), points: item.points, createdAt: now(), stage: category.currentStage });
        });
        return pending.length;
      });
    }

    function deleteScoreEntry(teamId, entryId) {
      const team = teamById(teamId);
      ensure(team && team.categoryId === state.selectedCategoryId, 'Carga inválida para esta categoría.', 'SCORE_NOT_FOUND');
      ensure(team.scoreEntries.some(function (e) { return e.id === entryId; }), 'La carga seleccionada no existe.', 'SCORE_NOT_FOUND');
      return commit(function () {
        const t = teamById(teamId);
        const index = t.scoreEntries.findIndex(function (e) { return e.id === entryId; });
        return t.scoreEntries.splice(index, 1)[0];
      }, 'No se pudo guardar la eliminación. La carga permanece intacta.');
    }

    // -------------------------------------------------------------------------
    // Zonas iniciales (Modalidad A)
    // -------------------------------------------------------------------------

    function requireZonesFormat(category) {
      ensure(!tournament.isSingleZoneFormat(category), 'Esta categoría usa una única zona (todos contra todos): no tiene zonas iniciales.', 'SINGLE_ZONE_FORMAT');
    }

    function requireFirstStageOpen(category, message) {
      ensure(category.currentStage === STAGES.GENERAL && tournament.flow(category).status !== ZONE_STATUS.FINISHED, message || 'La primera etapa ya fue cerrada.', 'STAGE_LOCKED');
    }

    function zoneHasResults(category, zoneId) {
      return matchesOf(category.id).some(function (r) { return r.zoneId === zoneId; });
    }

    function createZone(name) {
      const category = requireCategory();
      const trimmed = String(name || '').trim();
      requireZonesFormat(category);
      requireFirstStageOpen(category);
      ensure(trimmed, 'La zona necesita un nombre.', 'ZONE_NAME_REQUIRED');
      ensure(!tournament.flow(category).zones.some(function (z) { return z.name.toLowerCase() === trimmed.toLowerCase(); }), 'Ya existe una zona con ese nombre.', 'DUPLICATE_ZONE');
      return commit(function () {
        const f = tournament.flow(categoryById(category.id));
        const zone = { id: newId('zone'), name: trimmed, phase: constants.ZONE_PHASES.QUALIFYING, teamIds: [] };
        f.zones.push(zone);
        f.status = ZONE_STATUS.CONFIGURING;
        f.firstStageStatus = 'CONFIGURING';
        return zone;
      });
    }

    function renameZone(id, name) {
      const category = requireCategory();
      const trimmed = String(name || '').trim();
      ensure(tournament.zoneById(category, id), 'Zona inexistente.', 'ZONE_NOT_FOUND');
      ensure(trimmed, 'La zona necesita un nombre.', 'ZONE_NAME_REQUIRED');
      ensure(!tournament.flow(category).zones.some(function (z) { return z.id !== id && z.name.toLowerCase() === trimmed.toLowerCase(); }), 'Ya existe una zona con ese nombre.', 'DUPLICATE_ZONE');
      return commit(function () { tournament.zoneById(categoryById(category.id), id).name = trimmed; });
    }

    function assignTeamToZone(teamId, zoneId) {
      const category = requireCategory();
      const team = teamById(teamId);
      requireZonesFormat(category);
      ensure(team && team.categoryId === category.id && tournament.isInitialZone(category, zoneId), 'Equipo o zona inválidos.', 'INVALID_ASSIGNMENT');
      requireFirstStageOpen(category, 'La distribución ya fue cerrada.');
      const existing = tournament.teamInitialZone(category, teamId);
      if (existing && existing.id !== zoneId) {
        ensure(!zoneHasResults(category, existing.id) && !zoneHasResults(category, zoneId), 'No se puede mover el equipo después de registrar resultados en la zona. Primero corregí o eliminá esos resultados para mantener la clasificación consistente.', 'ZONE_HAS_RESULTS');
      }
      return commit(function () {
        const c = categoryById(category.id);
        const previous = tournament.teamInitialZone(c, teamId);
        if (previous && previous.id !== zoneId) previous.teamIds = previous.teamIds.filter(function (id) { return id !== teamId; });
        const zone = tournament.zoneById(c, zoneId);
        if (zone.teamIds.indexOf(teamId) < 0) zone.teamIds.push(teamId);
      });
    }

    function removeTeamFromZone(teamId, zoneId) {
      const category = requireCategory();
      requireZonesFormat(category);
      ensure(tournament.isInitialZone(category, zoneId), 'Zona inexistente.', 'ZONE_NOT_FOUND');
      ensure(category.currentStage === STAGES.GENERAL, 'No se puede modificar una etapa cerrada.', 'STAGE_LOCKED');
      ensure(!zoneHasResults(category, zoneId), 'No se puede quitar un equipo de una zona con resultados. Primero corregí o eliminá esos resultados para mantener la clasificación consistente.', 'ZONE_HAS_RESULTS');
      return commit(function () {
        const zone = tournament.zoneById(categoryById(category.id), zoneId);
        zone.teamIds = zone.teamIds.filter(function (id) { return id !== teamId; });
      });
    }

    /** Elimina una zona inicial y sus resultados (la UI pide confirmación explícita). */
    function deleteZone(id) {
      const category = requireCategory();
      const zone = tournament.zoneById(category, id);
      ensure(zone && tournament.isInitialZone(category, id), 'No se puede eliminar esta zona.', 'ZONE_NOT_FOUND');
      requireFirstStageOpen(category);
      return commit(function () {
        const c = categoryById(category.id);
        const f = tournament.flow(c);
        const affected = matchesOf(c.id).filter(function (r) { return r.zoneId === id; }).length;
        const teamCount = tournament.zoneById(c, id).teamIds.length;
        f.zones = f.zones.filter(function (z) { return z.id !== id; });
        f.tieBreaks = f.tieBreaks.filter(function (t) { return t.scope !== tournament.scopeKey(STAGES.GENERAL, id); });
        state.matchResults = state.matchResults.filter(function (r) { return r.zoneId !== id; });
        f.status = f.zones.length ? ZONE_STATUS.IN_PROGRESS : ZONE_STATUS.CONFIGURING;
        return { teams: teamCount, results: affected };
      });
    }

    // -------------------------------------------------------------------------
    // Zona única (Modalidad A): confirmación y reconciliación de clasificados
    // -------------------------------------------------------------------------

    /**
     * Cierra la primera etapa y crea la zona única con los 2 primeros de cada zona.
     * No traslada resultados: la zona única empieza su propia tabla desde cero.
     */
    function confirmZones() {
      const category = requireCategory();
      requireZonesFormat(category);
      ensure(category.currentStage === STAGES.GENERAL, 'La primera etapa ya fue cerrada.', 'STAGE_LOCKED');
      const result = qualification(category.id);
      if (!result.ready) throw new DomainError(result.issues.join(' '), 'QUALIFICATION_NOT_READY');
      return commit(function () {
        const c = categoryById(category.id);
        const f = tournament.flow(c);
        const qualifiedIds = result.qualifiers.map(function (q) { return q.teamId; });
        const second = { id: newId('zone'), name: constants.SECOND_STAGE_ZONE_NAME, phase: constants.ZONE_PHASES.FINAL, teamIds: qualifiedIds.slice() };
        f.qualified = result.qualifiers.map(function (q) { return Object.assign({}, q); });
        f.zones.push(second);
        f.secondStageZoneId = second.id;
        f.status = ZONE_STATUS.IN_PROGRESS;
        f.firstStageStatus = 'FINISHED';
        f.secondStageStatus = 'IN_PROGRESS';
        f.confirmedAt = now();
        c.currentStage = STAGES.ZONE_FINAL;
        teamsOf(c.id).forEach(function (t) {
          if (qualifiedIds.indexOf(t.id) >= 0) { t.status = STATUS.QUALIFIED; t.stage = STAGES.ZONE_FINAL; } else t.status = STATUS.ELIMINATED;
        });
        return f.qualified.slice();
      });
    }

    /** Qué pasaría al actualizar los clasificados según los resultados actuales. */
    function previewReconcile() {
      const category = requireCategory();
      const drift = qualificationDrift(category.id);
      if (!drift.applicable || !drift.determinable || !drift.changed) return Object.assign({ toArchive: 0, toRestore: 0 }, drift);
      const zone = tournament.finalZone(category);
      const nextIds = drift.qualifiers.map(function (q) { return q.teamId; });
      let toArchive = 0;
      let toRestore = 0;
      matchesOf(category.id).forEach(function (r) {
        if (r.stage !== STAGES.ZONE_FINAL || r.zoneId !== zone.id) return;
        const inside = nextIds.indexOf(r.winnerId) >= 0 && nextIds.indexOf(r.loserId) >= 0;
        if (!inside && !r.archived) toArchive += 1;
        if (inside && r.archived && r.archivedReason === ARCHIVE_REASONS.QUALIFICATION_CHANGE) toRestore += 1;
      });
      return Object.assign({ toArchive, toRestore }, drift);
    }

    /**
     * Actualiza los clasificados confirmados para que coincidan con la primera
     * etapa. Los resultados de zona única de equipos que salen se ARCHIVAN (no se
     * borran) y se restauran si el equipo vuelve a clasificar.
     */
    function reconcileQualifiers() {
      const category = requireCategory();
      const preview = previewReconcile();
      ensure(preview.applicable, 'Esta categoría no tiene clasificados confirmados para actualizar.', 'NOT_APPLICABLE');
      ensure(preview.determinable, 'No se pueden recalcular los clasificados: ' + preview.issues.join(' '), 'QUALIFICATION_NOT_READY');
      ensure(preview.changed, 'Los clasificados confirmados ya coinciden con los resultados.', 'NO_CHANGES');
      return commit(function () {
        const c = categoryById(category.id);
        const f = tournament.flow(c);
        const zone = tournament.finalZone(c);
        const nextIds = preview.qualifiers.map(function (q) { return q.teamId; });
        zone.teamIds = nextIds.slice();
        f.qualified = preview.qualifiers.map(function (q) { return Object.assign({}, q); });
        f.qualificationUpdatedAt = now();
        teamsOf(c.id).forEach(function (t) {
          if (nextIds.indexOf(t.id) >= 0) { t.status = STATUS.QUALIFIED; t.stage = STAGES.ZONE_FINAL; } else if (t.status === STATUS.QUALIFIED) t.status = STATUS.ELIMINATED;
        });
        matchesOf(c.id).forEach(function (r) {
          if (r.stage !== STAGES.ZONE_FINAL || r.zoneId !== zone.id) return;
          const inside = nextIds.indexOf(r.winnerId) >= 0 && nextIds.indexOf(r.loserId) >= 0;
          if (!inside && !r.archived) {
            r.archived = true;
            r.archivedReason = ARCHIVE_REASONS.QUALIFICATION_CHANGE;
            r.archivedAt = now();
          } else if (inside && r.archived && r.archivedReason === ARCHIVE_REASONS.QUALIFICATION_CHANGE) {
            delete r.archived; delete r.archivedReason; delete r.archivedAt;
          }
        });
        return { outgoing: preview.outgoing, incoming: preview.incoming, archived: preview.toArchive, restored: preview.toRestore };
      });
    }

    // -------------------------------------------------------------------------
    // Empates: resolución manual explícita
    // -------------------------------------------------------------------------

    /** Empates actuales (sin aplicar resoluciones) de un ámbito "ETAPA|zona". */
    function rawTies(category, scope) {
      const parts = String(scope || '').split('|');
      const zone = tournament.zoneById(category, parts[1]);
      ensure(zone && tournament.stageForZone(category, zone.id) === parts[0], 'Ámbito de empate inválido.', 'INVALID_SCOPE');
      const ctx = context(category.id);
      const rows = standingsLib.computeStandings(tournament.zoneTeams(ctx, zone), tournament.scopeMatches(ctx, parts[0], zone.id), { scoreStage: parts[0] });
      return standingsLib.rankWithTies(rows, []).ties;
    }

    /**
     * Registra el orden decidido manualmente para un grupo empatado.
     * @param {string} scope "ETAPA|zoneId"
     * @param {string[]} order Ids de los equipos empatados, en el orden elegido.
     */
    function resolveTie(scope, order) {
      const category = requireCategory();
      const ids = Array.isArray(order) ? order.slice() : [];
      ensure(ids.length >= 2 && new Set(ids).size === ids.length, 'Indicá un orden sin repetir equipos.', 'INVALID_ORDER');
      const ties = rawTies(category, scope);
      const sorted = ids.slice().sort().join(',');
      const tie = ties.filter(function (t) { return t.teamIds.slice().sort().join(',') === sorted; })[0];
      ensure(tie, 'Esos equipos no están empatados con los resultados actuales.', 'TIE_NOT_FOUND');
      return commit(function () {
        const f = tournament.flow(categoryById(category.id));
        const liveSignatures = ties.map(function (t) { return t.signature; });
        f.tieBreaks = f.tieBreaks.filter(function (item) {
          return item.scope !== scope || (item.signature !== tie.signature && liveSignatures.indexOf(item.signature) >= 0);
        });
        f.tieBreaks.push({ scope, signature: tie.signature, order: ids, createdAt: now() });
      });
    }

    function clearTieResolution(scope, signature) {
      const category = requireCategory();
      return commit(function () {
        const f = tournament.flow(categoryById(category.id));
        f.tieBreaks = f.tieBreaks.filter(function (item) { return !(item.scope === scope && item.signature === signature); });
      });
    }

    // -------------------------------------------------------------------------
    // Resultados (carga manual)
    // -------------------------------------------------------------------------

    /**
     * Determina etapa y zona de un nuevo resultado.
     * - Primera etapa: zona inicial obligatoria.
     * - Zona final / única: por defecto la zona final/única. En Modalidad A también se acepta
     *   una zona inicial como CORRECCIÓN de la primera etapa.
     */
    function resolveTarget(category, zoneId) {
      const f = tournament.flow(category);
      if (!f.zones.length) return { stage: category.currentStage, zone: null, correction: false };
      if (category.currentStage === STAGES.GENERAL) {
        const zone = zoneId ? tournament.zoneById(category, zoneId) : null;
        ensure(zone && tournament.isInitialZone(category, zone.id), 'Ambos equipos deben pertenecer a la misma zona.', 'ZONE_REQUIRED');
        return { stage: STAGES.GENERAL, zone, correction: false };
      }
      const target = zoneId ? tournament.zoneById(category, zoneId) : tournament.finalZone(category);
      ensure(target, 'El resultado debe pertenecer a la zona final.', 'ZONE_REQUIRED');
      if (target.id === f.secondStageZoneId) return { stage: STAGES.ZONE_FINAL, zone: target, correction: false };
      ensure(!tournament.isSingleZoneFormat(category) && tournament.isInitialZone(category, target.id), 'El resultado debe pertenecer a la zona final.', 'ZONE_REQUIRED');
      return { stage: STAGES.GENERAL, zone: target, correction: true };
    }

    function validateNewMatch(category, winnerId, loserId, score, sets, zoneId) {
      const winner = teamById(winnerId);
      const loser = teamById(loserId);
      ensure(category.currentStage !== STAGES.FINISHED, 'El torneo ya finalizó.', 'FINISHED');
      ensure(winner && loser && winner.categoryId === category.id && loser.categoryId === category.id && winner.id !== loser.id, 'Los equipos deben pertenecer a la categoría activa y ser diferentes.', 'INVALID_TEAMS');
      ensure(scoring.isValidScore(score), 'El resultado debe ser 2–0 o 2–1.', 'INVALID_SCORE');
      const target = resolveTarget(category, zoneId);
      if (target.zone) {
        const isFinal = target.stage === STAGES.ZONE_FINAL;
        ensure(target.zone.teamIds.indexOf(winner.id) >= 0 && target.zone.teamIds.indexOf(loser.id) >= 0,
          isFinal ? 'Ambos equipos deben integrar la zona única.' : 'Ambos equipos deben pertenecer a la misma zona.', 'TEAMS_NOT_IN_ZONE');
      }
      if (!target.correction) {
        ensure(LOCKED_STATUSES.indexOf(winner.status) < 0 && LOCKED_STATUSES.indexOf(loser.status) < 0, 'Solo pueden registrar resultados los equipos activos.', 'TEAM_LOCKED');
      }
      const zoneKey = target.zone ? target.zone.id : null;
      const duplicate = tournament.liveMatches(matchesOf(category.id)).some(function (r) {
        return r.stage === target.stage && r.zoneId === zoneKey && tournament.pairKey(r.winnerId, r.loserId) === tournament.pairKey(winner.id, loser.id);
      });
      ensure(!duplicate, 'Ese cruce ya tiene un resultado. Usá “Corregir” para modificarlo.', 'DUPLICATE_MATCH');
      const normalizedSets = typeof sets === 'undefined' ? [] : scoring.validateMatchSets(sets);
      scoring.ensureScoreMatchesSets(score, normalizedSets);
      return { stage: target.stage, zoneId: zoneKey, sets: normalizedSets, correction: target.correction };
    }

    function pushMatch(categoryId, winnerId, loserId, score, validated) {
      const match = { id: newId('match'), categoryId, winnerId, loserId, score, sets: validated.sets, stage: validated.stage, zoneId: validated.zoneId, createdAt: now() };
      state.matchResults.push(match);
      return match;
    }

    /** Registra un resultado manual (ganador, perdedor, "2-0"|"2-1", sets opcionales). */
    function createMatchResult(winnerId, loserId, score, sets, zoneId) {
      const category = requireCategory();
      const validated = validateNewMatch(category, winnerId, loserId, score, sets, zoneId);
      return commit(function () { return pushMatch(category.id, winnerId, loserId, score, validated); }, 'No se pudo guardar el resultado.');
    }

    /** Orienta sets cargados como "equipo 1 – equipo 2" hacia el ganador. */
    function orientSets(teamAWins, setScores) {
      return setScores.map(function (set) {
        const x = Number(set.a);
        const y = Number(set.b);
        return teamAWins ? { a: x, b: y } : { a: y, b: x };
      });
    }

    function parseSetsInput(setsA, setsB, setScores) {
      const resolved = scoring.resolveSetsWon(setsA, setsB);
      if (typeof setScores === 'undefined') return { resolved, sets: undefined };
      const list = Array.isArray(setScores) ? setScores : [];
      ensure(list.length, 'Ingresá los marcadores reales de cada set.', 'SETS_REQUIRED');
      ensure(list.length === resolved.totalSets, 'La cantidad de marcadores debe coincidir con los sets ganados.', 'SETS_COUNT');
      return { resolved, sets: orientSets(resolved.teamAWins, list) };
    }

    /** Registra un resultado a partir de sets ganados por equipo (2-0, 2-1, 1-2, 0-2). */
    function createMatchFromSets(teamAId, setsA, teamBId, setsB, setScores, zoneId) {
      const parsed = parseSetsInput(setsA, setsB, setScores);
      const winner = parsed.resolved.teamAWins ? teamAId : teamBId;
      const loser = parsed.resolved.teamAWins ? teamBId : teamAId;
      return createMatchResult(winner, loser, parsed.resolved.score, parsed.sets, zoneId);
    }

    function requireEditableMatch(matchId) {
      const match = matchById(matchId);
      ensure(match && match.categoryId === state.selectedCategoryId, 'Resultado inválido para esta categoría.', 'MATCH_NOT_FOUND');
      return match;
    }

    function applyMatchUpdate(match, winnerId, loserId, score, sets) {
      ensure(!match.archived, 'Este resultado está archivado por un cambio de clasificados. Eliminalo o volvé a clasificar al equipo.', 'MATCH_ARCHIVED');
      ensure(scoring.isValidScore(score), 'El resultado debe ser 2–0 o 2–1.', 'INVALID_SCORE');
      let normalizedSets = match.sets;
      if (typeof sets !== 'undefined') {
        normalizedSets = scoring.validateMatchSets(sets);
        scoring.ensureScoreMatchesSets(score, normalizedSets);
      }
      match.winnerId = winnerId;
      match.loserId = loserId;
      match.score = score;
      match.sets = normalizedSets;
      match.updatedAt = now();
    }

    /** Corrige el resultado tradicional (y opcionalmente los sets) manteniendo ganador. */
    function updateMatchResult(matchId, score, sets) {
      const match = requireEditableMatch(matchId);
      return commit(function () {
        const m = matchById(match.id);
        applyMatchUpdate(m, m.winnerId, m.loserId, score, sets);
      }, 'No se pudo guardar la corrección.');
    }

    /**
     * Corrige un resultado permitiendo invertir el ganador.
     * `teamAId` debe ser uno de los dos equipos del partido.
     */
    function updateMatchFromSets(matchId, teamAId, setsA, setsB, setScores) {
      const match = requireEditableMatch(matchId);
      ensure(teamAId === match.winnerId || teamAId === match.loserId, 'El equipo indicado no participa de este resultado.', 'INVALID_TEAMS');
      const teamBId = teamAId === match.winnerId ? match.loserId : match.winnerId;
      const parsed = parseSetsInput(setsA, setsB, setScores);
      const winner = parsed.resolved.teamAWins ? teamAId : teamBId;
      const loser = parsed.resolved.teamAWins ? teamBId : teamAId;
      return commit(function () {
        applyMatchUpdate(matchById(match.id), winner, loser, parsed.resolved.score, parsed.sets);
      }, 'No se pudo guardar la corrección.');
    }

    function deleteMatchResult(matchId) {
      requireEditableMatch(matchId);
      return commit(function () {
        state.matchResults = state.matchResults.filter(function (r) { return r.id !== matchId; });
      }, 'No se pudo guardar la eliminación.');
    }

    /**
     * Simula un cambio sobre un resultado y responde si alteraría a los
     * clasificados ya confirmados de la zona única. No guarda nada.
     * @param {'update'|'updateFromSets'|'delete'|'createFromSets'} kind
     * @param {Array} args Mismos argumentos que el caso de uso correspondiente.
     */
    function previewQualificationImpact(kind, args) {
      const category = requireCategory();
      const before = qualificationDrift(category.id);
      if (!before.applicable) return { affectsQualification: false, before, after: before };
      const actions = {
        update: function () { const m = requireEditableMatch(args[0]); applyMatchUpdate(m, m.winnerId, m.loserId, args[1], args[2]); },
        updateFromSets: function () {
          const m = requireEditableMatch(args[0]);
          const teamB = args[1] === m.winnerId ? m.loserId : m.winnerId;
          const parsed = parseSetsInput(args[2], args[3], args[4]);
          applyMatchUpdate(m, parsed.resolved.teamAWins ? args[1] : teamB, parsed.resolved.teamAWins ? teamB : args[1], parsed.resolved.score, parsed.sets);
        },
        delete: function () { requireEditableMatch(args[0]); state.matchResults = state.matchResults.filter(function (r) { return r.id !== args[0]; }); },
        createFromSets: function () {
          const parsed = parseSetsInput(args[1], args[3], args[4]);
          const winner = parsed.resolved.teamAWins ? args[0] : args[2];
          const loser = parsed.resolved.teamAWins ? args[2] : args[0];
          pushMatch(category.id, winner, loser, parsed.resolved.score, validateNewMatch(category, winner, loser, parsed.resolved.score, parsed.sets, args[5]));
        }
      };
      ensure(actions[kind], 'Operación desconocida.', 'UNKNOWN_OPERATION');
      const after = simulate(actions[kind], function () { return qualificationDrift(category.id); });
      const affects = after.changed !== before.changed || after.determinable !== before.determinable ||
        after.outgoing.join(',') !== before.outgoing.join(',') || after.incoming.join(',') !== before.incoming.join(',');
      return { affectsQualification: affects, before, after };
    }

    return Object.freeze({
      // consultas
      getState, rawState, categoryById, selectedCategory, teamsOf, teamById, matchById, matchesOf, activeTeams,
      categoryEntries, context, standings, zoneRanking, zoneProgress, qualification, finalClassification,
      qualificationDrift, phase, previewReconcile, previewQualificationImpact,
      // categorías y preferencias
      selectCategory, setTheme, createCategory, editCategory, deleteCategory, convertToSingleZone,
      // equipos y cargas
      createTeam, deleteTeam, createScoreEntry, addQuickScores, deleteScoreEntry,
      // zonas
      createZone, renameZone, assignTeamToZone, removeTeamFromZone, deleteZone,
      // zona única y empates
      confirmZones, reconcileQualifiers, resolveTie, clearTieResolution,
      // resultados
      createMatchResult, createMatchFromSets, updateMatchResult, updateMatchFromSets, deleteMatchResult,
      // persistencia
      reload: function () { state = repository.load(); return getState(); },
      save: function () { return repository.save(state); }
    });
  }

  return Object.freeze({ createTournamentService });
}));
