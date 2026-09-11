# ---------- build ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# better-sqlite3 se compila desde fuente: necesita toolchain en esta etapa.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# El diccionario de español del OCR. Se baja acá y viaja en la imagen: si no,
# tesseract intenta bajarlo la primera vez que alguien saca una foto, y en un
# contenedor sin salida a internet eso se cuelga en vez de fallar.
RUN mkdir -p /tessdata \
    && curl -fsSL -o /tessdata/spa.traineddata.gz \
       https://tessdata.projectnaptha.com/4.0.0/spa.traineddata.gz

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Las devDependencies solo hacen falta para compilar.
COPY . .
RUN npm install --no-audit --no-fund && npm run build

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
# RECEIPTS_PATH manda las fotos de los tickets al volumen: sin eso caen dentro
# del contenedor y se pierden al recrearlo. TESSERACT_CACHE apunta al
# diccionario que ya viene en la imagen.
ENV NODE_ENV=production \
    PORT=3100 \
    HOSTNAME=0.0.0.0 \
    SQLITE_PATH=/data/finanzas.db \
    RECEIPTS_PATH=/data/receipts \
    TESSERACT_CACHE=/tessdata \
    TZ=America/Argentina/Buenos_Aires

RUN useradd --system --uid 1001 finanzas \
    && mkdir -p /data && chown finanzas:finanzas /data

# `output: standalone` deja en .next/standalone solo lo necesario para correr.
COPY --from=builder --chown=finanzas:finanzas /app/.next/standalone ./
COPY --from=builder --chown=finanzas:finanzas /app/.next/static ./.next/static
COPY --from=builder --chown=finanzas:finanzas /app/public ./public
# El esquema se lee en caliente al abrir la base.
COPY --from=builder --chown=finanzas:finanzas /app/src/db/schema.sql ./src/db/schema.sql
COPY --from=builder --chown=finanzas:finanzas /tessdata /tessdata

USER finanzas
EXPOSE 3100
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
