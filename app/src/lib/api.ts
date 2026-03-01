// API service with proper error handling

const API = import.meta.env.VITE_API_URL || 'https://api.sonotxt.com'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }

  get isLimitExceeded() {
    return this.code === 'LIMIT_EXCEEDED' ||
      this.message.includes('limit') ||
      this.message.includes('Free tier')
  }
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new ApiError(
      data.error || data.message || `Request failed: ${res.status}`,
      res.status,
      data.code
    )
  }

  return res.json()
}

// TTS API
export interface TtsRequest {
  text: string
  voice: string
  engine?: string // "kokoro" | "vibevoice" | "vibevoice-streaming"
}

export interface TtsResponse {
  job_id: string
  status: { status: string; estimated_seconds?: number }
  free_tier_remaining?: number
}

export async function submitTts(req: TtsRequest): Promise<TtsResponse> {
  return request('/api/tts', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

// Extract URL
export interface ExtractResponse {
  text: string
  title?: string
  char_count: number
}

export async function extractUrl(url: string): Promise<ExtractResponse> {
  return request('/api/extract', {
    method: 'POST',
    body: JSON.stringify({ url }),
  })
}

// Voices
export interface VoiceEntry {
  id: string
  sample_url: string
}

export interface VoicesResponse {
  voices: VoiceEntry[]
  default: string
  samples_base_url: string
  categories: Record<string, string[]>
}

export async function fetchVoices(): Promise<VoicesResponse> {
  return request('/api/voices')
}

// Auth
export interface User {
  id: string
  nickname?: string
  email?: string
  balance: number
}

export interface AuthResponse {
  user_id: string
  nickname?: string
  email?: string
  balance: number
  token?: string
}

export async function checkSession(token: string): Promise<AuthResponse> {
  return request('/api/auth/session', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

export async function checkNickname(nickname: string): Promise<{ available: boolean }> {
  return request('/api/auth/check-nickname', {
    method: 'POST',
    body: JSON.stringify({ nickname }),
  })
}

export interface RegisterRequest {
  nickname: string
  public_key: string
  email?: string
  recovery_share?: string
}

export async function register(req: RegisterRequest): Promise<AuthResponse> {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export async function getChallenge(nickname: string): Promise<{ challenge: string; public_key: string }> {
  return request('/api/auth/challenge', {
    method: 'POST',
    body: JSON.stringify({ nickname }),
  })
}

export async function verifyChallenge(
  nickname: string,
  challenge: string,
  signature: string
): Promise<AuthResponse> {
  return request('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ nickname, challenge, signature }),
  })
}

export async function requestMagicLink(email: string): Promise<{ message: string; server_share?: string }> {
  return request('/api/auth/magic-link/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function verifyMagicLink(token: string): Promise<AuthResponse> {
  return request('/api/auth/magic-link/verify', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

export async function logout(token: string): Promise<void> {
  await request('/api/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

// Download helper - returns URL for downloading audio via API proxy
export function getDownloadUrl(jobId: string): string {
  return `${API}/api/download/${jobId}`
}
