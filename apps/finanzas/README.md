# Finanzas del hogar

App web para ordenar el flujo de caja de una casa: consultar y confirmar las
facturas de servicios en la ventana del 28 al 15, importar extractos de cuenta y
resúmenes de tarjeta, cargar préstamos y tickets sueltos, ver cuánto efectivo
queda semana a semana, recibir recomendaciones concretas y exportar todo para
analizarlo con un asistente.

Pensada para dos usuarios (vos y tu esposa) sobre los mismos datos, accesible
desde internet.

---

## Qué hace

| Necesidad | Cómo se resuelve |
|---|---|
| Saber qué se paga y cuándo, del 28 al 15 | Registro de servicios con día de vencimiento. La app genera las facturas del período y muestra la ventana vigente; los importes arrancan estimados y se confirman con un clic |
| Subir extractos de tarjeta y de caja de ahorro | Importador de PDF/CSV/TSV/XLSX con detección automática de separador, de hoja y de columnas, y parseo de texto pegado |
| Dejar la planilla de Excel que llevabas | Modo "planilla propia de gastos": los importes positivos entran como gastos y se respeta tu columna de categoría. Se migra el historial una vez y se sigue en la app |
| Dar de alta préstamos vigentes | Alta con cuota, total de cuotas y cuántas van pagas; las pendientes entran solas en la proyección |
| Tickets y gastos sueltos | Carga manual con categorización automática por comercio |
| Cuánto efectivo queda | Tablero con tres números: disponible, lo que falta pagar del mes y el neto entre ambos |
| Qué se paga este mes | Lista única del mes financiero — facturas, resúmenes de tarjeta y cuotas — con tilde de pagado, más alta rápida de un gasto o un ingreso |
| Qué se viene | Proyección de los próximos 6 meses con el desglose de cada uno, incluidas las cuotas de tarjeta ya comprometidas |
| Cuánto se debe | Deuda por tarjeta y por préstamo, total, cuánto sale por mes y qué parte del sueldo se lleva |
| Recomendaciones semanales | Diez reglas sobre los datos propios; cada una dice cuánta plata mueve |
| Exportable para analizar | Informe en Markdown (listo para pegar en un chat), JSON con todo el detalle y CSV de movimientos |
| Rappi | Detección automática de consumos en la tarjeta + importación del detalle desde los mails de pedido o un CSV, con análisis de ticket, envío, propina y hábito semanal |
| Login para dos personas | Sesión con cookie firmada y contraseñas con scrypt. Sin registro abierto |

### Lo que no hace, y por qué

- **No se conecta sola a las webs de los proveedores de servicios.** No hay una
  API común entre Edenor, Metrogas, la prepaga y el colegio; automatizar eso
  significa guardar las credenciales de cada uno y scrapear sitios que cambian.
  Lo que la app sí hace es decirte exactamente qué facturas faltan confirmar y
  cuándo vencen, y estimar el importe con el promedio histórico mientras tanto.
- **No se conecta sola a Rappi.** Rappi no publica una API abierta ni un export
  del historial. Sin eso, "conectarse" sería guardar tu usuario y contraseña y
  simular la app, que es justo lo que sus términos prohíben. Las tres vías que sí
  funcionan están explicadas dentro de la pantalla **Rappi**; la primera (leer los
  consumos `RAPPI*` del resumen de tarjeta) es automática y no requiere cargar
  nada.
- **Un PDF escaneado no se puede leer.** Los resúmenes en PDF digital sí: se
  rearman los renglones desde las coordenadas del texto y entran como cualquier
  otro archivo. Pero si el PDF es una foto o un escaneo no hay texto que
  extraer; ahí la app lo dice y quedan dos caminos: pedir el PDF digital o usar
  la carga por foto.

---

## Arrancar en local

```bash
cd apps/finanzas
npm install
npm run dev          # http://localhost:3100
```

La primera pantalla pide crear el usuario inicial (la base arranca vacía). Desde
**Config → Usuarios** se da de alta el segundo.

Para ver la app con datos antes de cargar los propios:

```bash
npm run seed -- --reset --email vos@ejemplo.com --password una-clave-larga
```

Otros comandos:

```bash
npm test          # 243 tests de la lógica de dominio
npm run typecheck
npm run build
```

Para cargar archivos sin pasar por el navegador, o para mirar una planilla
desconocida antes de importarla:

```bash
npm run import -- --inspect --archivo planilla.xlsx
npm run import -- --tipo gastos  --destino "Caja de ahorro" --archivo gastos-2026.xlsx --dry
npm run import -- --tipo cuenta  --destino "Caja de ahorro" --archivo extracto.csv
npm run import -- --tipo tarjeta --destino "Visa"           --archivo resumen.pdf
```

`--dry` muestra fecha, comercio, importe y categoría de cada línea sin escribir
nada en la base.

---

## Publicarlo en internet

La app corre en un contenedor y guarda todo en un único archivo SQLite. Necesita
**un volumen persistente** y **HTTPS** (la cookie de sesión es `Secure` en
producción).

```bash
docker compose up -d --build      # queda en el puerto 3100
```

Detrás de un proxy con TLS (Caddy, Nginx, Traefik) o en cualquier plataforma que
corra un Dockerfile con volumen:

- **Fly.io**: `fly launch` sobre este Dockerfile y `fly volumes create finanzas
  --size 1`, montado en `/data`. TLS incluido.
- **Railway / Render**: apuntar al Dockerfile, agregar un disco en `/data` y
  definir `SQLITE_PATH=/data/finanzas.db`.
- **VPS propio**: `docker compose up -d` más un proxy con certificado.

> Vercel no sirve para esta app: su filesystem es efímero y SQLite se perdería en
> cada deploy. Si en algún momento hiciera falta ir a Postgres, lo único que hay
> que reescribir es `src/db/client.ts` y las consultas de `src/lib/queries.ts`;
> la lógica de negocio no toca la base.

### Variables de entorno

| Variable | Para qué |
|---|---|
| `SQLITE_PATH` | Ruta del archivo de base. En Docker, dentro del volumen (`/data/finanzas.db`) |
| `TZ` | Define qué día es "hoy" y cuándo abre la ventana del 28. Por defecto `America/Argentina/Buenos_Aires` |
| `NODE_ENV` | En `production` la cookie de sesión viaja solo por HTTPS |
| `PORT` | Puerto de escucha (3100) |

### Respaldo

Todo vive en un archivo. Copiarlo es el backup:

```bash
docker compose exec finanzas sh -c 'cat /data/finanzas.db' > respaldo-$(date +%F).db
```

---

## El mes financiero

El mes **cierra el 27 y arranca el 28**. A partir del 28 la app ya trabaja sobre
el mes siguiente: genera sus facturas, arma la lista de pagos nueva y la ventana
de consulta de servicios queda abierta hasta el 15. Es la misma regla en todas
las pantallas, así que "agosto" siempre significa del 28 de julio al 27 de
agosto.

Lo que hay que pagar en un mes son tres cosas: las facturas de servicios, los
resúmenes de tarjeta que vencen dentro del mes y las cuotas de préstamo. Cada una
se puede tildar como pagada; lo que queda sin tildar y ya venció aparece como
vencido y sigue contando en "falta pagar".

## Cuotas de tarjeta

Un resumen que dice `ZARA 3/6 $25.000` no es un gasto de $25.000: son $25.000
este mes y otros tres meses más. Al importar un resumen la app guarda el mes al
que corresponde —deducido del último consumo del archivo, que siempre cae en el
ciclo que está cerrando— y desde ahí proyecta las cuotas que faltan.

Cuando llega el resumen real de un mes, reemplaza a la cuota proyectada de ese
mes: nunca se cuentan las dos.

## Cómo piensa la proyección

El número que importa —cuánto efectivo queda— sale de un modelo explícito, para
que se pueda auditar:

- **Punto de partida:** la suma de los saldos cargados en Config → Cuentas. Un
  gasto o ingreso cargado a mano mueve ese saldo; lo que va en tarjeta no, porque
  impacta recién al vencer el resumen.
- **Compromisos:** facturas pendientes, cuotas de préstamo y resúmenes de tarjeta
  impactan el día que vencen. Una factura vencida e impaga se ancla a hoy: la
  plata falta igual.
- **Gasto variable futuro:** un consumo diario parejo, calculado sobre los
  movimientos de los últimos 90 días, excluyendo lo que ya entra como evento
  propio (servicios, préstamos, impuestos). Se divide por los días que realmente
  cubre el historial, no por 90, para no subestimarlo.
- **Sin doble conteo:** un consumo de tarjeta ya importado no descuenta caja el
  día de la compra, solo dentro del resumen el día que vence.
- **Colchón mínimo:** el piso configurable que dispara las alertas.

Es un modelo conservador: asume que lo que se compra se paga. Sobreestima un poco
la salida de las primeras semanas, que es el lado seguro para decidir.

---

## Mapa del código

```
src/
  db/
    schema.sql            Esquema completo, idempotente (se aplica al abrir)
    client.ts             Conexión SQLite
    seed.ts               Datos de ejemplo
  lib/
    money.ts              Centavos, formatos $ 1.234,56 / 1,234.56
    dates.ts              Fechas ISO y la ventana 28 → 15
    auth.ts               scrypt + sesiones en cookie
    categories.ts         Categorización por comercio (incluye Rappi)
    cashflow.ts           Proyección semanal, resúmenes de tarjeta, burn diario
    monthly.ts            Mes financiero: cuotas, proyección a 6 meses y deudas
    recommendations.ts    Las diez reglas semanales
    queries.ts            Toda la lectura/escritura de la base
    report.ts             Informe Markdown / JSON / CSV
    parsers/
      csv.ts              CSV/TSV sin dependencias
      pdf.ts              PDF: de fragmentos con coordenadas a un renglón por movimiento
      xlsx.ts             Planillas: hojas a matriz de texto, fechas normalizadas
      input.ts            Entrada única: decide texto o planilla y elige la hoja
      statement.ts        Extractos: columnas por nombre + fallback por líneas
      rappi.ts            Mails de pedido, CSV y análisis de delivery
  app/                    Pantallas (Next.js App Router) y server actions
  components/             UI compartida y el gráfico semanal en SVG
tests/                    243 tests sobre parsers, fechas, plata, proyección y reglas
```

Las únicas dependencias de runtime son Next, React, `better-sqlite3` y `exceljs`
(para leer planillas): los parsers, el gráfico y el motor de reglas son código
propio y testeado.

---

## Seguridad

- Contraseñas con `scrypt` (sal por usuario, comparación en tiempo constante).
- Sesiones en cookie `httpOnly`, `SameSite=Lax` y `Secure` en producción, con
  vencimiento a 30 días.
- **No hay registro abierto:** solo se crean usuarios en el primer arranque o
  desde una sesión iniciada.
- Todas las páginas y el endpoint de exportación verifican sesión antes de
  responder.
- Toda consulta usa parámetros ligados; no se arma SQL por concatenación.

Al quedar expuesta a internet, la app maneja datos financieros sensibles: usá
contraseñas largas y no la publiques sin HTTPS.
