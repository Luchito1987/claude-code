/// <reference path="../pb_data/types.d.ts" />
// La ubicación de una captura se guarda siempre aproximada (2 decimales, ~1 km),
// aunque alguien la mande exacta usando la API directamente.
function redondear(e) {
  for (const campo of ["lat", "lon"]) {
    const v = e.record.getFloat(campo);
    if (v) e.record.set(campo, Math.round(v * 100) / 100);
  }
  e.next();
}
onRecordCreate(redondear, "capturas");
onRecordUpdate(redondear, "capturas");
