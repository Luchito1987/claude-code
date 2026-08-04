# Dónde poner tus archivos

Dejá acá las facturas, extractos, resúmenes de tarjeta y la planilla de gastos.

Esta carpeta está en `.gitignore`: nada de lo que pongas se sube al repositorio.
Son datos personales y no tienen por qué salir de tu máquina — la app los lee
localmente y guarda el resultado en `data/finanzas.db`, que tampoco se versiona.

Para mirar un archivo antes de importarlo, sin escribir nada en la base:

    npm run import -- --inspect --archivo documentos/tu-planilla.xlsx
    npm run import -- --tipo gastos --destino "Caja de ahorro" \
        --archivo documentos/tu-planilla.xlsx --dry
