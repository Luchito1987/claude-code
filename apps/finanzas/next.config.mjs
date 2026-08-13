/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    // Los dos levantan procesos o binarios propios: empaquetarlos rompe las
    // rutas que usan por dentro. tesseract.js, además, no falla —se cuelga.
    serverComponentsExternalPackages: ['better-sqlite3', 'tesseract.js'],

    // El OCR es WebAssembly, y el `.wasm` se carga recién en tiempo de
    // ejecución: el rastreador de `output: standalone` mira los `import` del
    // código y no lo ve, así que lo dejaba afuera del build. El resultado era
    // que sacar una foto quedaba colgado para siempre en producción —el worker
    // aborta adentro y la promesa nunca vuelve— mientras en desarrollo andaba.
    outputFileTracingIncludes: {
      '/ticket': ['./node_modules/tesseract.js-core/**'],
    },
  },
}
export default nextConfig
