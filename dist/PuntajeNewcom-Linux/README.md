# PuntajeNewcom — Distribución Ejecutable para Kali Linux (x86_64)

Aplicación independiente para la gestión, carga de resultados y cálculo oficial de posiciones en torneos de **Newcom** (reglamento FE.CHU.VOL. / sistema 3-2-1).

---

## 1. Contenido de la Distribución (`dist/PuntajeNewcom-Linux/`)

```text
PuntajeNewcom-Linux/
├── PuntajeNewcom          # Ejecutable nativo Linux x86_64 (generado con PyInstaller --onedir)
├── _internal/             # Runtime Python embebido, librerías y recursos internos
├── assets/                # Iconos oficiales de la aplicación (SVG y PNG)
├── index.html             # Interfaz principal SPA
├── app.js                 # Motor reactivo del cliente y sincronización de persistencia
├── styles.css             # Sistema de diseño y planillas oficiales
├── src/                   # Capas modulares Clean/Hexagonal (domain, infrastructure, application)
├── install.sh             # Script instalador para Kali Linux (sin requerir root)
├── uninstall.sh           # Script desinstalador (conserva los datos del usuario)
├── DOCUMENTACION.md       # Documentación técnica de la arquitectura del sistema
└── README.md              # Guía de instalación, ejecución, persistencia y copias de seguridad
```

---

## 2. Requisitos del Sistema

- **Sistema Operativo:** Kali Linux (o cualquier distribución Debian/Ubuntu moderna).
- **Arquitectura:** `x86_64` (`amd64`).
- **Conexión a Internet:** **No requerida** (funciona 100 % sin conexión).
- **Dependencias de Python:** **No requiere instalar Python ni paquetes `pip` manualmente** (el runtime viaja integrado dentro del paquete `--onedir`).
- **Entorno Gráfico:** Sesión de escritorio activa (XFCE/GNOME/KDE) con soporte para ventana nativa GTK3/WebKit2 (`gir1.2-webkit2-4.1`) o navegador local (`chromium`, `firefox`, `xdg-open`).

---

## 3. Instrucciones de Instalación

### Desde el archivo comprimido `PuntajeNewcom-Kali-Linux.tar.gz`

```bash
tar -xzf PuntajeNewcom-Kali-Linux.tar.gz
cd PuntajeNewcom-Linux
chmod +x install.sh
./install.sh
```

### Desde la carpeta `dist/PuntajeNewcom-Linux/`

```bash
cd dist/PuntajeNewcom-Linux
./install.sh
```

### ¿Qué realiza `install.sh`?
1. Verifica que el sistema sea Linux `x86_64`.
2. Comprueba la disponibilidad del motor gráfico del sistema.
3. Si detecta datos de una instalación previa en `~/.local/share/PuntajeNewcom/`, crea automáticamente un backup de seguridad (`pre_update`) antes de actualizar los binarios.
4. Instala el ejecutable y sus recursos en `~/.local/opt/PuntajeNewcom/`.
5. Instala los iconos en `~/.local/share/icons/hicolor/`.
6. Crea el lanzador de terminal en `~/.local/bin/puntajenewcom`.
7. Crea el acceso directo de escritorio en `~/.local/share/applications/puntajenewcom.desktop` para el menú de aplicaciones de Kali Linux.
8. **No requiere permisos de administrador (`sudo`).**

---

## 4. Instrucciones de Ejecución

Una vez instalada, la aplicación puede iniciarse de tres maneras equivalentes:

1. **Desde el Menú de Aplicaciones de Kali Linux:**
   Buscar **PuntajeNewcom** en el menú de aplicaciones (categorías *Deportes / Utilidades / Oficina*) y hacer clic.
2. **Mediante doble clic:**
   Hacer doble clic directamente sobre el ejecutable `PuntajeNewcom` dentro de `~/.local/opt/PuntajeNewcom/` o `dist/PuntajeNewcom-Linux/`.
3. **Desde la terminal (desde cualquier directorio):**
   ```bash
   puntajenewcom
   ```

### Opciones adicionales por línea de comandos

```bash
puntajenewcom --status          # Muestra rutas de datos, estado del torneo y cantidad de backups
puntajenewcom --backup          # Crea una copia de seguridad inmediata
puntajenewcom --list-backups    # Lista todas las copias de seguridad con sus fechas
puntajenewcom --restore <COPIA> # Restaura una copia de seguridad (solicita confirmación)
puntajenewcom --self-test       # Ejecuta el autodiagnóstico interno en un entorno temporal
puntajenewcom --ui gtk          # Fuerza ventana nativa GTK3/WebKit2
puntajenewcom --ui chromium     # Fuerza ventana de aplicación Chromium (--app)
puntajenewcom --ui browser      # Abre en el navegador predeterminado del sistema
```

---

## 5. Ubicación de los Datos Persistentes

Todos los datos del usuario se almacenan de forma independiente al ejecutable en:

```text
~/.local/share/PuntajeNewcom/
├── state.json             # Estado principal (categorías, zonas, equipos, resultados, posiciones)
├── state.prev.json        # Snapshot automático de último estado válido conocido
├── backups/               # Copias de seguridad manuales, pre-migración y pre-restauración
└── logs/
    └── puntajenewcom.log  # Registro detallado de operaciones y diagnóstico de errores
```

### Garantías de Persistencia
- **Independencia de ubicación:** Los datos **nunca** se guardan en la carpeta temporal de PyInstaller (`/tmp/_MEI*`) ni en la carpeta donde reside el ejecutable.
- **Guardado atómico:** Cada cambio se escribe en un archivo temporal en el mismo sistema de archivos, se fuerza el volcado físico a disco (`flush` + `os.fsync`), se verifica su integridad JSON y se reemplaza atómicamente (`os.replace`) junto con sincronización del directorio.
- **Recuperación automática:** Si `state.json` sufriera una interrupción externa o corrupción, la aplicación resguarda el archivo afectado en `backups/corrupt-<fecha>.json` y recupera automáticamente el último estado íntegro desde `state.prev.json` o la copia válida más reciente.
- **Conservación total:** Los datos se mantienen intactos al cerrar la ventana, ante cierres accidentales, al reiniciar Kali Linux, apagar el equipo, mover el ejecutable de carpeta o actualizar la versión.

---

## 6. Actualización sin Perder Información

Para actualizar `PuntajeNewcom` a una nueva versión:

1. Extraiga la nueva versión de `PuntajeNewcom-Kali-Linux.tar.gz`.
2. Ejecute `./install.sh`.

El instalador reemplaza únicamente los binarios en `~/.local/opt/PuntajeNewcom/`, realiza una copia de seguridad preventiva en `~/.local/share/PuntajeNewcom/backups/` y **conserva intactos todos los datos guardados en `~/.local/share/PuntajeNewcom/state.json`**.

---

## 7. Copias de Seguridad (Backup y Restauración)

### Crear una copia de seguridad
```bash
puntajenewcom --backup
```
Con etiqueta identificatoria o exportación a otra ruta (ej. pendrive USB):
```bash
puntajenewcom --backup --label "cierre_dia_1"
puntajenewcom --backup --label "torneo_completo" --output ~/Escritorio/respaldo_torneo.json
```
*Nota:* Las copias en `~/.local/share/PuntajeNewcom/backups/` se protegen automáticamente con permisos de solo lectura (`0444`) y nombres únicos con fecha y hora (`backup-YYYY-MM-DD_HH-MM-SS.json`) para evitar sobrescrituras accidentales.

### Listar copias de seguridad disponibles
```bash
puntajenewcom --list-backups
```
Muestra el nombre de archivo, fecha y hora exacta, cantidad de categorías, equipos, partidos y estado de integridad.

### Restaurar una copia de seguridad
```bash
puntajenewcom --restore <nombre_del_archivo_o_ruta>
```
- El sistema verifica la validez del archivo antes de tocar los datos actuales.
- Solicita confirmación interactiva explícita (`[s/N]`) antes de aplicar la restauración.
- **Antes de restaurar**, genera automáticamente un respaldo del estado actual en `backups/pre-restore-YYYY-MM-DD_HH-MM-SS.json` para que nunca se pierda información por accidente.

---

## 8. Desinstalación

Para desinstalar la aplicación del sistema:

```bash
~/.local/opt/PuntajeNewcom/uninstall.sh
```
*(O bien `./uninstall.sh` desde la carpeta de distribución).*

> **IMPORTANTE:** Desinstalar la aplicación **NO elimina los datos guardados del usuario**. Toda la información de torneos y sus copias de seguridad permanece intacta en `~/.local/share/PuntajeNewcom/`.
> Si se desea eliminar también los datos de forma explícita e independiente, debe ejecutarse `./uninstall.sh --purge-data` y confirmar manualmente la operación.
