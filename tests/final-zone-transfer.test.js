'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const stateSchema = require('../src/infrastructure/state-schema.js');
const { makeService, play, setupZones, SETS, createMemoryStorage, idGenerator, clock } = require('./helpers.js');

describe('Transferencia y continuidad de estadísticas hacia la Zona Final', () => {
  it('transfiere todas las estadísticas de fase clasificatoria al generar la Zona Final sin reiniciar ni duplicar partidos', () => {
    const { service } = makeService();
    // Zona A con 5 equipos (4 partidos por equipo) y Zona B con 3 equipos
    const cat = service.createCategory('Categoría +50', 'ZONES');
    const zA = service.createZone('Zona A');
    const aTeams = ['A1', 'A2', 'A3', 'A4', 'A5'].map((n) => service.createTeam(n, zA.id));
    const zB = service.createZone('Zona B');
    const bTeams = ['B1', 'B2', 'B3'].map((n) => service.createTeam(n, zB.id));

    const [a1, a2, a3, a4, a5] = aTeams;
    const [b1, b2, b3] = bTeams;

    // A1 juega 4 partidos: gana 3 (2-0) y pierde 1 (0-2) => 10 pts, 4 PJ, 3 PG, 1 PP, 6 SF, 2 SE, PF=128, PC=98, DIF=+30
    play(service, a1, '2-0', a3, zA.id, [{ a: 15, b: 9 }, { a: 15, b: 9 }]);   // 30 / 18
    play(service, a1, '2-0', a4, zA.id, [{ a: 15, b: 9 }, { a: 15, b: 10 }]);  // 30 / 19
    play(service, a1, '2-0', a5, zA.id, [{ a: 15, b: 9 }, { a: 15, b: 10 }]);  // 30 / 19
    play(service, a2, '2-0', a1, zA.id, [{ a: 21, b: 19 }, { a: 21, b: 19 }]); // A1: 38 / 42 -> Total A1: 128 PF, 98 PC

    // Completar resto de Zona A para poder cerrar zonas
    play(service, a2, '2-0', a3, zA.id, [{ a: 15, b: 8 }, { a: 15, b: 8 }]);
    play(service, a2, '2-0', a4, zA.id, [{ a: 15, b: 8 }, { a: 15, b: 8 }]);
    play(service, a2, '2-0', a5, zA.id, [{ a: 15, b: 8 }, { a: 15, b: 8 }]);
    play(service, a3, '2-1', a4, zA.id, SETS['2-1']);
    play(service, a3, '2-0', a5, zA.id, SETS['2-0']);
    play(service, a4, '2-1', a5, zA.id, SETS['2-1']);

    // Completar Zona B (b1 gana 2-0 y 2-1, b2 gana 2-0 a b3)
    play(service, b1, '2-0', b2, zB.id, [{ a: 15, b: 10 }, { a: 15, b: 10 }]);
    play(service, b1, '2-1', b3, zB.id, [{ a: 15, b: 10 }, { a: 10, b: 15 }, { a: 15, b: 8 }]);
    play(service, b2, '2-0', b3, zB.id, [{ a: 15, b: 7 }, { a: 15, b: 9 }]);

    const matchCountBeforeConfirm = service.matchesOf(cat.id).length;
    const qualified = service.confirmZones();
    assert.equal(qualified.length, 4);
    // Regla 2: No duplicar partidos de la fase clasificatoria
    assert.equal(service.matchesOf(cat.id).length, matchCountBeforeConfirm);

    const finalZoneId = service.selectedCategory().zoneTournament.secondStageZoneId;
    // El progreso de cruces propios de la Zona Final inicia en 0 de 6
    const progress = service.zoneProgress(cat.id, finalZoneId);
    assert.equal(progress.played, 0);
    assert.equal(progress.required, 6);

    // Regla 1 y sección 2: Verificar las 15 estadísticas transferidas en la tabla de Zona Final
    const finalRows = service.standings(cat.id, 'ZONE_FINAL', finalZoneId);
    const rowA1 = finalRows.find((r) => r.team.id === a1.id);
    assert.equal(rowA1.classificationPoints, 10);
    assert.equal(rowA1.resultCount, 4);
    assert.equal(rowA1.wins, 3);
    assert.equal(rowA1.losses, 1);
    assert.equal(rowA1.setWins, 6);
    assert.equal(rowA1.setLosses, 2);
    assert.equal(rowA1.pointsFor, 128);
    assert.equal(rowA1.pointsAgainst, 98);
    assert.equal(rowA1.difference, 30);
    assert.equal(rowA1.won20, 3);
    assert.equal(rowA1.won21, 0);
    assert.equal(rowA1.lost02, 1);
    assert.equal(rowA1.lost12, 0);
    assert.equal(rowA1.setRatio, 6 / 2);
    assert.equal(rowA1.ptosRatio, 128 / 98);

    // Verificar b1 también (1 triunfo 2-0 + 1 triunfo 2-1 = 5 pts, 2 PJ, 2 PG, 0 PP, 4 SF, 1 SE, PF=70, PC=53, DIF=17)
    const rowB1 = finalRows.find((r) => r.team.id === b1.id);
    assert.equal(rowB1.classificationPoints, 5);
    assert.equal(rowB1.resultCount, 2);
    assert.equal(rowB1.wins, 2);
    assert.equal(rowB1.losses, 0);
    assert.equal(rowB1.setWins, 4);
    assert.equal(rowB1.setLosses, 1);
    assert.equal(rowB1.pointsFor, 70);
    assert.equal(rowB1.pointsAgainst, 53);
    assert.equal(rowB1.difference, 17);
    assert.equal(rowB1.won20, 1);
    assert.equal(rowB1.won21, 1);
    assert.equal(rowB1.lost02, 0);
    assert.equal(rowB1.lost12, 0);
    assert.equal(rowB1.setRatio, 4 / 1);
    assert.equal(rowB1.ptosRatio, 70 / 53);
  });

  it('suma de forma incremental los nuevos partidos de Zona Final sin re-sumar ni alterar la fase clasificatoria', () => {
    const storage = createMemoryStorage();
    const { service } = makeService(storage);
    const cat = service.createCategory('Categoría +50', 'ZONES');
    const zA = service.createZone('Zona A');
    const [a1, a2, a3, a4, a5] = ['A1', 'A2', 'A3', 'A4', 'A5'].map((n) => service.createTeam(n, zA.id));
    const zB = service.createZone('Zona B');
    const [b1, b2] = ['B1', 'B2'].map((n) => service.createTeam(n, zB.id));

    // A1 termina fase clasificatoria con: 10 pts, 4 PJ, 3 G, 1 P, 128 PF, 98 PC (3x 2-0, 1x 0-2)
    play(service, a1, '2-0', a3, zA.id, [{ a: 15, b: 9 }, { a: 15, b: 9 }]);
    play(service, a1, '2-0', a4, zA.id, [{ a: 15, b: 9 }, { a: 15, b: 10 }]);
    play(service, a1, '2-0', a5, zA.id, [{ a: 15, b: 9 }, { a: 15, b: 10 }]);
    play(service, a2, '2-0', a1, zA.id, [{ a: 21, b: 19 }, { a: 21, b: 19 }]);
    play(service, a2, '2-0', a3, zA.id, SETS['2-0']);
    play(service, a2, '2-0', a4, zA.id, SETS['2-0']);
    play(service, a2, '2-0', a5, zA.id, SETS['2-0']);
    play(service, a3, '2-0', a4, zA.id, SETS['2-0']);
    play(service, a3, '2-0', a5, zA.id, SETS['2-0']);
    play(service, a4, '2-0', a5, zA.id, SETS['2-0']);
    play(service, b1, '2-0', b2, zB.id, [{ a: 15, b: 8 }, { a: 15, b: 10 }]);

    service.confirmZones();
    const finalZoneId = service.selectedCategory().zoneTournament.secondStageZoneId;

    // A1 gana 2-0 a B1 en Zona Final con sets 15-12 y 15-5 (+30 PF, +17 PC)
    const finalMatch = play(service, a1, '2-0', b1, finalZoneId, [{ a: 15, b: 12 }, { a: 15, b: 5 }]);

    // Consultar varias veces no debe volver a sumar la fase anterior (Regla 3)
    service.standings(cat.id, 'ZONE_FINAL', finalZoneId);
    service.finalClassification(cat.id);
    const rows = service.standings(cat.id, 'ZONE_FINAL', finalZoneId);
    const rowA1 = rows.find((r) => r.team.id === a1.id);
    const rowB1 = rows.find((r) => r.team.id === b1.id);

    assert.equal(rowA1.classificationPoints, 13);
    assert.equal(rowA1.resultCount, 5);
    assert.equal(rowA1.wins, 4);
    assert.equal(rowA1.losses, 1);
    assert.equal(rowA1.setWins, 8);
    assert.equal(rowA1.setLosses, 2);
    assert.equal(rowA1.pointsFor, 158);
    assert.equal(rowA1.pointsAgainst, 115);
    assert.equal(rowA1.difference, 43);
    assert.equal(rowA1.won20, 4);
    assert.equal(service.classificationPoints(a1.id, 'ZONE_FINAL', finalZoneId), 13);

    // B1 tenía 3 pts (1G, 1-0, 30 PF, 18 PC) + derrota 0-2 (1 pt, 17 PF, 30 PC) => 4 pts, 2 PJ, 1 G, 1 P, 47 PF, 48 PC
    assert.equal(rowB1.classificationPoints, 4);
    assert.equal(rowB1.resultCount, 2);
    assert.equal(rowB1.wins, 1);
    assert.equal(rowB1.losses, 1);
    assert.equal(rowB1.setWins, 2);
    assert.equal(rowB1.setLosses, 2);
    assert.equal(rowB1.pointsFor, 47);
    assert.equal(rowB1.pointsAgainst, 48);
    assert.equal(rowB1.difference, -1);
    assert.equal(rowB1.won20, 1);
    assert.equal(rowB1.lost02, 1);

    // La tabla histórica de Zona A NO debe incluir el partido de Zona Final
    const zARows = service.standings(cat.id, 'GENERAL', zA.id);
    const zAA1 = zARows.find((r) => r.team.id === a1.id);
    assert.equal(zAA1.classificationPoints, 10);
    assert.equal(zAA1.resultCount, 4);
    assert.equal(zAA1.pointsFor, 128);

    // Recargar desde storage mantiene los acumulados exactos sin duplicar
    const { service: reloaded } = makeService(storage);
    const reloadedA1 = reloaded.standings(cat.id, 'ZONE_FINAL', finalZoneId).find((r) => r.team.id === a1.id);
    assert.equal(reloadedA1.classificationPoints, 13);
    assert.equal(reloadedA1.resultCount, 5);
    assert.equal(reloadedA1.pointsFor, 158);
    assert.equal(reloadedA1.pointsAgainst, 115);

    // Al editar el partido de Zona Final a 2-1, se recalcula limpiamente (10 + 2 = 12 pts)
    service.updateMatchFromSets(finalMatch.id, a1.id, 2, 1, [{ a: 15, b: 12 }, { a: 10, b: 15 }, { a: 15, b: 5 }]);
    const afterEditA1 = service.standings(cat.id, 'ZONE_FINAL', finalZoneId).find((r) => r.team.id === a1.id);
    assert.equal(afterEditA1.classificationPoints, 12);
    assert.equal(afterEditA1.resultCount, 5);
    assert.equal(afterEditA1.won20, 3);
    assert.equal(afterEditA1.won21, 1);
    assert.equal(afterEditA1.pointsFor, 168);
    assert.equal(afterEditA1.pointsAgainst, 130);

    // Al eliminar el partido de Zona Final, A1 vuelve exactamente a sus 10 pts y 128/98 de fase clasificatoria
    service.deleteMatchResult(finalMatch.id);
    const afterDeleteA1 = service.standings(cat.id, 'ZONE_FINAL', finalZoneId).find((r) => r.team.id === a1.id);
    assert.equal(afterDeleteA1.classificationPoints, 10);
    assert.equal(afterDeleteA1.resultCount, 4);
    assert.equal(afterDeleteA1.pointsFor, 128);
    assert.equal(afterDeleteA1.pointsAgainst, 98);
  });

  it('recupera carriedStats automáticamente al cargar estados antiguos sin carriedStats en qualified', () => {
    const newId = idGenerator();
    const now = clock();
    const rawLegacy = {
      schemaVersion: 2,
      categories: [{
        id: 'cat-1',
        name: 'Categoría +50',
        format: 'zonas_y_final',
        currentStage: 'ZONE_FINAL',
        zoneTournament: {
          status: 'IN_PROGRESS',
          firstStageStatus: 'FINISHED',
          secondStageStatus: 'IN_PROGRESS',
          zones: [
            { id: 'z-a', name: 'Zona A', phase: 'clasificatoria', teamIds: ['t1', 't2'] },
            { id: 'z-b', name: 'Zona B', phase: 'clasificatoria', teamIds: ['t3', 't4'] },
            { id: 'z-f', name: 'Zona final', phase: 'final', teamIds: ['t1', 't2', 't3', 't4'] }
          ],
          secondStageZoneId: 'z-f',
          qualified: [
            { teamId: 't1', sourceZoneId: 'z-a', position: 1 },
            { teamId: 't2', sourceZoneId: 'z-a', position: 2 },
            { teamId: 't3', sourceZoneId: 'z-b', position: 1 },
            { teamId: 't4', sourceZoneId: 'z-b', position: 2 }
          ]
        }
      }],
      teams: [
        { id: 't1', name: 'A1', categoryId: 'cat-1', status: 'QUALIFIED', stage: 'ZONE_FINAL' },
        { id: 't2', name: 'A2', categoryId: 'cat-1', status: 'QUALIFIED', stage: 'ZONE_FINAL' },
        { id: 't3', name: 'B1', categoryId: 'cat-1', status: 'QUALIFIED', stage: 'ZONE_FINAL' },
        { id: 't4', name: 'B2', categoryId: 'cat-1', status: 'QUALIFIED', stage: 'ZONE_FINAL' }
      ],
      matchResults: [
        { id: 'm1', categoryId: 'cat-1', winnerId: 't1', loserId: 't2', score: '2-0', sets: [{ a: 15, b: 10 }, { a: 15, b: 12 }], stage: 'GENERAL', zoneId: 'z-a' },
        { id: 'm2', categoryId: 'cat-1', winnerId: 't3', loserId: 't4', score: '2-1', sets: [{ a: 15, b: 12 }, { a: 12, b: 15 }, { a: 15, b: 10 }], stage: 'GENERAL', zoneId: 'z-b' },
        { id: 'm3', categoryId: 'cat-1', winnerId: 't1', loserId: 't3', score: '2-0', sets: [{ a: 15, b: 8 }, { a: 15, b: 9 }], stage: 'ZONE_FINAL', zoneId: 'z-f' }
      ],
      selectedCategoryId: 'cat-1'
    };

    const normalized = stateSchema.normalize(rawLegacy, { newId, now });
    const q1 = normalized.state.categories[0].zoneTournament.qualified.find((q) => q.teamId === 't1');
    assert.equal(q1.carriedStats.classificationPoints, 3);
    assert.equal(q1.carriedStats.pointsFor, 30);
    assert.equal(q1.carriedStats.pointsAgainst, 22);

    const storage = createMemoryStorage({ 'puntaje-newcom-state': JSON.stringify(rawLegacy) });
    const { service } = makeService(storage);
    const rows = service.standings('cat-1', 'ZONE_FINAL', 'z-f');
    const rowT1 = rows.find((r) => r.team.id === 't1');
    // t1: 3 pts (Zona A) + 3 pts (Zona Final) = 6 pts; 30+30=60 PF, 22+17=39 PC
    assert.equal(rowT1.classificationPoints, 6);
    assert.equal(rowT1.resultCount, 2);
    assert.equal(rowT1.pointsFor, 60);
    assert.equal(rowT1.pointsAgainst, 39);
  });

  it('verifica transferencia, persistencia y tabla HTML renderizada en app.js (cliente navegador)', () => {
    const storage = createMemoryStorage();
    let positionsClick = null;
    const appNode = {
      innerHTML: '',
      querySelectorAll(selector) {
        if (selector === '[data-view]') {
          return [{
            getAttribute(attr) { return attr === 'data-view' ? 'positions' : ''; },
            set onclick(fn) { positionsClick = fn; }
          }];
        }
        return [];
      },
      querySelector() { return null; }
    };
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
        getElementById(id) { return id === 'app' ? appNode : makeEl(); }
      },
      FormData: function () {},
      console
    };
    context.globalThis = context;
    vm.createContext(context);
    const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    vm.runInContext(code, context);

    const api = context.window.PuntajeNewcom;
    const cat = api.createCategory('Categoría +50', 'zonas_y_final');
    const zA = api.createZone('Zona 1');
    const zB = api.createZone('Zona 2');
    const a1 = api.createTeam('Aguilas', zA.id);
    const a2 = api.createTeam('Halcones', zA.id);
    const b1 = api.createTeam('Condores', zB.id);
    const b2 = api.createTeam('Pumas', zB.id);

    const genMatchA = api.addMatchFromSets(a1.id, 2, a2.id, 0, [{ a: 15, b: 10 }, { a: 15, b: 11 }], zA.id);
    api.addMatchFromSets(b1.id, 2, b2.id, 1, [{ a: 15, b: 12 }, { a: 10, b: 15 }, { a: 15, b: 10 }], zB.id);

    const qualified = api.confirmZones();
    assert.equal(qualified.length, 4);
    assert.equal(qualified.find((q) => q.teamId === a1.id).carriedStats.classificationPoints, 3);
    assert.equal(qualified.find((q) => q.teamId === a1.id).carriedStats.pointsFor, 30);

    const finalZoneId = api.getState().categories[0].zoneTournament.secondStageZoneId;
    // Cargar un partido en la Zona Final: Aguilas (3 pts) vence 2-0 a Condores (2 pts) con sets 15-8, 15-7
    api.addMatchFromSets(a1.id, 2, b1.id, 0, [{ a: 15, b: 8 }, { a: 15, b: 7 }], finalZoneId);

    // Renderizar la vista de Posiciones y validar el HTML de la fila de Aguilas en la Zona Final
    positionsClick();
    assert.match(appNode.innerHTML, /ZONA FINAL/);
    assert.match(
      appNode.innerHTML,
      /<td class="col-team"><strong>Aguilas<\/strong><\/td><td class="col-pts"><b>6<\/b><\/td><td>2<\/td><td>2<\/td><td>0<\/td><td>4<\/td><td>0<\/td><td>60<\/td><td>36<\/td><td class="col-dif dif-plus"><b>\+24<\/b><\/td><td class="col-res">2<\/td><td class="col-res">0<\/td><td class="col-res">0<\/td><td class="col-res">0<\/td><td class="col-coc">MAX<\/td><td class="col-coc">1,67<\/td>/
    );

    const finalRows = api.calculateStandings(cat.id, 'ZONE_FINAL', finalZoneId);
    const rowAguilas = finalRows.find((r) => r.team.id === a1.id);
    const rowCondores = finalRows.find((r) => r.team.id === b1.id);

    // Aguilas: 3 + 3 = 6 pts, 2 PJ, 2 PG, 0 PP, 4 SF, 0 SE, 60 PF, 36 PC, +24 DIF
    assert.equal(rowAguilas.classificationPoints, 6);
    assert.equal(rowAguilas.resultCount, 2);
    assert.equal(rowAguilas.wins, 2);
    assert.equal(rowAguilas.losses, 0);
    assert.equal(rowAguilas.setWins, 4);
    assert.equal(rowAguilas.setLosses, 0);
    assert.equal(rowAguilas.pointsFor, 60);
    assert.equal(rowAguilas.pointsAgainst, 36);
    assert.equal(rowAguilas.difference, 24);
    assert.equal(rowAguilas.won20, 2);

    // Condores: 2 + 1 = 3 pts, 2 PJ, 1 PG, 1 PP, 2 SF, 3 SE, 55 PF, 67 PC, -12 DIF
    assert.equal(rowCondores.classificationPoints, 3);
    assert.equal(rowCondores.resultCount, 2);
    assert.equal(rowCondores.wins, 1);
    assert.equal(rowCondores.losses, 1);
    assert.equal(rowCondores.setWins, 2);
    assert.equal(rowCondores.setLosses, 3);
    assert.equal(rowCondores.pointsFor, 55);
    assert.equal(rowCondores.pointsAgainst, 67);
    assert.equal(rowCondores.difference, -12);
    assert.equal(rowCondores.won21, 1);
    assert.equal(rowCondores.lost02, 1);

    // Comprobar que loadState() y calculateClassificationPoints / calculateTeamSetStats coinciden
    assert.equal(api.calculateClassificationPoints(a1.id, 'ZONE_FINAL', finalZoneId), 6);
    assert.deepEqual({ ...api.calculateTeamSetStats(a1.id, 'ZONE_FINAL', finalZoneId) }, { for: 60, against: 36 });

    // Si se corrige un partido de fase clasificatoria, se sincronizan carriedStats y Zona Final
    api.updateMatchResult(genMatchA.id, '2-1', [{ a: 15, b: 10 }, { a: 10, b: 15 }, { a: 15, b: 11 }]);
    const afterGenEdit = api.calculateStandings(cat.id, 'ZONE_FINAL', finalZoneId).find((r) => r.team.id === a1.id);
    assert.equal(afterGenEdit.classificationPoints, 5); // 2 (2-1 en Zona 1) + 3 (2-0 en Zona Final)
    assert.equal(afterGenEdit.pointsFor, 70); // 40 + 30
    assert.equal(afterGenEdit.pointsAgainst, 51); // 36 + 15

    // Volver a instanciar app.js con el mismo localStorage y comprobar que no se reinicia ni duplica nada
    const context2 = {
      window: {},
      localStorage: storage,
      document: {
        documentElement: makeEl(),
        getElementById(id) { return id === 'app' ? appNode : makeEl(); }
      },
      FormData: function () {},
      console
    };
    context2.globalThis = context2;
    vm.createContext(context2);
    vm.runInContext(code, context2);

    const api2 = context2.window.PuntajeNewcom;
    const reloadedRow = api2.calculateStandings(cat.id, 'ZONE_FINAL', finalZoneId).find((r) => r.team.id === a1.id);
    assert.equal(reloadedRow.classificationPoints, 5);
    assert.equal(reloadedRow.resultCount, 2);
    assert.equal(reloadedRow.pointsFor, 70);
    assert.equal(reloadedRow.pointsAgainst, 51);
  });
});
