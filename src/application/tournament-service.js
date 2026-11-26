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
      const ctx = context(categoryId);
      const matches = zoneId && ctx && stage
        ? tournament.scopeMatches(ctx, stage, zoneId)
        : tournament.liveMatches(matchesOf(categoryId)).filter(function (r) {
          return (!stage || r.stage === stage) && (!zoneId || r.zoneId === zoneId);
        });
      const options = { scoreStage: stage };
      if (category && tournament.isFinalAccumulatedScope(category, stage, zoneId)) {
        options.baselineByTeamId = tournament.qualifiedBaselineMap(ctx);
      }
      return standingsLib.computeStandings(teams, matches, options);
    }

    /** Puntos de clasificación acumulados por un equipo según el sistema 3-3-2-1. */
    function classificationPoints(teamId, stage, zoneId) {
      const team = teamById(teamId);
      if (!team) return 0;
      const category = categoryById(team.categoryId);
      const ctx = context(team.categoryId);
      const matches = zoneId && ctx && stage
        ? tournament.scopeMatches(ctx, stage, zoneId)
        : tournament.liveMatches(matchesOf(team.categoryId)).filter(function (r) {
          return (!stage || r.stage === stage) && (!zoneId || r.zoneId === zoneId);
        });
      let total = standingsLib.classificationPointsFor(team.id, matches);
      if (category && tournament.isFinalAccumulatedScope(category, stage, zoneId)) {
        const baseline = tournament.qualifiedBaselineMap(ctx)[team.id];
        if (baseline) total += baseline.classificationPoints;
      }
      return total;
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
    function interzonalStatus(categoryId) { return tournament.interzonalStatus(context(categoryId)); }
    function playoffs(categoryId) { return tournament.computePlayoffs(context(categoryId)); }
    function finalStandings(categoryId) { return tournament.computeFinalStandings(context(categoryId)); }
    function fixture(categoryId, zoneId) {
      const cid = categoryId || state.selectedCategoryId;
      const ctx = context(cid);
      if (!ctx) return null;
      const zone = zoneId ? tournament.zoneById(ctx.category, zoneId) : tournament.finalZone(ctx.category);
      return tournament.computeZoneFixture(ctx, zone);
    }

    function syncZoneFixtureForCategory(category, zone) {
      if (!category || !zone) return;
      const minTeams = tournament.isTorneo68(category) ? 4 : 2;
      if (tournament.isTorneo68(category)) {
        if (zone.teamIds.length >= minTeams) {
          zone.fixture = tournament.buildRoundRobinFixture(zone.teamIds);
        } else {
          delete zone.fixture;
        }
      } else if (zone.fixture) {
        if (zone.teamIds.length >= minTeams) {
          zone.fixture = tournament.buildRoundRobinFixture(zone.teamIds);
        } else {
          delete zone.fixture;
        }
      }
    }

    function generateFixture(zoneId) {
      const category = requireCategory();
      const targetZone = zoneId ? tournament.zoneById(category, zoneId) : tournament.finalZone(category);
      ensure(targetZone, 'Zona inexistente para generar el fixture.', 'ZONE_NOT_FOUND');
      const minTeams = tournament.isTorneo68(category) ? 4 : 2;
      ensure(
        targetZone.teamIds.length >= minTeams,
        'Se requieren al menos ' + minTeams + ' equipos registrados para generar el torneo (actualmente hay ' + targetZone.teamIds.length + ').',
        'INSUFFICIENT_TEAMS'
      );
      commit(function () {
        const c = categoryById(category.id);
        const z = tournament.zoneById(c, targetZone.id);
        z.fixture = tournament.buildRoundRobinFixture(z.teamIds);
      });
      return fixture(category.id, targetZone.id);
    }

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

    function normalizeRequestedFormat(name, format) {
      if (format === FORMATS.TORNEO_50 || format === FORMATS.TORNEO_60 || format === FORMATS.TORNEO_68) return format;
      if (format === FORMATS.ZONES_AND_FINAL || format === 'ZONES') return FORMATS.ZONES_AND_FINAL;
      if (format === FORMATS.ROUND_ROBIN || format === 'SINGLE_ZONE') return FORMATS.ROUND_ROBIN;
      return tournament.inferFormat(name);
    }

    /**
     * Crea una categoría. Si no se indica modalidad se infiere del nombre.
     * Soporta formatos del 5° Torneo (+50, +60, +68) y genéricos (+40 / zona única).
     */
    function createCategory(name, format, opts) {
      const trimmed = String(name || '').trim();
      ensure(trimmed, 'La categoría necesita un nombre.', 'CATEGORY_NAME_REQUIRED');
      const chosen = normalizeRequestedFormat(trimmed, format);
      return commit(function () {
        const category = { id: newId('cat'), name: trimmed, format: chosen, currentStage: STAGES.GENERAL, championId: null, runnerUpId: null, zoneTournament: tournament.emptyZoneTournament() };
        if (chosen === FORMATS.ROUND_ROBIN || chosen === FORMATS.TORNEO_68) {
          const singleZone = { id: newId('zone'), code: 'U', name: constants.SINGLE_ZONE_NAME, phase: constants.ZONE_PHASES.FINAL, teamIds: [] };
          category.currentStage = STAGES.ZONE_FINAL;
          category.zoneTournament = tournament.singleZoneTournament(singleZone);
          if (chosen === FORMATS.TORNEO_68 && opts && opts.preloadTeams68) {
            constants.DEFAULT_TEAMS_68.forEach(function (teamName) {
              const team = { id: newId('team'), name: teamName, categoryId: category.id, status: STATUS.ACTIVE, stage: STAGES.ZONE_FINAL, scoreEntries: [] };
              state.teams.push(team);
              singleZone.teamIds.push(team.id);
            });
            syncZoneFixtureForCategory(category, singleZone);
          }
        } else if (chosen === FORMATS.TORNEO_50) {
          category.zoneTournament.zones = tournament.TORNEO_50_SPEC.map(function (spec) {
            return { id: newId('zone'), code: spec.code, name: spec.name, phase: constants.ZONE_PHASES.QUALIFYING, targetTeams: spec.targetTeams, teamIds: [] };
          });
          category.zoneTournament.status = ZONE_STATUS.IN_PROGRESS;
          category.zoneTournament.firstStageStatus = 'IN_PROGRESS';
        } else if (chosen === FORMATS.TORNEO_60) {
          category.zoneTournament.zones = tournament.TORNEO_60_SPEC.map(function (spec) {
            return { id: newId('zone'), code: spec.code, name: spec.name, phase: constants.ZONE_PHASES.QUALIFYING, targetTeams: spec.targetTeams, teamIds: [] };
          });
          category.zoneTournament.status = ZONE_STATUS.IN_PROGRESS;
          category.zoneTournament.firstStageStatus = 'IN_PROGRESS';
        }
        state.categories.push(category);
        state.selectedCategoryId = category.id;
        return category;
      });
    }

    function preloadTeams68() {
      const category = requireCategory();
      ensure(tournament.isTorneo68(category), 'Esta opción aplica únicamente a Categoría +68.', 'INVALID_FORMAT');
      const zone = tournament.finalZone(category);
      ensure(zone && zone.teamIds.length === 0, 'Ya hay equipos cargados en la Zona única.', 'ZONE_NOT_EMPTY');
      return commit(function () {
        const c = categoryById(category.id);
        const z = tournament.finalZone(c);
        const created = constants.DEFAULT_TEAMS_68.map(function (teamName) {
          const team = { id: newId('team'), name: teamName, categoryId: c.id, status: STATUS.ACTIVE, stage: STAGES.ZONE_FINAL, scoreEntries: [] };
          state.teams.push(team);
          z.teamIds.push(team.id);
          return team;
        });
        syncZoneFixtureForCategory(c, z);
        return created;
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
        const fZone = tournament.finalZone(category);
        const cap = tournament.zoneTargetTeams(category, fZone);
        if (cap) ensure(fZone.teamIds.length < cap, fZone.name + ' admite exactamente ' + cap + ' equipos.', 'ZONE_FULL');
      } else {
        ensure(tournament.initialZones(category).length, 'Primero tenés que crear al menos una zona.', 'NO_ZONES');
        ensure(category.currentStage === STAGES.GENERAL, 'No se pueden agregar equipos después de iniciar el torneo.', 'STAGE_LOCKED');
      }
      ensure(trimmed, 'El equipo necesita un nombre.', 'TEAM_NAME_REQUIRED');
      ensure(!teamsOf(category.id).some(function (t) { return t.name.toLowerCase() === trimmed.toLowerCase(); }), 'Ya existe un equipo con ese nombre en esta categoría.', 'DUPLICATE_TEAM');
      if (zoneId && !single) {
        ensure(tournament.isInitialZone(category, zoneId), 'Zona inexistente.', 'ZONE_NOT_FOUND');
        const targetZone = tournament.zoneById(category, zoneId);
        const cap = tournament.zoneTargetTeams(category, targetZone);
        if (cap) ensure(targetZone.teamIds.length < cap, targetZone.name + ' ya completó su cupo de ' + cap + ' equipos.', 'ZONE_FULL');
      }
      return commit(function () {
        const c = categoryById(category.id);
        const team = { id: newId('team'), name: trimmed, categoryId: c.id, status: STATUS.ACTIVE, stage: single ? STAGES.ZONE_FINAL : STAGES.GENERAL, scoreEntries: [] };
        state.teams.push(team);
        if (single) {
          const fz = tournament.finalZone(c);
          fz.teamIds.push(team.id);
          syncZoneFixtureForCategory(c, fz);
        } else if (zoneId) {
          const tz = tournament.zoneById(c, zoneId);
          tz.teamIds.push(team.id);
          syncZoneFixtureForCategory(c, tz);
        }
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
        tournament.flow(c).zones.forEach(function (zone) {
          zone.teamIds = zone.teamIds.filter(function (id) { return id !== teamId; });
          syncZoneFixtureForCategory(c, zone);
        });
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

    function teamHasInterzonalAssignment(category, teamId) {
      if (!tournament.isTorneo50(category)) return false;
      return tournament.interzonalSlots(category).some(function (s) {
        return s.teamCId === teamId || s.teamDId === teamId;
      });
    }

    function createZone(name) {
      const category = requireCategory();
      const trimmed = String(name || '').trim();
      requireZonesFormat(category);
      ensure(!tournament.isTorneo50(category) && !tournament.isTorneo60(category), 'Esta categoría ya tiene sus zonas oficiales definidas por reglamento.', 'FIXED_ZONES');
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
      const targetZone = tournament.zoneById(category, zoneId);
      const cap = tournament.zoneTargetTeams(category, targetZone);
      if (cap && targetZone.teamIds.indexOf(teamId) < 0) {
        ensure(targetZone.teamIds.length < cap, targetZone.name + ' ya completó su cupo de ' + cap + ' equipos.', 'ZONE_FULL');
      }
      const existing = tournament.teamInitialZone(category, teamId);
      if (existing && existing.id !== zoneId) {
        ensure(!teamHasInterzonalAssignment(category, teamId), 'No se puede cambiar de zona a un equipo que ya tiene cruce Interzonal C-D asignado. Limpiá primero ese cruce.', 'TEAM_IN_INTERZONAL');
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
      ensure(!teamHasInterzonalAssignment(category, teamId), 'No se puede quitar un equipo que tiene cruce Interzonal C-D asignado. Limpiá primero ese cruce.', 'TEAM_IN_INTERZONAL');
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
      ensure(!tournament.isTorneo50(category) && !tournament.isTorneo60(category), 'No se pueden eliminar las zonas reglamentarias de esta categoría.', 'FIXED_ZONES');
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
    // Selector Interzonal C-D (Categoría +50)
    // -------------------------------------------------------------------------

    function setInterzonalPair(slot, teamCId, teamDId, options) {
      const category = requireCategory();
      ensure(tournament.isTorneo50(category), 'El selector Interzonal C-D solo aplica a Categoría +50.', 'INVALID_FORMAT');
      requireFirstStageOpen(category, 'No se puede modificar el Interzonal C-D porque la Fase 1 ya fue cerrada.');
      const slotNum = Number(slot);
      ensure(slotNum === 1 || slotNum === 2 || slotNum === 3, 'El enfrentamiento interzonal debe ser 1, 2 o 3.', 'INVALID_SLOT');
      ensure(teamCId && teamDId, 'No se pueden guardar enfrentamientos incompletos. Seleccioná un equipo de Zona C y uno de Zona D.', 'INCOMPLETE_INTERZONAL');
      const { zoneC, zoneD } = tournament.interzonalZones(category);
      ensure(zoneC && zoneD, 'Deben existir Zona C y Zona D.', 'ZONES_NOT_FOUND');
      ensure(teamCId !== teamDId, 'No podés seleccionar al mismo equipo.', 'INVALID_TEAMS');
      const teamCInC = zoneC.teamIds.indexOf(teamCId) >= 0;
      const teamDInD = zoneD.teamIds.indexOf(teamDId) >= 0;
      ensure(teamCInC && teamDInD, 'Cada cruce debe enfrentar un equipo de Zona C contra un equipo de Zona D (no equipos de la misma zona).', 'INVALID_INTERZONAL_ZONES');

      const currentSlots = tournament.interzonalSlots(category);
      const duplicateC = currentSlots.some(function (s) { return s.slot !== slotNum && s.teamCId === teamCId; });
      const duplicateD = currentSlots.some(function (s) { return s.slot !== slotNum && s.teamDId === teamDId; });
      ensure(!duplicateC && !duplicateD, 'No se pueden repetir equipos en enfrentamientos diferentes.', 'DUPLICATE_INTERZONAL_TEAM');

      const ctx = context(category.id);
      const existingSlot = currentSlots.filter(function (s) { return s.slot === slotNum; })[0];
      const existingMatch = existingSlot && existingSlot.teamCId && existingSlot.teamDId
        ? tournament.interzonalMatchForSlot(ctx, slotNum, existingSlot)
        : null;
      const changed = !existingSlot || existingSlot.teamCId !== teamCId || existingSlot.teamDId !== teamDId;
      if (existingMatch && changed && !(options && options.force)) {
        throw new DomainError('Este enfrentamiento ya tiene un resultado cargado. Confirmá el cambio para eliminar el resultado anterior.', 'INTERZONAL_HAS_RESULT');
      }

      return commit(function () {
        const c = categoryById(category.id);
        const f = tournament.flow(c);
        const nextSlots = tournament.interzonalSlots(c).map(function (s) {
          return s.slot === slotNum ? { slot: slotNum, teamCId, teamDId } : s;
        });
        f.interzonals = nextSlots;
        if (existingMatch && changed) {
          state.matchResults = state.matchResults.filter(function (r) { return r.id !== existingMatch.id; });
        }
        return nextSlots[slotNum - 1];
      });
    }

    function clearInterzonalPair(slot, options) {
      const category = requireCategory();
      ensure(tournament.isTorneo50(category), 'El selector Interzonal C-D solo aplica a Categoría +50.', 'INVALID_FORMAT');
      requireFirstStageOpen(category, 'No se puede modificar el Interzonal C-D porque la Fase 1 ya fue cerrada.');
      const slotNum = Number(slot);
      ensure(slotNum === 1 || slotNum === 2 || slotNum === 3, 'El enfrentamiento interzonal debe ser 1, 2 o 3.', 'INVALID_SLOT');
      const currentSlots = tournament.interzonalSlots(category);
      const existingSlot = currentSlots.filter(function (s) { return s.slot === slotNum; })[0];
      const existingMatch = existingSlot && existingSlot.teamCId && existingSlot.teamDId
        ? tournament.interzonalMatchForSlot(context(category.id), slotNum, existingSlot)
        : null;
      if (existingMatch && !(options && options.force)) {
        throw new DomainError('Este enfrentamiento ya tiene un resultado cargado. Confirmá para limpiar el cruce y eliminar su resultado.', 'INTERZONAL_HAS_RESULT');
      }
      return commit(function () {
        const c = categoryById(category.id);
        const f = tournament.flow(c);
        f.interzonals = tournament.interzonalSlots(c).map(function (s) {
          return s.slot === slotNum ? { slot: slotNum, teamCId: null, teamDId: null } : s;
        });
        if (existingMatch) {
          state.matchResults = state.matchResults.filter(function (r) { return r.id !== existingMatch.id; });
        }
      });
    }

    // -------------------------------------------------------------------------
    // Zona única (Modalidad A): confirmación y reconciliación de clasificados
    // -------------------------------------------------------------------------

    /**
     * Cierra la primera etapa y crea las zonas de Segunda Fase (+40: Zona final; +50: Zonas 1-3; +60: Zonas 1-6),
     * transfiriendo las estadísticas acumuladas de la fase de grupos sin duplicar partidos.
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
        const createdZones = result.secondStageAllocations.map(function (spec) {
          const z = {
            id: newId('zone'),
            code: spec.code,
            name: spec.name,
            phase: spec.phase,
            teamIds: spec.teamIds.slice()
          };
          if (spec.targetTeams) z.targetTeams = spec.targetTeams;
          f.zones.push(z);
          return z;
        });
        f.qualified = result.qualifiers.map(function (q) {
          return {
            teamId: q.teamId,
            sourceZoneId: q.sourceZoneId,
            sourceCode: q.sourceCode,
            position: q.position,
            carriedStats: standingsLib.toCarriedStats(q.carriedStats)
          };
        });
        f.secondStageZoneId = createdZones[0] ? createdZones[0].id : null;
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
      const secondZones = tournament.secondStageZones(category);
      const nextTeamIdsByZoneCode = {};
      if (drift.secondStageAllocations) {
        drift.secondStageAllocations.forEach(function (spec) { nextTeamIdsByZoneCode[spec.code] = spec.teamIds; });
      }
      const nextIds = drift.qualifiers.map(function (q) { return q.teamId; });
      let toArchive = 0;
      let toRestore = 0;
      matchesOf(category.id).forEach(function (r) {
        if (r.stage !== STAGES.ZONE_FINAL) return;
        const zone = tournament.zoneById(category, r.zoneId);
        if (!zone || secondZones.indexOf(zone) < 0) return;
        const pool = (zone.code && nextTeamIdsByZoneCode[zone.code]) || nextIds;
        const inside = pool.indexOf(r.winnerId) >= 0 && pool.indexOf(r.loserId) >= 0;
        if (!inside && !r.archived) toArchive += 1;
        if (inside && r.archived && r.archivedReason === ARCHIVE_REASONS.QUALIFICATION_CHANGE) toRestore += 1;
      });
      return Object.assign({ toArchive, toRestore }, drift);
    }

    /**
     * Actualiza los clasificados confirmados para que coincidan con la primera etapa.
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
        const secondZones = tournament.secondStageZones(c);
        const nextTeamIdsByZoneCode = {};
        if (preview.secondStageAllocations) {
          preview.secondStageAllocations.forEach(function (spec) { nextTeamIdsByZoneCode[spec.code] = spec.teamIds; });
        }
        const nextIds = preview.qualifiers.map(function (q) { return q.teamId; });
        secondZones.forEach(function (zone) {
          zone.teamIds = (zone.code && nextTeamIdsByZoneCode[zone.code]) ? nextTeamIdsByZoneCode[zone.code].slice() : nextIds.slice();
        });
        f.qualified = preview.qualifiers.map(function (q) {
          return {
            teamId: q.teamId,
            sourceZoneId: q.sourceZoneId,
            sourceCode: q.sourceCode,
            position: q.position,
            carriedStats: standingsLib.toCarriedStats(q.carriedStats)
          };
        });
        f.qualificationUpdatedAt = now();
        teamsOf(c.id).forEach(function (t) {
          if (nextIds.indexOf(t.id) >= 0) { t.status = STATUS.QUALIFIED; t.stage = STAGES.ZONE_FINAL; } else if (t.status === STATUS.QUALIFIED) t.status = STATUS.ELIMINATED;
        });
        matchesOf(c.id).forEach(function (r) {
          if (r.stage !== STAGES.ZONE_FINAL) return;
          const zone = tournament.zoneById(c, r.zoneId);
          if (!zone || secondZones.indexOf(zone) < 0) return;
          const pool = (zone.code && nextTeamIdsByZoneCode[zone.code]) || nextIds;
          const inside = pool.indexOf(r.winnerId) >= 0 && pool.indexOf(r.loserId) >= 0;
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
      const matches = tournament.scopeMatches(ctx, parts[0], zone.id);
      const options = { scoreStage: parts[0] };
      if (tournament.isFinalAccumulatedScope(category, parts[0], zone.id)) {
        options.baselineByTeamId = tournament.qualifiedBaselineMap(ctx);
      }
      const rows = standingsLib.computeStandings(tournament.zoneTeams(ctx, zone), matches, options);
      return standingsLib.rankWithTies(rows, [], matches).ties;
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
      ensure(target, 'El resultado debe pertenecer a una zona válida.', 'ZONE_REQUIRED');
      if (tournament.isSecondStageZone(category, target.id)) return { stage: STAGES.ZONE_FINAL, zone: target, correction: false };
      ensure(!tournament.isSingleZoneFormat(category) && tournament.isInitialZone(category, target.id), 'El resultado debe pertenecer a una zona de segunda fase.', 'ZONE_REQUIRED');
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
          isFinal ? 'Ambos equipos deben integrar la zona seleccionada.' : 'Ambos equipos deben pertenecer a la misma zona.', 'TEAMS_NOT_IN_ZONE');
      }
      if (!target.correction) {
        ensure(LOCKED_STATUSES.indexOf(winner.status) < 0 && LOCKED_STATUSES.indexOf(loser.status) < 0, 'Solo pueden registrar resultados los equipos activos.', 'TEAM_LOCKED');
      }
      const zoneKey = target.zone ? target.zone.id : null;
      const duplicate = tournament.liveMatches(matchesOf(category.id)).some(function (r) {
        return r.matchType !== constants.MATCH_TYPES.INTERZONAL && r.matchType !== constants.MATCH_TYPES.PLAYOFF &&
          r.stage === target.stage && r.zoneId === zoneKey && tournament.pairKey(r.winnerId, r.loserId) === tournament.pairKey(winner.id, loser.id);
      });
      ensure(!duplicate, 'Ese cruce ya tiene un resultado. Usá “Corregir” para modificarlo.', 'DUPLICATE_MATCH');
      const normalizedSets = typeof sets === 'undefined' ? [] : scoring.validateMatchSets(sets);
      scoring.ensureScoreMatchesSets(score, normalizedSets);
      return { stage: target.stage, zoneId: zoneKey, sets: normalizedSets, correction: target.correction };
    }

    function syncCategoryCarriedStats(categoryId) {
      const ctx = context(categoryId);
      if (ctx) tournament.syncCarriedStats(ctx);
    }

    function syncChampionFromPlayoffs(categoryId) {
      const category = categoryById(categoryId);
      if (!category || !tournament.hasPlayoffStageFormat(category)) return;
      const finalMatch = tournament.findPlayoffMatch(context(categoryId), 'final');
      category.championId = finalMatch ? finalMatch.winnerId : null;
      category.runnerUpId = finalMatch ? finalMatch.loserId : null;
    }

    function pushMatch(categoryId, winnerId, loserId, score, validated, extras) {
      const match = Object.assign({
        id: newId('match'),
        categoryId,
        winnerId,
        loserId,
        score,
        sets: validated.sets,
        stage: validated.stage,
        zoneId: validated.zoneId,
        createdAt: now()
      }, extras || {});
      state.matchResults.push(match);
      if (match.stage === STAGES.GENERAL) syncCategoryCarriedStats(categoryId);
      if (match.matchType === constants.MATCH_TYPES.PLAYOFF) syncChampionFromPlayoffs(categoryId);
      return match;
    }

    /** Registra un resultado manual (ganador, perdedor, "2-0"|"2-1", sets opcionales). */
    function createMatchResult(winnerId, loserId, score, sets, zoneId) {
      const category = requireCategory();
      const validated = validateNewMatch(category, winnerId, loserId, score, sets, zoneId);
      return commit(function () { return pushMatch(category.id, winnerId, loserId, score, validated, { matchType: constants.MATCH_TYPES.ZONE }); }, 'No se pudo guardar el resultado.');
    }

    /** Registra el resultado de un cruce Interzonal C-D asignado en +50. */
    function createInterzonalMatchFromSets(slot, teamAId, setsA, setsB, setScores) {
      const category = requireCategory();
      ensure(tournament.isTorneo50(category), 'Los partidos Interzonales C-D solo aplican a Categoría +50.', 'INVALID_FORMAT');
      ensure(category.currentStage !== STAGES.FINISHED, 'El torneo ya finalizó.', 'FINISHED');
      const slotNum = Number(slot);
      const status = tournament.interzonalStatus(context(category.id));
      const slotObj = status.slots.filter(function (s) { return s.slot === slotNum; })[0];
      ensure(slotObj && slotObj.assigned, 'Primero guardá ambos equipos del Enfrentamiento ' + slotNum + ' en Interzonal C-D.', 'INTERZONAL_NOT_ASSIGNED');
      ensure(!slotObj.match, 'Ese cruce Interzonal C-D ya tiene un resultado cargado.', 'DUPLICATE_MATCH');
      ensure(teamAId === slotObj.teamCId || teamAId === slotObj.teamDId, 'El equipo indicado no pertenece a este cruce interzonal.', 'INVALID_TEAMS');
      const teamBId = teamAId === slotObj.teamCId ? slotObj.teamDId : slotObj.teamCId;
      const parsed = parseSetsInput(setsA, setsB, setScores);
      const winner = parsed.resolved.teamAWins ? teamAId : teamBId;
      const loser = parsed.resolved.teamAWins ? teamBId : teamAId;
      const normalizedSets = typeof parsed.sets === 'undefined' ? [] : scoring.validateMatchSets(parsed.sets);
      scoring.ensureScoreMatchesSets(parsed.resolved.score, normalizedSets);
      return commit(function () {
        return pushMatch(category.id, winner, loser, parsed.resolved.score, {
          stage: STAGES.GENERAL,
          zoneId: null,
          sets: normalizedSets
        }, {
          matchType: constants.MATCH_TYPES.INTERZONAL,
          interzonalSlot: slotNum
        });
      }, 'No se pudo guardar el resultado interzonal.');
    }

    /** Registra el resultado de un cruce final de Día 3 (Semifinales, Final, 3°/4°, 5°/6°, 7°/8°). */
    function createPlayoffMatchFromSets(bracketId, teamAId, setsA, setsB, setScores) {
      const category = requireCategory();
      ensure(tournament.hasPlayoffStageFormat(category), 'Esta categoría no tiene cruces finales de Día 3.', 'INVALID_FORMAT');
      ensure(category.currentStage !== STAGES.FINISHED, 'El torneo ya finalizó.', 'FINISHED');
      const po = tournament.computePlayoffs(context(category.id));
      ensure(po.unlocked, po.reasons.join(' ') || 'Los cruces finales todavía no están habilitados.', 'PLAYOFFS_LOCKED');
      const slot = po.slots.filter(function (s) { return s.id === bracketId; })[0];
      ensure(slot && slot.ready, 'Este cruce todavía espera la definición de la llave previa.', 'BRACKET_NOT_READY');
      ensure(!slot.match, 'Este cruce ya tiene un resultado cargado.', 'DUPLICATE_MATCH');
      ensure(teamAId === slot.teamA.id || teamAId === slot.teamB.id, 'El equipo indicado no participa de este cruce.', 'INVALID_TEAMS');
      const teamBId = teamAId === slot.teamA.id ? slot.teamB.id : slot.teamA.id;
      const parsed = parseSetsInput(setsA, setsB, setScores);
      const winner = parsed.resolved.teamAWins ? teamAId : teamBId;
      const loser = parsed.resolved.teamAWins ? teamBId : teamAId;
      const normalizedSets = typeof parsed.sets === 'undefined' ? [] : scoring.validateMatchSets(parsed.sets);
      scoring.ensureScoreMatchesSets(parsed.resolved.score, normalizedSets);
      return commit(function () {
        return pushMatch(category.id, winner, loser, parsed.resolved.score, {
          stage: STAGES.PLAYOFFS,
          zoneId: null,
          sets: normalizedSets
        }, {
          matchType: constants.MATCH_TYPES.PLAYOFF,
          bracketId: slot.id,
          bracketLabel: slot.label
        });
      }, 'No se pudo guardar el cruce final.');
    }

    /** Orienta sets cargados como "equipo 1 – equipo 2" hacia el ganador. */
    function orientSets(teamAWins, setScores) {
      return setScores.map(function (set) {
        const normalized = scoring.normalizeSet(set);
        if (!normalized) return set;
        return teamAWins ? { a: normalized.a, b: normalized.b } : { a: normalized.b, b: normalized.a };
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
        normalizedSets = Array.isArray(sets) && sets.length === 0 ? [] : scoring.validateMatchSets(sets);
        scoring.ensureScoreMatchesSets(score, normalizedSets);
      } else if (Array.isArray(normalizedSets) && normalizedSets.length) {
        if (winnerId !== match.winnerId && score === match.score) {
          normalizedSets = normalizedSets.map(function (s) { return { a: s.b, b: s.a }; });
        }
        if (scoring.matchSetsFor({ score, sets: normalizedSets }).length !== normalizedSets.length) {
          normalizedSets = [];
        }
      }
      const winnerChanged = match.winnerId !== winnerId;
      match.winnerId = winnerId;
      match.loserId = loserId;
      match.score = score;
      match.sets = normalizedSets;
      match.updatedAt = now();
      if (match.stage === STAGES.GENERAL) syncCategoryCarriedStats(match.categoryId);
      if (match.matchType === constants.MATCH_TYPES.PLAYOFF) {
        if (winnerChanged && (match.bracketId === 'semi-1' || match.bracketId === 'semi-2')) {
          state.matchResults = state.matchResults.filter(function (r) {
            return !(r.categoryId === match.categoryId && r.matchType === constants.MATCH_TYPES.PLAYOFF && (r.bracketId === 'final' || r.bracketId === 'third-place'));
          });
        }
        syncChampionFromPlayoffs(match.categoryId);
      }
      return match;
    }

    /** Corrige el resultado tradicional (y opcionalmente los sets) manteniendo ganador. */
    function updateMatchResult(matchId, score, sets) {
      const match = requireEditableMatch(matchId);
      return commit(function () {
        const m = matchById(match.id);
        return applyMatchUpdate(m, m.winnerId, m.loserId, score, sets);
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
        return applyMatchUpdate(matchById(match.id), winner, loser, parsed.resolved.score, parsed.sets);
      }, 'No se pudo guardar la corrección.');
    }

    function deleteMatchResult(matchId) {
      const match = requireEditableMatch(matchId);
      return commit(function () {
        state.matchResults = state.matchResults.filter(function (r) { return r.id !== matchId; });
        if (match.matchType === constants.MATCH_TYPES.PLAYOFF && (match.bracketId === 'semi-1' || match.bracketId === 'semi-2')) {
          state.matchResults = state.matchResults.filter(function (r) {
            return !(r.categoryId === match.categoryId && r.matchType === constants.MATCH_TYPES.PLAYOFF && (r.bracketId === 'final' || r.bracketId === 'third-place'));
          });
        }
        if (match.stage === STAGES.GENERAL) syncCategoryCarriedStats(match.categoryId);
        if (match.matchType === constants.MATCH_TYPES.PLAYOFF) syncChampionFromPlayoffs(match.categoryId);
      }, 'No se pudo guardar la eliminación.');
    }

    /**
     * Simula un cambio sobre un resultado y responde si alteraría a los
     * clasificados ya confirmados de la zona única. No guarda nada.
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
      categoryEntries, context, standings, classificationPoints, resultPoints: scoring.resultPoints,
      zoneRanking, zoneProgress, qualification, finalClassification,
      qualificationDrift, phase, previewReconcile, previewQualificationImpact,
      interzonalStatus, playoffs, finalStandings, fixture,
      // categorías y preferencias
      selectCategory, setTheme, createCategory, editCategory, deleteCategory, convertToSingleZone, preloadTeams68, generateFixture,
      // equipos y cargas
      createTeam, deleteTeam, createScoreEntry, addQuickScores, deleteScoreEntry,
      // zonas e interzonal C-D
      createZone, renameZone, assignTeamToZone, removeTeamFromZone, deleteZone,
      setInterzonalPair, clearInterzonalPair,
      // segunda etapa y empates
      confirmZones, reconcileQualifiers, resolveTie, clearTieResolution,
      // resultados
      createMatchResult, createMatchFromSets, createInterzonalMatchFromSets, createPlayoffMatchFromSets,
      updateMatchResult, updateMatchFromSets, deleteMatchResult,
      // persistencia
      reload: function () { state = repository.load(); return getState(); },
      save: function () { return repository.save(state); }
    });
  }

  return Object.freeze({ createTournamentService });
}));
