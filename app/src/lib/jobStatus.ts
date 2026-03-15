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

  // Try WebSocket first, with timeout fallback
  const wsUrl = API.replace(/^http/, 'ws') + `/ws/job/${encodeURIComponent(jobId)}`
  let wsConnected = false
  let wsTimeout: ReturnType<typeof setTimeout> | null = null

  try {
    ws = new WebSocket(wsUrl)

    // If WS doesn't open within 5s, fall back to polling
    wsTimeout = setTimeout(() => {
      if (!wsConnected && !cancelled) {
        ws?.close()
        startPolling()
      }
    }, 5000)

    ws.onopen = () => {
      wsConnected = true
      if (wsTimeout) clearTimeout(wsTimeout)
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

    ws.onerror = () => {
      if (wsTimeout) clearTimeout(wsTimeout)
      ws?.close()
      if (!cancelled && !wsConnected) startPolling()
    }

    ws.onclose = () => {}
  } catch {
    if (wsTimeout) clearTimeout(wsTimeout)
    startPolling()
  }

  function startPolling() {
    if (cancelled) return

    async function poll() {
      if (cancelled) return

      try {
        const res = await fetch(`${API}/api/status?job_id=${encodeURIComponent(jobId)}`)
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
    if (typeof data.status === 'string') {
      return {
        status: data.status,
        url: data.url,
        duration_seconds: data.duration_seconds,
        reason: data.reason,
        progress: data.progress,
        estimated_seconds: data.estimated_seconds,
        elapsed_seconds: data.elapsed_seconds,
      }
    }

    return { status: 'Unknown' }
  }

  // Cleanup function
  return () => {
    cancelled = true
    if (wsTimeout) clearTimeout(wsTimeout)
    ws?.close()
    if (pollTimeout) clearTimeout(pollTimeout)
  }
}
