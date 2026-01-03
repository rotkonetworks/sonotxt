import { defineConfig, presetUno, presetAttributify, presetIcons } from 'unocss'

export default defineConfig({
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({
      scale: 1.2,
      extraProperties: {
        'display': 'inline-block',
        'vertical-align': 'middle',
      },
    }),
  ],
  theme: {
    colors: {
      // Dark blue palette with pink accents
      bg: {
        dark: '#0d1117',
        mid: '#161b22',
        light: '#21262d',
      },
      border: {
        dark: '#010409',
        light: '#30363d',
        highlight: '#484f58',
      },
      lcd: {
        green: '#00ff00',
        yellow: '#ffcc00',
        red: '#ff0000',
        pink: '#ec4899',
        bg: '#0a0f0a',
      },
      text: {
        DEFAULT: '#b8b8b8',
        dim: '#666666',
        bright: '#ffffff',
      },
      accent: '#be185d',
      'accent-hover': '#9f1239',
    },
  },
  shortcuts: {
    // Winamp-style buttons
    'btn-win': 'border border-solid cursor-pointer text-11px font-semibold uppercase tracking-wider py-1 px-3',
    'btn-win-primary': 'btn-win text-white',
    // Panels
    'panel': 'border border-solid',
    'panel-inset': 'bg-bg-dark border border-solid shadow-inner',
    // LCD display
    'lcd': 'bg-lcd-bg font-mono text-lcd-green',
  },
})
