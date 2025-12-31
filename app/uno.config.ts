import { defineConfig, presetUno, presetAttributify } from 'unocss'

export default defineConfig({
  presets: [
    presetUno(),
    presetAttributify(),
  ],
  theme: {
    colors: {
      bg: '#0d1117',
      surface: '#161b22',
      border: 'rgba(255,255,255,0.1)',
      primary: '#be185d',
      'primary-hover': '#9f1239',
      success: '#059669',
      error: '#dc2626',
      muted: 'rgba(255,255,255,0.5)',
    },
  },
  shortcuts: {
    'btn': 'px-6 py-3 font-medium cursor-pointer border border-border hover:border-primary transition-colors',
    'btn-primary': 'btn bg-primary border-primary text-white hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed',
    'input-base': 'bg-transparent border border-border px-4 py-3 text-white focus:outline-none focus:border-primary',
  },
})
