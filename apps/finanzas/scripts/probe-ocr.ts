/**
 * Pasa fotos de tickets por el OCR y el parser, para ver qué se entiende de
 * cada una sin tener que subirlas desde el celular.
 *
 *   npx tsx scripts/probe-ocr.ts foto1.jpg foto2.jpg
 */

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { readImageText, stopOcr } from '@/lib/ocr'
import { parseReceipt } from '@/lib/parsers/receipt'
import { formatMoney } from '@/lib/money'

async function main() {
  const files = process.argv.slice(2)
  if (!files.length) {
    console.error('Uso: npx tsx scripts/probe-ocr.ts <foto...>')
    process.exit(1)
  }

  for (const file of files) {
    const t0 = Date.now()
    let texto = ''
    try {
      texto = await readImageText(readFileSync(file))
    } catch (err) {
      console.log(`\n===== ${basename(file)} =====\nFALLÓ EL OCR: ${(err as Error).message}`)
      continue
    }
    const r = parseReceipt(texto)
    const seg = ((Date.now() - t0) / 1000).toFixed(1)

    console.log(`\n===== ${basename(file)}  (${seg}s) =====`)
    console.log(`importe : ${r.amountCents === null ? 'NO ENCONTRADO' : formatMoney(r.amountCents)}   [${r.source}]`)
    console.log(`comercio: ${r.merchant || '—'}`)
    console.log(`fecha   : ${r.date ?? '—'}`)
    console.log(`rubro   : ${r.category}`)
    console.log('--- texto leído ---')
    console.log(texto.split('\n').filter((l) => l.trim()).join('\n'))
  }

  await stopOcr()
}

main()
