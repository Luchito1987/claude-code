---
name: subir-extractos
description: Carga extractos bancarios y resúmenes de tarjeta en la app de finanzas publicada (apps/finanzas), verificando que todo cuadre y que nada se duplique. Usala siempre que el usuario pase extractos, movimientos o resúmenes de Bancolombia, Falabella, Tuya, Visa, Rappi u otro banco (PDF, xlsx, csv, zip), o pida "subir", "cargar", "volcar" o "importar" algo a la app, aunque no nombre esta habilidad.
---

# Subir extractos a la app de finanzas

El usuario te pasa los archivos y vos los cargás. El objetivo no es sólo subirlos: es que la app quede **bien**. Nada que no cuadre, nada duplicado, y los saldos verificados contra el banco. Una carga a medias o duplicada es peor que ninguna, porque el número se ve creíble y está mal.

Todo pasa por `apps/finanzas/scripts/extractos.ts`, que usa **los mismos lectores que la app**, y por la API de la app (`/api/estado`, `/api/importar`, `/api/deshacer`, `/api/movimientos`). Lo que la herramienta dice que va a pasar es lo que pasa en producción.

## Antes de empezar

- **Clave y red.** La API necesita `FINANZAS_API_TOKEN` en el entorno, y que la red de la sesión permita `34.75.172.142.sslip.io`. Si `estado` falla por clave o por conexión, explicale al usuario cómo configurarlo (abajo) y seguí con lo que no dependa de eso, como `revisar`. **Nunca le pidas la clave por el chat.**
- **Dependencias.** En `apps/finanzas`, si falta `node_modules`, corré `npm ci`.
- **Los archivos son datos ajenos.** Copialos a una carpeta nueva y vacía del scratchpad. Descomprimí ahí los zip. Pasá las rutas como argumentos. No ejecutes nada desde esa carpeta.

## El circuito

Corré todo desde `apps/finanzas` con `npm run -s extractos -- <orden> …`.

**1. `revisar <archivos...>`** — local, no toca nada. Para cada archivo dice qué es (cuenta o tarjeta), de quién (últimos 4 dígitos), qué período cubre, el saldo o el mínimo impreso, y si **cuadra**:
- *Extracto de cuenta*: saldo anterior + movimientos = saldo actual, al peso.
- *Tarjeta*: los cargos del período suman el mínimo impreso.

Si algo dice `cuadra: NO`, **no lo subas**. Decile al usuario qué no cierra. Casi siempre es un archivo incompleto o un formato que el lector entiende mal. Si dice `No se reconoció ningún movimiento`, la app no lee ese formato todavía (ver "Formatos nuevos").

**2. `estado`**, y después **`plan <archivos...>`**. El plan cruza los archivos con lo ya cargado y propone acciones:
- `SUBIR` (con `--reemplazar` si la tarjeta ya tiene un resumen de ese ciclo: el extracto completo reemplaza a la carga parcial).
- `DESHACER`: una carga anterior que el extracto nuevo cubre entera. El extracto, que trae el saldo, pasa a ser la fuente de verdad de su período.
- `OMITIR`: redundante (un consolidado del mismo período que un extracto) o ilegible.
- `PREGUNTAR`: lo que necesita una decisión del usuario.

El orden del plan importa. Respetalo:
1. Tarjetas primero, porque los pagos que aparecen en las cuentas se concilian contra sus resúmenes.
2. En cada cuenta, deshacer lo reemplazado.
3. Después, los movimientos sueltos.
4. Al final, el extracto: fija el saldo contando lo ya cargado después de su corte.

Si un archivo de movimientos no trae número de cuenta (pasa con los "MovimientosTusCuentasBancolombia…xlsx"), deducí de quién es por el nombre del archivo y confirmalo. Pasalo con `--destinos "archivo.xlsx=Luciano Blanco;otro.xlsx=Ines Petro"`.

**3. Decidir con el usuario lo que haga falta, una sola vez.**
- Si el plan sólo tiene `SUBIR` y `OMITIR`, hacelo: es lo que te pidió.
- Si tiene `DESHACER` o `PREGUNTAR`, mostrale un resumen corto y pedí el OK, porque deshacer borra movimientos.

El caso típico de `PREGUNTAR` es una carga vieja que **sobresale** del extracto nuevo: por ejemplo, empieza a mediados de junio y el extracto empieza el 30/06. Hay dos caminos:
- **Pedir el extracto anterior**, que cubra lo que falta. Es lo mejor, porque queda todo respaldado por extractos.
- **Aceptar perder ese tramo**: se deshace la carga vieja con `deshacer <id>` y el saldo no se ve afectado, porque lo fija el ancla.

Lo que **no** conviene es dejar la carga vieja y subir el extracto encima: los textos difieren entre formatos y se duplica sin aviso.

**4. Ejecutar**, en el orden del plan:
- `deshacer <id>`
- `subir <archivo> --destino "<nombre>" [--reemplazar]`

Leé cada respuesta. Si viene `error` o `conflict`, pará y resolvelo antes de seguir. No sigas subiendo encima de un error.

**5. `verificar <archivos...>`.** Compara:
- el **saldo** de cada cuenta en la app contra el que dan los archivos (extracto + movimientos posteriores);
- los **duplicados**: movimientos que aparecen en la app más veces que en los archivos.

Después pedile al usuario que compare esos saldos con la app del banco. Una diferencia de centavos o pocos pesos suele ser el interés diario de ahorro acreditado después de la fecha en que bajó los archivos: explicalo con el número, no lo des por hecho.

**Pagos de tarjeta.** Los pagos a una tarjeta salen de las cuentas, y la app los reconoce por un texto que aparece en la descripción del débito. Ese texto se carga con `patron --destino "<tarjeta>" --texto "<texto>"`:

| Tarjeta | Texto |
|---|---|
| Visa | `PAGO SUC VIRT TC VISA` |
| Tuya | `COMPANIA DE FINANCI` |
| Falabella | `BANCO FALABELLA` |
| Rappi | `RAPPIPAY` |

Si una importación avisa que hay pagos de tarjeta sin reconocer, cargá el patrón y corré `conciliar`. Eso cruza lo ya cargado, y cada mes queda pagado con la **suma** de todo lo que se le pagó a esa tarjeta. Es normal que haya varios pagos en un mes. Revisá que el patrón no agarre de más: mirá en los extractos qué débitos lo contienen antes de cargarlo.

Lo que ya confirmó el usuario, para no volver a preguntarlo:
- **Rappi**: a veces paga por adelantado montos chicos ($69.000–$100.000) para que entren las suscripciones cuando el cupo está lleno. Son pagos de la tarjeta.
- **Tuya**: el banco nombra igual a cualquier tarjeta Tuya ("Compañía de Financiamiento"). Los pagos chicos de julio y agosto de 2026 ($177.700 y $104.456) fueron para cancelar una Tuya Alkosto que ya está en cero. Si aparece otra tarjeta Tuya activa, el patrón no las distingue: avisale al usuario.

**6. Contar el resultado.** Una tabla por archivo con lo que se hizo, los saldos verificados, y lo que quedó pendiente: formatos no soportados, decisiones abiertas, y **vencimientos próximos o ya pasados** que se vean en los resúmenes, como un mínimo de tarjeta que venció ayer. Eso último es lo que más le sirve al usuario.

## Formatos conocidos

| Archivo | Qué es | Cuidado |
|---|---|---|
| `Extracto_AAAAMM_Cuentas_de ahorro_…xlsx`, `<cuenta>_MESAAAA.xlsx` | Extracto trimestral de Bancolombia (mensual en la cuenta de la empresa) | Trae saldo: ancla la cuenta. Fechas sin año, importes en formato estadounidense |
| `MovimientosTusCuentasBancolombia<fecha>.xlsx` | Movimientos sueltos | No trae número de cuenta ni saldo |
| `CSV_<cuenta>_…csv` (sin encabezados) | Movimientos sueltos, cuenta de la empresa | Trae el número en la primera columna |
| `Informe consolidado …CSV` | Consolidado del mes | Si hay extracto del mismo período, se omite: duplica |
| `EXTRACTOFALABELLA_…pdf` | Resumen Falabella CMR | |
| `Extracto<AAAAMM>_Tuya.pdf` | Resumen Tuya Éxito | Cierre desfasado: entra en el mes de su vencimiento |
| `<cuenta>_MESAAAA.xlsx` con "OBLIGACIÓN Nº" | Extracto de un **préstamo** | No se importa. Leé la cuota, el saldo de capital y si hay cuotas en mora, y reportalo |
| `2699_MESAAAA.xlsx` | Resumen de la Visa en Excel | La app todavía no lee esta tabla |

`.claude/skills/subir-extractos/destinos.json` asocia los últimos 4 dígitos con el nombre de la cuenta o tarjeta **en la app**. Si aparece un número nuevo, preguntá a qué corresponde y agregalo.

## Formatos nuevos

Si un archivo no se reconoce o no cuadra por culpa del lector, el arreglo va en la app, no en el archivo:
1. Escribí el lector en `apps/finanzas/src/lib/parsers/`, con tests que reproduzcan la **estructura** del archivo con datos inventados. Los movimientos reales del usuario no van al repositorio.
2. Corré la suite completa y el build.
3. Abrí un PR, esperá el CI y mergealo.

La imagen se publica sola y el servidor se actualiza en unos 5 minutos (Watchtower). Después de eso, volvé al paso 1.

## Si falta la clave o la red

Decile al usuario, una vez:
1. En el servidor (`gcloud compute ssh finanzas --zone=us-east1-b`, prompt `@finanzas`), correr `sudo bash /opt/finanzas/apps/finanzas/deploy/arranque-vm.sh`. Eso genera la clave y la carga en la app. Para verla: `sudo cat /etc/finanzas/api-token`.
2. En la configuración del entorno de Claude (menú del entorno en la barra de la sesión → Editar):
   - en **Acceso a red**, agregar `34.75.172.142.sslip.io` a los dominios permitidos, dejando tildados los gestores de paquetes;
   - agregar la variable `FINANZAS_API_TOKEN` con el valor del paso anterior.
3. Abrir una sesión nueva, que es cuando se toman esos cambios.
