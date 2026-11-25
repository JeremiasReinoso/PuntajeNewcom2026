#!/usr/bin/env bash
# ==============================================================================
# PuntajeNewcom — Instalador para Kali Linux (x86_64)
# Instala la aplicación en el espacio del usuario sin requerir permisos root:
#   - Binario y recursos : ~/.local/opt/PuntajeNewcom/
#   - Comando terminal   : ~/.local/bin/puntajenewcom
#   - Acceso directo     : ~/.local/share/applications/puntajenewcom.desktop
#   - Datos persistentes : ~/.local/share/PuntajeNewcom/ (se conservan en actualizaciones)
# ==============================================================================

set -euo pipefail

APP_NAME="PuntajeNewcom"
CMD_NAME="puntajenewcom"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

INSTALL_DIR="${PUNTAJENEWCOM_INSTALL_DIR:-${HOME}/.local/opt/${APP_NAME}}"
BIN_DIR="${PUNTAJENEWCOM_BIN_DIR:-${HOME}/.local/bin}"
APPS_DIR="${PUNTAJENEWCOM_APPS_DIR:-${HOME}/.local/share/applications}"
ICONS_DIR="${PUNTAJENEWCOM_ICONS_DIR:-${HOME}/.local/share/icons/hicolor}"
DATA_DIR="${PUNTAJENEWCOM_DATA_DIR:-${HOME}/.local/share/${APP_NAME}}"

echo "============================================================"
echo "  Instalador de ${APP_NAME} para Kali Linux"
echo "============================================================"

# 1. Comprobar sistema operativo y arquitectura
OS_NAME="$(uname -s)"
ARCH_NAME="$(uname -m)"

if [[ "${OS_NAME}" != "Linux" ]]; then
  echo "[ERROR] Este instalador está diseñado para sistemas Linux (detectado: ${OS_NAME})." >&2
  exit 1
fi

if [[ "${ARCH_NAME}" != "x86_64" && "${ARCH_NAME}" != "amd64" ]]; then
  echo "[ERROR] Arquitectura incompatible: se requiere x86_64 (detectada: ${ARCH_NAME})." >&2
  exit 1
fi
echo "[OK] Sistema operativo y arquitectura verificados (${OS_NAME} ${ARCH_NAME})."

# 2. Verificar dependencias externas del entorno gráfico
GUI_BACKEND="ninguno"
if command -v python3 >/dev/null 2>&1 && python3 -c "import gi; gi.require_version('Gtk', '3.0'); gi.require_version('WebKit2', '4.1')" >/dev/null 2>&1; then
  GUI_BACKEND="GTK3 + WebKit2 nativo"
elif command -v chromium >/dev/null 2>&1 || command -v google-chrome >/dev/null 2>&1; then
  GUI_BACKEND="Modo aplicación Chromium/Chrome"
elif command -v firefox >/dev/null 2>&1 || command -v firefox-esr >/dev/null 2>&1 || command -v xdg-open >/dev/null 2>&1; then
  GUI_BACKEND="Navegador del sistema (Firefox / xdg-open)"
fi

if [[ "${GUI_BACKEND}" == "ninguno" ]]; then
  echo "[AVISO] No se detectó WebKit2 ni un navegador gráfico estándar en PATH."
  echo "        La aplicación podrá ejecutarse en modo headless o tras instalar gir1.2-webkit2-4.1 / chromium."
else
  echo "[OK] Motor gráfico disponible: ${GUI_BACKEND}."
fi

# 3. Localizar los archivos del paquete de distribución
SOURCE_DIST=""
if [[ -x "${SCRIPT_DIR}/${APP_NAME}" && -d "${SCRIPT_DIR}/_internal" ]]; then
  SOURCE_DIST="${SCRIPT_DIR}"
elif [[ -x "${SCRIPT_DIR}/dist/${APP_NAME}-Linux/${APP_NAME}" ]]; then
  SOURCE_DIST="${SCRIPT_DIR}/dist/${APP_NAME}-Linux"
else
  echo "[ERROR] No se encontró el ejecutable compilado '${APP_NAME}'." >&2
  echo "        Ejecute install.sh desde la carpeta 'dist/PuntajeNewcom-Linux/' o la raíz del proyecto." >&2
  exit 1
fi
echo "[OK] Paquete de origen localizado en: ${SOURCE_DIST}"

# 4. Asegurar directorio de datos persistentes y realizar backup previo si es actualización
mkdir -p "${DATA_DIR}/backups" "${DATA_DIR}/logs"
if [[ -f "${DATA_DIR}/state.json" ]]; then
  echo "[INFO] Se detectaron datos existentes en ${DATA_DIR}/state.json."
  echo "       Creando copia de seguridad automática previa a la actualización..."
  PUNTAJENEWCOM_DATA_DIR="${DATA_DIR}" "${SOURCE_DIST}/${APP_NAME}" --backup --label "pre_update" >/dev/null 2>&1 || true
  echo "[OK] Datos existentes protegidos y respaldados."
fi

# 5. Instalar en ~/.local/opt/PuntajeNewcom/
echo "[INFO] Instalando ${APP_NAME} en ${INSTALL_DIR}..."
mkdir -p "$(dirname "${INSTALL_DIR}")"

# Si se instala desde una ubicación distinta a INSTALL_DIR, reemplazar limpiamente los binarios
if [[ "$(cd "${SOURCE_DIST}" && pwd)" != "$(mkdir -p "${INSTALL_DIR}" && cd "${INSTALL_DIR}" && pwd)" ]]; then
  rm -rf "${INSTALL_DIR}"
  mkdir -p "${INSTALL_DIR}"
  cp -a "${SOURCE_DIST}/." "${INSTALL_DIR}/"
fi

chmod 755 "${INSTALL_DIR}/${APP_NAME}"
if [[ -f "${INSTALL_DIR}/uninstall.sh" ]]; then
  chmod 755 "${INSTALL_DIR}/uninstall.sh"
fi
if [[ -f "${INSTALL_DIR}/install.sh" ]]; then
  chmod 755 "${INSTALL_DIR}/install.sh"
fi
echo "[OK] Archivos de la aplicación instalados en: ${INSTALL_DIR}"

# 6. Configurar iconos de la aplicación
ICON_PNG="${INSTALL_DIR}/assets/puntajenewcom.png"
ICON_SVG="${INSTALL_DIR}/assets/puntajenewcom.svg"
ICON_TARGET="${ICON_PNG}"

if [[ -f "${ICON_PNG}" ]]; then
  mkdir -p "${ICONS_DIR}/128x128/apps"
  cp -f "${ICON_PNG}" "${ICONS_DIR}/128x128/apps/puntajenewcom.png"
fi
if [[ -f "${ICON_SVG}" ]]; then
  mkdir -p "${ICONS_DIR}/scalable/apps"
  cp -f "${ICON_SVG}" "${ICONS_DIR}/scalable/apps/puntajenewcom.svg"
  if [[ ! -f "${ICON_PNG}" ]]; then
    ICON_TARGET="${ICON_SVG}"
  fi
fi
echo "[OK] Iconos configurados."

# 7. Crear lanzador de terminal ~/.local/bin/puntajenewcom
mkdir -p "${BIN_DIR}"
LAUNCHER_PATH="${BIN_DIR}/${CMD_NAME}"
cat > "${LAUNCHER_PATH}" <<EOF
#!/usr/bin/env bash
# Lanzador de terminal para ${APP_NAME}
set -euo pipefail
APP_EXEC="${INSTALL_DIR}/${APP_NAME}"
if [[ ! -x "\${APP_EXEC}" ]]; then
  echo "[ERROR] No se encontró el ejecutable de ${APP_NAME} en \${APP_EXEC}" >&2
  exit 1
fi
exec "\${APP_EXEC}" "\$@"
EOF
chmod 755 "${LAUNCHER_PATH}"
echo "[OK] Comando de terminal instalado en: ${LAUNCHER_PATH}"

# 8. Crear acceso directo .desktop para el menú de aplicaciones
mkdir -p "${APPS_DIR}"
DESKTOP_FILE="${APPS_DIR}/puntajenewcom.desktop"
cat > "${DESKTOP_FILE}" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=PuntajeNewcom
GenericName=Gestión de Torneos de Newcom
Comment=Gestión de categorías, zonas, equipos, resultados y tablas de posiciones de Newcom
Exec="${INSTALL_DIR}/${APP_NAME}"
TryExec=${INSTALL_DIR}/${APP_NAME}
Path=${INSTALL_DIR}
Icon=${ICON_TARGET}
Terminal=false
Categories=Sports;Utility;Office;
Keywords=Newcom;Torneo;Voleibol;Puntaje;Posiciones;FECHUVOL;
StartupNotify=true
StartupWMClass=PuntajeNewcom
EOF
chmod 755 "${DESKTOP_FILE}"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${APPS_DIR}" >/dev/null 2>&1 || true
fi
echo "[OK] Acceso directo creado en: ${DESKTOP_FILE}"

# 8b. Colocar ejecutable y acceso directo en el Escritorio del usuario si existe
DESKTOP_USER_DIR=""
if [[ -d "${HOME}/Escritorio" && -w "${HOME}/Escritorio" ]]; then
  DESKTOP_USER_DIR="${HOME}/Escritorio"
elif [[ -d "${HOME}/Desktop" && -w "${HOME}/Desktop" ]]; then
  DESKTOP_USER_DIR="${HOME}/Desktop"
fi

if [[ -n "${DESKTOP_USER_DIR}" ]]; then
  ln -sf "${INSTALL_DIR}/${APP_NAME}" "${DESKTOP_USER_DIR}/${APP_NAME}"
  cp -f "${DESKTOP_FILE}" "${DESKTOP_USER_DIR}/${APP_NAME}.desktop"
  chmod 755 "${DESKTOP_USER_DIR}/${APP_NAME}.desktop"
  if command -v gio >/dev/null 2>&1; then
    gio set "${DESKTOP_USER_DIR}/${APP_NAME}.desktop" metadata::trusted true 2>/dev/null || true
    if command -v sha256sum >/dev/null 2>&1; then
      DESKTOP_HASH="$(sha256sum "${DESKTOP_USER_DIR}/${APP_NAME}.desktop" | cut -d' ' -f1)"
      gio set -t string "${DESKTOP_USER_DIR}/${APP_NAME}.desktop" metadata::xfce-exe-checksum "${DESKTOP_HASH}" 2>/dev/null || true
    fi
  fi
  echo "[OK] Ejecutable y acceso directo colocados en el Escritorio: ${DESKTOP_USER_DIR}/${APP_NAME}"
fi

# 9. Verificar que ~/.local/bin esté en PATH
if [[ ":${PATH}:" != *":${BIN_DIR}:"* ]]; then
  for rc_file in "${HOME}/.bashrc" "${HOME}/.zshrc" "${HOME}/.profile"; do
    if [[ -f "${rc_file}" && -w "${rc_file}" ]]; then
      if ! grep -q ".local/bin" "${rc_file}" 2>/dev/null; then
        printf '\n# Agregado por el instalador de PuntajeNewcom\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "${rc_file}"
      fi
    fi
  done
  echo "[INFO] Se agregó ${BIN_DIR} al PATH en la configuración de su shell."
fi

echo ""
echo "============================================================"
echo "  ${APP_NAME} se instaló correctamente"
echo "============================================================"
echo "  Ejecutable instalado : ${INSTALL_DIR}/${APP_NAME}"
echo "  Comando de terminal  : ${CMD_NAME}"
echo "  Menú de aplicaciones : PuntajeNewcom (${DESKTOP_FILE})"
echo "  Datos persistentes   : ${DATA_DIR}/"
echo ""
echo "  Para abrir desde la terminal escriba:"
echo "    ${CMD_NAME}"
echo "============================================================"
