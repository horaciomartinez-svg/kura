import { createClient } from '@/lib/supabase/client'

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/$/, '')

/** Obtiene el access token de la sesión de Supabase (solo en el navegador). */
async function getAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  const {
    data: { session },
  } = await createClient().auth.getSession()
  return session?.access_token ?? null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken()
  const headers = new Headers(init?.headers)

  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers })

  if (!response.ok) {
    let message = `API request failed: ${response.status} ${response.statusText}`
    try {
      const body = (await response.json()) as { error?: { message?: string } }
      if (body?.error?.message) message = body.error.message
    } catch {
      // El cuerpo de error no era JSON; se conserva el mensaje genérico.
    }
    throw new Error(message)
  }

  return response.json() as Promise<T>
}

export const api = {
  sendCampaign: (campaignId: string) =>
    request<{ message: string; enqueued: number }>(`/api/campaigns/${campaignId}/send`, {
      method: 'POST',
    }),

  saveDesign: (campaignId: string, design: unknown) =>
    request<void>(`/api/campaigns/${campaignId}/design`, {
      method: 'PUT',
      body: JSON.stringify(design),
    }),

  autosave: (campaignId: string, designJson: unknown) =>
    request<{ message: string }>(`/api/campaigns/${campaignId}/autosave`, {
      method: 'PATCH',
      body: JSON.stringify({ design_json: designJson }),
    }),

  compile: (campaignId: string, designJson: unknown, html: string) =>
    request<{ message: string }>(`/api/campaigns/${campaignId}/compile`, {
      method: 'PUT',
      body: JSON.stringify({ design_json: designJson, html_content: html }),
    }),
}
