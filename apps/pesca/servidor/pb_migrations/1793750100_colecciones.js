/// <reference path="../pb_data/types.d.ts" />
// Datos de la comunidad: capturas, comentarios y reportes de contenido.
//
// Reglas generales:
// - Cualquiera puede ver lo publicado (sin cuenta).
// - Publicar, comentar y reportar requiere cuenta y no estar bloqueado.
// - Cada uno edita o borra solo lo suyo. Ocultar contenido y bloquear
//   usuarios solo lo hace el admin desde el panel.
// - El mero guasa (protegido) solo se puede registrar como liberado.

const ESPECIES = [
  "jurel", "sabalo", "robalo", "pampano", "mojarra", "lisa", "pargo",
  "ronco", "sierra", "barracuda", "bagre", "mero_guasa", "otra",
];
const ZONAS = [
  "tajamar_bocas", "puerto_colombia", "salgar_sabanilla", "puerto_velero", "otra",
];
const PUEDE_ESCRIBIR =
  '@request.auth.id != "" && @request.auth.collectionName = "users" && @request.auth.bloqueado = false';

migrate((app) => {
  // Usuarios: bandera de bloqueo (solo la cambia el admin) y perfil visible
  // para mostrar el nombre en las publicaciones. El email sigue oculto salvo
  // que el propio usuario active emailVisibility.
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new BoolField({ name: "bloqueado" }));
  users.viewRule = "";
  users.updateRule = 'id = @request.auth.id && @request.body.bloqueado:isset = false && @request.body.verified:isset = false';
  const nombre = users.fields.getByName("name");
  nombre.required = true;
  nombre.min = 2;
  nombre.max = 40;
  app.save(users);

  const capturas = new Collection({
    type: "base",
    name: "capturas",
    listRule: 'oculta = false || usuario = @request.auth.id',
    viewRule: 'oculta = false || usuario = @request.auth.id',
    createRule: PUEDE_ESCRIBIR +
      ' && @request.body.usuario = @request.auth.id' +
      ' && @request.body.oculta:isset = false' +
      ' && (@request.body.especie != "mero_guasa" || @request.body.liberado = true)',
    // Al editar solo se puede cambiar el texto, la carnada, el anzuelo y las medidas.
    updateRule: PUEDE_ESCRIBIR +
      ' && usuario = @request.auth.id' +
      ' && @request.body.usuario:isset = false && @request.body.oculta:isset = false' +
      ' && @request.body.especie:isset = false && @request.body.liberado:isset = false',
    deleteRule: 'usuario = @request.auth.id',
    fields: [
      { name: "usuario", type: "relation", required: true, maxSelect: 1, cascadeDelete: true,
        collectionId: users.id },
      { name: "foto", type: "file", required: true, maxSelect: 1, maxSize: 6 * 1024 * 1024,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"], thumbs: ["480x0", "160x160"] },
      { name: "especie", type: "select", required: true, maxSelect: 1, values: ESPECIES },
      { name: "especie_otra", type: "text", max: 60 },
      { name: "zona", type: "select", required: true, maxSelect: 1, values: ZONAS },
      { name: "fecha", type: "date", required: true },
      { name: "tamano_cm", type: "number", min: 1, max: 300 },
      { name: "peso_kg", type: "number", min: 0, max: 300 },
      { name: "carnada", type: "text", max: 80 },
      { name: "anzuelo", type: "text", max: 30 },
      { name: "liberado", type: "bool" },
      { name: "comentario", type: "text", max: 500 },
      // Ola, viento, luna, etc. del momento, que guarda la página al publicar.
      { name: "condiciones", type: "json", maxSize: 4000 },
      { name: "oculta", type: "bool" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_capturas_created ON capturas (created)",
      "CREATE INDEX idx_capturas_especie ON capturas (especie, fecha)",
      "CREATE INDEX idx_capturas_zona ON capturas (zona, fecha)",
    ],
  });
  app.save(capturas);

  const comentarios = new Collection({
    type: "base",
    name: "comentarios",
    listRule: 'oculto = false && captura.oculta = false',
    viewRule: 'oculto = false && captura.oculta = false',
    createRule: PUEDE_ESCRIBIR +
      ' && @request.body.usuario = @request.auth.id && @request.body.oculto:isset = false',
    updateRule: PUEDE_ESCRIBIR +
      ' && usuario = @request.auth.id && @request.body.usuario:isset = false' +
      ' && @request.body.captura:isset = false && @request.body.oculto:isset = false',
    deleteRule: 'usuario = @request.auth.id',
    fields: [
      { name: "captura", type: "relation", required: true, maxSelect: 1, cascadeDelete: true,
        collectionId: capturas.id },
      { name: "usuario", type: "relation", required: true, maxSelect: 1, cascadeDelete: true,
        collectionId: users.id },
      { name: "texto", type: "text", required: true, min: 1, max: 500 },
      { name: "oculto", type: "bool" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_comentarios_captura ON comentarios (captura, created)"],
  });
  app.save(comentarios);

  // Reportes: los crea cualquier usuario, solo los ve el admin.
  const reportes = new Collection({
    type: "base",
    name: "reportes",
    listRule: null,
    viewRule: null,
    createRule: PUEDE_ESCRIBIR + ' && @request.body.usuario = @request.auth.id',
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "usuario", type: "relation", required: true, maxSelect: 1, cascadeDelete: true,
        collectionId: users.id },
      { name: "captura", type: "relation", maxSelect: 1, cascadeDelete: true, collectionId: capturas.id },
      { name: "comentario", type: "relation", maxSelect: 1, cascadeDelete: true, collectionId: comentarios.id },
      { name: "motivo", type: "select", required: true, maxSelect: 1,
        values: ["spam", "ofensivo", "falso", "especie_protegida", "otro"] },
      { name: "detalle", type: "text", max: 300 },
      { name: "revisado", type: "bool" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
  });
  app.save(reportes);
}, (app) => {
  for (const n of ["reportes", "comentarios", "capturas"]) {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (e) { /* ya no existe */ }
  }
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("bloqueado");
  users.viewRule = "id = @request.auth.id";
  users.updateRule = "id = @request.auth.id";
  app.save(users);
});
