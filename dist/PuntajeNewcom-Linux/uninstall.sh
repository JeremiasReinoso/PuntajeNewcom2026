#!/usr/bin/env bash
# ==============================================================================
# PuntajeNewcom — Desinstalador para Kali Linux
# IMPORTANTE: Por diseño de seguridad, este desinstalador NO elimina los datos
# guardados del usuario en ~/.local/share/PuntajeNewcom/.
# La eliminación de datos es una operación independiente y explícita.
# ==============================================================================

set -euo pipefail

APP_NAME="PuntajeNewcom"
CMD_NAME="puntajenewcom"

INSTALL_DIR="${PUNTAJENEWCOM_INSTALL_DIR:-${HOME}/.local/opt/${APP_NAME}}"
BIN_DIR="${PUNTAJENEWCOM_BIN_DIR:-${HOME}/.local/bin}"
APPS_DIR="${PUNTAJENEWCOM_APPS_DIR:-${HOME}/.local/share/applications}"
ICONS_DIR="${PUNTAJENEWCOM_ICONS_DIR:-${HOME}/.local/share/icons/hicolor}"
DATA_DIR="${PUNTAJENEWCOM_DATA_DIR:-${HOME}/.local/share/${APP_NAME}}"

PURGE_DATA="false"
CONFIRM_PURGE="false"

for arg in "$@"; do
  case "${arg}" in
    --purge-data)
      PURGE_DATA="true"
      ;;
    --confirm-delete-data)
      CONFIRM_PURGE="true"
      ;;
    -h|--help)
      echo "Uso: ./uninstall.sh [--purge-data [--confirm-delete-data]]"
      echo ""
      echo "Por defecto, desinstala el ejecutable, el comando '${CMD_NAME}' y el acceso"
      echo "directo del menú, CONSERVANDO intactos todos los datos y copias de seguridad"
      echo "en ${DATA_DIR}."
      exit 0
      ;;
  esac
done

echo "============================================================"
echo "  Desinstalador de ${APP_NAME}"
echo "============================================================"

# 1. Eliminar lanzador de terminal
if [[ -f "${BIN_DIR}/${CMD_NAME}" ]]; then
  rm -f "${BIN_DIR}/${CMD_NAME}"
  echo "[OK] Lanzador de terminal eliminado: ${BIN_DIR}/${CMD_NAME}"
else
  echo "[INFO] Lanzador de terminal no encontrado en ${BIN_DIR}/${CMD_NAME}."
fi

# 2. Eliminar acceso directo .desktop
if [[ -f "${APPS_DIR}/puntajenewcom.desktop" ]]; then
  rm -f "${APPS_DIR}/puntajenewcom.desktop"
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "${APPS_DIR}" >/dev/null 2>&1 || true
  fi
  echo "[OK] Acceso directo eliminado: ${APPS_DIR}/puntajenewcom.desktop"
else
  echo "[INFO] Acceso directo no encontrado en ${APPS_DIR}/puntajenewcom.desktop."
fi

# 2b. Eliminar accesos directos del Escritorio si existen
for desktop_dir in "${HOME}/Escritorio" "${HOME}/Desktop"; do
  rm -f "${desktop_dir}/${APP_NAME}" "${desktop_dir}/${APP_NAME}.desktop" 2>/dev/null || true
done

# 3. Eliminar iconos instalados
rm -f "${ICONS_DIR}/128x128/apps/puntajenewcom.png" 2>/dev/null || true
rm -f "${ICONS_DIR}/scalable/apps/puntajenewcom.svg" 2>/dev/null || true

# 4. Eliminar carpeta de instalación de binarios (~/.local/opt/PuntajeNewcom)
if [[ -d "${INSTALL_DIR}" ]]; then
  rm -rf "${INSTALL_DIR}"
  echo "[OK] Directorio de la aplicación eliminado: ${INSTALL_DIR}"
else
  echo "[INFO] Directorio de la aplicación no encontrado en ${INSTALL_DIR}."
fi

# 5. Protección explícita de los datos persistentes del usuario
if [[ "${PURGE_DATA}" == "true" ]]; then
  if [[ -d "${DATA_DIR}" ]]; then
    if [[ "${CONFIRM_PURGE}" != "true" ]]; then
      echo ""
      echo "[ADVERTENCIA CRÍTICA] Ha solicitado eliminar también los datos del usuario en:"
      echo "  ${DATA_DIR}"
      read -r -p "Para confirmar el borrado definitivo, escriba exactamente 'ELIMINAR DATOS': " USER_INPUT
      if [[ "${USER_INPUT}" != "ELIMINAR DATOS" ]]; then
        echo "[INFO] Confirmación no válida. Los datos en ${DATA_DIR} fueron CONSERVADOS."
        exit 0
      fi
    fi
    rm -rf "${DATA_DIR}"
    echo "[OK] Datos persistentes eliminados explícitamente de: ${DATA_DIR}"
  fi
else
  echo ""
  echo "[PROTECCIÓN DE DATOS] Los datos de torneos, categorías, equipos, resultados"
  echo "y copias de seguridad NO fueron eliminados y permanecen resguardados en:"
  echo "  ${DATA_DIR}"
  echo ""
  echo "(Si en algún momento desea borrar también los datos de forma explícita,"
  echo " puede ejecutar: ./uninstall.sh --purge-data)"
fi

echo "============================================================"
echo "  Desinstalación de ${APP_NAME} finalizada."
echo "============================================================"
