/**
 * Reglas del torneo por etapas:
 *  - Modalidad A (`zonas_y_final`): Zonas clasificatorias → 2 por zona → Zona final (+40 / genérico).
 *  - Modalidad B (`todos_contra_todos`): Zona única directa (genérico).
 *  - Torneo +50 (`torneo_50`, 14 equipos):
 *      Fase 1 (Viernes): Zona A (4), Zona B (4), Zona C (3 + Interzonal), Zona D (3 + Interzonal) + Selector Interzonal C-D (3 cruces).
 *      Fase 2 (Sábado / Dom.): Ronda Campeonato Zona 1 (1°A,1°B,2°C,2°D) y Zona 2 (1°C,1°D,2°A,2°B); Ronda Estímulo Zona 3 (3°/4° de cada zona, 6 equipos → 9°–14°).
 *      Fase 3 (Domingo): Semifinal 1 (1°Z1 vs 2°Z2), Semifinal 2 (1°Z2 vs 2°Z1), Final (1°/2°), 3°/4°, 5°/6° (3°Z1 vs 3°Z2), 7°/8° (4°Z1 vs 4°Z2).
 *  - Torneo +60 (`torneo_60`, 18 equipos):
 *      Fase 1 (Viernes y Sábado): 3 zonas de 6 equipos (Zonas A, B y C).
 *      Fase 2 (Domingo mañana): Zona 1 (1°A,2°B,1°C), Zona 2 (2°A,1°B,2°C), Zona 3 (3°s → 7°–9°), Zona 4 (4°s → 10°–12°), Zona 5 (5°s → 13°–15°), Zona 6 (6°s → 16°–18°).
 *      Fase 3 (Domingo tarde): Semifinal 1 (1°Z1 vs 2°Z2), Semifinal 2 (1°Z2 vs 2°Z1), Final (1°/2°), 3°/4°, 5°/6° (3°Z1 vs 3°Z2).
 *  - Torneo +68 (`torneo_68`, 8 equipos):
 *      Fase 1 (Días 1 y 2): Zona Única (8 equipos, 28 partidos) → Tabla General 1°–8°.
 *      Fase 2 (Día 3): Semifinal 1 (1° vs 4°), Semifinal 2 (2° vs 3°), Gran Final (1°/2°), 3°/4°; puestos 5°–8° directos por tabla.
 *
 * Capa: domain. Las consultas son puras.
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

  const { STAGES, STATUS, ZONE_STATUS, ZONE_PHASES, FORMATS, PHASES, PHASE_LABELS, QUALIFIERS_PER_ZONE, MATCH_TYPES } = constants;

  const TORNEO_50_SPEC = Object.freeze([
    { code: 'A', name: 'Zona A', targetTeams: 4 },
    { code: 'B', name: 'Zona B', targetTeams: 4 },
    { code: 'C', name: 'Zona C', targetTeams: 3 },
    { code: 'D', name: 'Zona D', targetTeams: 3 }
  ]);

  const TORNEO_60_SPEC = Object.freeze([
    { code: 'A', name: 'Zona A', targetTeams: 6 },
    { code: 'B', name: 'Zona B', targetTeams: 6 },
    { code: 'C', name: 'Zona C', targetTeams: 6 }
  ]);

  function defaultInterzonals() {
    return [
      { slot: 1, teamCId: null, teamDId: null },
      { slot: 2, teamCId: null, teamDId: null },
      { slot: 3, teamCId: null, teamDId: null }
    ];
  }

  // ---------------------------------------------------------------------------
  // Estructura de la categoría
  // ---------------------------------------------------------------------------

  /** Estado inicial de una categoría con zonas. */
  function emptyZoneTournament() {
    return {
      status: ZONE_STATUS.CONFIGURING,
      firstStageStatus: 'CONFIGURING',
      secondStageStatus: null,
      zones: [],
      secondStageZoneId: null,
      qualified: [],
      interzonals: defaultInterzonals(),
      confirmedAt: null,
      qualificationUpdatedAt: null,
      tieBreaks: []
    };
  }

  /** Estado inicial de una categoría de zona única (`todos_contra_todos` o `torneo_68`). */
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

  function isTorneo50(category) {
    return Boolean(category) && category.format === FORMATS.TORNEO_50;
  }

  function isTorneo60(category) {
    return Boolean(category) && category.format === FORMATS.TORNEO_60;
  }

  function isTorneo68(category) {
    return Boolean(category) && category.format === FORMATS.TORNEO_68;
  }

  function isSingleZoneFormat(category) {
    return Boolean(category) && (category.format === FORMATS.SINGLE_ZONE || category.format === FORMATS.TORNEO_68);
  }

  function hasPlayoffStageFormat(category) {
    return isTorneo50(category) || isTorneo60(category) || isTorneo68(category);
  }

  /** Sugiere la modalidad según el nombre (retrocompatible: "+60"/"+68" → zona única salvo que se indique formato explícito). */
  function inferFormat(name) {
    return constants.SINGLE_ZONE_CATEGORY_PATTERN.test(String(name || '')) ? FORMATS.ROUND_ROBIN : FORMATS.ZONES_AND_FINAL;
  }

  function zoneById(category, zoneId) {
    return flow(category).zones.filter(function (zone) { return zone.id === zoneId; })[0] || null;
  }

  function zoneByCode(category, code) {
    const f = flow(category);
    return f.zones.filter(function (zone) { return zone.code === code; })[0] ||
      f.zones.filter(function (zone) { return zone.name.toLowerCase() === ('zona ' + code).toLowerCase(); })[0] || null;
  }

  /** Zonas de la primera etapa (excluye segunda etapa / zona única). */
  function initialZones(category) {
    const f = flow(category);
    if (isSingleZoneFormat(category)) return [];
    return f.zones.filter(function (zone) {
      return zone.id !== f.secondStageZoneId && zone.phase === ZONE_PHASES.QUALIFYING;
    });
  }

  /** Zonas de la segunda etapa (Zona final en +40; Zonas 1-3 en +50; Zonas 1-6 en +60; Zona única en +60/+68 genérico). */
  function secondStageZones(category) {
    const f = flow(category);
    if (isSingleZoneFormat(category)) {
      const z = finalZone(category);
      return z ? [z] : [];
    }
    return f.zones.filter(function (zone) {
      return zone.id === f.secondStageZoneId || zone.phase !== ZONE_PHASES.QUALIFYING;
    });
  }

  /** Zona única o principal de segunda etapa. */
  function finalZone(category) {
    const f = flow(category);
    if (f.secondStageZoneId) return zoneById(category, f.secondStageZoneId);
    return f.zones.filter(function (zone) { return zone.phase !== ZONE_PHASES.QUALIFYING; })[0] || null;
  }

  function isInitialZone(category, zoneId) {
    return initialZones(category).some(function (zone) { return zone.id === zoneId; });
  }

  function isSecondStageZone(category, zoneId) {
    return secondStageZones(category).some(function (zone) { return zone.id === zoneId; });
  }

  /** Zona inicial a la que pertenece un equipo. */
  function teamInitialZone(category, teamId) {
    return initialZones(category).filter(function (zone) { return zone.teamIds.indexOf(teamId) >= 0; })[0] || null;
  }

  function stageForZone(category, zoneId) {
    if (isSingleZoneFormat(category)) return STAGES.ZONE_FINAL;
    const zone = zoneId ? zoneById(category, zoneId) : null;
    if ((zoneId && zoneId === flow(category).secondStageZoneId) || (zone && zone.phase !== ZONE_PHASES.QUALIFYING)) {
      return STAGES.ZONE_FINAL;
    }
    return STAGES.GENERAL;
  }

  function scopeKey(stage, zoneId) {
    return stage + '|' + zoneId;
  }

  function zoneTargetTeams(category, zone) {
    if (!category || !zone) return null;
    if (isTorneo68(category)) return null;
    if (typeof zone.targetTeams === 'number' && zone.targetTeams > 0) return zone.targetTeams;
    if (isTorneo50(category)) {
      const found50 = TORNEO_50_SPEC.filter(function (s) { return s.code === zone.code || s.name.toLowerCase() === zone.name.toLowerCase(); })[0];
      if (found50) return found50.targetTeams;
      if (zone.code === '1' || zone.code === '2') return 4;
      if (zone.code === '3') return 6;
    }
    if (isTorneo60(category)) {
      if (zone.phase === ZONE_PHASES.QUALIFYING) return 6;
      return 3;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Resultados, progreso e Interzonal C-D
  // ---------------------------------------------------------------------------

  /** Resultados vigentes (los archivados no cuentan). */
  function liveMatches(matches) {
    return (Array.isArray(matches) ? matches : []).filter(function (match) { return match && !match.archived; });
  }

  function interzonalSlots(category) {
    const raw = Array.isArray(flow(category).interzonals) ? flow(category).interzonals : [];
    const bySlot = {};
    raw.forEach(function (item) {
      if (item && (item.slot === 1 || item.slot === 2 || item.slot === 3)) {
        bySlot[item.slot] = {
          slot: item.slot,
          teamCId: typeof item.teamCId === 'string' && item.teamCId ? item.teamCId : null,
          teamDId: typeof item.teamDId === 'string' && item.teamDId ? item.teamDId : null
        };
      }
    });
    return [1, 2, 3].map(function (slot) {
      return bySlot[slot] || { slot, teamCId: null, teamDId: null };
    });
  }

  function interzonalZones(category) {
    if (!isTorneo50(category)) return { zoneC: null, zoneD: null };
    return { zoneC: zoneByCode(category, 'C'), zoneD: zoneByCode(category, 'D') };
  }

  function isInterzonalZone(category, zone) {
    if (!isTorneo50(category) || !zone) return false;
    const { zoneC, zoneD } = interzonalZones(category);
    return (zoneC && zone.id === zoneC.id) || (zoneD && zone.id === zoneD.id);
  }

  function interzonalMatches(ctx) {
    return liveMatches(ctx && ctx.matches).filter(function (match) {
      return match.stage === STAGES.GENERAL && match.matchType === MATCH_TYPES.INTERZONAL;
    });
  }

  function interzonalMatchForSlot(ctx, slot, pairing) {
    const matches = interzonalMatches(ctx);
    const bySlot = matches.filter(function (m) { return m.interzonalSlot === slot; })[0];
    if (bySlot) return bySlot;
    if (pairing && pairing.teamCId && pairing.teamDId) {
      const key = pairKey(pairing.teamCId, pairing.teamDId);
      return matches.filter(function (m) { return pairKey(m.winnerId, m.loserId) === key; })[0] || null;
    }
    return null;
  }

  /**
   * Estado completo del selector Interzonal C-D en Categoría +50:
   * - 3 enfrentamientos (slot 1..3), cada equipo de C y de D exactamente una vez.
   * - Qué equipos están asignados y cuáles pendientes.
   * - Qué cruces ya tienen resultado cargado.
   */
  function interzonalStatus(ctx) {
    const category = ctx && ctx.category;
    const { zoneC, zoneD } = interzonalZones(category);
    const teamsC = zoneC ? zoneTeams(ctx, zoneC) : [];
    const teamsD = zoneD ? zoneTeams(ctx, zoneD) : [];
    const teamMap = {};
    (ctx && ctx.teams || []).forEach(function (t) { teamMap[t.id] = t; });
    const slots = interzonalSlots(category).map(function (item) {
      const teamC = item.teamCId && zoneC && zoneC.teamIds.indexOf(item.teamCId) >= 0 ? (teamMap[item.teamCId] || null) : null;
      const teamD = item.teamDId && zoneD && zoneD.teamIds.indexOf(item.teamDId) >= 0 ? (teamMap[item.teamDId] || null) : null;
      const assigned = Boolean(teamC && teamD);
      const match = assigned ? interzonalMatchForSlot(ctx, item.slot, { teamCId: teamC.id, teamDId: teamD.id }) : null;
      return {
        slot: item.slot,
        teamCId: teamC ? teamC.id : null,
        teamDId: teamD ? teamD.id : null,
        teamC,
        teamD,
        assigned,
        match,
        played: Boolean(match)
      };
    });

    const assignedCMap = {};
    const assignedDMap = {};
    slots.forEach(function (s) {
      if (s.teamCId) assignedCMap[s.teamCId] = true;
      if (s.teamDId) assignedDMap[s.teamDId] = true;
    });

    const assignedC = teamsC.filter(function (t) { return assignedCMap[t.id]; });
    const pendingC = teamsC.filter(function (t) { return !assignedCMap[t.id]; });
    const assignedD = teamsD.filter(function (t) { return assignedDMap[t.id]; });
    const pendingD = teamsD.filter(function (t) { return !assignedDMap[t.id]; });
    const assignedCount = slots.filter(function (s) { return s.assigned; }).length;
    const playedCount = slots.filter(function (s) { return s.played; }).length;
    const allAssigned = teamsC.length === 3 && teamsD.length === 3 && assignedCount === 3 && pendingC.length === 0 && pendingD.length === 0;
    const allPlayed = allAssigned && playedCount === 3;

    return {
      applicable: isTorneo50(category),
      zoneC,
      zoneD,
      teamsC,
      teamsD,
      slots,
      assignedC,
      pendingC,
      assignedD,
      pendingD,
      assignedCount,
      playedCount,
      allAssigned,
      allPlayed
    };
  }

  function scopeMatches(ctx, stage, zoneId) {
    const live = liveMatches(ctx.matches);
    const zone = zoneId ? zoneById(ctx.category, zoneId) : null;
    if (stage === STAGES.GENERAL && isTorneo50(ctx.category) && isInterzonalZone(ctx.category, zone)) {
      const members = {};
      zone.teamIds.forEach(function (id) { members[id] = true; });
      return live.filter(function (match) {
        if (match.stage !== STAGES.GENERAL) return false;
        if (match.zoneId === zoneId) return true;
        return match.matchType === MATCH_TYPES.INTERZONAL && (members[match.winnerId] || members[match.loserId]);
      });
    }
    return live.filter(function (match) { return match.stage === stage && match.zoneId === zoneId; });
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
   * Progreso de un todos contra todos (e interzonales en Zona C / D de +50).
   */
  function zoneProgress(ctx, zone, stage) {
    const members = {};
    zone.teamIds.forEach(function (id) { members[id] = true; });
    const internalPairs = {};
    const interzonalPairs = {};
    scopeMatches(ctx, stage, zone.id).forEach(function (match) {
      if (match.matchType === MATCH_TYPES.INTERZONAL && (members[match.winnerId] || members[match.loserId])) {
        interzonalPairs[pairKey(match.winnerId, match.loserId)] = true;
      } else if (members[match.winnerId] && members[match.loserId]) {
        internalPairs[pairKey(match.winnerId, match.loserId)] = true;
      }
    });
    const teamCount = zone.teamIds.length;
    const internalRequired = teamCount * (teamCount - 1) / 2;
    const internalPlayed = Object.keys(internalPairs).length;
    const hasInterzonal = stage === STAGES.GENERAL && isTorneo50(ctx.category) && isInterzonalZone(ctx.category, zone);
    const interzonalRequired = hasInterzonal ? 3 : 0;
    const interzonalPlayed = hasInterzonal ? Object.keys(interzonalPairs).length : 0;
    const required = internalRequired + interzonalRequired;
    const played = internalPlayed + interzonalPlayed;
    const targetTeams = zoneTargetTeams(ctx.category, zone);
    const minTeams = isTorneo68(ctx.category) ? 4 : 2;
    const teamCountOk = targetTeams ? teamCount === targetTeams : teamCount >= minTeams;
    return {
      teamCount,
      targetTeams,
      required,
      played,
      missing: Math.max(0, required - played),
      internalRequired,
      internalPlayed,
      interzonalRequired,
      interzonalPlayed,
      complete: teamCountOk && played === required
    };
  }

  /**
   * Genera automáticamente la planificación por rondas (fixture todos contra todos)
   * adaptada a la cantidad real de equipos (Método del Círculo / Tablas de Berger).
   * - Si la cantidad de equipos es impar (ej. 7 equipos): 7 fechas, 3 partidos por fecha (21 en total),
   *   cada equipo juega 6 partidos y tiene exactamente 1 fecha libre sin crear equipos ni partidos ficticios.
   * - Si la cantidad de equipos es par (ej. 8 equipos): 7 fechas, 4 partidos por fecha (28 en total),
   *   cada equipo juega 7 partidos sin fechas libres.
   */
  function buildRoundRobinFixture(teamIds) {
    const cleanIds = [];
    const seen = {};
    (Array.isArray(teamIds) ? teamIds : []).forEach(function (id) {
      if (typeof id === 'string' && id.trim() && !seen[id]) {
        seen[id] = true;
        cleanIds.push(id);
      }
    });
    const n = cleanIds.length;
    if (n < 2) {
      return {
        teamIds: cleanIds,
        teamCount: n,
        totalMatches: 0,
        matchesPerTeam: 0,
        roundsCount: 0,
        hasFreeDates: false,
        rounds: []
      };
    }

    const isOdd = (n % 2 === 1);
    const slots = cleanIds.slice();
    if (isOdd) {
      slots.push(null); // Ranura virtual únicamente para determinar la fecha libre de cada ronda
    }

    const numSlots = slots.length;
    const numRounds = numSlots - 1;
    const half = numSlots / 2;
    const rounds = [];
    const seenPairs = {};
    let current = slots.slice();
    let matchCounter = 0;

    for (let r = 1; r <= numRounds; r += 1) {
      const roundMatches = [];
      let freeTeamId = null;

      for (let i = 0; i < half; i += 1) {
        const a = current[i];
        const b = current[numSlots - 1 - i];
        if (a === null || b === null) {
          freeTeamId = a === null ? b : a;
        } else if (a !== b) {
          const pk = pairKey(a, b);
          if (!seenPairs[pk]) {
            seenPairs[pk] = true;
            matchCounter += 1;
            const teamAId = (i === 0 && r % 2 === 0) ? b : a;
            const teamBId = (i === 0 && r % 2 === 0) ? a : b;
            roundMatches.push({
              id: 'R' + r + '-M' + (roundMatches.length + 1),
              number: matchCounter,
              round: r,
              order: roundMatches.length + 1,
              teamAId,
              teamBId
            });
          }
        }
      }

      rounds.push({
        round: r,
        name: 'Fecha ' + r,
        freeTeamId,
        matches: roundMatches
      });

      const next = [current[0], current[numSlots - 1]];
      for (let k = 1; k < numSlots - 1; k += 1) {
        next.push(current[k]);
      }
      current = next;
    }

    return {
      teamIds: cleanIds,
      teamCount: n,
      totalMatches: matchCounter,
      matchesPerTeam: n - 1,
      roundsCount: rounds.length,
      hasFreeDates: isOdd,
      rounds
    };
  }

  function isFixtureSyncedWithZone(fixture, zoneTeamIds) {
    if (!fixture || typeof fixture !== 'object' || !Array.isArray(fixture.teamIds) || !Array.isArray(fixture.rounds)) {
      return false;
    }
    if (fixture.teamIds.length !== zoneTeamIds.length) return false;
    for (let i = 0; i < zoneTeamIds.length; i += 1) {
      if (fixture.teamIds[i] !== zoneTeamIds[i]) return false;
    }
    return true;
  }

  /**
   * Obtiene el fixture enriquecido de una zona, vinculando cada cruce programado
   * con los equipos registrados y los resultados ya disputados.
   */
  function computeZoneFixture(ctx, zone) {
    const category = ctx && ctx.category;
    const targetZone = zone || (category ? finalZone(category) : null);
    if (!category || !targetZone) {
      return {
        valid: false,
        zoneId: null,
        teamIds: [],
        teamCount: 0,
        totalMatches: 0,
        matchesPerTeam: 0,
        roundsCount: 0,
        hasFreeDates: false,
        freeTeamsByRound: [],
        rounds: [],
        allMatches: [],
        matchesByTeam: {},
        playedMatchesCount: 0,
        pendingMatchesCount: 0
      };
    }

    const minTeams = isTorneo68(category) ? 4 : 2;
    const baseFixture = isFixtureSyncedWithZone(targetZone.fixture, targetZone.teamIds)
      ? targetZone.fixture
      : buildRoundRobinFixture(targetZone.teamIds);

    const teamMap = {};
    (ctx.teams || []).forEach(function (t) { teamMap[t.id] = t; });

    const stage = stageForZone(category, targetZone.id);
    const matchByPair = {};
    scopeMatches(ctx, stage, targetZone.id).forEach(function (m) {
      if (m.matchType !== MATCH_TYPES.INTERZONAL && m.matchType !== MATCH_TYPES.PLAYOFF) {
        matchByPair[pairKey(m.winnerId, m.loserId)] = m;
      }
    });

    const matchesByTeam = {};
    targetZone.teamIds.forEach(function (id) { matchesByTeam[id] = 0; });

    const allMatches = [];
    const freeTeamsByRound = [];
    let playedMatchesCount = 0;

    const rounds = (targetZone.teamIds.length >= minTeams ? baseFixture.rounds : []).map(function (r) {
      const freeTeam = r.freeTeamId ? (teamMap[r.freeTeamId] || null) : null;
      if (r.freeTeamId) {
        freeTeamsByRound.push({
          round: r.round,
          roundName: r.name,
          teamId: r.freeTeamId,
          team: freeTeam
        });
      }
      let roundPlayed = 0;
      const items = (r.matches || []).map(function (m) {
        const playedMatch = matchByPair[pairKey(m.teamAId, m.teamBId)] || null;
        if (playedMatch) {
          roundPlayed += 1;
          playedMatchesCount += 1;
        }
        matchesByTeam[m.teamAId] = (matchesByTeam[m.teamAId] || 0) + 1;
        matchesByTeam[m.teamBId] = (matchesByTeam[m.teamBId] || 0) + 1;
        const enriched = {
          id: m.id,
          number: m.number,
          round: r.round,
          roundName: r.name,
          order: m.order,
          teamAId: m.teamAId,
          teamBId: m.teamBId,
          teamA: teamMap[m.teamAId] || null,
          teamB: teamMap[m.teamBId] || null,
          match: playedMatch,
          played: Boolean(playedMatch)
        };
        allMatches.push(enriched);
        return enriched;
      });
      return {
        round: r.round,
        name: r.name,
        freeTeamId: r.freeTeamId || null,
        freeTeam,
        playedCount: roundPlayed,
        totalCount: items.length,
        matches: items
      };
    });

    const valid = targetZone.teamIds.length >= minTeams;
    const totalMatches = valid ? baseFixture.totalMatches : 0;

    return {
      valid,
      zoneId: targetZone.id,
      teamIds: baseFixture.teamIds.slice(),
      teamCount: baseFixture.teamCount,
      totalMatches,
      matchesPerTeam: valid ? baseFixture.matchesPerTeam : 0,
      roundsCount: rounds.length,
      hasFreeDates: valid ? baseFixture.hasFreeDates : false,
      freeTeamsByRound,
      rounds,
      allMatches,
      matchesByTeam,
      playedMatchesCount,
      pendingMatchesCount: Math.max(0, totalMatches - playedMatchesCount)
    };
  }

  function tieResolutions(category, scope) {
    return (flow(category).tieBreaks || []).filter(function (item) { return item.scope === scope; });
  }

  function isFinalAccumulatedScope(category, stage, zoneId) {
    if (!category || isSingleZoneFormat(category)) return false;
    const effectiveStage = stage || (zoneId ? stageForZone(category, zoneId) : undefined);
    if (effectiveStage !== STAGES.ZONE_FINAL) return false;
    if (!zoneId) return secondStageZones(category).length > 0;
    return isSecondStageZone(category, zoneId);
  }

  function teamGeneralMatches(ctx, teamId, sourceZoneId) {
    return liveMatches(ctx.matches).filter(function (match) {
      if (match.stage !== STAGES.GENERAL) return false;
      if (match.winnerId !== teamId && match.loserId !== teamId) return false;
      if (match.matchType === MATCH_TYPES.INTERZONAL) return true;
      return !sourceZoneId || !match.zoneId || match.zoneId === sourceZoneId;
    });
  }

  function qualifiedTeamBaseline(ctx, qualifiedEntry) {
    if (!ctx || !qualifiedEntry || !qualifiedEntry.teamId) return standings.emptyCarriedStats();
    const team = ctx.teams.filter(function (t) { return t.id === qualifiedEntry.teamId; })[0];
    const generalMatches = teamGeneralMatches(ctx, qualifiedEntry.teamId, qualifiedEntry.sourceZoneId);
    if (generalMatches.length > 0 && team) {
      return standings.toCarriedStats(standings.computeStandings([team], generalMatches, { scoreStage: STAGES.GENERAL })[0]);
    }
    if (qualifiedEntry.carriedStats) {
      return standings.normalizeCarriedStats(qualifiedEntry.carriedStats);
    }
    return standings.emptyCarriedStats();
  }

  /** Mapa de estadísticas acumuladas transferidas desde la fase clasificatoria por `teamId`. */
  function qualifiedBaselineMap(ctx) {
    const map = {};
    if (!ctx || !ctx.category || isSingleZoneFormat(ctx.category)) return map;
    const f = flow(ctx.category);
    (f.qualified || []).forEach(function (q) {
      if (q && q.teamId) map[q.teamId] = qualifiedTeamBaseline(ctx, q);
    });
    return map;
  }

  /** Recalcula y sincroniza `carriedStats` en `category.zoneTournament.qualified`. MUTA `category`. */
  function syncCarriedStats(ctx) {
    const f = flow(ctx && ctx.category);
    if (!ctx || !ctx.category || isSingleZoneFormat(ctx.category) || !Array.isArray(f.qualified) || !f.qualified.length) return;
    f.qualified.forEach(function (q) {
      const team = ctx.teams.filter(function (t) { return t.id === q.teamId; })[0];
      if (!team) {
        q.carriedStats = standings.emptyCarriedStats();
        return;
      }
      const generalMatches = teamGeneralMatches(ctx, q.teamId, q.sourceZoneId);
      q.carriedStats = standings.toCarriedStats(standings.computeStandings([team], generalMatches, { scoreStage: STAGES.GENERAL })[0]);
    });
  }

  /** Tabla de una zona con empates detectados y resoluciones manuales aplicadas. */
  function zoneRanking(ctx, zone, stage) {
    const matches = scopeMatches(ctx, stage, zone.id);
    const options = { scoreStage: stage };
    if (isFinalAccumulatedScope(ctx.category, stage, zone.id)) {
      options.baselineByTeamId = qualifiedBaselineMap(ctx);
    }
    const rows = standings.computeStandings(zoneTeams(ctx, zone), matches, options);
    const ranked = standings.rankWithTies(rows, tieResolutions(ctx.category, scopeKey(stage, zone.id)), matches);
    return Object.assign(ranked, { scope: scopeKey(stage, zone.id), stage, zoneId: zone.id });
  }

  // ---------------------------------------------------------------------------
  // Clasificación de Primera Etapa (+40, +50, +60)
  // ---------------------------------------------------------------------------

  function blockingTiesForZone(category, zone, ranking) {
    const unresolved = ranking.ties.filter(function (tie) { return !tie.resolved; });
    if (!unresolved.length) return [];
    if (isTorneo50(category)) {
      if (zone.code === 'A' || zone.code === 'B') {
        // 1° -> Z1, 2° -> Z2, 3° y 4° -> Z3 (el empate 3°-4° no cambia destino)
        return unresolved.filter(function (tie) {
          return (tie.start < 1 && tie.end >= 1) || (tie.start < 2 && tie.end >= 2);
        });
      }
      // En Zonas C y D: 1° -> Z2, 2° -> Z1, 3° -> Z3 (cualquier puesto define destino)
      return unresolved;
    }
    if (isTorneo60(category)) {
      // En +60 cada puesto 1°..6° pasa a un triangular distinto (Zonas 1..6)
      return unresolved;
    }
    const cut = QUALIFIERS_PER_ZONE;
    return unresolved.filter(function (tie) { return tie.start < cut && tie.end >= cut; });
  }

  function zoneQualification(ctx, zone) {
    const progress = zoneProgress(ctx, zone, STAGES.GENERAL);
    const ranking = zoneRanking(ctx, zone, STAGES.GENERAL);
    const blockingTies = blockingTiesForZone(ctx.category, zone, ranking);
    const targetTeams = zoneTargetTeams(ctx.category, zone);
    let status = 'DEFINED';
    if (targetTeams ? progress.teamCount !== targetTeams : progress.teamCount < 2) status = 'INSUFFICIENT_TEAMS';
    else if (!progress.complete) status = 'INCOMPLETE';
    else if (blockingTies.length) status = 'TIED';
    const cut = isTorneo50(ctx.category) || isTorneo60(ctx.category) ? ranking.rows.length : QUALIFIERS_PER_ZONE;
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

  function zoneIssue(ctx, zq) {
    const target = zoneTargetTeams(ctx.category, zq.zone);
    if (zq.status === 'INSUFFICIENT_TEAMS') {
      if (target) return zq.zone.name + ': debe tener exactamente ' + target + ' equipos (actualmente tiene ' + zq.progress.teamCount + ').';
      return zq.zone.name + ': necesita al menos dos equipos.';
    }
    if (zq.status === 'INCOMPLETE') {
      if (zq.progress.interzonalRequired && zq.progress.internalPlayed < zq.progress.internalRequired) {
        return zq.zone.name + ': faltan ' + (zq.progress.internalRequired - zq.progress.internalPlayed) + ' partido(s) internos.';
      }
      if (zq.progress.interzonalRequired && zq.progress.interzonalPlayed < zq.progress.interzonalRequired) {
        return zq.zone.name + ': faltan ' + (zq.progress.interzonalRequired - zq.progress.interzonalPlayed) + ' partido(s) del Interzonal C-D.';
      }
      return zq.zone.name + ': faltan ' + zq.progress.missing + ' resultado(s) para completar el todos contra todos.';
    }
    if (zq.status === 'TIED') return zq.zone.name + ': hay un empate sin resolver que afecta el pase a la siguiente fase.';
    return null;
  }

  function buildSecondStageAllocations50(zonesByCode, qualifiedEntries) {
    const find = function (code, pos) {
      return qualifiedEntries.filter(function (q) { return q.sourceCode === code && q.position === pos; })[0];
    };
    const z1Teams = [find('A', 1), find('B', 1), find('C', 2), find('D', 2)].filter(Boolean);
    const z2Teams = [find('C', 1), find('D', 1), find('A', 2), find('B', 2)].filter(Boolean);
    const z3Teams = [find('A', 3), find('A', 4), find('B', 3), find('B', 4), find('C', 3), find('D', 3)].filter(Boolean);
    return [
      { code: '1', name: 'Zona 1 · Ronda Campeonato', phase: ZONE_PHASES.CHAMPIONSHIP, targetTeams: 4, teamIds: z1Teams.map(function (q) { return q.teamId; }) },
      { code: '2', name: 'Zona 2 · Ronda Campeonato', phase: ZONE_PHASES.CHAMPIONSHIP, targetTeams: 4, teamIds: z2Teams.map(function (q) { return q.teamId; }) },
      { code: '3', name: 'Zona 3 · Ronda Estímulo (9° al 14°)', phase: ZONE_PHASES.STIMULUS, targetTeams: 6, teamIds: z3Teams.map(function (q) { return q.teamId; }) }
    ];
  }

  function buildSecondStageAllocations60(zonesByCode, qualifiedEntries) {
    const find = function (code, pos) {
      return qualifiedEntries.filter(function (q) { return q.sourceCode === code && q.position === pos; })[0];
    };
    return [
      { code: '1', name: 'Zona 1 · Campeonato', phase: ZONE_PHASES.CHAMPIONSHIP, targetTeams: 3, teamIds: [find('A', 1), find('B', 2), find('C', 1)].filter(Boolean).map(function (q) { return q.teamId; }) },
      { code: '2', name: 'Zona 2 · Campeonato', phase: ZONE_PHASES.CHAMPIONSHIP, targetTeams: 3, teamIds: [find('A', 2), find('B', 1), find('C', 2)].filter(Boolean).map(function (q) { return q.teamId; }) },
      { code: '3', name: 'Zona 3 · Puestos 7° al 9°', phase: ZONE_PHASES.PLACEMENT, targetTeams: 3, teamIds: [find('A', 3), find('B', 3), find('C', 3)].filter(Boolean).map(function (q) { return q.teamId; }) },
      { code: '4', name: 'Zona 4 · Puestos 10° al 12°', phase: ZONE_PHASES.PLACEMENT, targetTeams: 3, teamIds: [find('A', 4), find('B', 4), find('C', 4)].filter(Boolean).map(function (q) { return q.teamId; }) },
      { code: '5', name: 'Zona 5 · Puestos 13° al 15°', phase: ZONE_PHASES.PLACEMENT, targetTeams: 3, teamIds: [find('A', 5), find('B', 5), find('C', 5)].filter(Boolean).map(function (q) { return q.teamId; }) },
      { code: '6', name: 'Zona 6 · Puestos 16° al 18°', phase: ZONE_PHASES.PLACEMENT, targetTeams: 3, teamIds: [find('A', 6), find('B', 6), find('C', 6)].filter(Boolean).map(function (q) { return q.teamId; }) }
    ];
  }

  /**
   * Clasificación completa de la primera etapa.
   */
  function computeQualification(ctx) {
    const category = ctx.category;
    const zones = initialZones(category).map(function (zone) { return zoneQualification(ctx, zone); });
    const issues = [];
    if (!zones.length) issues.push('Creá al menos una zona.');
    assignmentIssues(ctx).forEach(function (issue) { issues.push(issue); });

    if (isTorneo50(category)) {
      const iz = interzonalStatus(ctx);
      if (!iz.allAssigned) issues.push('Completá los 3 enfrentamientos en el selector Interzonal C-D.');
      else if (!iz.allPlayed) issues.push('Faltan cargar ' + (3 - iz.playedCount) + ' resultado(s) del Interzonal C-D.');
    }

    zones.forEach(function (zq) {
      const issue = zoneIssue(ctx, zq);
      if (issue && issues.indexOf(issue) < 0) issues.push(issue);
    });

    const qualifiers = [];
    zones.forEach(function (zq) {
      const code = zq.zone.code || zq.zone.name.slice(-1).toUpperCase();
      zq.qualifierIds.forEach(function (teamId, index) {
        const row = zq.ranking.rows[index];
        qualifiers.push({
          teamId,
          sourceZoneId: zq.zone.id,
          sourceCode: code,
          position: index + 1,
          carriedStats: standings.toCarriedStats(row)
        });
      });
    });

    const unique = {};
    qualifiers.forEach(function (q) { unique[q.teamId] = true; });
    if (Object.keys(unique).length !== qualifiers.length) issues.push('Hay equipos clasificados duplicados.');

    let secondStageAllocations = [];
    if (isTorneo50(category)) {
      secondStageAllocations = buildSecondStageAllocations50(zones, qualifiers);
    } else if (isTorneo60(category)) {
      secondStageAllocations = buildSecondStageAllocations60(zones, qualifiers);
    } else {
      secondStageAllocations = [{
        code: 'F',
        name: constants.SECOND_STAGE_ZONE_NAME,
        phase: ZONE_PHASES.FINAL,
        teamIds: qualifiers.map(function (q) { return q.teamId; })
      }];
    }

    return { zones, issues, ready: issues.length === 0, qualifiers, secondStageAllocations };
  }

  /**
   * Compara los clasificados confirmados con los que surgen de los resultados
   * actuales de la primera etapa.
   */
  function qualificationDrift(ctx) {
    const f = flow(ctx.category);
    if (isSingleZoneFormat(ctx.category) || ctx.category.currentStage === STAGES.GENERAL || !f.qualified.length) {
      return { applicable: false, determinable: true, changed: false, outgoing: [], incoming: [], issues: [], qualifiers: [] };
    }
    const confirmed = f.qualified.map(function (q) { return q.teamId; });
    const computed = computeQualification(ctx);
    if (!computed.ready) {
      return { applicable: true, determinable: false, changed: false, outgoing: [], incoming: [], issues: computed.issues, qualifiers: [] };
    }
    if (isTorneo50(ctx.category) || isTorneo60(ctx.category)) {
      const confirmedByKey = {};
      f.qualified.forEach(function (q) { confirmedByKey[q.sourceZoneId + ':' + q.position] = q.teamId; });
      const changedPositions = computed.qualifiers.some(function (q) {
        return confirmedByKey[q.sourceZoneId + ':' + q.position] !== q.teamId;
      });
      const computedIds = computed.qualifiers.map(function (q) { return q.teamId; });
      const outgoing = confirmed.filter(function (id) { return computedIds.indexOf(id) < 0; });
      const incoming = computedIds.filter(function (id) { return confirmed.indexOf(id) < 0; });
      return {
        applicable: true,
        determinable: true,
        changed: changedPositions || outgoing.length + incoming.length > 0,
        outgoing,
        incoming,
        issues: [],
        qualifiers: computed.qualifiers,
        secondStageAllocations: computed.secondStageAllocations
      };
    }
    const computedIds = computed.qualifiers.map(function (q) { return q.teamId; });
    const outgoing = confirmed.filter(function (id) { return computedIds.indexOf(id) < 0; });
    const incoming = computedIds.filter(function (id) { return confirmed.indexOf(id) < 0; });
    return { applicable: true, determinable: true, changed: outgoing.length + incoming.length > 0, outgoing, incoming, issues: [], qualifiers: computed.qualifiers };
  }

  // ---------------------------------------------------------------------------
  // Cruces Finales (Día 3) para +50, +60 y +68
  // ---------------------------------------------------------------------------

  function playoffMatches(ctx) {
    return liveMatches(ctx && ctx.matches).filter(function (m) {
      return m.stage === STAGES.PLAYOFFS || m.matchType === MATCH_TYPES.PLAYOFF;
    });
  }

  function findPlayoffMatch(ctx, bracketId) {
    return playoffMatches(ctx).filter(function (m) { return m.bracketId === bracketId; })[0] || null;
  }

  function makePlayoffSlot(ctx, def) {
    const match = findPlayoffMatch(ctx, def.id);
    const ready = Boolean(def.teamA && def.teamB && def.teamA.id !== def.teamB.id);
    const teamMap = {};
    (ctx.teams || []).forEach(function (t) { teamMap[t.id] = t; });
    return {
      id: def.id,
      label: def.label,
      group: def.group,
      teamASource: def.teamASource,
      teamBSource: def.teamBSource,
      teamA: def.teamA || null,
      teamB: def.teamB || null,
      ready,
      match,
      winner: match ? (teamMap[match.winnerId] || null) : null,
      loser: match ? (teamMap[match.loserId] || null) : null
    };
  }

  function evaluateSecondStageZone(ctx, zone) {
    if (!zone) return { zone: null, progress: null, ranking: { rows: [], ties: [] }, unresolvedTies: [], complete: false, ready: false };
    const progress = zoneProgress(ctx, zone, STAGES.ZONE_FINAL);
    const ranking = zoneRanking(ctx, zone, STAGES.ZONE_FINAL);
    const unresolvedTies = ranking.ties.filter(function (tie) { return !tie.resolved; });
    return {
      zone,
      progress,
      ranking,
      unresolvedTies,
      complete: progress.complete,
      ready: progress.complete && unresolvedTies.length === 0
    };
  }

  /**
   * Deriva el cuadro de Cruces Finales (Día 3) y posiciones finales del torneo.
   */
  function computePlayoffs(ctx) {
    const category = ctx && ctx.category;
    if (!category || !hasPlayoffStageFormat(category)) {
      return { applicable: false, unlocked: false, reasons: [], slots: [], placementZones: [], allComplete: false };
    }

    if (isTorneo68(category)) {
      const zU = finalZone(category);
      const evalU = evaluateSecondStageZone(ctx, zU);
      const teamCount = evalU.progress ? evalU.progress.teamCount : 0;
      const reasons = [];
      if (!evalU.zone || teamCount < 4) {
        reasons.push('La Zona única requiere al menos 4 equipos inscriptos para generar la fase eliminatoria (actualmente hay ' + teamCount + ').');
      } else if (!evalU.progress.complete) {
        reasons.push('Faltan ' + evalU.progress.missing + ' de ' + evalU.progress.required + ' partido(s) en la Zona única.');
      }
      if (evalU.unresolvedTies.length) reasons.push('Hay ' + evalU.unresolvedTies.length + ' empate(s) sin resolver en la Zona única.');
      const unlocked = reasons.length === 0;
      const rows = unlocked ? evalU.ranking.rows : [];
      const t = function (idx) { return rows[idx] ? rows[idx].team : null; };

      const semi1 = makePlayoffSlot(ctx, {
        id: 'semi-1',
        label: 'Semifinal 1',
        group: 'Semifinales',
        teamASource: '1° Tabla General',
        teamBSource: '4° Tabla General',
        teamA: t(0),
        teamB: t(3)
      });
      const semi2 = makePlayoffSlot(ctx, {
        id: 'semi-2',
        label: 'Semifinal 2',
        group: 'Semifinales',
        teamASource: '2° Tabla General',
        teamBSource: '3° Tabla General',
        teamA: t(1),
        teamB: t(2)
      });
      const finalSlot = makePlayoffSlot(ctx, {
        id: 'final',
        label: 'Gran Final (1° y 2° Puesto)',
        group: 'Finales',
        teamASource: 'Ganador Semifinal 1',
        teamBSource: 'Ganador Semifinal 2',
        teamA: semi1.winner,
        teamB: semi2.winner
      });
      const thirdSlot = makePlayoffSlot(ctx, {
        id: 'third-place',
        label: '3° y 4° Puesto',
        group: 'Finales',
        teamASource: 'Perdedor Semifinal 1',
        teamBSource: 'Perdedor Semifinal 2',
        teamA: semi1.loser,
        teamB: semi2.loser
      });
      const slots = [semi1, semi2, finalSlot, thirdSlot];
      const placementZones = [];
      if (teamCount > 4) {
        const placementLabel = teamCount === 5
          ? '5° Puesto (Directo por Tabla General)'
          : ('Puestos 5° al ' + teamCount + '° (Directo por Tabla General)');
        placementZones.push({
          label: placementLabel,
          offset: 5,
          eval: evalU,
          sliceStart: 4,
          sliceEnd: teamCount
        });
      }
      return {
        applicable: true,
        unlocked,
        reasons,
        slots,
        placementZones,
        allComplete: unlocked && slots.every(function (s) { return Boolean(s.match); })
      };
    }

    // +50 y +60: requiere haber cerrado Fase 1
    if (category.currentStage === STAGES.GENERAL) {
      return {
        applicable: true,
        unlocked: false,
        reasons: ['Primero cerrá la Fase de Grupos para generar las zonas de Segunda Fase.'],
        slots: [],
        placementZones: [],
        allComplete: false
      };
    }

    const z1 = zoneByCode(category, '1');
    const z2 = zoneByCode(category, '2');
    const e1 = evaluateSecondStageZone(ctx, z1);
    const e2 = evaluateSecondStageZone(ctx, z2);
    const reasons = [];
    if (!e1.complete) reasons.push('Zona 1: faltan ' + (e1.progress ? e1.progress.missing : 0) + ' partido(s).');
    else if (e1.unresolvedTies.length) reasons.push('Zona 1: hay empate(s) sin resolver.');
    if (!e2.complete) reasons.push('Zona 2: faltan ' + (e2.progress ? e2.progress.missing : 0) + ' partido(s).');
    else if (e2.unresolvedTies.length) reasons.push('Zona 2: hay empate(s) sin resolver.');

    const unlocked = Boolean(e1.ready && e2.ready);
    const r1 = unlocked ? e1.ranking.rows : [];
    const r2 = unlocked ? e2.ranking.rows : [];
    const t1 = function (idx) { return r1[idx] ? r1[idx].team : null; };
    const t2 = function (idx) { return r2[idx] ? r2[idx].team : null; };

    const semi1 = makePlayoffSlot(ctx, {
      id: 'semi-1',
      label: 'Semifinal 1',
      group: 'Semifinales',
      teamASource: '1° Zona 1',
      teamBSource: '2° Zona 2',
      teamA: t1(0),
      teamB: t2(1)
    });
    const semi2 = makePlayoffSlot(ctx, {
      id: 'semi-2',
      label: 'Semifinal 2',
      group: 'Semifinales',
      teamASource: '1° Zona 2',
      teamBSource: '2° Zona 1',
      teamA: t2(0),
      teamB: t1(1)
    });
    const finalSlot = makePlayoffSlot(ctx, {
      id: 'final',
      label: 'Final (1° y 2° Puesto)',
      group: 'Finales',
      teamASource: 'Ganador Semifinal 1',
      teamBSource: 'Ganador Semifinal 2',
      teamA: semi1.winner,
      teamB: semi2.winner
    });
    const thirdSlot = makePlayoffSlot(ctx, {
      id: 'third-place',
      label: '3° y 4° Puesto',
      group: 'Finales',
      teamASource: 'Perdedor Semifinal 1',
      teamBSource: 'Perdedor Semifinal 2',
      teamA: semi1.loser,
      teamB: semi2.loser
    });
    const fifthSlot = makePlayoffSlot(ctx, {
      id: 'fifth-place',
      label: '5° y 6° Puesto',
      group: 'Reclasificación',
      teamASource: '3° Zona 1',
      teamBSource: '3° Zona 2',
      teamA: t1(2),
      teamB: t2(2)
    });

    const slots = [semi1, semi2, finalSlot, thirdSlot, fifthSlot];
    const placementZones = [];

    if (isTorneo50(category)) {
      slots.push(makePlayoffSlot(ctx, {
        id: 'seventh-place',
        label: '7° y 8° Puesto',
        group: 'Reclasificación',
        teamASource: '4° Zona 1',
        teamBSource: '4° Zona 2',
        teamA: t1(3),
        teamB: t2(3)
      }));
      const z3 = zoneByCode(category, '3');
      const e3 = evaluateSecondStageZone(ctx, z3);
      placementZones.push({ label: 'Puestos 9° al 14° (Zona 3 · Ronda Estímulo)', offset: 9, eval: e3, sliceStart: 0, sliceEnd: 6 });
    } else if (isTorneo60(category)) {
      [
        { code: '3', offset: 7, label: 'Puestos 7° al 9° (Zona 3)' },
        { code: '4', offset: 10, label: 'Puestos 10° al 12° (Zona 4)' },
        { code: '5', offset: 13, label: 'Puestos 13° al 15° (Zona 5)' },
        { code: '6', offset: 16, label: 'Puestos 16° al 18° (Zona 6)' }
      ].forEach(function (spec) {
        const z = zoneByCode(category, spec.code);
        placementZones.push({ label: spec.label, offset: spec.offset, eval: evaluateSecondStageZone(ctx, z), sliceStart: 0, sliceEnd: 3 });
      });
    }

    const bracketsDone = unlocked && slots.every(function (s) { return Boolean(s.match); });
    const placementDone = placementZones.every(function (p) { return p.eval.ready; });

    return {
      applicable: true,
      unlocked,
      reasons,
      slots,
      placementZones,
      allComplete: bracketsDone && placementDone
    };
  }

  /**
   * Tabla general de posiciones finales del torneo (1°..14° / 1°..18° / 1°..8°).
   */
  function computeFinalStandings(ctx) {
    const category = ctx && ctx.category;
    const playoffs = computePlayoffs(ctx);
    if (!playoffs.applicable) return [];
    const byId = {};
    playoffs.slots.forEach(function (s) { byId[s.id] = s; });

    const rows = [];
    const pushBracket = function (posW, posL, slotId, origin) {
      const s = byId[slotId];
      rows.push({ position: posW, team: s && s.winner ? s.winner : null, origin: origin + ' · Ganador', detail: s && s.match ? s.match.score.replace('-', '–') : 'Pendiente' });
      rows.push({ position: posL, team: s && s.loser ? s.loser : null, origin: origin + ' · Perdedor', detail: s && s.match ? s.match.score.replace('-', '–') : 'Pendiente' });
    };

    pushBracket(1, 2, 'final', 'Final');
    pushBracket(3, 4, 'third-place', '3° y 4° Puesto');
    if (isTorneo50(category) || isTorneo60(category)) {
      pushBracket(5, 6, 'fifth-place', '5° y 6° Puesto');
    }
    if (isTorneo50(category)) {
      pushBracket(7, 8, 'seventh-place', '7° y 8° Puesto');
    }

    playoffs.placementZones.forEach(function (pz) {
      const count = pz.sliceEnd - pz.sliceStart;
      const sourceRows = pz.eval && pz.eval.ready ? pz.eval.ranking.rows.slice(pz.sliceStart, pz.sliceEnd) : [];
      for (let i = 0; i < count; i += 1) {
        const r = sourceRows[i] || null;
        rows.push({
          position: pz.offset + i,
          team: r ? r.team : null,
          origin: pz.label,
          detail: r ? (r.classificationPoints + ' pts · DIF ' + (r.difference > 0 ? '+' + r.difference : r.difference)) : 'En juego / Pendiente'
        });
      }
    });

    return rows;
  }

  // ---------------------------------------------------------------------------
  // Zona única y clasificación final (retrocompatible con +40 y genéricos)
  // ---------------------------------------------------------------------------

  function finalClassification(ctx) {
    const category = ctx.category;
    if (hasPlayoffStageFormat(category)) {
      const playoffs = computePlayoffs(ctx);
      const finalTable = computeFinalStandings(ctx);
      const reasons = playoffs.reasons.slice();
      playoffs.slots.forEach(function (s) {
        if (!s.match) reasons.push('Falta jugar: ' + s.label + '.');
      });
      playoffs.placementZones.forEach(function (pz) {
        if (!pz.eval.complete) reasons.push(pz.label + ': faltan partidos.');
        else if (pz.eval.unresolvedTies.length) reasons.push(pz.label + ': hay empate(s) sin resolver.');
      });
      return {
        zone: finalZone(category),
        progress: null,
        ranking: { rows: [], ties: [] },
        unresolvedTies: [],
        reasons,
        definitive: playoffs.allComplete,
        drift: qualificationDrift(ctx),
        playoffs,
        finalTable
      };
    }

    const zone = finalZone(category);
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
    else if (hasPlayoffStageFormat(category)) {
      if (category.currentStage === STAGES.GENERAL) {
        const qualification = computeQualification(ctx);
        const allComplete = qualification.zones.every(function (zq) { return zq.progress.complete; }) &&
          (!isTorneo50(category) || interzonalStatus(ctx).allPlayed);
        if (qualification.ready) code = PHASES.QUALIFIED;
        else if (allComplete) code = PHASES.QUALIFICATION_PENDING;
        else code = PHASES.FIRST_STAGE_IN_PROGRESS;
      } else {
        code = computePlayoffs(ctx).allComplete ? PHASES.FINAL_AVAILABLE : PHASES.SINGLE_ZONE_IN_PROGRESS;
      }
    } else if (category.currentStage === STAGES.ZONE_FINAL) {
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

  function convertCategoryToSingleZone(category, teams, matches, deps) {
    const zones = initialZones(category);
    const target = zones.length === 1
      ? zones[0]
      : { id: deps.newId('zone'), name: constants.SINGLE_ZONE_NAME, phase: constants.ZONE_PHASES.FINAL, teamIds: [] };
    target.phase = constants.ZONE_PHASES.FINAL;
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
    category.format = FORMATS.ROUND_ROBIN;
    category.currentStage = STAGES.ZONE_FINAL;
    category.zoneTournament = Object.assign(singleZoneTournament(target), {
      tieBreaks: (previous.tieBreaks || []).filter(function (item) { return item.scope.indexOf(STAGES.ZONE_FINAL + '|') === 0; })
    });
    return target;
  }

  return Object.freeze({
    TORNEO_50_SPEC,
    TORNEO_60_SPEC,
    defaultInterzonals,
    emptyZoneTournament,
    singleZoneTournament,
    flow,
    isTorneo50,
    isTorneo60,
    isTorneo68,
    isSingleZoneFormat,
    hasPlayoffStageFormat,
    inferFormat,
    zoneById,
    zoneByCode,
    initialZones,
    secondStageZones,
    finalZone,
    isInitialZone,
    isSecondStageZone,
    teamInitialZone,
    stageForZone,
    scopeKey,
    zoneTargetTeams,
    liveMatches,
    interzonalSlots,
    interzonalZones,
    isInterzonalZone,
    interzonalMatches,
    interzonalMatchForSlot,
    interzonalStatus,
    scopeMatches,
    zoneTeams,
    pairKey,
    zoneProgress,
    buildRoundRobinFixture,
    isFixtureSyncedWithZone,
    computeZoneFixture,
    isFinalAccumulatedScope,
    qualifiedBaselineMap,
    syncCarriedStats,
    zoneRanking,
    zoneQualification,
    assignmentIssues,
    computeQualification,
    qualificationDrift,
    playoffMatches,
    findPlayoffMatch,
    computePlayoffs,
    computeFinalStandings,
    finalClassification,
    phase,
    convertCategoryToSingleZone
  });
}));
