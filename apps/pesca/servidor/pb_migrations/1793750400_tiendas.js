/// <reference path="../pb_data/types.d.ts" />
// Requisitos de las tiendas de apps para contenido de usuarios:
// - Aceptar las normas: sin `normas_aceptadas` no se puede publicar, comentar,
//   reaccionar ni reportar.
// - Bloquear usuarios: cada uno arma su lista privada; la página oculta lo que
//   publican los bloqueados.
// - No se puede comentar ni reaccionar sobre publicaciones ocultas.
// (Borrar la cuenta ya está permitido: users.deleteRule es el propio usuario y
// sus publicaciones, comentarios, me gusta y reportes se borran en cascada.)

const CON_SESION = '@request.auth.id != "" && @request.auth.collectionName = "users"';
const BLOQUEO = '@request.auth.bloqueado = false';
const CON_NORMAS = BLOQUEO + ' && @request.auth.normas_aceptadas != ""';

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new DateField({ name: "normas_aceptadas" }));
  app.save(users);

  for (const n of ["capturas", "comentarios", "reportes", "reacciones"]) {
    const c = app.findCollectionByNameOrId(n);
    c.createRule = c.createRule.replace(BLOQUEO, CON_NORMAS);
    if (n === "comentarios" || n === "reacciones") {
      c.createRule += ' && @request.body.captura.oculta = false';
    }
    if (c.updateRule) c.updateRule = c.updateRule.replace(BLOQUEO, CON_NORMAS);
    app.save(c);
  }

  const bloqueos = new Collection({
    type: "base",
    name: "bloqueos",
    listRule: 'usuario = @request.auth.id',
    viewRule: 'usuario = @request.auth.id',
    createRule: CON_SESION + ' && @request.body.usuario = @request.auth.id && @request.body.bloqueado != @request.auth.id',
    updateRule: null,
    deleteRule: 'usuario = @request.auth.id',
    fields: [
      { name: "usuario", type: "relation", required: true, maxSelect: 1, cascadeDelete: true, collectionId: users.id },
      { name: "bloqueado", type: "relation", required: true, maxSelect: 1, cascadeDelete: true, collectionId: users.id },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_bloqueos_unico ON bloqueos (usuario, bloqueado)"],
  });
  app.save(bloqueos);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("bloqueos")); } catch (e) { /* ya no existe */ }
  for (const n of ["capturas", "comentarios", "reportes", "reacciones"]) {
    const c = app.findCollectionByNameOrId(n);
    c.createRule = c.createRule.replace(CON_NORMAS, BLOQUEO).replace(' && @request.body.captura.oculta = false', '');
    if (c.updateRule) c.updateRule = c.updateRule.replace(CON_NORMAS, BLOQUEO);
    app.save(c);
  }
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("normas_aceptadas");
  app.save(users);
});
