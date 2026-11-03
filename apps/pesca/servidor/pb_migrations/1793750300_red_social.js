/// <reference path="../pb_data/types.d.ts" />
// Estilo red social:
// - Todo el contenido (publicaciones, comentarios, perfiles) se ve solo con
//   sesión iniciada: la comunidad es para miembros.
// - Una publicación puede ser solo texto, solo foto o ambas; la especie y la
//   zona pasan a ser opcionales (se completan con un toque si se quiere).
// - "Me gusta": una reacción por usuario y publicación.
// - Lugar de la captura: nombre (automático o escrito a mano) y coordenadas
//   redondeadas por la página a ~1 km para no revelar el punto exacto.

const PUEDE_ESCRIBIR =
  '@request.auth.id != "" && @request.auth.collectionName = "users" && @request.auth.bloqueado = false';
const CON_SESION = '@request.auth.id != "" && @request.auth.collectionName = "users"';

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.viewRule = CON_SESION;
  app.save(users);

  const capturas = app.findCollectionByNameOrId("capturas");
  capturas.listRule = CON_SESION + ' && (oculta = false || usuario = @request.auth.id)';
  capturas.viewRule = capturas.listRule;
  for (const n of ["foto", "especie", "zona"]) {
    capturas.fields.getByName(n).required = false;
  }
  capturas.fields.getByName("comentario").max = 1000;
  capturas.fields.add(new TextField({ name: "lugar", max: 80 }));
  capturas.fields.add(new NumberField({ name: "lat", min: -90, max: 90 }));
  capturas.fields.add(new NumberField({ name: "lon", min: -180, max: 180 }));
  app.save(capturas);

  const comentarios = app.findCollectionByNameOrId("comentarios");
  comentarios.listRule = CON_SESION + ' && oculto = false && captura.oculta = false';
  comentarios.viewRule = comentarios.listRule;
  app.save(comentarios);

  const reacciones = new Collection({
    type: "base",
    name: "reacciones",
    listRule: CON_SESION,
    viewRule: CON_SESION,
    createRule: PUEDE_ESCRIBIR + ' && @request.body.usuario = @request.auth.id',
    updateRule: null,
    deleteRule: 'usuario = @request.auth.id',
    fields: [
      { name: "captura", type: "relation", required: true, maxSelect: 1, cascadeDelete: true,
        collectionId: capturas.id },
      { name: "usuario", type: "relation", required: true, maxSelect: 1, cascadeDelete: true,
        collectionId: users.id },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_reacciones_unica ON reacciones (captura, usuario)"],
  });
  app.save(reacciones);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("reacciones")); } catch (e) { /* ya no existe */ }
  const users = app.findCollectionByNameOrId("users");
  users.viewRule = "";
  app.save(users);
  const capturas = app.findCollectionByNameOrId("capturas");
  capturas.listRule = 'oculta = false || usuario = @request.auth.id';
  capturas.viewRule = capturas.listRule;
  for (const n of ["foto", "especie", "zona"]) {
    capturas.fields.getByName(n).required = true;
  }
  capturas.fields.getByName("comentario").max = 500;
  for (const n of ["lugar", "lat", "lon"]) capturas.fields.removeByName(n);
  app.save(capturas);
  const comentarios = app.findCollectionByNameOrId("comentarios");
  comentarios.listRule = 'oculto = false && captura.oculta = false';
  comentarios.viewRule = comentarios.listRule;
  app.save(comentarios);
});
