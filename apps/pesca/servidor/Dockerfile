# PocketBase para la app comunitaria de pesca.
# La versión y su sha256 van fijos: el build falla si el zip descargado no coincide.
FROM alpine:3.24.3

ARG PB_VERSION=0.40.6
ARG PB_SHA256=0e1f609158ed945f809f8a02ae012aa0427129c66ebb63c1aee76f2c0309373f

RUN apk add --no-cache ca-certificates unzip wget \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" -O /tmp/pb.zip \
 && echo "${PB_SHA256}  /tmp/pb.zip" | sha256sum -c - \
 && mkdir -p /pb \
 && unzip -q /tmp/pb.zip -d /pb \
 && rm /tmp/pb.zip \
 && adduser -D -H -u 1000 pb \
 && mkdir -p /pb/pb_data && chown pb:pb /pb/pb_data

USER pb
WORKDIR /pb
EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8090/api/health || exit 1

CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data", "--migrationsDir=/pb/pb_migrations", "--hooksDir=/pb/pb_hooks", "--automigrate=false"]
