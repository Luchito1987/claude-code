/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    // Los dos levantan procesos o binarios propios: empaquetarlos rompe las
    // rutas que usan por dentro. tesseract.js, además, no falla —se cuelga.
    serverComponentsExternalPackages: ['better-sqlite3', 'tesseract.js', 'pdfjs-dist'],

    // El OCR es WebAssembly, y el `.wasm` se carga recién en tiempo de
    // ejecución: el rastreador de `output: standalone` mira los `import` del
    // código y no lo ve, así que lo dejaba afuera del build. El resultado era
    // que sacar una foto quedaba colgado para siempre en producción —el worker
    // aborta adentro y la promesa nunca vuelve— mientras en desarrollo andaba.
    // Lo mismo con las fuentes estándar de pdfjs: se leen del disco al abrir un
    // PDF, no se importan, así que hay que nombrarlas para que viajen al build.
    outputFileTracingIncludes: {
      '/ticket': ['./node_modules/tesseract.js-core/**'],
      '/importar': [
        // Las fuentes estándar se leen del disco al abrir el PDF.
        './node_modules/pdfjs-dist/standard_fonts/**',
        // Y aunque en Node no se levanta un worker de verdad, pdfjs importa
        // igual este archivo para armar el "worker falso": sin él, abrir un PDF
        // falla en producción con "Setting up fake worker failed".
        './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      ],
    },
  },
}
export default nextConfig
