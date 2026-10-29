'use strict';
/**
 * Utilidades compartidas por los tests (node:test, sin dependencias externas).
 */
const { createTournamentService } = require('../src/application/tournament-service.js');
const { createLocalStorageRepository, createMemoryStorage } = require('../src/infrastructure/local-storage-repository.js');

/** Generador determinista de ids para que los tests sean reproducibles. */
function idGenerator() {
  let counter = 0;
  return function newId(prefix) { counter += 1; return prefix + '-' + String(counter).padStart(4, '0'); };
}

function clock() {
  let tick = 0;
  return function now() { tick += 1; return new Date(Date.UTC(2026, 9, 1, 12, 0, tick)).toISOString(); };
}

const silentLogger = { warn() {}, info() {} };

/** Crea un servicio sobre un almacenamiento (en memoria por defecto). */
function makeService(storage) {
  const store = storage || createMemoryStorage();
  const newId = idGenerator();
  const now = clock();
  const repository = createLocalStorageRepository(store, { newId, now, logger: silentLogger });
  const service = createTournamentService({ repository, newId, now });
  return { service, storage: store, repository };
}

/** Sets válidos para cada resultado, vistos desde el equipo A. */
const SETS = {
  '2-0': [{ a: 15, b: 8 }, { a: 15, b: 10 }],
  '2-1': [{ a: 15, b: 12 }, { a: 9, b: 15 }, { a: 15, b: 11 }],
  '1-2': [{ a: 12, b: 15 }, { a: 15, b: 9 }, { a: 11, b: 15 }],
  '0-2': [{ a: 8, b: 15 }, { a: 10, b: 15 }]
};

/** Carga manualmente un resultado "A x-y B" usando el flujo de la UI. */
function play(service, teamA, result, teamB, zoneId, sets) {
  const parts = result.split('-');
  return service.createMatchFromSets(teamA.id, Number(parts[0]), teamB.id, Number(parts[1]), sets || SETS[result], zoneId);
}

/**
 * Crea una categoría con zonas y equipos.
 * @returns {{category, zones: Array<{zone, teams: Array}>}}
 */
function setupZones(service, categoryName, zoneCount, teamsPerZone) {
  const category = service.createCategory(categoryName, 'ZONES');
  const zones = [];
  for (let z = 0; z < zoneCount; z += 1) {
    const zone = service.createZone('Zona ' + String.fromCharCode(65 + z));
    const teams = [];
    for (let t = 0; t < teamsPerZone; t += 1) teams.push(service.createTeam(zone.name.slice(-1) + (t + 1), zone.id));
    zones.push({ zone, teams });
  }
  return { category, zones };
}

/**
 * Todos contra todos con orden estricto: el equipo i le gana al j (i < j).
 * Usa 2-0 para que los puntos queden escalonados sin empates.
 */
function playStrictRoundRobin(service, teams, zoneId) {
  for (let i = 0; i < teams.length; i += 1) {
    for (let j = i + 1; j < teams.length; j += 1) play(service, teams[i], '2-0', teams[j], zoneId);
  }
}

function names(rows) { return rows.map((row) => row.team.name); }

module.exports = { makeService, play, setupZones, playStrictRoundRobin, names, SETS, createMemoryStorage, idGenerator, clock, silentLogger };
