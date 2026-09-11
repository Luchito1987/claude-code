#!/usr/bin/env bash
#
# Deja la app actualizándose sola. Se corre una sola vez.
#
#   apps/finanzas/scripts/instalar-autoactualizacion.sh
#
# A partir de ahí, cada cinco minutos se revisa si hay una versión nueva
# publicada; si la hay, se reconstruye y se levanta. Si la versión nueva no
# responde, se vuelve sola a la anterior.
#
# Para ver qué viene haciendo:      tail -f apps/finanzas/data/autoactualizar.log
# Para desinstalarlo:               crontab -e   y borrá la línea de finanzas

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$APP_DIR/scripts/autoactualizar.sh"
MARCA="# finanzas: autoactualizacion"

[[ -x "$SCRIPT" ]] || chmod +x "$SCRIPT"

if ! command -v crontab >/dev/null 2>&1; then
  echo "No encontré crontab en este sistema."
  echo "Instalalo con:  sudo apt install cron"
  exit 1
fi

# El repo tiene que estar parado en la rama que se va a seguir. Este clon quedó
# en la rama de trabajo de la app, que ya está mergeada: cambiarse a main no
# pierde nada, pero se comprueba antes de tocar nada.
REPO_DIR="$(cd "$APP_DIR/../.." && pwd)"
RAMA="${RAMA:-main}"
cd "$REPO_DIR"

ACTUAL_RAMA="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$ACTUAL_RAMA" != "$RAMA" ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Tenés cambios sin guardar en el repo. Guardalos o descartalos y volvé a correr esto."
    exit 1
  fi
  git fetch --quiet origin "$RAMA"
  if ! git merge-base --is-ancestor HEAD "origin/$RAMA"; then
    echo "La rama '$ACTUAL_RAMA' tiene commits que no están en '$RAMA'."
    echo "Subilos primero, o cambiate a mano con: git checkout $RAMA"
    exit 1
  fi
  echo "Cambiando de '$ACTUAL_RAMA' a '$RAMA' (todo lo de esa rama ya está en $RAMA)."
  git checkout "$RAMA" >/dev/null 2>&1
  git merge --ff-only "origin/$RAMA" >/dev/null 2>&1
fi

ACTUAL="$(crontab -l 2>/dev/null || true)"

if grep -Fq "$MARCA" <<<"$ACTUAL"; then
  echo "Ya estaba instalado. No cambio nada."
  echo "Para verlo:  crontab -l | grep finanzas"
  exit 0
fi

# PATH explícito: cron arranca con uno mínimo y ahí no existe docker.
{
  [[ -n "$ACTUAL" ]] && echo "$ACTUAL"
  echo "$MARCA"
  echo "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  echo "*/5 * * * * $SCRIPT >/dev/null 2>&1"
} | crontab -

echo "Listo. La app se va a mantener al día sola, revisando cada cinco minutos."
echo
echo "Registro:      tail -f $APP_DIR/data/autoactualizar.log"
echo "Comprobar:     crontab -l | grep finanzas"
echo "Forzar ahora:  $SCRIPT"
