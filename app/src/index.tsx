/* @refresh reload */
import { render } from 'solid-js/web'
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import App from './App'

const root = document.getElementById('root')!
const shell = document.getElementById('shell')

render(() => <App />, root)

// Hide shell, show app
root.style.display = 'block'
shell?.remove()
