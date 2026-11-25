'use strict';
/**
 * Pruebas integrales de extremo a extremo (E2E) para la distribución Kali Linux de PuntajeNewcom.
 *
 * Verifica sobre un entorno temporal aislado (sin tocar datos reales del usuario):
 *  1. Apertura y funcionamiento del ejecutable compilado (PyInstaller --onedir) y ventana GTK/WebKit2 (Xvfb).
 *  2. Instalación (install.sh), acceso directo (.desktop), comando de terminal (puntajenewcom).
 *  3. Creación de categorías, zonas y equipos; carga de resultados 2-0, 2-1, 1-2 y 0-2.
 *  4. Cálculo exacto de posiciones, PJ, PG, PP, PF, PC, DIF, clasificación de los 2 mejores a Zona Final y Zona Única.
 *  5. Persistencia real en ~/.local/share/PuntajeNewcom/state.json tras cierre normal, cierre abrupto (SIGKILL),
 *     reinicio simulado, ejecución desde otra ubicación y actualización del ejecutable.
 *  6. Copias de seguridad: creación, listado, protección de archivos, bloqueo sin confirmación y restauración.
 *  7. Desinstalación (uninstall.sh) conservando intactos los datos persistentes del usuario.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync, spawn } = require('node:child_process');
const { createMemoryStorage } = require('./helpers.js');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist', 'PuntajeNewcom-Linux');
const DIST_BIN = path.join(DIST_DIR, 'PuntajeNewcom');
const TARBALL_PATH = path.join(PROJECT_ROOT, 'PuntajeNewcom-Kali-Linux.tar.gz');

/**
 * Ejecuta una petición HTTP sincrónica usando un subproceso corto de Python o curl
 * para que el cliente app.js dentro de node:vm pueda usar XMLHttpRequest sincrónico contra el binario.
 */
function makeSyncXHRClass(baseUrl) {
  return class SyncXMLHttpRequest {
    constructor() {
      this.status = 0;
      this.responseText = '';
      this._method = 'GET';
      this._url = '';
      this._headers = {};
    }
    open(method, url, asyncFlag) {
      this._method = method;
      this._url = url.startsWith('http') ? url : baseUrl.replace(/\/$/, '') + url;
      this._async = asyncFlag;
    }
    setRequestHeader(k, v) {
      this._headers[k] = v;
    }
    send(body) {
      const pyScript = `
import sys, json, urllib.request, urllib.error
req_data = json.loads(sys.argv[1])
body_bytes = req_data["body"].encode("utf-8") if req_data["body"] is not None else None
req = urllib.request.Request(req_data["url"], data=body_bytes, headers=req_data["headers"], method=req_data["method"])
try:
    with urllib.request.urlopen(req, timeout=5) as resp:
        sys.stdout.write(json.dumps({"status": resp.status, "text": resp.read().decode("utf-8")}))
except urllib.error.HTTPError as e:
    sys.stdout.write(json.dumps({"status": e.code, "text": e.read().decode("utf-8")}))
`;
      const payload = JSON.stringify({
        method: this._method,
        url: this._url,
        headers: this._headers,
        body: body !== undefined && body !== null ? String(body) : null
      });
      const out = execFileSync('python3', ['-c', pyScript, payload], { encoding: 'utf8' });
      const parsed = JSON.parse(out);
      this.status = parsed.status;
      this.responseText = parsed.text;
    }
  };
}

function mountAppAgainstServer(baseUrl) {
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

  const XMLHttpRequest = makeSyncXHRClass(baseUrl);
  const windowObj = {
    location: { protocol: 'http:', host: new URL(baseUrl).host, href: baseUrl },
    addEventListener() {}
  };
  const context = {
    window: windowObj,
    localStorage: storage,
    XMLHttpRequest,
    document: {
      documentElement: makeEl(),
      getElementById() { return makeEl(); }
    },
    FormData: function () {},
    confirm: () => true,
    alert: () => {},
    console
  };
  context.globalThis = context;
  vm.createContext(context);
  const code = fs.readFileSync(path.join(PROJECT_ROOT, 'app.js'), 'utf8');
  vm.runInContext(code, context);
  return { api: context.window.PuntajeNewcom, storage };
}

async function waitForHealth(baseUrl, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok) return data;
      }
    } catch (_) {
      // esperar inicio
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`El servidor del ejecutable no respondió en ${baseUrl}/api/health`);
}

describe('Distribución Ejecutable PuntajeNewcom para Kali Linux (x86_64)', () => {
  let tempRoot;
  let fakeHome;
  let extractDir;

  before(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'puntajenewcom-kali-e2e-'));
    fakeHome = path.join(tempRoot, 'home');
    extractDir = path.join(tempRoot, 'extracted');
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.mkdirSync(extractDir, { recursive: true });
  });

  after(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('1. Verifica la estructura de entrega dist/PuntajeNewcom-Linux/ y el paquete PuntajeNewcom-Kali-Linux.tar.gz', () => {
    assert.ok(fs.existsSync(DIST_DIR), 'Debe existir dist/PuntajeNewcom-Linux/');
    assert.ok(fs.existsSync(DIST_BIN), 'Debe existir el ejecutable dist/PuntajeNewcom-Linux/PuntajeNewcom');
    assert.ok(fs.existsSync(path.join(DIST_DIR, '_internal')), 'Debe existir la carpeta _internal de PyInstaller --onedir');
    assert.ok(fs.existsSync(path.join(DIST_DIR, 'install.sh')), 'Debe existir install.sh');
    assert.ok(fs.existsSync(path.join(DIST_DIR, 'uninstall.sh')), 'Debe existir uninstall.sh');
    assert.ok(fs.existsSync(path.join(DIST_DIR, 'README.md')), 'Debe existir README.md');
    assert.ok(fs.existsSync(path.join(DIST_DIR, 'assets', 'puntajenewcom.png')), 'Debe existir el icono PNG');
    assert.ok(fs.existsSync(path.join(DIST_DIR, 'assets', 'puntajenewcom.svg')), 'Debe existir el icono SVG');
    assert.ok(fs.existsSync(TARBALL_PATH), 'Debe existir PuntajeNewcom-Kali-Linux.tar.gz');

    // Extraer el tar.gz en una carpeta temporal fuera del directorio de desarrollo
    execFileSync('tar', ['-xzf', TARBALL_PATH, '-C', extractDir]);
    const extractedBin = path.join(extractDir, 'PuntajeNewcom-Linux', 'PuntajeNewcom');
    assert.ok(fs.existsSync(extractedBin), 'El archivo tar.gz debe contener PuntajeNewcom-Linux/PuntajeNewcom');

    // Ejecutar --version y --self-test desde /tmp (otra ubicación distinta a la de desarrollo)
    const verOut = execFileSync(extractedBin, ['--version'], { cwd: os.tmpdir(), encoding: 'utf8' });
    assert.match(verOut, /PuntajeNewcom 2\.0\.0/);

    const selfTestOut = execFileSync(extractedBin, ['--self-test'], { cwd: os.tmpdir(), encoding: 'utf8' });
    assert.match(selfTestOut, /\[OK\] Autodiagnóstico de PuntajeNewcom/);
  });

  it('2. Ejecuta install.sh en entorno de usuario, configura .desktop, icono y comando puntajenewcom', () => {
    const installerPath = path.join(extractDir, 'PuntajeNewcom-Linux', 'install.sh');
    const env = {
      ...process.env,
      HOME: fakeHome,
      PATH: `${path.join(fakeHome, '.local', 'bin')}:${process.env.PATH}`
    };

    const installOut = execFileSync('bash', [installerPath], {
      cwd: os.tmpdir(),
      env,
      encoding: 'utf8'
    });
    assert.match(installOut, /PuntajeNewcom se instaló correctamente/);

    const installedBin = path.join(fakeHome, '.local', 'opt', 'PuntajeNewcom', 'PuntajeNewcom');
    const launcherBin = path.join(fakeHome, '.local', 'bin', 'puntajenewcom');
    const desktopFile = path.join(fakeHome, '.local', 'share', 'applications', 'puntajenewcom.desktop');
    const iconPng = path.join(fakeHome, '.local', 'share', 'icons', 'hicolor', '128x128', 'apps', 'puntajenewcom.png');
    const dataDir = path.join(fakeHome, '.local', 'share', 'PuntajeNewcom');

    assert.ok(fs.existsSync(installedBin), 'El ejecutable debe instalarse en ~/.local/opt/PuntajeNewcom/PuntajeNewcom');
    assert.ok(fs.existsSync(launcherBin), 'El lanzador debe instalarse en ~/.local/bin/puntajenewcom');
    assert.ok(fs.existsSync(desktopFile), 'El acceso directo .desktop debe crearse en ~/.local/share/applications/');
    assert.ok(fs.existsSync(iconPng), 'El icono debe instalarse en ~/.local/share/icons/');
    assert.ok(fs.existsSync(dataDir), 'El directorio de datos ~/.local/share/PuntajeNewcom/ debe existir');

    const desktopContent = fs.readFileSync(desktopFile, 'utf8');
    assert.match(desktopContent, /Name=PuntajeNewcom/);
    assert.match(desktopContent, /Type=Application/);
    assert.ok(desktopContent.includes(installedBin), 'El acceso directo .desktop debe apuntar al ejecutable instalado');

    // Probar el comando 'puntajenewcom --status' ejecutado desde /tmp
    const statusOut = execFileSync('puntajenewcom', ['--status'], {
      cwd: os.tmpdir(),
      env,
      encoding: 'utf8'
    });
    assert.match(statusOut, /PuntajeNewcom — Gestión de Torneos de Newcom/);
    assert.ok(statusOut.includes(dataDir), 'El comando puntajenewcom debe usar ~/.local/share/PuntajeNewcom');
  });

  it('3. Abre correctamente la ventana gráfica nativa (GTK3/WebKit2 bajo Xvfb) mediante el comando puntajenewcom', () => {
    const xvfbBin = '/usr/bin/xvfb-run';
    if (!fs.existsSync(xvfbBin)) return;

    const env = {
      ...process.env,
      HOME: fakeHome,
      PATH: `${path.join(fakeHome, '.local', 'bin')}:${process.env.PATH}`,
      PUNTAJENEWCOM_AUTOCLOSE_MS: '600',
      PUNTAJENEWCOM_DISABLE_WEBKIT_SANDBOX: '1'
    };

    execFileSync(xvfbBin, ['-a', 'puntajenewcom', '--ui', 'gtk', '--port', '18460'], {
      cwd: os.tmpdir(),
      env,
      encoding: 'utf8',
      timeout: 20000
    });

    const stateFile = path.join(fakeHome, '.local', 'share', 'PuntajeNewcom', 'state.json');
    assert.ok(fs.existsSync(stateFile), 'Al abrir y cerrar la ventana gráfica debe haberse inicializado state.json');
  });

  it('4. Permite crear categorías, registrar equipos, cargar resultados (2-0, 2-1, 1-2, 0-2), calcular posiciones (PF, PC, DIF) y persistir todo en disco', async () => {
    const env = {
      ...process.env,
      HOME: fakeHome,
      PATH: `${path.join(fakeHome, '.local', 'bin')}:${process.env.PATH}`
    };
    const port = 18465;
    const baseUrl = `http://127.0.0.1:${port}`;

    const proc = spawn('puntajenewcom', ['--ui', 'headless', '--port', String(port)], {
      cwd: os.tmpdir(),
      env,
      stdio: 'ignore'
    });

    try {
      await waitForHealth(baseUrl);
      const { api } = mountAppAgainstServer(baseUrl);

      // 1. Crear Categoría por Zonas + Zona Final (+50)
      const cat50 = api.createCategory('Categoría +50', 'zonas_y_final');
      const zA = api.createZone('Zona A');
      const zB = api.createZone('Zona B');

      // 2. Registrar equipos en Zona A y Zona B
      const aguilas = api.createTeam('Águilas Doradas', zA.id);
      const nahuel = api.createTeam('Los Nahuel', zA.id);
      const toninas = api.createTeam('Toninas', zA.id);

      const newen = api.createTeam('Newen', zB.id);
      const abrojal = api.createTeam('Abrojal', zB.id);
      const corsarios = api.createTeam('Corsarios', zB.id);

      // 3. Cargar resultados en Zona A (2-0, 2-1 y 1-2)
      // Águilas 2-0 Los Nahuel (15-10, 15-8) -> Águilas: 3 pts, PF 30, PC 18; Nahuel: 1 pt, PF 18, PC 30
      api.addMatchFromSets(aguilas.id, 2, nahuel.id, 0, [{ a: 15, b: 10 }, { a: 15, b: 8 }], zA.id);
      // Águilas 2-1 Toninas (15-12, 11-15, 15-9) -> Águilas: +3=6 pts, PF +41=71, PC +36=54; Toninas: 2 pts, PF 36, PC 41
      api.addMatchFromSets(aguilas.id, 2, toninas.id, 1, [{ a: 15, b: 12 }, { a: 11, b: 15 }, { a: 15, b: 9 }], zA.id);
      // Los Nahuel 1-2 Toninas (10-15, 15-13, 8-15) -> Toninas: +3=5 pts, PF +43=79, PC +33=74; Nahuel: +2=3 pts, PF +33=51, PC +43=73
      api.addMatchFromSets(nahuel.id, 1, toninas.id, 2, [{ a: 10, b: 15 }, { a: 15, b: 13 }, { a: 8, b: 15 }], zA.id);

      // 4. Cargar resultados en Zona B (incluyendo 0-2)
      api.addMatchFromSets(newen.id, 2, abrojal.id, 0, [{ a: 15, b: 9 }, { a: 15, b: 11 }], zB.id);
      api.addMatchFromSets(corsarios.id, 0, newen.id, 2, [{ a: 7, b: 15 }, { a: 10, b: 15 }], zB.id);
      api.addMatchFromSets(abrojal.id, 2, corsarios.id, 1, [{ a: 15, b: 13 }, { a: 12, b: 15 }, { a: 15, b: 10 }], zB.id);

      // 5. Verificar tabla de posiciones Zona A (PJ, PG, PP, PF, PC, DIF)
      const tableZA = Array.from(api.calculateStandings(cat50.id, 'GENERAL', zA.id));
      assert.deepEqual(tableZA.map((r) => r.team.name), ['Águilas Doradas', 'Toninas', 'Los Nahuel']);

      assert.equal(tableZA[0].classificationPoints, 6);
      assert.equal(tableZA[0].resultCount, 2); // PJ
      assert.equal(tableZA[0].wins, 2);        // PG
      assert.equal(tableZA[0].losses, 0);      // PP
      assert.equal(tableZA[0].pointsFor, 71);  // PF
      assert.equal(tableZA[0].pointsAgainst, 54); // PC
      assert.equal(tableZA[0].difference, 17); // DIF

      assert.equal(tableZA[1].classificationPoints, 5);
      assert.equal(tableZA[1].pointsFor, 79);
      assert.equal(tableZA[1].pointsAgainst, 74);
      assert.equal(tableZA[1].difference, 5);

      assert.equal(tableZA[2].classificationPoints, 3);
      assert.equal(tableZA[2].pointsFor, 51);
      assert.equal(tableZA[2].pointsAgainst, 73);
      assert.equal(tableZA[2].difference, -22);

      // 6. Clasificación de los 2 mejores equipos de cada zona hacia Zona Final
      const qualified = api.confirmZones();
      assert.equal(qualified.length, 4);
      const finalZoneId = api.getState().categories[0].zoneTournament.secondStageZoneId;
      api.addMatchFromSets(aguilas.id, 2, newen.id, 0, [{ a: 15, b: 11 }, { a: 15, b: 12 }], finalZoneId);

      const finalTable = api.calculateStandings(cat50.id, 'ZONE_FINAL', finalZoneId);
      const aguilasFinal = finalTable.find((r) => r.team.id === aguilas.id);
      assert.equal(aguilasFinal.classificationPoints, 9);
      assert.equal(aguilasFinal.pointsFor, 101);
      assert.equal(aguilasFinal.pointsAgainst, 77);
      assert.equal(aguilasFinal.difference, 24);

      // 7. Crear Categoría de Zona Única (+60 Todos contra todos)
      const cat60 = api.createCategory('Categoría +60', 'todos_contra_todos');
      const singleZoneId = cat60.zoneTournament.secondStageZoneId;
      const halcones = api.createTeam('Halcones', singleZoneId);
      const condores = api.createTeam('Cóndores', singleZoneId);
      const pumas = api.createTeam('Pumas', singleZoneId);
      api.addMatchFromSets(halcones.id, 2, condores.id, 0, [{ a: 15, b: 9 }, { a: 15, b: 11 }], singleZoneId);

      const singleTable = api.calculateStandings(cat60.id, 'ZONE_FINAL', singleZoneId);
      assert.equal(singleTable[0].team.name, 'Halcones');
      assert.equal(singleTable[0].classificationPoints, 3);
      assert.equal(singleTable[0].pointsFor, 30);
      assert.equal(singleTable[0].pointsAgainst, 20);
      assert.equal(singleTable[0].difference, 10);
    } finally {
      proc.kill('SIGTERM');
      await new Promise((resolve) => proc.once('exit', resolve));
    }

    // 8. Verificar que el archivo state.json existe en ~/.local/share/PuntajeNewcom/state.json
    const stateFile = path.join(fakeHome, '.local', 'share', 'PuntajeNewcom', 'state.json');
    assert.ok(fs.existsSync(stateFile), 'state.json debe haberse guardado en ~/.local/share/PuntajeNewcom/');
    const onDisk = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(onDisk.categories.length, 2);
    assert.equal(onDisk.teams.length, 9);
    assert.equal(onDisk.matchResults.length, 8);
  });

  it('5. Conserva todos los datos después de cerrar y volver a abrir, ante cierre accidental (SIGKILL), ejecución desde otra ubicación y actualización', async () => {
    const env = {
      ...process.env,
      HOME: fakeHome,
      PATH: `${path.join(fakeHome, '.local', 'bin')}:${process.env.PATH}`
    };

    // A) Volver a abrir el ejecutable y comprobar que recupera exactamente todo el estado y PF/PC/DIF
    const port1 = 18466;
    const url1 = `http://127.0.0.1:${port1}`;
    const proc1 = spawn('puntajenewcom', ['--ui', 'headless', '--port', String(port1)], {
      cwd: os.tmpdir(),
      env,
      stdio: 'ignore'
    });

    try {
      await waitForHealth(url1);
      const { api } = mountAppAgainstServer(url1);
      const st = api.getState();
      assert.equal(st.categories.length, 2);
      assert.equal(st.teams.length, 9);
      assert.equal(st.matchResults.length, 8);

      const cat50 = st.categories.find((c) => c.name === 'Categoría +50');
      const finalZoneId = cat50.zoneTournament.secondStageZoneId;
      const finalRows = api.calculateStandings(cat50.id, 'ZONE_FINAL', finalZoneId);
      const aguilasRow = finalRows.find((r) => r.team.name === 'Águilas Doradas');
      assert.equal(aguilasRow.classificationPoints, 9);
      assert.equal(aguilasRow.pointsFor, 101);
      assert.equal(aguilasRow.pointsAgainst, 77);
      assert.equal(aguilasRow.difference, 24);

      // Cargar un partido adicional en la categoría activa (+60) y simular cierre accidental inmediato (SIGKILL)
      const cat60 = st.categories.find((c) => c.name === 'Categoría +60');
      const singleZoneId = cat60.zoneTournament.secondStageZoneId;
      const halcones = st.teams.find((t) => t.name === 'Halcones');
      const pumas = st.teams.find((t) => t.name === 'Pumas');
      api.addMatchFromSets(halcones.id, 2, pumas.id, 1, [{ a: 15, b: 13 }, { a: 12, b: 15 }, { a: 15, b: 11 }], singleZoneId);
    } finally {
      proc1.kill('SIGKILL');
      await new Promise((resolve) => proc1.once('exit', resolve));
    }

    // B) Copiar el ejecutable a otra carpeta completamente distinta y abrirlo desde allí (simulando reinicio y cambio de ubicación)
    const relocatedDir = path.join(tempRoot, 'relocated-binary', 'PuntajeNewcom-Linux');
    fs.mkdirSync(path.dirname(relocatedDir), { recursive: true });
    fs.cpSync(path.join(extractDir, 'PuntajeNewcom-Linux'), relocatedDir, { recursive: true });
    const relocatedBin = path.join(relocatedDir, 'PuntajeNewcom');

    const port2 = 18467;
    const url2 = `http://127.0.0.1:${port2}`;
    const proc2 = spawn(relocatedBin, ['--ui', 'headless', '--port', String(port2)], {
      cwd: '/',
      env,
      stdio: 'ignore'
    });

    try {
      await waitForHealth(url2);
      const { api: apiAfterKill } = mountAppAgainstServer(url2);
      const st2 = apiAfterKill.getState();
      assert.equal(st2.matchResults.length, 9, 'El partido guardado justo antes de SIGKILL debe haberse conservado');
    } finally {
      proc2.kill('SIGTERM');
      await new Promise((resolve) => proc2.once('exit', resolve));
    }

    // C) Simular actualización del ejecutable re-ejecutando install.sh y verificar que los 9 partidos siguen intactos
    const installerPath = path.join(extractDir, 'PuntajeNewcom-Linux', 'install.sh');
    execFileSync('bash', [installerPath], { cwd: os.tmpdir(), env, encoding: 'utf8' });

    const stateFile = path.join(fakeHome, '.local', 'share', 'PuntajeNewcom', 'state.json');
    const afterUpdate = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(afterUpdate.categories.length, 2);
    assert.equal(afterUpdate.teams.length, 9);
    assert.equal(afterUpdate.matchResults.length, 9);
  });

  it('6. Crea, lista y restaura copias de seguridad protegiendo los archivos originales y exigiendo confirmación', () => {
    const env = {
      ...process.env,
      HOME: fakeHome,
      PATH: `${path.join(fakeHome, '.local', 'bin')}:${process.env.PATH}`
    };

    // 1. Crear copia de seguridad manual etiquetada y exportada
    const exportedFile = path.join(tempRoot, 'export_torneo.json');
    const backupOut = execFileSync('puntajenewcom', ['--backup', '--label', 'antes_cambio', '--output', exportedFile], {
      cwd: os.tmpdir(),
      env,
      encoding: 'utf8'
    });
    assert.match(backupOut, /\[OK\] Copia de seguridad creada exitosamente/);
    assert.ok(fs.existsSync(exportedFile), 'Debe haberse exportado el archivo de backup');

    // No debe permitir sobrescribir un archivo exportado existente
    assert.throws(() => {
      execFileSync('puntajenewcom', ['--backup', '--output', exportedFile], {
        cwd: os.tmpdir(),
        env,
        encoding: 'utf8'
      });
    }, /ya existe y no será sobrescrito/);

    // 2. Listar copias de seguridad y verificar fecha y conteo
    const listOut = execFileSync('puntajenewcom', ['--list-backups'], {
      cwd: os.tmpdir(),
      env,
      encoding: 'utf8'
    });
    assert.match(listOut, /antes_cambio\.json/);
    assert.match(listOut, /VÁLIDO/);

    const backupsDir = path.join(fakeHome, '.local', 'share', 'PuntajeNewcom', 'backups');
    const backupFiles = fs.readdirSync(backupsDir).filter((f) => f.includes('antes_cambio'));
    assert.equal(backupFiles.length, 1);
    const backupPath = path.join(backupsDir, backupFiles[0]);

    // Verificar que el archivo de backup en backups/ está protegido en modo solo lectura
    const mode = fs.statSync(backupPath).mode;
    assert.equal(mode & 0o200, 0, 'El archivo original de backup debe estar protegido contra escritura (read-only)');

    // 3. Modificar state.json (simulando pérdida o borrado accidental de categorías)
    const stateFile = path.join(fakeHome, '.local', 'share', 'PuntajeNewcom', 'state.json');
    fs.writeFileSync(stateFile, JSON.stringify({
      schemaVersion: 2,
      categories: [],
      teams: [],
      matchResults: [],
      selectedCategoryId: null,
      theme: 'light'
    }));

    // 4. Intentar restaurar SIN confirmación en modo no interactivo debe rechazarse sin sobrescribir
    assert.throws(() => {
      execFileSync('puntajenewcom', ['--restore', backupFiles[0]], {
        cwd: os.tmpdir(),
        env,
        stdio: 'pipe',
        encoding: 'utf8'
      });
    }, /confirmación/);

    // 5. Restaurar CON confirmación explícita (--yes)
    const restoreOut = execFileSync('puntajenewcom', ['--restore', backupFiles[0], '--yes'], {
      cwd: os.tmpdir(),
      env,
      encoding: 'utf8'
    });
    assert.match(restoreOut, /\[OK\] Copia de seguridad restaurada exitosamente/);
    assert.match(restoreOut, /Respaldo previo\s*:\s*pre-restore-/);

    const restoredState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(restoredState.categories.length, 2);
    assert.equal(restoredState.teams.length, 9);
    assert.equal(restoredState.matchResults.length, 9);
  });

  it('7. Desinstala la aplicación (uninstall.sh) eliminando binarios y accesos directos pero CONSERVANDO intactos los datos del usuario', () => {
    const env = {
      ...process.env,
      HOME: fakeHome,
      PATH: `${path.join(fakeHome, '.local', 'bin')}:${process.env.PATH}`
    };
    const uninstallerPath = path.join(fakeHome, '.local', 'opt', 'PuntajeNewcom', 'uninstall.sh');
    assert.ok(fs.existsSync(uninstallerPath), 'Debe existir uninstall.sh en la carpeta instalada');

    const uninstallOut = execFileSync('bash', [uninstallerPath], {
      cwd: os.tmpdir(),
      env,
      encoding: 'utf8'
    });
    assert.match(uninstallOut, /\[PROTECCIÓN DE DATOS\]/);

    // Verificar que los binarios y lanzadores se eliminaron
    assert.ok(!fs.existsSync(path.join(fakeHome, '.local', 'opt', 'PuntajeNewcom')), 'La carpeta ~/.local/opt/PuntajeNewcom debe haberse eliminado');
    assert.ok(!fs.existsSync(path.join(fakeHome, '.local', 'bin', 'puntajenewcom')), 'El comando ~/.local/bin/puntajenewcom debe haberse eliminado');
    assert.ok(!fs.existsSync(path.join(fakeHome, '.local', 'share', 'applications', 'puntajenewcom.desktop')), 'El acceso directo .desktop debe haberse eliminado');

    // Verificar que los datos persistentes del usuario siguen 100% intactos
    const stateFile = path.join(fakeHome, '.local', 'share', 'PuntajeNewcom', 'state.json');
    assert.ok(fs.existsSync(stateFile), 'Desinstalar NO debe borrar ~/.local/share/PuntajeNewcom/state.json');
    const preserved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(preserved.categories.length, 2);
    assert.equal(preserved.teams.length, 9);
    assert.equal(preserved.matchResults.length, 9);
  });
});
