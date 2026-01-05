import { ErrorBoundary as SolidErrorBoundary, ParentComponent } from 'solid-js'

interface FallbackProps {
  error: Error
  reset: () => void
}

function ErrorFallback(props: FallbackProps) {
  return (
    <div class="p-4 m-2 bg-red-900/20 border border-red-500/30 rounded-lg">
      <div class="flex items-start gap-3">
        <span class="i-mdi-alert-circle w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
        <div class="flex-1 min-w-0">
          <h3 class="text-red-300 text-sm font-semibold mb-1">Something went wrong</h3>
          <p class="text-red-200/70 text-xs mb-3 break-words">
            {props.error.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={props.reset}
            class="btn-win text-xs"
          >
            Try Again
          </button>
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
