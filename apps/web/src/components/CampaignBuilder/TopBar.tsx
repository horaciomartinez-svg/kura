'use client'

import React, { useState } from 'react'
import { Check, Loader2, Save, Send } from 'lucide-react'
import { api } from '@/lib/api'
import { useCampaignBuilderStore } from '@/store/useCampaignBuilderStore'

export function TopBar() {
  const campaignId = useCampaignBuilderStore((s) => s.campaignId)
  const isDirty = useCampaignBuilderStore((s) => s.isDirty)
  const saveDesign = useCampaignBuilderStore((s) => s.saveDesign)
  const blockCount = useCampaignBuilderStore((s) => s.design.blocks.length)

  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const notify = (type: 'ok' | 'error', text: string) => {
    setFeedback({ type, text })
    setTimeout(() => setFeedback(null), 3500)
  }

  const handleSave = async () => {
    if (!campaignId) {
      notify('error', 'No hay campaña activa.')
      return
    }
    setSaving(true)
    try {
      await saveDesign()
      notify('ok', 'Borrador guardado.')
    } catch {
      notify('error', 'No se pudo guardar el borrador.')
    } finally {
      setSaving(false)
    }
  }

  const handleSendTest = async () => {
    if (!campaignId) {
      notify('error', 'No hay campaña activa.')
      return
    }
    setSending(true)
    try {
      if (isDirty) await saveDesign()
      const result = await api.sendCampaign(campaignId)
      notify('ok', `Envío iniciado (${result.enqueued} correos en cola).`)
    } catch {
      notify('error', 'No se pudo iniciar el envío.')
    } finally {
      setSending(false)
    }
  }

  return (
    <header className="flex items-center justify-between gap-4 px-6 py-3 border-b border-gray-100 bg-surface-card">
      <div className="flex items-center gap-3 min-w-0">
        <h2 className="font-heading text-lg font-semibold truncate">Editor de Campaña</h2>
        <span className="text-xs text-typography-muted whitespace-nowrap">
          {blockCount} {blockCount === 1 ? 'bloque' : 'bloques'}
        </span>
        <span
          className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${
            isDirty ? 'bg-yellow-50 text-amber-700' : 'bg-accent/30 text-primary'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${isDirty ? 'bg-amber-500' : 'bg-primary'}`} />
          {isDirty ? 'Cambios sin guardar' : 'Todo guardado'}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {feedback && (
          <span
            className={`flex items-center gap-1.5 text-xs font-medium ${
              feedback.type === 'ok' ? 'text-primary' : 'text-red-600'
            }`}
          >
            {feedback.type === 'ok' && <Check size={14} />}
            {feedback.text}
          </span>
        )}

        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className="flex items-center gap-2 border border-primary text-primary px-4 py-2 rounded-kura-md font-medium hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Guardar
        </button>

        <button
          onClick={handleSendTest}
          disabled={sending || blockCount === 0}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-kura-md font-medium hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          Enviar prueba
        </button>
      </div>
    </header>
  )
}
