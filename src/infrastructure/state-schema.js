/**
 * Esquema persistido: validación, normalización y migración del estado guardado.
 *
 * Responsabilidades:
 *  - Descartar registros corruptos sin romper la aplicación (mismo criterio que antes).
 *  - Completar campos nuevos con valores por defecto compatibles.
 *  - Migración v1 → v2:
 *      · Agrega `category.format` (ZONES | SINGLE_ZONE).
 *      · Las categorías "+60" en primera etapa con 0 o 1 zona se convierten
 *        automáticamente a zona única SIN perder datos (ver
 *        `tournament.convertCategoryToSingleZone`). Si la conversión no es
 *        inequívoca (varias zonas o etapa avanzada) se mantienen como ZONES y la
 *        interfaz ofrece una conversión manual explícita.
 *
 * Capa: infrastructure (adaptador de persistencia). No accede al DOM ni a localStorage.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../domain/constants.js'), require('../domain/scoring.js'), require('../domain/tournament.js'));
  } else {
    const modules = root.PuntajeNewcomModules;
    modules.stateSchema = factory(modules.constants, modules.scoring, modules.tournament);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (constants, scoring, tournament) {
  'use strict';

  const { STAGES, STATUS, ZONE_STATUS, FORMATS, SCHEMA_VERSION } = constants;

  function emptyState() {
    return { schemaVersion: SCHEMA_VERSION, categories: [], teams: [], matchResults: [], selectedCategoryId: null, theme: 'light' };
  }

  function isOneOf(dictionary, value) {
    return Object.keys(dictionary).some(function (key) { return dictionary[key] === value; });
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function normalizeEntry(entry, fallbackStage, deps) {
    const points = Number(entry && entry.points);
    if (!Number.isInteger(points) || points < 0) return null;
    return {
      id: isNonEmptyString(entry.id) ? entry.id : deps.newId('score'),
      points,
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : deps.now(),
      stage: isOneOf(STAGES, entry.stage) ? entry.stage : fallbackStage
    };
  }

  function normalizeTieBreaks(source) {
    return Array.isArray(source) ? source.filter(function (item) {
      return item && typeof item.scope === 'string' && typeof item.signature === 'string' &&
        Array.isArray(item.order) && item.order.every(function (id) { return typeof id === 'string'; });
    }).map(function (item) {
      return { scope: item.scope, signature: item.signature, order: item.order.slice(), createdAt: item.createdAt || null };
    }) : [];
  }

  function normalizeZoneTournament(source, teamIds) {
    const raw = source || {};
    const zones = Array.isArray(raw.zones) ? raw.zones.filter(function (zone) {
      return zone && isNonEmptyString(zone.id) && isNonEmptyString(zone.name);
    }).map(function (zone) {
      return { id: zone.id, name: zone.name.trim(), teamIds: Array.isArray(zone.teamIds) ? zone.teamIds.filter(function (id) { return teamIds[id]; }) : [] };
    }) : [];
    const secondStageId = typeof raw.secondStageZoneId === 'string' ? raw.secondStageZoneId : null;
    return {
      status: isOneOf(ZONE_STATUS, raw.status) ? raw.status : (zones.length ? ZONE_STATUS.IN_PROGRESS : ZONE_STATUS.CONFIGURING),
      firstStageStatus: raw.firstStageStatus === 'SKIPPED' ? 'SKIPPED' : (raw.firstStageStatus === 'FINISHED' || secondStageId ? 'FINISHED' : (raw.firstStageStatus || 'CONFIGURING')),
      secondStageStatus: raw.secondStageStatus === 'IN_PROGRESS' || secondStageId ? 'IN_PROGRESS' : (raw.secondStageStatus || null),
      zones,
      secondStageZoneId: secondStageId,
      qualified: Array.isArray(raw.qualified) ? raw.qualified.filter(function (q) {
        return q && teamIds[q.teamId] && typeof q.sourceZoneId === 'string';
      }).map(function (q) {
        return { teamId: q.teamId, sourceZoneId: q.sourceZoneId, position: Number.isInteger(q.position) ? q.position : null };
      }) : [],
      confirmedAt: raw.confirmedAt || null,
      qualificationUpdatedAt: raw.qualificationUpdatedAt || null,
      tieBreaks: normalizeTieBreaks(raw.tieBreaks)
    };
  }

  function normalizeMatch(match) {
    const sets = scoring.normalizeSets(match.sets);
    const normalized = {
      id: match.id,
      categoryId: match.categoryId,
      winnerId: match.winnerId,
      loserId: match.loserId,
      score: match.score,
      sets: sets.length ? sets : [],
      stage: isOneOf(STAGES, match.stage) ? match.stage : STAGES.GENERAL,
      zoneId: typeof match.zoneId === 'string' ? match.zoneId : null,
      createdAt: typeof match.createdAt === 'string' ? match.createdAt : new Date().toISOString()
    };
    if (typeof match.originalZoneId === 'string') normalized.originalZoneId = match.originalZoneId;
    if (typeof match.updatedAt === 'string') normalized.updatedAt = match.updatedAt;
    if (match.archived === true) {
      normalized.archived = true;
      normalized.archivedReason = typeof match.archivedReason === 'string' ? match.archivedReason : null;
      normalized.archivedAt = typeof match.archivedAt === 'string' ? match.archivedAt : null;
    }
    return normalized;
  }

  /** ¿Puede convertirse automáticamente una categoría +60 sin ambigüedad? */
  function canAutoMigrateToSingleZone(category) {
    return tournament.inferFormat(category.name) === FORMATS.SINGLE_ZONE &&
      category.currentStage === STAGES.GENERAL &&
      !category.zoneTournament.secondStageZoneId &&
      tournament.initialZones(category).length <= 1;
  }

  /**
   * Normaliza (y migra) un estado crudo leído del almacenamiento.
   * @param {unknown} raw
   * @param {{newId: function(string): string, now: function(): string}} deps
   * @returns {{state: object, notes: string[]}}
   */
  function normalize(raw, deps) {
    const notes = [];
    if (!raw || typeof raw !== 'object') return { state: emptyState(), notes };

    const categoryIds = {};
    const categories = (Array.isArray(raw.categories) ? raw.categories : []).filter(function (c) {
      if (!c || !isNonEmptyString(c.id) || !isNonEmptyString(c.name) || categoryIds[c.id]) return false;
      categoryIds[c.id] = true;
      return true;
    });

    const teamIds = {};
    const legacyResults = Array.isArray(raw.results) ? raw.results : [];
    const teams = (Array.isArray(raw.teams) ? raw.teams : []).filter(function (t) {
      return t && isNonEmptyString(t.id) && !teamIds[t.id] && isNonEmptyString(t.name) && typeof t.categoryId === 'string' && categoryIds[t.categoryId] && (teamIds[t.id] = true);
    }).map(function (t) {
      const stage = isOneOf(STAGES, t.stage) ? t.stage : (isOneOf(STAGES, t.currentStage) ? t.currentStage : STAGES.GENERAL);
      const sourceEntries = Array.isArray(t.scoreEntries) ? t.scoreEntries : legacyResults.filter(function (r) { return r && r.teamId === t.id; });
      return {
        id: t.id,
        name: t.name.trim(),
        categoryId: t.categoryId,
        status: isOneOf(STATUS, t.status) ? t.status : STATUS.ACTIVE,
        stage,
        scoreEntries: sourceEntries.map(function (e) { return normalizeEntry(e, stage, deps); }).filter(Boolean)
      };
    });

    const matchIds = {};
    const matchResults = (Array.isArray(raw.matchResults) ? raw.matchResults : []).filter(function (r) {
      return r && isNonEmptyString(r.id) && !matchIds[r.id] && categoryIds[r.categoryId] && teamIds[r.winnerId] && teamIds[r.loserId] &&
        r.winnerId !== r.loserId && scoring.isValidScore(r.score) && (matchIds[r.id] = true);
    }).map(normalizeMatch);

    const normalizedCategories = categories.map(function (c) {
      const category = {
        id: c.id,
        name: c.name.trim(),
        format: isOneOf(FORMATS, c.format) ? c.format : null,
        currentStage: isOneOf(STAGES, c.currentStage) ? c.currentStage : STAGES.GENERAL,
        championId: typeof c.championId === 'string' ? c.championId : null,
        runnerUpId: typeof c.runnerUpId === 'string' ? c.runnerUpId : null,
        zoneTournament: normalizeZoneTournament(c.zoneTournament, teamIds)
      };
      // Una zona sólo puede contener equipos de su propia categoría.
      category.zoneTournament.zones.forEach(function (zone) {
        zone.teamIds = zone.teamIds.filter(function (id) {
          return teams.some(function (team) { return team.id === id && team.categoryId === category.id; });
        });
      });
      return category;
    });

    normalizedCategories.forEach(function (category) {
      if (category.format) return;
      if (canAutoMigrateToSingleZone(category)) {
        tournament.convertCategoryToSingleZone(
          category,
          teams.filter(function (team) { return team.categoryId === category.id; }),
          matchResults.filter(function (match) { return match.categoryId === category.id; }),
          deps
        );
        notes.push('Categoría "' + category.name + '" migrada a modalidad zona única conservando equipos y resultados.');
      } else {
        category.format = FORMATS.ZONES;
        if (tournament.inferFormat(category.name) === FORMATS.SINGLE_ZONE) {
          notes.push('Categoría "' + category.name + '" conserva su estructura de zonas; puede convertirse manualmente a zona única.');
        }
      }
    });

    const selected = typeof raw.selectedCategoryId === 'string' && categoryIds[raw.selectedCategoryId]
      ? raw.selectedCategoryId
      : (normalizedCategories[0] ? normalizedCategories[0].id : null);

    return {
      state: {
        schemaVersion: SCHEMA_VERSION,
        categories: normalizedCategories,
        teams,
        matchResults,
        selectedCategoryId: selected,
        theme: raw.theme === 'dark' ? 'dark' : 'light'
      },
      notes
    };
  }

  return Object.freeze({ emptyState, normalize, canAutoMigrateToSingleZone });
}));
