# Publicar la app en internet

La app corre en una máquina virtual **e2-micro** de Google Compute Engine, que
es gratis de forma permanente —no una prueba de noventa días— siempre que esté
en Oregon, Iowa o Carolina del Sur y no pase de 30 GB de disco.

Se eligió una máquina y no Cloud Run porque la base es SQLite: Cloud Run guarda
los archivos en Cloud Storage, que [no tiene bloqueo de
archivos](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts),
y con dos personas cargando gastos a la vez la última escritura pisa a la
anterior. En una máquina el disco es un disco y SQLite funciona como en casa.

## Qué hay acá

| Archivo | Para qué |
|---|---|
| `docker-compose.prod.yml` | La app, el proxy con HTTPS y el actualizador automático |
| `Caddyfile` | El proxy: certificado automático y cabeceras de seguridad |
| `arranque-vm.sh` | Lo que corre la máquina al encenderse: Docker, el repo y todo arriba |

## Crear la máquina

Desde **Cloud Shell** (el ícono de terminal arriba a la derecha en la consola de
Google Cloud), pegar el bloque entero:

```bash
gcloud config set project project-03a38afe-43a8-4dc9-aec
gcloud services enable compute.googleapis.com

# Que el tráfico web llegue a las máquinas etiquetadas como servidor web.
gcloud compute firewall-rules create permitir-web \
  --allow=tcp:80,tcp:443 --target-tags=servidor-web \
  --description="HTTP y HTTPS hacia la app" || true

# us-east1 es la región gratuita más cercana a Colombia y a Argentina.
gcloud compute instances create finanzas \
  --zone=us-east1-b \
  --machine-type=e2-micro \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard \
  --tags=servidor-web \
  --metadata=startup-script-url=https://raw.githubusercontent.com/Luchito1987/claude-code/main/apps/finanzas/deploy/arranque-vm.sh

gcloud compute instances describe finanzas --zone=us-east1-b \
  --format='value(networkInterfaces[0].accessConfigs[0].natIP)'
```

La última línea imprime la IP. La app queda en `https://<esa-ip>.sslip.io`.

`sslip.io` es un servicio que resuelve cualquier `<ip>.sslip.io` a esa IP, sin
registrar ni pagar nada, y sirve para que Let's Encrypt emita el certificado. El
día que haya un dominio propio se cambia una línea del script de arranque.

El primer arranque tarda unos minutos: instala Docker, baja la imagen y pide el
certificado.

## Ver cómo viene

```bash
gcloud compute ssh finanzas --zone=us-east1-b --command='sudo tail -f /var/log/arranque-finanzas.log'
```

## Cómo se actualiza

No hay que hacer nada. Cada push a `main` que toque `apps/finanzas/` dispara el
workflow que construye la imagen y la publica; el contenedor `actualizador`
revisa cada cinco minutos y recrea la app cuando hay una versión nueva.

## Apagarla

```bash
gcloud compute instances delete finanzas --zone=us-east1-b
```

Los datos viven en un volumen de Docker dentro del disco de la máquina: borrar
la máquina los borra. Antes de eliminarla, copiar la base:

```bash
gcloud compute ssh finanzas --zone=us-east1-b \
  --command='sudo docker run --rm -v finanzas_finanzas-data:/d -v /tmp:/o alpine cp /d/finanzas.db /o/'
gcloud compute scp finanzas:/tmp/finanzas.db . --zone=us-east1-b
```
