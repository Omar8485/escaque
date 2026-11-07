/** @type {import('tailwindcss').Config} */
// Paleta de Escaque (propia, cálida; ver docs/HANDOFF.md §3i):
//  - brand: terracota (botones principales, selección, reloj activo). Reemplaza al índigo genérico.
//  - ink:   piedra cálida para fondos, textos y bordes; en oscuro, café espresso. Reemplaza al slate.
// Los colores de estado (emerald, amber, rose, yellow, sky) se mantienen para las insignias.
export default {
  // Tema oscuro por clase: <html class="dark"> (botón en la esquina superior derecha).
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fdf4ef',
          100: '#fbe4d8',
          200: '#f6c6ae',
          300: '#eea17f',
          400: '#e47b52',
          500: '#d66035',
          600: '#bf4b24',
          700: '#9d3b1d',
          800: '#7e311d',
          900: '#672b1b',
          950: '#38130b',
        },
        ink: {
          50: '#faf6f0',
          100: '#f2ebe0',
          200: '#e4d9c8',
          300: '#cfbfa8',
          400: '#a89881',
          500: '#857565',
          600: '#685b4f',
          700: '#4e443b',
          800: '#332c26',
          900: '#221d19',
          950: '#14110e',
        },
      },
    },
  },
  plugins: [],
}
