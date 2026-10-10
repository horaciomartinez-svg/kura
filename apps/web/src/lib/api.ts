import type { EasyEmailAST } from '@kura/core'
import { createClient } from '@/lib/supabase/client'

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/$/, '')

/** Campaña devuelta por GET /api/campaigns/:id (columnas Drizzle en camelCase). */
export interface Campaign {
  id: string
  name: string
  fromEmail: string
  subject: string | null
  designJson: EasyEmailAST | null
  htmlContent: string | null
  status: string
}

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

/**
 * Sube una imagen al Worker autenticado (multipart). No se establece
 * Content-Type manualmente: el navegador añade el boundary correcto.
 */
async function uploadAsset(blob: Blob): Promise<string> {
  const token = await getAccessToken()
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const form = new FormData()
  form.append('file', blob, 'imagen')

  const response = await fetch(`${API_BASE}/api/assets`, {
    method: 'POST',
    body: form,
    headers,
  })

  if (!response.ok) {
    let message = `No se pudo subir la imagen (${response.status}).`
    try {
      const body = (await response.json()) as { error?: { message?: string } }
      if (body?.error?.message) message = body.error.message
    } catch {
      // El cuerpo de error no era JSON.
    }
    throw new Error(message)
  }

  const data = (await response.json()) as { public_url: string }
  return data.public_url
}

export const api = {
  getCampaign: async (campaignId: string): Promise<Campaign> => {
    const { campaign } = await request<{ campaign: Campaign }>(`/api/campaigns/${campaignId}`)
    return campaign
  },

  uploadAsset,

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
