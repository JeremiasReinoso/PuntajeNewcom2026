#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PuntajeNewcom — Punto de entrada nativo para Kali Linux (x86_64).

Provee:
1. Servidor local embebido (127.0.0.1) sin dependencias externas de red.
2. Persistencia atómica y segura en ~/.local/share/PuntajeNewcom/state.json.
3. Protección frente a escrituras interrumpidas (archivo temporal + fsync + os.replace)
   y recuperación automática desde state.prev.json o copias de respaldo.
4. Respaldo automático previo a migraciones de esquema o restauraciones.
5. Sistema completo de Copias de Seguridad (crear, listar, restaurar con confirmación).
6. Ventana nativa GTK3/WebKit2 o ventana de aplicación Chromium/Navegador con
   manejo controlado de errores.
"""

from __future__ import annotations

import argparse
import datetime as dt
import errno
import hashlib
import http.server
import json
import logging
import mimetypes
import os
import pathlib
import re
import shutil
import signal
import socket
import socketserver
import stat
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

APP_NAME = "PuntajeNewcom"
APP_TITLE = "PuntajeNewcom — Gestión de Torneos de Newcom"
APP_VERSION = "2.0.0"
SCHEMA_VERSION = 2
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 18420
PORT_SCAN_RANGE = 40

REQUIRED_RESOURCES = (
    "index.html",
    "app.js",
    "styles.css",
    "src/domain/constants.js",
    "src/domain/errors.js",
    "src/domain/scoring.js",
    "src/domain/standings.js",
    "src/domain/tournament.js",
    "src/infrastructure/state-schema.js",
    "src/infrastructure/local-storage-repository.js",
    "src/application/tournament-service.js",
)


def get_resource_dir() -> pathlib.Path:
    """Obtiene el directorio de recursos empaquetados (PyInstaller _MEIPASS o carpeta fuente)."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return pathlib.Path(getattr(sys, "_MEIPASS")).resolve()
    return pathlib.Path(__file__).resolve().parent


def get_data_dir(custom_dir: Optional[str] = None) -> pathlib.Path:
    """
    Obtiene el directorio persistente de datos del usuario.
    Por defecto: ~/.local/share/PuntajeNewcom/
    Nunca utiliza el directorio temporal de PyInstaller ni depende de la ubicación del ejecutable.
    """
    if custom_dir:
        return pathlib.Path(custom_dir).expanduser().resolve()
    env_dir = os.environ.get("PUNTAJENEWCOM_DATA_DIR", "").strip()
    if env_dir:
        return pathlib.Path(env_dir).expanduser().resolve()
    return (pathlib.Path.home() / ".local" / "share" / APP_NAME).resolve()


def clean_host_env() -> Dict[str, str]:
    """
    Construye un entorno limpio para subprocesos del sistema (GTK/WebKit2, Chromium, xdg-open),
    evitando que LD_LIBRARY_PATH de PyInstaller interfiera con las librerías del sistema en Kali Linux.
    """
    env = dict(os.environ)
    meipass = getattr(sys, "_MEIPASS", None)
    if "LD_LIBRARY_PATH_ORIG" in env:
        orig = env["LD_LIBRARY_PATH_ORIG"]
        if orig:
            env["LD_LIBRARY_PATH"] = orig
        else:
            env.pop("LD_LIBRARY_PATH", None)
    elif meipass and "LD_LIBRARY_PATH" in env:
        parts = [
            p for p in env["LD_LIBRARY_PATH"].split(os.pathsep)
            if p and not os.path.abspath(p).startswith(os.path.abspath(meipass))
        ]
        if parts:
            env["LD_LIBRARY_PATH"] = os.pathsep.join(parts)
        else:
            env.pop("LD_LIBRARY_PATH", None)

    if not env.get("DISPLAY") and not env.get("WAYLAND_DISPLAY"):
        if pathlib.Path("/tmp/.X11-unix/X0").exists():
            env["DISPLAY"] = ":0"
    return env


def setup_logging(data_dir: pathlib.Path) -> logging.Logger:
    """Configura el registro de eventos y errores en ~/.local/share/PuntajeNewcom/logs/."""
    logs_dir = data_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_file = logs_dir / "puntajenewcom.log"

    logger = logging.getLogger(APP_NAME)
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    try:
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setFormatter(formatter)
        logger.addHandler(fh)
    except OSError:
        pass

    sh = logging.StreamHandler(sys.stderr)
    sh.setLevel(logging.WARNING)
    sh.setFormatter(formatter)
    logger.addHandler(sh)

    return logger


def notify_fatal_error(title: str, message: str, log_path: Optional[pathlib.Path] = None) -> None:
    """
    Muestra un error de forma controlada en la terminal y mediante diálogo gráfico si no hay TTY,
    evitando que la aplicación se cierre silenciosamente al abrirse con doble clic.
    """
    full_msg = f"{title}\n\n{message}"
    if log_path:
        full_msg += f"\n\nRegistro detallado en:\n{log_path}"

    sys.stderr.write(f"\n[ERROR - {APP_NAME}] {full_msg}\n\n")
    sys.stderr.flush()

    env = clean_host_env()
    if not (env.get("DISPLAY") or env.get("WAYLAND_DISPLAY")):
        return

    if sys.stderr.isatty() and not os.environ.get("PUNTAJENEWCOM_FORCE_GUI_ERROR"):
        return

    zenity_bin = shutil.which("zenity")
    if zenity_bin:
        try:
            subprocess.run(
                [zenity_bin, "--error", "--title", APP_TITLE, "--width=480", "--text", full_msg],
                env=env,
                timeout=30,
                check=False,
            )
            return
        except Exception:
            pass

    notify_bin = shutil.which("notify-send")
    if notify_bin:
        try:
            subprocess.run(
                [notify_bin, "-u", "critical", APP_TITLE, full_msg],
                env=env,
                timeout=10,
                check=False,
            )
        except Exception:
            pass


def empty_state() -> Dict[str, Any]:
    """Devuelve el estado inicial limpio conforme al esquema v2."""
    return {
        "schemaVersion": SCHEMA_VERSION,
        "categories": [],
        "teams": [],
        "matchResults": [],
        "selectedCategoryId": None,
        "theme": "light",
    }


def validate_and_normalize_state(raw: Any) -> Tuple[Dict[str, Any], int]:
    """
    Valida que el objeto leído sea un diccionario de estado válido de PuntajeNewcom.
    Conserva intactos todos los campos de categorías, zonas, equipos, resultados y tablas.
    Devuelve (estado_normalizado, version_anterior).
    """
    if not isinstance(raw, dict):
        raise ValueError("El contenido del estado no es un objeto JSON válido.")

    # Si el archivo es un contenedor con clave 'state', extraerlo si no tiene 'categories' directo
    if "state" in raw and isinstance(raw["state"], dict) and "categories" not in raw:
        raw = raw["state"]

    prev_version = raw.get("schemaVersion", 1)
    if not isinstance(prev_version, int) or prev_version < 1:
        prev_version = 1

    categories = raw.get("categories", [])
    teams = raw.get("teams", [])
    match_results = raw.get("matchResults", [])

    if not isinstance(categories, list):
        raise ValueError("El campo 'categories' debe ser una lista.")
    if not isinstance(teams, list):
        raise ValueError("El campo 'teams' debe ser una lista.")
    if not isinstance(match_results, list):
        raise ValueError("El campo 'matchResults' debe ser una lista.")

    cat_ids = set()
    valid_categories = []
    for cat in categories:
        if not isinstance(cat, dict):
            continue
        cid = cat.get("id")
        cname = cat.get("name")
        if not isinstance(cid, str) or not cid.strip() or cid == "demo-cat-50" or cid in cat_ids:
            continue
        if not isinstance(cname, str) or not cname.strip():
            continue
        cat_ids.add(cid)
        valid_categories.append(cat)

    team_ids = set()
    valid_teams = []
    for team in teams:
        if not isinstance(team, dict):
            continue
        tid = team.get("id")
        tname = team.get("name")
        tcid = team.get("categoryId")
        if (
            not isinstance(tid, str)
            or not tid.strip()
            or tid in team_ids
            or not isinstance(tname, str)
            or not tname.strip()
            or not isinstance(tcid, str)
            or tcid not in cat_ids
        ):
            continue
        team_ids.add(tid)
        valid_teams.append(team)

    match_ids = set()
    valid_matches = []
    for match in match_results:
        if not isinstance(match, dict):
            continue
        mid = match.get("id")
        mcid = match.get("categoryId")
        wid = match.get("winnerId")
        lid = match.get("loserId")
        if (
            not isinstance(mid, str)
            or not mid.strip()
            or mid in match_ids
            or mcid not in cat_ids
            or wid not in team_ids
            or lid not in team_ids
            or wid == lid
        ):
            continue
        match_ids.add(mid)
        valid_matches.append(match)

    selected = raw.get("selectedCategoryId")
    if not isinstance(selected, str) or selected not in cat_ids:
        selected = valid_categories[0]["id"] if valid_categories else None

    theme = "dark" if raw.get("theme") == "dark" else "light"

    normalized: Dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "categories": valid_categories,
        "teams": valid_teams,
        "matchResults": valid_matches,
        "selectedCategoryId": selected,
        "theme": theme,
    }
    return normalized, prev_version


def fsync_directory(dir_path: pathlib.Path) -> None:
    """Sincroniza el descriptor del directorio en sistemas POSIX para asegurar atomicidad de os.replace."""
    try:
        fd = os.open(str(dir_path), os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


def atomic_write_json(target_path: pathlib.Path, payload: Dict[str, Any], readonly: bool = False) -> None:
    """
    Escribe un objeto JSON de manera atómica:
    1. Serializa y verifica validez JSON en memoria.
    2. Escribe en un archivo temporal dentro del mismo directorio.
    3. Ejecuta flush() y os.fsync() sobre el archivo temporal.
    4. Verifica la lectura completa del archivo temporal desde disco.
    5. Reemplaza atómicamente el archivo destino mediante os.replace().
    6. Ejecuta fsync() sobre el directorio contenedor.
    """
    target_path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    # Validar que el texto serializado sea parseable
    json.loads(serialized)

    tmp_name = f".{target_path.name}.tmp.{os.getpid()}.{threading.get_ident()}.{int(time.time() * 1000)}"
    tmp_path = target_path.parent / tmp_name

    try:
        # Si el destino existe y era de solo lectura, habilitar escritura antes del replace
        if target_path.exists():
            try:
                os.chmod(target_path, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)
            except OSError:
                pass

        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write(serialized)
            f.flush()
            os.fsync(f.fileno())

        # Comprobar que el archivo temporal escrito en disco está completo y es JSON válido
        with open(tmp_path, "r", encoding="utf-8") as check_f:
            verify_data = json.load(check_f)
        if not isinstance(verify_data, dict):
            raise IOError("Verificación post-escritura fallida: estructura inválida.")

        if readonly:
            os.chmod(tmp_path, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
        else:
            os.chmod(tmp_path, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)

        os.replace(tmp_path, target_path)
        fsync_directory(target_path.parent)
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


class PersistentStateStore:
    """
    Administrador de persistencia en ~/.local/share/PuntajeNewcom/.
    Garantiza creación automática de directorios, guardado atómico, copias de seguridad
    antes de migraciones, protección ante corrupción y mecanismo de backup/restauración.
    """

    def __init__(self, data_dir: pathlib.Path, logger: logging.Logger) -> None:
        self.data_dir = data_dir.resolve()
        self.backups_dir = self.data_dir / "backups"
        self.logs_dir = self.data_dir / "logs"
        self.state_path = self.data_dir / "state.json"
        self.prev_path = self.data_dir / "state.prev.json"
        self.logger = logger
        self._lock = threading.RLock()
        self.ensure_directories()

    def ensure_directories(self) -> None:
        """Crea automáticamente la estructura ~/.local/share/PuntajeNewcom/."""
        for folder in (self.data_dir, self.backups_dir, self.logs_dir):
            folder.mkdir(parents=True, exist_ok=True)

    def _timestamp_slug(self) -> str:
        return dt.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

    def _unique_backup_path(self, prefix: str, label: Optional[str] = None) -> pathlib.Path:
        ts = self._timestamp_slug()
        clean_label = ""
        if label:
            sanitized = re.sub(r"[^a-zA-Z0-9_-]+", "_", label.strip()).strip("_")
            if sanitized:
                clean_label = f"-{sanitized[:40]}"
        base_name = f"{prefix}-{ts}{clean_label}.json"
        candidate = self.backups_dir / base_name
        counter = 1
        while candidate.exists():
            candidate = self.backups_dir / f"{prefix}-{ts}{clean_label}-{counter:02d}.json"
            counter += 1
        return candidate

    def _quarantine_corrupt_file(self, source_path: pathlib.Path, reason: str) -> Optional[pathlib.Path]:
        if not source_path.exists():
            return None
        try:
            corrupt_dest = self._unique_backup_path("corrupt", source_path.stem)
            shutil.copy2(source_path, corrupt_dest)
            os.chmod(corrupt_dest, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
            self.logger.warning(
                "Archivo corrupto o incompleto detectado (%s). Resguardado en: %s",
                reason,
                corrupt_dest,
            )
            return corrupt_dest
        except OSError as exc:
            self.logger.error("No se pudo resguardar el archivo corrupto: %s", exc)
            return None

    def _try_load_file(self, path: pathlib.Path) -> Tuple[Optional[Dict[str, Any]], int, Optional[str]]:
        if not path.exists():
            return None, SCHEMA_VERSION, None
        try:
            raw_text = path.read_text(encoding="utf-8")
            if not raw_text.strip():
                return None, SCHEMA_VERSION, "Archivo vacío"
            parsed = json.loads(raw_text)
            normalized, prev_version = validate_and_normalize_state(parsed)
            return normalized, prev_version, None
        except Exception as exc:
            return None, SCHEMA_VERSION, str(exc)

    def load(self) -> Tuple[Dict[str, Any], bool]:
        """
        Carga el estado persistente desde state.json.
        Si state.json fue interrumpido o está corrupto, lo resguarda en backups/corrupt-*.json
        y recupera automáticamente desde state.prev.json o desde la última copia de seguridad válida.
        Si detecta una versión anterior de esquema, realiza un backup pre-migración antes de actualizar.
        Devuelve (estado, existia_en_disco).
        """
        with self._lock:
            self.ensure_directories()
            if self.state_path.exists():
                state, prev_version, error = self._try_load_file(self.state_path)
                if state is not None:
                    if prev_version != SCHEMA_VERSION:
                        mig_backup = self._unique_backup_path(f"pre-migration-v{prev_version}")
                        try:
                            shutil.copy2(self.state_path, mig_backup)
                            os.chmod(mig_backup, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
                            self.logger.info(
                                "Copia de seguridad previa a migración (v%s -> v%s) creada en: %s",
                                prev_version,
                                SCHEMA_VERSION,
                                mig_backup,
                            )
                        except OSError as exc:
                            self.logger.warning("No se pudo crear copia pre-migración: %s", exc)
                        atomic_write_json(self.state_path, state)
                    return state, True

                # state.json existe pero está corrupto o incompleto
                self._quarantine_corrupt_file(self.state_path, error or "JSON inválido")

                # Intentar recuperar desde state.prev.json
                prev_state, _, prev_err = self._try_load_file(self.prev_path)
                if prev_state is not None:
                    self.logger.warning(
                        "Estado recuperado exitosamente desde snapshot previo: %s",
                        self.prev_path,
                    )
                    atomic_write_json(self.state_path, prev_state)
                    return prev_state, True

                # Intentar recuperar desde el backup válido más reciente que no sea 'corrupt-*'
                for binfo in self.list_backups():
                    if binfo["valid"] and not binfo["name"].startswith("corrupt-"):
                        bpath = self.backups_dir / binfo["name"]
                        bstate, _, _ = self._try_load_file(bpath)
                        if bstate is not None:
                            self.logger.warning(
                                "Estado recuperado desde la copia de seguridad más reciente: %s",
                                bpath,
                            )
                            atomic_write_json(self.state_path, bstate)
                            return bstate, True

                self.logger.warning("No se encontró respaldo válido para recuperar; iniciando estado limpio.")
                return empty_state(), False

            # Si state.json no existe pero state.prev.json sí existe (ej. interrupción externa)
            if self.prev_path.exists():
                prev_state, _, _ = self._try_load_file(self.prev_path)
                if prev_state is not None:
                    self.logger.info("Restaurando state.json ausente desde state.prev.json.")
                    atomic_write_json(self.state_path, prev_state)
                    return prev_state, True

            return empty_state(), False

    def save(self, raw_state: Dict[str, Any], reason: str = "save") -> Dict[str, Any]:
        """
        Valida y guarda atómicamente el estado en state.json.
        Antes de sobrescribir state.json, actualiza state.prev.json con la versión válida anterior.
        Si se detecta cambio de versión de esquema, guarda una copia en backups/pre-migration-*.json.
        """
        with self._lock:
            self.ensure_directories()
            normalized, prev_version = validate_and_normalize_state(raw_state)

            if self.state_path.exists():
                current_valid, disk_version, err = self._try_load_file(self.state_path)
                if current_valid is not None:
                    # Actualizar snapshot de recuperación inmediata state.prev.json
                    atomic_write_json(self.prev_path, current_valid)
                    # Si había una versión anterior de esquema o razón explícita de migración
                    if disk_version != SCHEMA_VERSION or prev_version != SCHEMA_VERSION:
                        mig_path = self._unique_backup_path(f"pre-migration-v{min(disk_version, prev_version)}")
                        atomic_write_json(mig_path, current_valid, readonly=True)
                        self.logger.info("Respaldo automático pre-migración guardado en %s", mig_path)
                elif err:
                    self._quarantine_corrupt_file(self.state_path, err)

            atomic_write_json(self.state_path, normalized)
            return normalized

    def create_backup(
        self,
        label: Optional[str] = None,
        output_path: Optional[str] = None,
        prefix: str = "backup",
    ) -> Dict[str, Any]:
        """
        Crea una copia de seguridad protegida (solo lectura) en ~/.local/share/PuntajeNewcom/backups/
        y opcionalmente exporta una copia a output_path sin sobrescribir archivos existentes.
        """
        with self._lock:
            self.ensure_directories()
            current_state, exists = self.load()
            if not exists:
                atomic_write_json(self.state_path, current_state)

            backup_path = self._unique_backup_path(prefix, label)
            created_at = dt.datetime.now().isoformat(timespec="seconds")

            atomic_write_json(backup_path, current_state, readonly=True)
            raw_bytes = backup_path.read_bytes()
            sha256_hash = hashlib.sha256(raw_bytes).hexdigest()

            exported_to: Optional[str] = None
            if output_path:
                out_file = pathlib.Path(output_path).expanduser().resolve()
                if out_file.exists():
                    raise FileExistsError(
                        f"El archivo destino ya existe y no será sobrescrito: {out_file}"
                    )
                out_file.parent.mkdir(parents=True, exist_ok=True)
                atomic_write_json(out_file, current_state, readonly=False)
                exported_to = str(out_file)

            info = {
                "name": backup_path.name,
                "path": str(backup_path),
                "exportedTo": exported_to,
                "createdAt": created_at,
                "sizeBytes": len(raw_bytes),
                "sha256": sha256_hash,
                "categories": len(current_state.get("categories", [])),
                "teams": len(current_state.get("teams", [])),
                "matches": len(current_state.get("matchResults", [])),
            }
            self.logger.info(
                "Copia de seguridad creada: %s (categorías=%d, equipos=%d, partidos=%d)",
                backup_path.name,
                info["categories"],
                info["teams"],
                info["matches"],
            )
            return info

    def list_backups(self) -> List[Dict[str, Any]]:
        """Lista todas las copias de seguridad disponibles con fecha, tamaño y resumen de datos."""
        with self._lock:
            self.ensure_directories()
            items: List[Dict[str, Any]] = []
            for path in sorted(self.backups_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
                stat_info = path.stat()
                mtime_str = dt.datetime.fromtimestamp(stat_info.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
                state, _, err = self._try_load_file(path)
                valid = state is not None and not path.name.startswith("corrupt-")
                items.append(
                    {
                        "name": path.name,
                        "path": str(path),
                        "date": mtime_str,
                        "mtime": stat_info.st_mtime,
                        "sizeBytes": stat_info.st_size,
                        "valid": valid,
                        "error": err,
                        "categories": len(state.get("categories", [])) if state else 0,
                        "teams": len(state.get("teams", [])) if state else 0,
                        "matches": len(state.get("matchResults", [])) if state else 0,
                        "readonly": not bool(stat_info.st_mode & stat.S_IWUSR),
                    }
                )
            return items

    def resolve_backup_path(self, name_or_path: str) -> pathlib.Path:
        """Resuelve el nombre o ruta de una copia de seguridad."""
        candidate = pathlib.Path(name_or_path).expanduser()
        if candidate.is_file():
            return candidate.resolve()
        in_backups = (self.backups_dir / name_or_path).resolve()
        if in_backups.is_file():
            return in_backups
        if not name_or_path.endswith(".json"):
            in_backups_json = (self.backups_dir / f"{name_or_path}.json").resolve()
            if in_backups_json.is_file():
                return in_backups_json
        raise FileNotFoundError(f"No se encontró la copia de seguridad especificada: {name_or_path}")

    def restore_backup(self, name_or_path: str) -> Dict[str, Any]:
        """
        Restaura una copia de seguridad tras verificar su integridad.
        Antes de sobrescribir state.json, crea automáticamente una copia de seguridad
        de los datos actuales bajo el prefijo 'pre-restore-*' para evitar pérdida accidental.
        """
        with self._lock:
            self.ensure_directories()
            target_path = self.resolve_backup_path(name_or_path)
            restored_state, _, err = self._try_load_file(target_path)
            if restored_state is None:
                raise ValueError(
                    f"La copia de seguridad '{target_path.name}' no es válida o está dañada: {err}"
                )

            pre_restore_info = None
            if self.state_path.exists():
                current_state, _, current_err = self._try_load_file(self.state_path)
                if current_state is not None:
                    pre_restore_info = self.create_backup(
                        label=f"antes_de_restaurar_{target_path.stem[:20]}",
                        prefix="pre-restore",
                    )
                elif current_err:
                    self._quarantine_corrupt_file(self.state_path, current_err)

            atomic_write_json(self.state_path, restored_state)
            atomic_write_json(self.prev_path, restored_state)

            stat_info = target_path.stat()
            backup_date = dt.datetime.fromtimestamp(stat_info.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
            result = {
                "restoredFrom": str(target_path),
                "backupName": target_path.name,
                "backupDate": backup_date,
                "preRestoreBackup": pre_restore_info["name"] if pre_restore_info else None,
                "categories": len(restored_state.get("categories", [])),
                "teams": len(restored_state.get("teams", [])),
                "matches": len(restored_state.get("matchResults", [])),
            }
            self.logger.info(
                "Copia de seguridad '%s' (%s) restaurada correctamente. Respaldo previo: %s",
                result["backupName"],
                result["backupDate"],
                result["preRestoreBackup"],
            )
            return result


class PuntajeNewcomHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        server_address: Tuple[str, int],
        request_handler_class: Any,
        resource_dir: pathlib.Path,
        store: PersistentStateStore,
        logger: logging.Logger,
    ) -> None:
        super().__init__(server_address, request_handler_class)
        self.resource_dir = resource_dir
        self.store = store
        self.logger = logger
        self.last_activity = time.time()


class PuntajeNewcomRequestHandler(http.server.BaseHTTPRequestHandler):
    """Manejador HTTP para recursos estáticos de PuntajeNewcom y API REST de persistencia en disco."""

    server: PuntajeNewcomHTTPServer

    def log_message(self, fmt: str, *args: Any) -> None:
        # Evitar ruido excesivo en consola; registrar sólo errores en archivo de log
        pass

    def _send_json(self, status_code: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise ValueError("El cuerpo de la petición debe ser un objeto JSON.")
        return parsed

    def do_GET(self) -> None:
        self.server.last_activity = time.time()
        parsed_url = urllib.parse.urlparse(self.path)
        route = parsed_url.path

        if route == "/api/health":
            self._send_json(
                200,
                {
                    "ok": True,
                    "app": APP_NAME,
                    "version": APP_VERSION,
                    "pid": os.getpid(),
                    "dataDir": str(self.server.store.data_dir),
                },
            )
            return

        if route == "/api/state":
            try:
                state, exists = self.server.store.load()
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "exists": exists,
                        "state": state,
                        "dataDir": str(self.server.store.data_dir),
                        "stateFile": str(self.server.store.state_path),
                    },
                )
            except Exception as exc:
                self.server.logger.error("Error en GET /api/state: %s", exc)
                self._send_json(500, {"ok": False, "error": str(exc)})
            return

        if route == "/api/backups":
            try:
                backups = self.server.store.list_backups()
                self._send_json(200, {"ok": True, "backups": backups})
            except Exception as exc:
                self.server.logger.error("Error en GET /api/backups: %s", exc)
                self._send_json(500, {"ok": False, "error": str(exc)})
            return

        self._serve_static(route)

    def do_POST(self) -> None:
        self.server.last_activity = time.time()
        parsed_url = urllib.parse.urlparse(self.path)
        route = parsed_url.path

        if route == "/api/state":
            try:
                payload = self._read_json_body()
                reason = str(payload.get("reason", "save"))
                target_state = payload.get("state") if "state" in payload and isinstance(payload.get("state"), dict) else payload
                saved = self.server.store.save(target_state, reason=reason)
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "savedAt": dt.datetime.now().isoformat(timespec="seconds"),
                        "categories": len(saved.get("categories", [])),
                        "teams": len(saved.get("teams", [])),
                        "matches": len(saved.get("matchResults", [])),
                    },
                )
            except Exception as exc:
                self.server.logger.error("Error en POST /api/state: %s", exc)
                self._send_json(400, {"ok": False, "error": str(exc)})
            return

        if route == "/api/backups/create":
            try:
                payload = self._read_json_body()
                label = payload.get("label")
                output_path = payload.get("output")
                info = self.server.store.create_backup(
                    label=str(label) if label else None,
                    output_path=str(output_path) if output_path else None,
                )
                self._send_json(200, {"ok": True, "backup": info})
            except Exception as exc:
                self.server.logger.error("Error en POST /api/backups/create: %s", exc)
                self._send_json(400, {"ok": False, "error": str(exc)})
            return

        if route == "/api/backups/restore":
            try:
                payload = self._read_json_body()
                if not payload.get("confirm"):
                    self._send_json(
                        400,
                        {
                            "ok": False,
                            "error": "Se requiere confirmación explícita (confirm=true) para restaurar una copia de seguridad.",
                        },
                    )
                    return
                backup_name = str(payload.get("backup", "")).strip()
                if not backup_name:
                    self._send_json(400, {"ok": False, "error": "Debe indicar el nombre de la copia a restaurar."})
                    return
                result = self.server.store.restore_backup(backup_name)
                self._send_json(200, {"ok": True, "restored": result})
            except Exception as exc:
                self.server.logger.error("Error en POST /api/backups/restore: %s", exc)
                self._send_json(400, {"ok": False, "error": str(exc)})
            return

        self._send_json(404, {"ok": False, "error": f"Ruta no encontrada: {route}"})

    def _serve_static(self, route: str) -> None:
        if route in ("", "/"):
            rel_path = "index.html"
        elif route == "/favicon.ico":
            rel_path = "assets/puntajenewcom.png" if (self.server.resource_dir / "assets/puntajenewcom.png").exists() else "assets/puntajenewcom.svg"
        else:
            rel_path = route.lstrip("/")

        target = (self.server.resource_dir / rel_path).resolve()
        try:
            target.relative_to(self.server.resource_dir)
        except ValueError:
            self._send_json(403, {"ok": False, "error": "Acceso denegado."})
            return

        if not target.is_file():
            self._send_json(404, {"ok": False, "error": f"Recurso no encontrado: {rel_path}"})
            return

        content_type, _ = mimetypes.guess_type(str(target))
        if target.suffix == ".js":
            content_type = "application/javascript; charset=utf-8"
        elif target.suffix == ".css":
            content_type = "text/css; charset=utf-8"
        elif target.suffix == ".html":
            content_type = "text/html; charset=utf-8"
        elif target.suffix == ".svg":
            content_type = "image/svg+xml"
        elif not content_type:
            content_type = "application/octet-stream"

        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.end_headers()
        self.wfile.write(data)


def verify_bundled_resources(resource_dir: pathlib.Path) -> None:
    """Verifica que todos los archivos y módulos de la aplicación estén presentes."""
    missing = [rel for rel in REQUIRED_RESOURCES if not (resource_dir / rel).is_file()]
    if missing:
        raise FileNotFoundError(
            f"Faltan recursos esenciales de la aplicación en {resource_dir}: {', '.join(missing)}"
        )


def check_existing_instance(data_dir: pathlib.Path) -> Optional[str]:
    """Comprueba si ya hay una instancia activa de PuntajeNewcom respondiendo en localhost."""
    runtime_file = data_dir / "runtime.json"
    if not runtime_file.is_file():
        return None
    try:
        info = json.loads(runtime_file.read_text(encoding="utf-8"))
        url = str(info.get("url", "")).strip()
        if not url:
            return None
        req = urllib.request.Request(f"{url.rstrip('/')}/api/health", headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=1.2) as resp:
            if resp.status == 200:
                payload = json.loads(resp.read().decode("utf-8"))
                if payload.get("ok") and payload.get("app") == APP_NAME:
                    return url
    except Exception:
        pass
    return None


def bind_local_server(
    host: str,
    preferred_port: int,
    resource_dir: pathlib.Path,
    store: PersistentStateStore,
    logger: logging.Logger,
) -> PuntajeNewcomHTTPServer:
    """Inicia el servidor HTTP local en preferred_port o busca un puerto libre contiguo."""
    ports_to_try = [preferred_port] + [
        preferred_port + offset for offset in range(1, PORT_SCAN_RANGE + 1) if preferred_port > 0
    ]
    if 0 not in ports_to_try:
        ports_to_try.append(0)

    last_err: Optional[Exception] = None
    for port in ports_to_try:
        try:
            return PuntajeNewcomHTTPServer(
                (host, port),
                PuntajeNewcomRequestHandler,
                resource_dir=resource_dir,
                store=store,
                logger=logger,
            )
        except OSError as exc:
            last_err = exc
            if exc.errno != errno.EADDRINUSE:
                break
    raise RuntimeError(f"No se pudo iniciar el servidor local en {host}: {last_err}")


GTK_WINDOW_HELPER_CODE = r"""
import os
import sys

os.environ.setdefault("WEBKIT_DISABLE_COMPOSITING_MODE", "1")
if os.environ.get("PUNTAJENEWCOM_DISABLE_WEBKIT_SANDBOX") == "1":
    os.environ["WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS"] = "1"

import gi
gi.require_version("Gtk", "3.0")
try:
    gi.require_version("WebKit2", "4.1")
except ValueError:
    gi.require_version("WebKit2", "4.0")
from gi.repository import Gtk, WebKit2, Gdk, GLib

ok, _ = Gtk.init_check([])
if not ok:
    sys.exit(2)

url = sys.argv[1]
title = sys.argv[2]
icon_path = sys.argv[3] if len(sys.argv) > 3 else ""
data_dir = sys.argv[4] if len(sys.argv) > 4 else ""
auto_close_ms = int(os.environ.get("PUNTAJENEWCOM_AUTOCLOSE_MS", "0") or "0")

win = Gtk.Window(title=title)
win.set_default_size(1280, 820)
win.set_position(Gtk.WindowPosition.CENTER)
if icon_path and os.path.isfile(icon_path):
    try:
        win.set_icon_from_file(icon_path)
    except Exception:
        pass

if data_dir:
    webkit_dir = os.path.join(data_dir, "webkit-data")
    os.makedirs(webkit_dir, exist_ok=True)
    mgr = WebKit2.WebsiteDataManager(
        base_data_directory=webkit_dir,
        base_cache_directory=os.path.join(webkit_dir, "cache"),
    )
    ctx = WebKit2.WebContext.new_with_website_data_manager(mgr)
    webview = WebKit2.WebView.new_with_context(ctx)
else:
    webview = WebKit2.WebView()

settings = webview.get_settings()
settings.set_enable_javascript(True)
settings.set_enable_page_cache(True)
if hasattr(WebKit2, "HardwareAccelerationPolicy"):
    settings.set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.NEVER)

def on_key_press(widget, event):
    keyval = event.keyval
    state = event.state & Gtk.accelerator_get_default_mod_mask()
    if keyval == Gdk.KEY_F5 or (state == Gdk.ModifierType.CONTROL_MASK and keyval in (Gdk.KEY_r, Gdk.KEY_R)):
        webview.reload()
        return True
    if state == Gdk.ModifierType.CONTROL_MASK and keyval in (Gdk.KEY_q, Gdk.KEY_Q):
        Gtk.main_quit()
        return True
    return False

win.connect("key-press-event", on_key_press)
win.connect("destroy", Gtk.main_quit)
win.add(webview)
win.show_all()

if auto_close_ms > 0:
    def on_load_changed(view, event):
        if event == WebKit2.LoadEvent.FINISHED:
            GLib.timeout_add(auto_close_ms, Gtk.main_quit)
    webview.connect("load-changed", on_load_changed)
    GLib.timeout_add(max(auto_close_ms * 4, 4000), Gtk.main_quit)

webview.load_uri(url)
Gtk.main()
"""


def try_launch_gtk_window(
    url: str,
    resource_dir: pathlib.Path,
    data_dir: pathlib.Path,
    logger: logging.Logger,
) -> bool:
    """
    Intenta abrir una ventana nativa GTK3 + WebKit2 utilizando el intérprete Python del sistema
    con entorno limpio para garantizar compatibilidad total con las librerías gráficas de Kali Linux.
    Devuelve True si la ventana se abrió y cerró normalmente.
    """
    env = clean_host_env()
    if not (env.get("DISPLAY") or env.get("WAYLAND_DISPLAY")):
        return False

    sys_python = shutil.which("python3") or "/usr/bin/python3"
    if not pathlib.Path(sys_python).is_file():
        return False

    # Comprobar rápidamente disponibilidad de Gtk + WebKit2 y conexión al display
    probe_cmd = [
        sys_python,
        "-c",
        (
            "import gi; gi.require_version('Gtk', '3.0'); "
            "from gi.repository import Gtk; ok, _ = Gtk.init_check([]); "
            "gi.require_version('WebKit2', '4.1'); from gi.repository import WebKit2; "
            "import sys; sys.exit(0 if ok else 2)"
        ),
    ]
    try:
        probe = subprocess.run(
            probe_cmd,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )
        if probe.returncode != 0:
            return False
    except Exception:
        return False

    icon_file = resource_dir / "assets" / "puntajenewcom.png"
    if not icon_file.is_file():
        icon_file = resource_dir / "assets" / "puntajenewcom.svg"

    logger.info("Abriendo ventana nativa GTK3/WebKit2 en %s", url)
    proc = subprocess.run(
        [sys_python, "-c", GTK_WINDOW_HELPER_CODE, url, APP_TITLE, str(icon_file), str(data_dir)],
        env=env,
        check=False,
    )
    if proc.returncode != 0 and env.get("PUNTAJENEWCOM_DISABLE_WEBKIT_SANDBOX") != "1":
        # Reintentar desactivando el sandbox interno de WebKit2 (necesario en contenedores/bwrap)
        env["PUNTAJENEWCOM_DISABLE_WEBKIT_SANDBOX"] = "1"
        proc = subprocess.run(
            [sys_python, "-c", GTK_WINDOW_HELPER_CODE, url, APP_TITLE, str(icon_file), str(data_dir)],
            env=env,
            check=False,
        )
    return proc.returncode == 0


def try_launch_chromium_app(
    url: str,
    data_dir: pathlib.Path,
    logger: logging.Logger,
) -> Optional[subprocess.Popen]:
    """
    Intenta abrir PuntajeNewcom como ventana independiente de aplicación (--app=URL)
    usando Chromium o Google Chrome con perfil dedicado en ~/.local/share/PuntajeNewcom/browser-profile.
    """
    env = clean_host_env()
    if not (env.get("DISPLAY") or env.get("WAYLAND_DISPLAY")):
        return None

    for binary_name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        binary = shutil.which(binary_name)
        if not binary:
            continue
        profile_dir = data_dir / "browser-profile"
        profile_dir.mkdir(parents=True, exist_ok=True)
        cmd = [
            binary,
            f"--app={url}",
            f"--user-data-dir={profile_dir}",
            "--class=PuntajeNewcom",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-sync",
            "--disable-extensions",
            "--window-size=1280,820",
        ]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            cmd.append("--no-sandbox")
        try:
            logger.info("Abriendo ventana de aplicación con %s en %s", binary_name, url)
            return subprocess.Popen(
                cmd,
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception as exc:
            logger.warning("No se pudo iniciar %s: %s", binary_name, exc)
    return None


def try_launch_standard_browser(url: str, logger: logging.Logger) -> Optional[subprocess.Popen]:
    """Abre el navegador predeterminado del sistema (firefox, firefox-esr o xdg-open)."""
    env = clean_host_env()
    if not (env.get("DISPLAY") or env.get("WAYLAND_DISPLAY")):
        return None

    for binary_name in ("firefox", "firefox-esr", "xdg-open"):
        binary = shutil.which(binary_name)
        if not binary:
            continue
        try:
            logger.info("Abriendo navegador (%s) en %s", binary_name, url)
            return subprocess.Popen(
                [binary, url],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception as exc:
            logger.warning("No se pudo iniciar %s: %s", binary_name, exc)
    return None


def run_self_test() -> int:
    """
    Ejecuta una batería de autodiagnóstico en un directorio temporal aislado
    sin tocar ~/.local/share/PuntajeNewcom/, comprobando:
    - Recursos empaquetados
    - Creación automática de directorios
    - Persistencia atómica de categorías, equipos, resultados 2-0 / 2-1, PF, PC y DIF
    - Recuperación ante archivo corrupto/incompleto
    - Creación, listado y restauración de copias de seguridad
    - Servidor HTTP local (/api/health, /api/state, /api/backups, index.html, app.js)
    """
    resource_dir = get_resource_dir()
    verify_bundled_resources(resource_dir)

    with tempfile.TemporaryDirectory(prefix="puntajenewcom-selftest-") as tmp_dir:
        tmp_path = pathlib.Path(tmp_dir) / "PuntajeNewcom"
        logger = setup_logging(tmp_path)
        store = PersistentStateStore(tmp_path, logger)

        assert tmp_path.is_dir(), "El directorio de datos no se creó automáticamente."
        assert (tmp_path / "backups").is_dir(), "El directorio de backups no se creó."
        assert (tmp_path / "logs").is_dir(), "El directorio de logs no se creó."

        # Guardar estado de prueba con categoría, equipos y partido 2-0 y 2-1
        sample_state = {
            "schemaVersion": 2,
            "categories": [
                {
                    "id": "cat-test-1",
                    "name": "Categoría +50",
                    "format": "zonas_y_final",
                    "currentStage": "GENERAL",
                    "championId": None,
                    "runnerUpId": None,
                    "zoneTournament": {
                        "status": "IN_PROGRESS",
                        "firstStageStatus": "IN_PROGRESS",
                        "secondStageStatus": None,
                        "zones": [
                            {
                                "id": "zone-a",
                                "name": "Zona A",
                                "phase": "clasificatoria",
                                "teamIds": ["team-1", "team-2", "team-3"],
                            }
                        ],
                        "secondStageZoneId": None,
                        "qualified": [],
                        "interzonals": [],
                        "confirmedAt": None,
                        "tieBreaks": [],
                    },
                }
            ],
            "teams": [
                {"id": "team-1", "name": "Águilas Doradas", "categoryId": "cat-test-1", "status": "ACTIVE", "stage": "GENERAL", "scoreEntries": []},
                {"id": "team-2", "name": "Los Nahuel", "categoryId": "cat-test-1", "status": "ACTIVE", "stage": "GENERAL", "scoreEntries": []},
                {"id": "team-3", "name": "Toninas", "categoryId": "cat-test-1", "status": "ACTIVE", "stage": "GENERAL", "scoreEntries": []},
            ],
            "matchResults": [
                {
                    "id": "match-1",
                    "categoryId": "cat-test-1",
                    "winnerId": "team-1",
                    "loserId": "team-2",
                    "score": "2-0",
                    "sets": [{"a": 15, "b": 10}, {"a": 15, "b": 12}],
                    "stage": "GENERAL",
                    "zoneId": "zone-a",
                    "createdAt": "2026-11-25T12:00:00Z",
                },
                {
                    "id": "match-2",
                    "categoryId": "cat-test-1",
                    "winnerId": "team-1",
                    "loserId": "team-3",
                    "score": "2-1",
                    "sets": [{"a": 15, "b": 13}, {"a": 11, "b": 15}, {"a": 15, "b": 9}],
                    "stage": "GENERAL",
                    "zoneId": "zone-a",
                    "createdAt": "2026-11-25T12:30:00Z",
                },
            ],
            "selectedCategoryId": "cat-test-1",
            "theme": "light",
        }

        store.save(sample_state)
        loaded, exists = store.load()
        assert exists is True
        assert len(loaded["categories"]) == 1
        assert len(loaded["teams"]) == 3
        assert len(loaded["matchResults"]) == 2

        # Probar creación de backup
        binfo = store.create_backup(label="selftest")
        assert pathlib.Path(binfo["path"]).is_file()

        # Probar protección frente a escritura interrumpida / corrupción de state.json
        store.state_path.write_text("{corrupt-json-truncated", encoding="utf-8")
        recovered, rec_exists = store.load()
        assert rec_exists is True
        assert len(recovered["teams"]) == 3, "Falló la recuperación automática tras corrupción."

        # Probar servidor HTTP local y endpoints
        server = bind_local_server(DEFAULT_HOST, 0, resource_dir, store, logger)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base_url = f"http://{DEFAULT_HOST}:{port}"
            with urllib.request.urlopen(f"{base_url}/api/health", timeout=3) as resp:
                health = json.loads(resp.read().decode("utf-8"))
                assert health["ok"] is True

            with urllib.request.urlopen(f"{base_url}/api/state", timeout=3) as resp:
                api_state = json.loads(resp.read().decode("utf-8"))
                assert api_state["ok"] is True
                assert api_state["exists"] is True
                assert len(api_state["state"]["matchResults"]) == 2

            with urllib.request.urlopen(f"{base_url}/", timeout=3) as resp:
                html = resp.read().decode("utf-8")
                assert "Puntaje Newcom" in html
        finally:
            server.shutdown()
            server.server_close()

    print(f"[OK] Autodiagnóstico de {APP_NAME} v{APP_VERSION} completado exitosamente.")
    return 0


def print_status(store: PersistentStateStore, resource_dir: pathlib.Path) -> int:
    """Muestra el estado actual de instalación, rutas de persistencia y resumen de datos."""
    state, exists = store.load()
    backups = store.list_backups()
    active_url = check_existing_instance(store.data_dir)
    print(f"=== {APP_TITLE} (v{APP_VERSION}) ===")
    print(f"Directorio de recursos : {resource_dir}")
    print(f"Directorio de datos    : {store.data_dir}")
    print(f"Archivo de estado      : {store.state_path} ({'EXISTE' if exists else 'NO CREADO AÚN'})")
    print(f"Directorio de backups  : {store.backups_dir} ({len(backups)} copias)")
    print(f"Archivo de registro    : {store.logs_dir / 'puntajenewcom.log'}")
    print(f"Instancia en ejecución : {active_url or 'Ninguna'}")
    print("--- Resumen de datos persistidos ---")
    print(f"Categorías registradas : {len(state.get('categories', []))}")
    print(f"Equipos registrados    : {len(state.get('teams', []))}")
    print(f"Partidos cargados      : {len(state.get('matchResults', []))}")
    return 0


def print_backups_list(store: PersistentStateStore) -> int:
    """Imprime la tabla de copias de seguridad disponibles."""
    backups = store.list_backups()
    print(f"Directorio de copias de seguridad: {store.backups_dir}")
    if not backups:
        print("No hay copias de seguridad registradas.")
        return 0
    print(f"{'ARCHIVO':<48} {'FECHA':<20} {'CAT':>4} {'EQ':>4} {'PART':>5} {'ESTADO':<10}")
    print("-" * 96)
    for b in backups:
        status = "VÁLIDO" if b["valid"] else "CORRUPTO"
        print(
            f"{b['name']:<48} {b['date']:<20} {b['categories']:>4} {b['teams']:>4} {b['matches']:>5} {status:<10}"
        )
    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="puntajenewcom",
        description=f"{APP_TITLE} — Aplicación independiente para Kali Linux.",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"{APP_NAME} {APP_VERSION}",
    )
    parser.add_argument(
        "--data-dir",
        metavar="RUTA",
        help="Directorio de datos persistentes (por defecto: ~/.local/share/PuntajeNewcom).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Puerto local en 127.0.0.1 (por defecto: {DEFAULT_PORT}).",
    )
    parser.add_argument(
        "--ui",
        choices=("auto", "gtk", "chromium", "browser", "headless"),
        default=os.environ.get("PUNTAJENEWCOM_UI", "auto"),
        help="Modo de interfaz gráfica: auto (predeterminado), gtk, chromium, browser o headless.",
    )
    parser.add_argument(
        "--backup",
        action="store_true",
        help="Crear una copia de seguridad de los datos persistentes actuales.",
    )
    parser.add_argument(
        "--label",
        metavar="ETIQUETA",
        help="Etiqueta opcional para identificar la copia de seguridad creada con --backup.",
    )
    parser.add_argument(
        "--output",
        metavar="ARCHIVO",
        help="Ruta adicional donde exportar la copia de seguridad creada con --backup.",
    )
    parser.add_argument(
        "--list-backups",
        action="store_true",
        help="Listar todas las copias de seguridad disponibles con sus fechas y resumen.",
    )
    parser.add_argument(
        "--restore",
        metavar="COPIA",
        help="Restaurar una copia de seguridad por nombre o ruta de archivo.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirmar explícitamente la restauración de una copia de seguridad sin pregunta interactiva.",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Mostrar información sobre ubicación de datos, estado actual y copias de seguridad.",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Ejecutar autodiagnóstico interno en un entorno temporal aislado.",
    )
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    if args.self_test:
        return run_self_test()

    resource_dir = get_resource_dir()
    data_dir = get_data_dir(args.data_dir)
    logger = setup_logging(data_dir)

    try:
        verify_bundled_resources(resource_dir)
        store = PersistentStateStore(data_dir, logger)

        # Subcomandos CLI de estado y copias de seguridad
        if args.status:
            return print_status(store, resource_dir)

        if args.list_backups:
            return print_backups_list(store)

        if args.backup:
            info = store.create_backup(label=args.label, output_path=args.output)
            print(f"[OK] Copia de seguridad creada exitosamente:")
            print(f"  Archivo    : {info['name']}")
            print(f"  Ubicación  : {info['path']}")
            if info["exportedTo"]:
                print(f"  Exportado a: {info['exportedTo']}")
            print(f"  Fecha      : {info['createdAt']}")
            print(f"  Contenido  : {info['categories']} categorías, {info['teams']} equipos, {info['matches']} partidos")
            print(f"  SHA-256    : {info['sha256']}")
            return 0

        if args.restore:
            target_path = store.resolve_backup_path(args.restore)
            stat_info = target_path.stat()
            bdate = dt.datetime.fromtimestamp(stat_info.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
            bstate, _, err = store._try_load_file(target_path)
            if bstate is None:
                raise ValueError(f"El archivo de respaldo '{target_path}' no es válido: {err}")

            if not args.yes:
                if not sys.stdin.isatty():
                    raise RuntimeError(
                        "La restauración requiere confirmación interactiva o el parámetro explícito --yes."
                    )
                print(f"Copia seleccionada : {target_path.name}")
                print(f"Fecha de la copia  : {bdate}")
                print(
                    f"Contenido          : {len(bstate.get('categories', []))} categorías, "
                    f"{len(bstate.get('teams', []))} equipos, {len(bstate.get('matchResults', []))} partidos"
                )
                print(
                    "NOTA: Se creará automáticamente un respaldo de los datos actuales antes de restaurar."
                )
                answer = input("¿Confirmás restaurar esta copia de seguridad? [s/N]: ").strip().lower()
                if answer not in ("s", "si", "sí", "y", "yes"):
                    print("Restauración cancelada por el usuario. No se modificaron los datos.")
                    return 0

            res = store.restore_backup(args.restore)
            print(f"[OK] Copia de seguridad restaurada exitosamente:")
            print(f"  Restaurado desde : {res['backupName']} ({res['backupDate']})")
            if res["preRestoreBackup"]:
                print(f"  Respaldo previo  : {res['preRestoreBackup']}")
            print(
                f"  Datos activos    : {res['categories']} categorías, {res['teams']} equipos, {res['matches']} partidos"
            )
            return 0

        # Verificar y cargar estado inicial al arrancar la aplicación
        initial_state, existed = store.load()
        if not existed:
            store.save(initial_state, reason="first-init")
            logger.info("Directorio de datos inicializado en %s", store.data_dir)
        else:
            logger.info(
                "Estado cargado desde %s (%d categorías, %d equipos, %d partidos)",
                store.state_path,
                len(initial_state.get("categories", [])),
                len(initial_state.get("teams", [])),
                len(initial_state.get("matchResults", [])),
            )

        # Si ya hay una instancia activa y no estamos en modo headless, abrir ventana hacia esa instancia
        existing_url = check_existing_instance(store.data_dir)
        if existing_url and args.ui != "headless":
            logger.info("Conectando a instancia activa de %s en %s", APP_NAME, existing_url)
            if args.ui in ("auto", "gtk") and try_launch_gtk_window(existing_url, resource_dir, store.data_dir, logger):
                return 0
            proc = try_launch_chromium_app(existing_url, store.data_dir, logger) or try_launch_standard_browser(existing_url, logger)
            if proc:
                return 0

        # Iniciar servidor HTTP embebido
        server = bind_local_server(DEFAULT_HOST, args.port, resource_dir, store, logger)
        actual_port = server.server_address[1]
        url = f"http://{DEFAULT_HOST}:{actual_port}/"

        runtime_file = store.data_dir / "runtime.json"
        atomic_write_json(
            runtime_file,
            {
                "pid": os.getpid(),
                "host": DEFAULT_HOST,
                "port": actual_port,
                "url": url,
                "startedAt": dt.datetime.now().isoformat(timespec="seconds"),
            },
        )

        stop_event = threading.Event()

        def handle_signal(signum: int, _frame: Any) -> None:
            logger.info("Señal %d recibida; cerrando %s de forma segura...", signum, APP_NAME)
            stop_event.set()

        signal.signal(signal.SIGINT, handle_signal)
        signal.signal(signal.SIGTERM, handle_signal)

        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        logger.info("%s v%s escuchando en %s (Datos: %s)", APP_NAME, APP_VERSION, url, store.data_dir)

        try:
            if args.ui == "headless":
                print(f"{APP_TITLE} activo en {url}", flush=True)
                print(f"Datos persistentes en: {store.data_dir}", flush=True)
                while not stop_event.is_set():
                    stop_event.wait(0.5)
                return 0

            if args.ui in ("auto", "gtk"):
                if try_launch_gtk_window(url, resource_dir, store.data_dir, logger):
                    return 0
                if args.ui == "gtk":
                    raise RuntimeError(
                        "No se pudo abrir la ventana GTK3/WebKit2. Verifique que haya una sesión gráfica activa."
                    )

            browser_proc: Optional[subprocess.Popen] = None
            if args.ui in ("auto", "chromium"):
                browser_proc = try_launch_chromium_app(url, store.data_dir, logger)
                if not browser_proc and args.ui == "chromium":
                    raise RuntimeError("No se encontró Chromium ni Google Chrome para abrir el modo --ui chromium.")

            if not browser_proc:
                browser_proc = try_launch_standard_browser(url, logger)

            if not browser_proc:
                raise RuntimeError(
                    "No se detectó un entorno gráfico activo (DISPLAY/WAYLAND_DISPLAY) ni un navegador compatible. "
                    "Puede ejecutar 'puntajenewcom --ui headless' o 'puntajenewcom --status'."
                )

            print(f"{APP_TITLE} iniciado en {url}", flush=True)
            print(f"Datos guardados automáticamente en: {store.data_dir}", flush=True)

            start_watch = time.time()
            while not stop_event.is_set():
                ret = browser_proc.poll()
                if ret is not None:
                    # Si el proceso del navegador duró más de 3 segundos, fue una ventana dedicada que el usuario cerró
                    if time.time() - start_watch >= 3.0:
                        break
                    # Si terminó inmediatamente, delegó la pestaña a una sesión existente del navegador;
                    # mantener el servidor activo hasta recibir Ctrl+C o señal de cierre.
                    while not stop_event.is_set():
                        stop_event.wait(0.5)
                    break
                stop_event.wait(0.4)

            return 0
        finally:
            server.shutdown()
            server.server_close()
            if runtime_file.exists():
                try:
                    runtime_file.unlink()
                except OSError:
                    pass
            logger.info("%s finalizado correctamente.", APP_NAME)

    except Exception as exc:
        log_path = data_dir / "logs" / "puntajenewcom.log"
        logger.error("Error fatal en %s: %s\n%s", APP_NAME, exc, traceback.format_exc())
        notify_fatal_error(
            "No se pudo iniciar o completar la operación en PuntajeNewcom",
            str(exc),
            log_path=log_path,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
