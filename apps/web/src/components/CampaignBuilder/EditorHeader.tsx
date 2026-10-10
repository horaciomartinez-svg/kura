'use client'

import React from 'react'
import { Loader2, Save } from 'lucide-react'

interface EditorHeaderProps {
  isDirty: boolean
  isSaving: boolean
  lastSavedAt: Date | null
  onSaveAndContinue: () => void
}

function formatTime(value: Date): string {
  return value.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
}

/** Cabecera del editor con el estado de guardado y la acción principal (§9.4). */
export function EditorHeader({ isDirty, isSaving, lastSavedAt, onSaveAndContinue }: EditorHeaderProps) {
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

      <button
        onClick={onSaveAndContinue}
        disabled={isSaving}
        className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-kura-md font-medium hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        Guardar y continuar
      </button>
    </header>
  )
}
