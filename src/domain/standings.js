/**
 * Tablas de posiciones y detección de empates.
 *
 * Criterios de orden (idénticos a la versión anterior, en este orden):
 *   1. Más puntos de clasificación (3/2/1/0 por partido).
 *   2. Más puntos a favor (suma de marcadores de sets).
 *   3. Menos puntos en contra.
 *   4. Nombre alfabético — SÓLO para mostrar un orden estable; NO es un criterio
 *      reglamentario. Por eso, dos equipos iguales en 1–3 se reportan como empate.
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
    return match.winnerId === teamId || match.loserId === teamId;
  }

  /** Puntos a favor/en contra derivados de los sets de los partidos dados. */
  function setStatsFor(teamId, matches) {
    return matches.reduce(function (stats, match) {
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
    return matches.reduce(function (total, match) {
      if (!involves(match, teamId)) return total;
      const points = scoring.resultPoints(match.score);
      return total + (match.winnerId === teamId ? points.winner : points.loser);
    }, 0);
  }

  /** Comparador de la tabla (criterios existentes + desempate visual por nombre). */
  function compareRows(a, b) {
    return b.classificationPoints - a.classificationPoints ||
      b.pointsFor - a.pointsFor ||
      a.pointsAgainst - b.pointsAgainst ||
      a.team.name.localeCompare(b.team.name);
  }

  /** Dos filas están empatadas si coinciden en todos los criterios reglamentarios. */
  function sameRanking(a, b) {
    return a.classificationPoints === b.classificationPoints &&
      a.pointsFor === b.pointsFor &&
      a.pointsAgainst === b.pointsAgainst;
  }

  function rankingKey(row) {
    return row.classificationPoints + '/' + row.pointsFor + '/' + row.pointsAgainst;
  }

  /**
   * Calcula la tabla de posiciones.
   * @param {Array} teams Equipos que integran la tabla.
   * @param {Array} matches Partidos YA filtrados por ámbito (etapa/zona, no archivados).
   * @param {{scoreStage?: string}} [options] Etapa usada para totalizar cargas de puntaje.
   */
  function computeStandings(teams, matches, options) {
    const scoreStage = options && options.scoreStage;
    return teams.map(function (team) {
      const setStats = setStatsFor(team.id, matches);
      const classificationPoints = classificationPointsFor(team.id, matches);
      return {
        team,
        resultCount: matches.filter(function (match) { return involves(match, team.id); }).length,
        stagePoints: classificationPoints,
        classificationPoints,
        scorePoints: calculateTeamStageTotal(team, scoreStage),
        totalPoints: calculateTeamTotal(team),
        pointsFor: setStats.for,
        pointsAgainst: setStats.against,
        difference: setStats.for - setStats.against
      };
    }).sort(compareRows);
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
  function rankWithTies(rows, resolutions) {
    const available = Array.isArray(resolutions) ? resolutions : [];
    const output = [];
    const ties = [];
    let index = 0;
    while (index < rows.length) {
      let end = index;
      while (end + 1 < rows.length && sameRanking(rows[index], rows[end + 1])) end += 1;
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
    computeStandings,
    tieSignature,
    rankWithTies
  });
}));
