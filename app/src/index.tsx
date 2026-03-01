/* @refresh reload */
import { render } from 'solid-js/web'
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import './index.css'
import App from './App'
import { StoreProvider } from './lib/store'
import { AppErrorBoundary } from './components/ErrorBoundary'

const root = document.getElementById('root')!
const shell = document.getElementById('shell')

render(
  () => (
    <StoreProvider>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </StoreProvider>
  ),
  root
)

// Hide shell, show app
root.style.display = 'block'
shell?.remove()
document.body.style.display = ''
document.body.style.alignItems = ''
document.body.style.justifyContent = ''
