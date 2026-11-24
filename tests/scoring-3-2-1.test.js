'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const scoring = require('../src/domain/scoring.js');
const standings = require('../src/domain/standings.js');
const stateSchema = require('../src/infrastructure/state-schema.js');
const { makeService, play, setupZones, SETS, createMemoryStorage, idGenerator, clock } = require('./helpers.js');

describe('Sistema de puntuación 3-2-1 de PuntajeNewcom', () => {
  it('asigna exactamente 3 puntos al ganador y 1 punto al perdedor en victoria 2-0', () => {
    const pts = scoring.resultPoints('2-0');
    assert.deepEqual(pts, { winner: 3, loser: 1 });
    assert.ok(pts.winner > pts.loser, 'El ganador siempre debe recibir más puntos que el perdedor');
  });

  it('asigna exactamente 2 puntos al ganador y 1 punto al perdedor en victoria 2-1', () => {
    const pts = scoring.resultPoints('2-1');
    assert.deepEqual(pts, { winner: 3, loser: 2 });
    assert.ok(pts.winner > pts.loser, 'El ganador siempre debe recibir más puntos que el perdedor');
  });

  it('normaliza resultados vistos desde el perdedor (0-2 y 1-2) respetando la regla 3-2-1', () => {
    assert.deepEqual(scoring.resultPoints('0-2'), { winner: 3, loser: 1 });
    assert.deepEqual(scoring.resultPoints('1-2'), { winner: 3, loser: 2 });
  });

  it('rechaza resultados fuera del sistema 2-0 / 2-1', () => {
    for (const invalid of ['', '0-0', '1-0', '1-1', '3-0', '3-1', '3-2', null, undefined]) {
      assert.throws(() => scoring.resultPoints(invalid), /2–0 o 2–1/);
    }
  });

  it('no confunde puntos de clasificación (3, 2, 1) con los puntos reales anotados en cada set', () => {
    const { service } = makeService();
    const { category, zones } = setupZones(service, 'Categoría +50', 1, 2);
    const { zone, teams } = zones[0];
    const [teamA, teamB] = teams;

    // Equipo A gana 2-1 pero Equipo B anota más tantos totales en los sets (15-14, 5-15, 15-14 => A=35, B=43)
    const customSets = [
      { a: 15, b: 14 },
      { a: 5, b: 15 },
      { a: 15, b: 14 }
    ];
    play(service, teamA, '2-1', teamB, zone.id, customSets);

    const table = service.standings(category.id, 'GENERAL', zone.id);
    assert.equal(table[0].team.id, teamA.id, 'El ganador 2-1 debe liderar la tabla por puntos de clasificación');
    assert.equal(table[0].classificationPoints, 3);
    assert.equal(table[0].pointsFor, 35);
    assert.equal(table[0].pointsAgainst, 43);
    assert.equal(table[0].difference, -8);

    assert.equal(table[1].team.id, teamB.id);
    assert.equal(table[1].classificationPoints, 2);
    assert.equal(table[1].pointsFor, 43);
    assert.equal(table[1].pointsAgainst, 35);
    assert.equal(table[1].difference, 8);
  });

  it('calcula automáticamente la tabla de posiciones en un todos contra todos con resultados 2-0 y 2-1', () => {
    const { service } = makeService();
    const { category, zones } = setupZones(service, 'Categoría +50', 1, 3);
    const { zone, teams } = zones[0];
    const [a, b, c] = teams;

    // A gana 2-0 a B -> A: 3 pts, B: 1 pt
    play(service, a, '2-0', b, zone.id);
    // A gana 2-1 a C -> A: +3 = 6 pts, C: 2 pts
    play(service, a, '2-1', c, zone.id);
    // B gana 2-1 a C -> B: +3 = 4 pts (DIF -11), C: +2 = 4 pts (DIF -2)
    play(service, b, '2-1', c, zone.id);

    const rows = service.standings(category.id, 'GENERAL', zone.id);
    assert.deepEqual(rows.map((r) => r.team.id), [a.id, c.id, b.id]);
    assert.deepEqual(rows.map((r) => r.classificationPoints), [6, 4, 4]);
    assert.equal(service.classificationPoints(a.id, 'GENERAL', zone.id), 6);
    assert.equal(service.classificationPoints(b.id, 'GENERAL', zone.id), 4);
    assert.equal(service.classificationPoints(c.id, 'GENERAL', zone.id), 4);
  });

  it('recalcula puntos de clasificación y estadísticas automáticamente al modificar o eliminar un resultado', () => {
    const { service } = makeService();
    const { category, zones } = setupZones(service, 'Categoría +50', 1, 2);
    const { zone, teams } = zones[0];
    const [teamA, teamB] = teams;

    // Inicialmente A gana 2-0 a B -> A=3, B=1
    const match = play(service, teamA, '2-0', teamB, zone.id, SETS['2-0']);
    let rows = service.standings(category.id, 'GENERAL', zone.id);
    assert.equal(rows.find((r) => r.team.id === teamA.id).classificationPoints, 3);
    assert.equal(rows.find((r) => r.team.id === teamB.id).classificationPoints, 1);

    // Se modifica a victoria 2-1 de A -> A=3, B=2
    service.updateMatchFromSets(match.id, teamA.id, 2, 1, SETS['2-1']);
    rows = service.standings(category.id, 'GENERAL', zone.id);
    assert.equal(rows.find((r) => r.team.id === teamA.id).classificationPoints, 3);
    assert.equal(rows.find((r) => r.team.id === teamB.id).classificationPoints, 2);
    assert.equal(rows.find((r) => r.team.id === teamA.id).pointsFor, 39);
    assert.equal(rows.find((r) => r.team.id === teamA.id).pointsAgainst, 38);

    // Se invierte el ganador: B gana 2-0 (0-2 desde A) -> B=3, A=1
    service.updateMatchFromSets(match.id, teamA.id, 0, 2, SETS['0-2']);
    rows = service.standings(category.id, 'GENERAL', zone.id);
    assert.equal(rows[0].team.id, teamB.id);
    assert.equal(rows[0].classificationPoints, 3);
    assert.equal(rows[1].team.id, teamA.id);
    assert.equal(rows[1].classificationPoints, 1);

    // Se elimina el partido -> A=0, B=0
    service.deleteMatchResult(match.id);
    rows = service.standings(category.id, 'GENERAL', zone.id);
    assert.equal(rows[0].classificationPoints, 0);
    assert.equal(rows[1].classificationPoints, 0);
    assert.equal(rows[0].pointsFor, 0);
    assert.equal(rows[1].pointsFor, 0);
  });

  it('persiste y recupera correctamente los resultados manteniendo intacto el cálculo 3-2-1', () => {
    const storage = createMemoryStorage();
    const { service: s1 } = makeService(storage);
    const category = s1.createCategory('Categoría +60');
    const singleZoneId = s1.selectedCategory().zoneTournament.secondStageZoneId;
    const t1 = s1.createTeam('Águilas');
    const t2 = s1.createTeam('Cóndores');
    const t3 = s1.createTeam('Halcones');

    play(s1, t1, '2-0', t2, singleZoneId);
    play(s1, t2, '2-1', t3, singleZoneId);

    // Recargar desde storage en una nueva instancia
    const { service: s2 } = makeService(storage);
    const rows = s2.standings(category.id, 'ZONE_FINAL', singleZoneId);
    const byId = Object.fromEntries(rows.map((r) => [r.team.id, r]));

    // t1: 1 victoria 2-0 = 3 pts
    assert.equal(byId[t1.id].classificationPoints, 3);
    // t2: 1 derrota 0-2 (1 pt) + 1 victoria 2-1 (3 pts) = 4 pts
    assert.equal(byId[t2.id].classificationPoints, 4);
    // t3: 1 derrota 1-2 = 2 pts
    assert.equal(byId[t3.id].classificationPoints, 2);
  });

  it('valida estrictamente sets inválidos o tercer set innecesario tras un 2-0', () => {
    // 3 sets donde los dos primeros ya definieron un 2-0 (15-10, 15-8, 10-15)
    assert.throws(() => {
      scoring.validateMatchSets([{ a: 15, b: 10 }, { a: 15, b: 8 }, { a: 10, b: 15 }]);
    }, /resultado válido 2–0 o 2–1/);

    // Set empatado dentro de una lista de 3 sets no debe filtrarse silenciosamente
    assert.throws(() => {
      scoring.validateMatchSets([{ a: 15, b: 10 }, { a: 15, b: 8 }, { a: 12, b: 12 }]);
    }, /2 sets para un 2–0 o 3 sets para un 2–1/);
  });

  it('normaliza el esquema descartando sets inconsistentes sin alterar puntos 3-2-1', () => {
    const newId = idGenerator();
    const now = clock();
    const raw = {
      categories: [{ id: 'cat-1', name: 'Categoría +50', format: 'zonas_y_final', currentStage: 'GENERAL' }],
      teams: [
        { id: 't-1', name: 'Equipo 1', categoryId: 'cat-1', status: 'ACTIVE', stage: 'GENERAL' },
        { id: 't-2', name: 'Equipo 2', categoryId: 'cat-1', status: 'ACTIVE', stage: 'GENERAL' }
      ],
      matchResults: [
        { id: 'm-1', categoryId: 'cat-1', winnerId: 't-1', loserId: 't-2', score: '2-0', sets: [{ a: 15, b: 10 }, { a: 15, b: 12 }], stage: 'GENERAL' }
      ],
      selectedCategoryId: 'cat-1'
    };
    const { state } = stateSchema.normalize(raw, { newId, now });
    assert.equal(state.matchResults.length, 1);
    assert.equal(standings.classificationPointsFor('t-1', state.matchResults), 3);
    assert.equal(standings.classificationPointsFor('t-2', state.matchResults), 1);
  });

  it('verifica la integración completa en app.js (cliente navegador) para 2-0, 2-1, edición y zona única', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const vm = require('node:vm');

    const storage = createMemoryStorage();
    const makeEl = () => ({
      innerHTML: '',
      textContent: '',
      hidden: false,
      disabled: false,
      value: '',
      className: '',
      classList: { toggle() {}, add() {}, remove() {} },
      querySelectorAll() { return []; },
      querySelector() { return null; },
      addEventListener() {},
      setAttribute() {},
      getAttribute() { return ''; },
      closest() { return null; },
      focus() {},
      select() {},
      click() {}
    });

    const context = {
      window: {},
      localStorage: storage,
      document: {
        documentElement: makeEl(),
        getElementById() { return makeEl(); }
      },
      FormData: function () {},
      console
    };
    context.globalThis = context;
    vm.createContext(context);
    const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    vm.runInContext(code, context);

    const api = context.window.PuntajeNewcom;
    assert.deepEqual({ ...api.resultPoints('2-0') }, { winner: 3, loser: 1 });
    assert.deepEqual({ ...api.resultPoints('2-1') }, { winner: 3, loser: 2 });
    assert.throws(() => api.resultPoints('3-0'), /2–0 o 2–1/);

    const cat = api.createCategory('Categoría +60');
    const zoneId = cat.zoneTournament.secondStageZoneId;
    const tA = api.createTeam('Equipo A');
    const tB = api.createTeam('Equipo B');
    const tC = api.createTeam('Equipo C');

    const m1 = api.addMatchFromSets(tA.id, 2, tB.id, 0, SETS['2-0'], zoneId);
    api.addMatchFromSets(tA.id, 2, tC.id, 1, SETS['2-1'], zoneId);

    let table = api.calculateStandings(cat.id, 'ZONE_FINAL', zoneId);
    const map1 = Object.fromEntries(table.map((r) => [r.team.id, r]));
    assert.equal(map1[tA.id].classificationPoints, 6); // 3 (2-0) + 3 (2-1)
    assert.equal(map1[tB.id].classificationPoints, 1); // 1 (0-2)
    assert.equal(map1[tC.id].classificationPoints, 2); // 2 (1-2)

    // Modificar m1 de 2-0 a 1-2 (gana B 2-1)
    api.updateMatchFromSets(m1.id, tA.id, 1, 2, SETS['1-2']);
    table = api.calculateStandings(cat.id, 'ZONE_FINAL', zoneId);
    const map2 = Object.fromEntries(table.map((r) => [r.team.id, r]));
    assert.equal(map2[tA.id].classificationPoints, 5); // 2 (1-2) + 3 (2-1)
    assert.equal(map2[tB.id].classificationPoints, 3); // 3 (2-1)
    assert.equal(map2[tC.id].classificationPoints, 2); // 2 (1-2)
  });
});
