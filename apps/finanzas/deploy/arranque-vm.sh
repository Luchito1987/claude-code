#!/usr/bin/env bash
#
# Script de arranque de la máquina. Google lo corre como root la primera vez que
# la VM se enciende, y también en cada reinicio: por eso todo lo que hace tiene
# que poder repetirse sin romper nada.

set -euo pipefail
exec > >(tee -a /var/log/arranque-finanzas.log) 2>&1
echo "== arranque $(date) =="

DESTINO=/opt/finanzas
REPO="${REPO:-https://github.com/Luchito1987/claude-code.git}"

# La e2-micro tiene 1 GB de RAM y sin swap el kernel mata procesos cuando Docker
# descomprime una imagen grande. Dos gigas de swap en disco alcanzan y el disco
# gratuito son 30.
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v docker >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
fi

if [[ ! -d "$DESTINO/.git" ]]; then
  git clone --depth 1 "$REPO" "$DESTINO"
else
  git -C "$DESTINO" fetch --depth 1 origin main -q && git -C "$DESTINO" reset --hard origin/main -q
fi

cd "$DESTINO/apps/finanzas/deploy"

# El dominio sale de la IP pública: <ip>.sslip.io resuelve a esa misma IP sin
# que haya que registrar ni pagar nada, y Let's Encrypt emite certificado para
# él. El día que haya un dominio propio, se cambia esta línea y nada más.
IP="$(curl -s -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)"
DOMINIO="${DOMINIO_FIJO:-${IP}.sslip.io}"

cat > .env <<ENV
DOMINIO=$DOMINIO
IMAGEN=ghcr.io/luchito1987/finanzas:latest
TZ=America/Bogota
ENV

echo "== levantando en https://$DOMINIO =="

# Lo normal es bajar la imagen ya construida. Si no se puede —porque el paquete
# de ghcr todavía es privado, o porque el registro no responde— se construye acá
# mismo: tarda diez o quince minutos con esta memoria, pero deja la app en pie
# igual. Vale más arrancar lento que no arrancar.
if docker compose -f docker-compose.prod.yml --env-file .env pull finanzas 2>/dev/null; then
  echo "imagen bajada del registro"
else
  echo "no pude bajar la imagen; la construyo acá (esto tarda)"
  docker build -t "$(grep '^IMAGEN=' .env | cut -d= -f2-)" ../
fi

docker compose -f docker-compose.prod.yml --env-file .env up -d

echo "== listo: https://$DOMINIO =="
