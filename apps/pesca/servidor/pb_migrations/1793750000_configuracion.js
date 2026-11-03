/// <reference path="../pb_data/types.d.ts" />
// Ajustes generales: nombre, dirección pública, límite de intentos y cómo
// saber la IP real de cada visitante detrás del filtro (Caddy) y Tailscale.
migrate((app) => {
  const s = app.settings();
  s.meta.appName = "Pesca del día";
  s.meta.appURL = "https://pesca.tail043e0b.ts.net";
  s.meta.hideControls = false;

  // Caddy pone la IP real del visitante en X-Real-IP.
  s.trustedProxy.headers = ["X-Real-IP"];
  s.trustedProxy.useLeftmostIP = false;

  s.rateLimits.enabled = true;
  s.rateLimits.rules = [
    // Logins y registros: 10 por minuto por IP (frena a quien prueba contraseñas).
    { label: "*:auth", audience: "", duration: 60, maxRequests: 10 },
    // Crear registros (capturas, comentarios, reportes, cuentas): 20 por minuto.
    { label: "*:create", audience: "", duration: 60, maxRequests: 20 },
    { label: "/api/batch", audience: "", duration: 1, maxRequests: 3 },
    // Todo lo demás: 300 cada 10 segundos.
    { label: "/api/", audience: "", duration: 10, maxRequests: 300 },
  ];
  app.save(s);
}, (app) => {
  const s = app.settings();
  s.rateLimits.enabled = false;
  s.trustedProxy.headers = [];
  app.save(s);
});
