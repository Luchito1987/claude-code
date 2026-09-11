#!/usr/bin/env bash
#
# Mantiene la app al día sola.
#
# Mira si hay algo nuevo en la rama, y si lo hay reconstruye y levanta. Si la
# app no responde después de levantar, vuelve al commit anterior y la reconstruye
# con él: es preferible quedarse una versión atrás que quedarse sin app, sobre
# todo en una que se consulta para saber si alcanza la plata del mes.
#
# Instalación (una sola vez):
#   apps/finanzas/scripts/instalar-autoactualizacion.sh
#
# Se puede correr a mano en cualquier momento:
#   apps/finanzas/scripts/autoactualizar.sh

set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$APP_DIR/../.." && pwd)"
RAMA="${RAMA:-main}"
URL_SALUD="${URL_SALUD:-http://localhost:3100/api/health}"
LOG="$APP_DIR/data/autoactualizar.log"

mkdir -p "$(dirname "$LOG")"
decir() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

cd "$REPO_DIR" || { decir "no encuentro el repo en $REPO_DIR"; exit 1; }

# Nada de pisar trabajo sin guardar: si hay cambios locales, no se toca nada.
if [[ -n "$(git status --porcelain)" ]]; then
  decir "hay cambios sin commitear en el repo; no actualizo"
  exit 0
fi

ANTERIOR="$(git rev-parse HEAD)"

git fetch --quiet origin "$RAMA" || { decir "no pude bajar de origin/$RAMA"; exit 1; }
NUEVO="$(git rev-parse "origin/$RAMA")"

if [[ "$ANTERIOR" == "$NUEVO" ]]; then
  exit 0   # al día: silencio, que esto corre cada pocos minutos
fi

decir "hay versión nueva: ${ANTERIOR:0:7} -> ${NUEVO:0:7}"
git merge --ff-only "origin/$RAMA" >>"$LOG" 2>&1 || {
  decir "no pude avanzar a origin/$RAMA (la rama local divergió); no actualizo"
  exit 1
}

levantar() {
  ( cd "$APP_DIR" && docker compose up -d --build ) >>"$LOG" 2>&1
}

sana() {
  # El contenedor tarda en arrancar; se le da un minuto largo antes de rendirse.
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 3 "$URL_SALUD" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

if levantar && sana; then
  decir "actualizada y respondiendo en ${NUEVO:0:7}"
  exit 0
fi

decir "la versión ${NUEVO:0:7} no levantó bien; vuelvo a ${ANTERIOR:0:7}"
git reset --hard "$ANTERIOR" >>"$LOG" 2>&1
if levantar && sana; then
  decir "restaurada la versión anterior, la app responde"
else
  decir "ATENCIÓN: tampoco levanta la anterior; hace falta mirarlo a mano"
fi
exit 1
