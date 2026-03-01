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
      // backgrounds
      page: 'var(--bg)',
      surface: 'var(--surface)',
      // foreground
      fg: {
        DEFAULT: 'var(--fg)',
        muted: 'var(--fg-muted)',
        faint: 'var(--fg-faint)',
      },
      // accent
      accent: {
        DEFAULT: 'var(--accent)',
        hover: 'var(--accent-hover)',
        strong: 'var(--accent-strong)',
        soft: 'var(--accent-soft)',
        muted: 'var(--accent-muted)',
        faint: 'var(--accent-faint)',
      },
      // borders
      edge: {
        DEFAULT: 'var(--border)',
        soft: 'var(--border-soft)',
      },
    },
    fontFamily: {
      heading: ['Space Grotesk', 'sans-serif'],
      serif: ['IBM Plex Serif', 'serif'],
      mono: ['IBM Plex Mono', 'monospace'],
    },
    boxShadow: {
      sharp: 'var(--shadow)',
    },
  },
  shortcuts: {
    'btn-win': 'bg-surface border-2 border-edge text-fg font-heading cursor-pointer text-11px font-semibold uppercase tracking-wider py-1 px-3 hover:bg-page',
    'btn-win-primary': 'btn-win bg-accent text-white hover:bg-accent-hover',
    'panel': 'bg-surface border-2 border-edge shadow-sharp',
    'panel-inset': 'bg-page border border-edge-soft',
  },
})
