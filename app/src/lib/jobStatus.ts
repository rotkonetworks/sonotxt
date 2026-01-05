// Job status with WebSocket + API polling fallback

const API = import.meta.env.VITE_API_URL || 'https://api.sonotxt.com'

interface JobResult {
  status: string
  url?: string
  duration_seconds?: number
  reason?: string
  progress?: number
  estimated_seconds?: number
  elapsed_seconds?: number
}

type StatusCallback = (result: JobResult) => void
type ErrorCallback = (error: Error) => void

export function watchJobStatus(
  jobId: string,
  onStatus: StatusCallback,
  onError: ErrorCallback
): () => void {
  let cancelled = false
  let ws: WebSocket | null = null
  let pollTimeout: number | null = null

  // Try WebSocket first
  const wsUrl = API.replace(/^http/, 'ws') + `/ws/job/${jobId}`

  try {
    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log('[WS] Connected for job:', jobId)
    }

    ws.onmessage = (event) => {
      if (cancelled) return
      try {
        const data = JSON.parse(event.data)
        onStatus(normalizeStatus(data))

        // Close on terminal states
        if (data.Complete || data.Failed) {
          ws?.close()
        }
      } catch (e) {
        console.error('[WS] Parse error:', e)
      }
    }

    ws.onerror = (e) => {
      console.warn('[WS] Error, falling back to polling:', e)
      ws?.close()
      if (!cancelled) startPolling()
    }

    ws.onclose = () => {
      console.log('[WS] Closed')
    }
  } catch (e) {
    console.warn('[WS] Failed to connect, using polling')
    startPolling()
  }

  function startPolling() {
    if (cancelled) return

    async function poll() {
      if (cancelled) return

      try {
        const res = await fetch(`${API}/api/status?job_id=${jobId}`)
        if (!res.ok) throw new Error('Status fetch failed')

        const data = await res.json()
        onStatus(normalizeStatus(data))

        // Continue polling if not terminal
        if (data.status !== 'Complete' && data.status !== 'Failed') {
          pollTimeout = window.setTimeout(poll, 1000)
        }
      } catch (e: any) {
        if (!cancelled) onError(e)
      }
    }

    poll()
  }

  // Normalize different status formats
  function normalizeStatus(data: any): JobResult {
    // WebSocket sends { Complete: {...} } or { Failed: {...} } etc
    if (data.Complete) {
      return {
        status: 'Complete',
        url: data.Complete.url,
        duration_seconds: data.Complete.duration_seconds,
      }
    }
    if (data.Failed) {
      return {
        status: 'Failed',
        reason: data.Failed.reason,
      }
    }
    if (data.Processing) {
      return {
        status: 'Processing',
        progress: data.Processing.progress,
        elapsed_seconds: data.Processing.elapsed_seconds,
        estimated_seconds: data.Processing.estimated_seconds,
      }
    }
    if (data.Queued) {
      return {
        status: 'Queued',
        estimated_seconds: data.Queued.estimated_seconds,
      }
    }

    // API returns { status: "Complete", url: ... }
    return data
  }

  // Cleanup function
  return () => {
    cancelled = true
    ws?.close()
    if (pollTimeout) clearTimeout(pollTimeout)
  }
}
