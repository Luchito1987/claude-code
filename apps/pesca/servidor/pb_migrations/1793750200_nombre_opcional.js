/// <reference path="../pb_data/types.d.ts" />
// El nombre deja de ser obligatorio en la base: al entrar con Google la cuenta
// se crea antes de saber si Google mandó un nombre, y si faltara el alta
// fallaría. La página lo pide después del primer ingreso.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const nombre = users.fields.getByName("name");
  nombre.required = false;
  nombre.min = 0;
  nombre.max = 40;
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  const nombre = users.fields.getByName("name");
  nombre.required = true;
  nombre.min = 2;
  app.save(users);
});
