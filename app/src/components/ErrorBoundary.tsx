import { ErrorBoundary as SolidErrorBoundary, ParentComponent } from 'solid-js'

interface FallbackProps {
  error: Error
  reset: () => void
}

function ErrorFallback(props: FallbackProps) {
  return (
    <div class="p-4 m-2 bg-red-50 border-2 border-red-700 shadow-[var(--shadow)]">
      <div class="flex items-start gap-3">
        <span class="i-mdi-alert-circle w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div class="flex-1 min-w-0">
          <h3 class="text-red-800 text-sm font-semibold font-heading mb-1">Something went wrong</h3>
          <p class="text-red-700 text-xs mb-3 break-words">
            {props.error.message || 'An unexpected error occurred'}
          </p>
          <div class="flex gap-2">
            <button
              onClick={props.reset}
              class="btn-win text-xs"
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              class="btn-win text-xs text-fg-muted"
            >
              Reload Page
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export const AppErrorBoundary: ParentComponent = (props) => {
  return (
    <SolidErrorBoundary
      fallback={(error, reset) => <ErrorFallback error={error} reset={reset} />}
    >
      {props.children}
    </SolidErrorBoundary>
  )
}

export default AppErrorBoundary
