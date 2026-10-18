'use client'

import React from 'react'
import { CalendarClock, Loader2, Save, Send } from 'lucide-react'

interface EditorHeaderProps {
  isDirty: boolean
  isSaving: boolean
  isSending?: boolean
  isScheduling?: boolean
  lastSavedAt: Date | null
  onSaveAndContinue: () => void
  onSend?: () => void
  onSchedule?: () => void
}

function formatTime(value: Date): string {
  return value.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
}

/** Cabecera del editor con el estado de guardado y la acción principal (§9.4). */
export function EditorHeader({
  isDirty,
  isSaving,
  isSending = false,
  isScheduling = false,
  lastSavedAt,
  onSaveAndContinue,
  onSend,
  onSchedule,
}: EditorHeaderProps) {
  return (
    <header className="flex items-center justify-between gap-4 px-6 py-3 border-b border-gray-100 bg-surface-card">
      <div className="flex items-center gap-3 min-w-0">
        <h2 className="font-heading text-lg font-semibold truncate">Editor de Campaña</h2>
        <span
          className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${
            isDirty ? 'bg-yellow-50 text-amber-700' : 'bg-accent/30 text-primary'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${isDirty ? 'bg-amber-500' : 'bg-primary'}`} />
          {isDirty ? 'Cambios sin guardar' : 'Todo guardado'}
        </span>
        {lastSavedAt && (
          <span className="hidden sm:inline text-xs text-typography-muted whitespace-nowrap">
            Guardado a las {formatTime(lastSavedAt)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onSaveAndContinue}
          disabled={isSaving || isSending || isScheduling}
          className="flex items-center gap-2 border border-primary text-primary px-4 py-2 rounded-kura-md font-medium hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Guardar y continuar
        </button>

        {onSchedule && (
          <button
            onClick={onSchedule}
            disabled={isSaving || isSending || isScheduling}
            className="flex items-center gap-2 border border-gray-300 text-typography px-4 py-2 rounded-kura-md font-medium hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isScheduling ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <CalendarClock size={16} />
            )}
            Programar envío
          </button>
        )}

        {onSend && (
          <button
            onClick={onSend}
            disabled={isSaving || isSending || isScheduling}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-kura-md font-medium hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            Enviar campaña
          </button>
        )}
      </div>
    </header>
  )
}
