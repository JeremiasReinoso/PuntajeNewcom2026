/**
 * Tablas de posiciones y detección de empates.
 *
 * Sistema de puntuación oficial 3-2-1:
 *   - Victoria 2-0: 3 puntos para el ganador, 1 punto para el perdedor.
 *   - Victoria 2-1: 2 puntos para el ganador, 1 punto para el perdedor.
 *
 * Criterios de orden en cascada:
 *   1. Más puntos de clasificación (3, 2 y 1 por partido).
 *   2. Mayor diferencia de tantos (DIF = PF - PC).
 *   3. Más puntos a favor (PF, suma de marcadores de sets).
 *   4. Menos puntos en contra (PC).
 *   5. Enfrentamiento directo entre los equipos empatados.
 *   6. Nombre alfabético / id — SÓLO para mostrar un orden estable; NO es un criterio
 *      reglamentario. Por eso, dos equipos iguales en 1–5 se reportan como empate.
 *
 * Un empate puede resolverse manualmente: la resolución guarda el orden elegido y
 * una "firma" (equipos + estadísticas). Si los resultados cambian y la firma deja
 * de coincidir, la resolución deja de aplicarse automáticamente y el empate vuelve
 * a mostrarse como pendiente. No se inventa ningún criterio nuevo.
 *
 * Capa: domain. Funciones puras: no modifican los objetos recibidos.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./scoring.js'));
  } else {
    root.PuntajeNewcomModules = root.PuntajeNewcomModules || {};
    root.PuntajeNewcomModules.standings = factory(root.PuntajeNewcomModules.scoring);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (scoring) {
  'use strict';

  /** Total de puntajes anotados ("cargas") del equipo. */
  function calculateTeamTotal(team) {
    return team.scoreEntries.reduce(function (total, entry) { return total + entry.points; }, 0);
  }

  /** Total de cargas del equipo en una etapa (o todas si `stage` es vacío). */
  function calculateTeamStageTotal(team, stage) {
    return team.scoreEntries
      .filter(function (entry) { return !stage || entry.stage === stage; })
      .reduce(function (total, entry) { return total + entry.points; }, 0);
  }

  function involves(match, teamId) {
    return Boolean(match) && !match.archived && (match.winnerId === teamId || match.loserId === teamId) && match.winnerId !== match.loserId;
  }

  function headToHeadDiff(aTeamId, bTeamId, matches) {
    if (!matches || !matches.length) return 0;
    const direct = matches.filter(function (m) {
      return m && !m.archived && (
        (m.winnerId === aTeamId && m.loserId === bTeamId) ||
        (m.winnerId === bTeamId && m.loserId === aTeamId)
      );
    });
    if (!direct.length) return 0;
    const aWins = direct.filter(function (m) { return m.winnerId === aTeamId; }).length;
    const bWins = direct.filter(function (m) { return m.winnerId === bTeamId; }).length;
    if (aWins > bWins) return -1;
    if (bWins > aWins) return 1;
    return 0;
  }

  /** Puntos a favor/en contra derivados de los sets de los partidos dados. */
  function setStatsFor(teamId, matches) {
    return (Array.isArray(matches) ? matches : []).reduce(function (stats, match) {
      if (!involves(match, teamId)) return stats;
      const isWinner = match.winnerId === teamId;
      scoring.matchSetsFor(match).forEach(function (set) {
        stats.for += isWinner ? set.a : set.b;
        stats.against += isWinner ? set.b : set.a;
      });
      return stats;
    }, { for: 0, against: 0 });
  }

  function classificationPointsFor(teamId, matches) {
    return (Array.isArray(matches) ? matches : []).reduce(function (total, match) {
      return total + scoring.matchPointsForTeam(match, teamId);
    }, 0);
  }

  /**
   * Comparador oficial de la tabla:
   * 1. Mayor puntuación de clasificación (3, 2 y 1).
   * 2. Mayor diferencia de puntos (DIF = PF - PC).
   * 3. Mayor cantidad de puntos a favor (PF).
   * 4. Menor cantidad de puntos en contra (PC).
   * 5. Enfrentamiento directo entre los equipos empatados.
   * 6. Criterio determinista final (orden alfabético por nombre / id).
   */
  function compareRows(a, b, matches) {
    if (b.classificationPoints !== a.classificationPoints) {
      return b.classificationPoints - a.classificationPoints;
    }
    if (b.difference !== a.difference) {
      return b.difference - a.difference;
    }
    if (b.pointsFor !== a.pointsFor) {
      return b.pointsFor - a.pointsFor;
    }
    if (a.pointsAgainst !== b.pointsAgainst) {
      return a.pointsAgainst - b.pointsAgainst;
    }
    const h2h = headToHeadDiff(a.team.id, b.team.id, matches);
    if (h2h !== 0) return h2h;
    return a.team.name.localeCompare(b.team.name) || (a.team.id && b.team.id ? a.team.id.localeCompare(b.team.id) : 0);
  }

  /** Dos filas están empatadas si coinciden en puntos, diferencia, tantos y no hay ganador directo. */
  function sameRanking(a, b, matches) {
    return a.classificationPoints === b.classificationPoints &&
      a.difference === b.difference &&
      a.pointsFor === b.pointsFor &&
      a.pointsAgainst === b.pointsAgainst &&
      headToHeadDiff(a.team.id, b.team.id, matches) === 0;
  }

  function rankingKey(row) {
    return row.classificationPoints + '/' + row.difference + '/' + row.pointsFor + '/' + row.pointsAgainst;
  }

  function emptyCarriedStats() {
    return {
      classificationPoints: 0,
      resultCount: 0,
      wins: 0,
      losses: 0,
      won20: 0,
      won21: 0,
      lost02: 0,
      lost12: 0,
      setWins: 0,
      setLosses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      difference: 0,
      setRatio: 0,
      ptosRatio: 0
    };
  }

  function nonNegativeInt(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }

  function computeSetRatio(setWins, setLosses) {
    return setLosses > 0 ? (setWins / setLosses) : (setWins > 0 ? 1000 + setWins : 0);
  }

  function computePointsRatio(pointsFor, pointsAgainst) {
    return pointsAgainst > 0 ? (pointsFor / pointsAgainst) : (pointsFor > 0 ? 1000 + pointsFor : 0);
  }

  /** Normaliza un bloque de estadísticas acumuladas transferidas desde la fase clasificatoria. */
  function normalizeCarriedStats(raw) {
    if (!raw || typeof raw !== 'object') return emptyCarriedStats();
    const setWins = nonNegativeInt(raw.setWins);
    const setLosses = nonNegativeInt(raw.setLosses);
    const pointsFor = nonNegativeInt(raw.pointsFor);
    const pointsAgainst = nonNegativeInt(raw.pointsAgainst);
    const wins = nonNegativeInt(raw.wins);
    const losses = nonNegativeInt(raw.losses);
    const won20 = nonNegativeInt(raw.won20);
    const won21 = nonNegativeInt(raw.won21);
    const lost02 = nonNegativeInt(raw.lost02);
    const lost12 = nonNegativeInt(raw.lost12);
    const resultCount = Math.max(nonNegativeInt(raw.resultCount), wins + losses);
    return {
      classificationPoints: nonNegativeInt(raw.classificationPoints),
      resultCount,
      wins,
      losses,
      won20,
      won21,
      lost02,
      lost12,
      setWins,
      setLosses,
      pointsFor,
      pointsAgainst,
      difference: pointsFor - pointsAgainst,
      setRatio: computeSetRatio(setWins, setLosses),
      ptosRatio: computePointsRatio(pointsFor, pointsAgainst)
    };
  }

  /** Extrae una instantánea inmutable de estadísticas transferibles a partir de una fila de tabla. */
  function toCarriedStats(row) {
    if (!row || typeof row !== 'object') return emptyCarriedStats();
    return normalizeCarriedStats(row);
  }

  /**
   * Calcula la tabla de posiciones.
   * @param {Array} teams Equipos que integran la tabla.
   * @param {Array} matches Partidos YA filtrados por ámbito (etapa/zona, no archivados).
   * @param {{scoreStage?: string, baselineByTeamId?: Object}} [options] Etapa y estadísticas base acumuladas de fase previa.
   */
  function computeStandings(teams, matches, options) {
    const scoreStage = options && options.scoreStage;
    const baselineByTeamId = options && options.baselineByTeamId && typeof options.baselineByTeamId === 'object'
      ? options.baselineByTeamId
      : null;
    const scopedMatches = (Array.isArray(matches) ? matches : []).filter(function (match) {
      return match && !match.archived && Boolean(scoring.resolveMatchScore(match));
    });
    return teams.map(function (team) {
      const base = baselineByTeamId && baselineByTeamId[team.id]
        ? normalizeCarriedStats(baselineByTeamId[team.id])
        : null;
      const teamMatches = scopedMatches.filter(function (match) { return involves(match, team.id); });
      const setStats = setStatsFor(team.id, scopedMatches);
      const matchPoints = classificationPointsFor(team.id, scopedMatches);
      let wins = base ? base.wins : 0;
      let losses = base ? base.losses : 0;
      let won20 = base ? base.won20 : 0;
      let won21 = base ? base.won21 : 0;
      let lost02 = base ? base.lost02 : 0;
      let lost12 = base ? base.lost12 : 0;
      let setWins = base ? base.setWins : 0;
      let setLosses = base ? base.setLosses : 0;
      teamMatches.forEach(function (match) {
        const isWinner = match.winnerId === team.id;
        const score = scoring.resolveMatchScore(match);
        if (isWinner) {
          wins += 1;
          setWins += 2;
          if (score === '2-1') {
            won21 += 1;
            setLosses += 1;
          } else {
            won20 += 1;
          }
        } else {
          losses += 1;
          setLosses += 2;
          if (score === '2-1') {
            lost12 += 1;
            setWins += 1;
          } else {
            lost02 += 1;
          }
        }
      });
      const classificationPoints = (base ? base.classificationPoints : 0) + matchPoints;
      const pointsFor = (base ? base.pointsFor : 0) + setStats.for;
      const pointsAgainst = (base ? base.pointsAgainst : 0) + setStats.against;
      const setRatio = computeSetRatio(setWins, setLosses);
      const ptosRatio = computePointsRatio(pointsFor, pointsAgainst);
      return {
        team,
        resultCount: (base ? base.resultCount : 0) + teamMatches.length,
        wins,
        losses,
        won20,
        won21,
        lost02,
        lost12,
        stagePoints: classificationPoints,
        classificationPoints,
        scorePoints: calculateTeamStageTotal(team, scoreStage),
        totalPoints: calculateTeamTotal(team),
        pointsFor,
        pointsAgainst,
        difference: pointsFor - pointsAgainst,
        setWins,
        setLosses,
        setRatio,
        ptosRatio
      };
    }).sort(function (a, b) {
      return compareRows(a, b, scopedMatches);
    });
  }

  /** Firma de un grupo empatado: equipos + estadísticas compartidas. */
  function tieSignature(rows) {
    return rows.map(function (row) { return row.team.id; }).sort().join(',') + '@' + rankingKey(rows[0]);
  }

  /**
   * Agrupa empates y aplica resoluciones manuales vigentes.
   * @param {Array} rows Filas ordenadas por `computeStandings`.
   * @param {Array<{signature: string, order: string[]}>} [resolutions]
   * @returns {{rows: Array, ties: Array<{teamIds: string[], start: number, end: number, signature: string, resolved: boolean}>}}
   */
  function rankWithTies(rows, resolutions, matches) {
    const available = Array.isArray(resolutions) ? resolutions : [];
    const output = [];
    const ties = [];
    let index = 0;
    while (index < rows.length) {
      let end = index;
      while (end + 1 < rows.length && sameRanking(rows[index], rows[end + 1], matches)) end += 1;
      let group = rows.slice(index, end + 1);
      if (group.length > 1) {
        const signature = tieSignature(group);
        const resolution = available.filter(function (item) { return item.signature === signature; })[0];
        const resolved = Boolean(resolution);
        if (resolved) {
          group = resolution.order.map(function (teamId) {
            return group.filter(function (row) { return row.team.id === teamId; })[0];
          }).filter(Boolean);
        }
        group = group.map(function (row) { return Object.assign({}, row, { tied: true, tieResolved: resolved }); });
        ties.push({ teamIds: group.map(function (row) { return row.team.id; }), start: index, end, signature, resolved });
      }
      group.forEach(function (row) { output.push(row); });
      index = end + 1;
    }
    return { rows: output, ties };
  }

  return Object.freeze({
    calculateTeamTotal,
    calculateTeamStageTotal,
    setStatsFor,
    classificationPointsFor,
    compareRows,
    sameRanking,
    rankingKey,
    emptyCarriedStats,
    normalizeCarriedStats,
    toCarriedStats,
    computeStandings,
    tieSignature,
    rankWithTies
  });
}));
