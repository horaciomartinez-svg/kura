import type { Config } from 'tailwindcss'
import forms from '@tailwindcss/forms'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Paleta Institucional KURA
        primary: {
          DEFAULT: '#014751', // Verde Esmeralda
          hover: '#01363E',
        },
        accent: {
          DEFAULT: '#AFFECA', // Verde Menta
          hover: '#95E3B3',
        },
        surface: {
          DEFAULT: '#F7F9FC', // Gris Hielo (Fondos)
          card: '#FFFFFF',
        },
        typography: {
          DEFAULT: '#111827', // Gris Carbón
          muted: '#6B7280',
        }
      },
      fontFamily: {
        heading: ['Clash Display', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['Fira Code', 'monospace'],
      },
      borderRadius: {
        'kura-sm': '6px',
        'kura-md': '8px',
        'kura-lg': '12px',
      },
      boxShadow: {
        'kura-soft': '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
      }
    },
  },
  plugins: [
    forms,
  ],
}
export default config
