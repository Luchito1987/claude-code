/**
 * Imprime las direcciones por las que se llega a la app desde la red de casa.
 *
 * Hace falta porque `next start` dentro de Docker anuncia la IP del contenedor
 * (172.x.x.x), que no sirve desde el celular: la que vale es la de la máquina
 * en la red local.
 */

import { networkInterfaces } from 'node:os'

const port = process.env.PORT ?? '3100'

/** IPv4 de la máquina en la red local, salteando loopback y virtuales. */
function direccionesLocales(): Array<{ nombre: string; ip: string }> {
  const salida: Array<{ nombre: string; ip: string }> = []
  for (const [nombre, direcciones] of Object.entries(networkInterfaces())) {
    for (const dir of direcciones ?? []) {
      if (dir.family !== 'IPv4' || dir.internal) continue
      // Las de Docker y las autoasignadas no llevan a ningún lado.
      if (/^(172\.1[6-9]\.|172\.2\d\.|172\.3[01]\.|169\.254\.)/.test(dir.address)) continue
      salida.push({ nombre, ip: dir.address })
    }
  }
  return salida
}

const encontradas = direccionesLocales()

console.log(`\nEn esta misma máquina:\n  http://localhost:${port}\n`)

if (encontradas.length) {
  console.log('Desde el celular o desde otra compu en la misma wifi:')
  for (const { nombre, ip } of encontradas) {
    console.log(`  http://${ip}:${port}   (${nombre})`)
  }
  console.log(
    '\nSi no abre desde el celular: fijate que el firewall deje pasar el puerto ' +
      `${port} y que ambos estén en la misma red.\n`,
  )
} else {
  console.log(
    'No encontré una IP de red local. Si estás dentro de un contenedor, corré este\n' +
      'comando en la máquina anfitriona, no adentro del contenedor.\n',
  )
}
