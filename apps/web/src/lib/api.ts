const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/$/, '')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`)
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
}
