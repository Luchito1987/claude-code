# Servidor de la comunidad de pesca

Backend de "Pesca del día": usuarios, capturas con foto, comentarios y reportes.
Corre en la máquina de casa con Docker y sale a internet por Tailscale Funnel.

```
internet ──► Tailscale Funnel (https://pesca.tail043e0b.ts.net/api)
                 │
                 ▼
         filtro (Caddy, 127.0.0.1:8091) ──► pocketbase (127.0.0.1:8090)
                                                 ▲
tailnet ──► Tailscale Serve (:8443, panel /_/) ──┘
```

| Archivo | Para qué |
|---|---|
| `Dockerfile` | PocketBase con versión y sha256 fijos |
| `docker-compose.yml` | PocketBase y el filtro, ambos escuchando solo en 127.0.0.1 |
| `Caddyfile` | El filtro: bloquea rutas de admin, limita subidas a 8 MB y pasa la IP real |
| `pb_migrations/` | Ajustes (límite de intentos, IP real) y colecciones con sus reglas |

## Qué queda público y qué no

- **Público** (`/api` por Funnel, pasando por el filtro): leer capturas y comentarios,
  registrarse, iniciar sesión como usuario y publicar.
- **Solo en la tailnet** (`https://pesca.tail043e0b.ts.net:8443/_/`): el panel de
  administración y el login de superusuario. Desde internet esas rutas dan 404.

## Instalar o actualizar

En la máquina, dentro de la carpeta del servidor (los datos viven en `./datos`):

```bash
docker compose up -d --build
tailscale funnel --bg --set-path /api http://127.0.0.1:8091/api
tailscale serve --bg --https=8443 http://127.0.0.1:8090
```

PocketBase aplica solo las migraciones nuevas de `pb_migrations/` al arrancar.

Para subir de versión de PocketBase: cambiar `PB_VERSION` y `PB_SHA256` en el
`Dockerfile` (el sha256 está en `checksums.txt` de la release) y repetir
`docker compose up -d --build`.

## Moderar

En el panel (`:8443/_/`):

- **Reportes**: colección `reportes`. Marcá `revisado` cuando lo atiendas.
- **Ocultar** una captura o comentario: tildá `oculta` / `oculto`. El autor la
  sigue viendo; el resto no.
- **Bloquear** a un usuario: tildá `bloqueado` en `users`. No puede publicar,
  comentar ni reportar.

## Copias de seguridad

En el panel: *Settings → Backups*, activar las copias automáticas diarias y
conservar las últimas 14. Quedan en `./datos/backups`. Conviene copiar esa
carpeta a otro disco o a la nube de vez en cuando.

## Ver qué pasa

```bash
docker compose ps
docker compose logs -f pocketbase
docker compose logs -f filtro      # accesos desde internet, con la IP real
tailscale funnel status
```

## Apagar o despublicar

```bash
tailscale funnel reset && tailscale serve reset   # deja de estar en internet
docker compose down                                # apaga (los datos quedan)
```
