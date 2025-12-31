import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import UnoCSS from 'unocss/vite'

export default defineConfig({
  plugins: [
    UnoCSS(),
    solid(),
  ],
  build: {
    target: 'esnext',
    minify: 'esbuild',
  },
})
