'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { JsonToMjml } from 'easy-email-core'
import type { IBlockData } from 'easy-email-core'
import mjml2html from 'mjml-browser'
import type { EasyEmailAST } from '@kura/core'
import { api } from '@/lib/api'

/** Autoguardado del AST con debounce de 30 s (§9.4). */
const AUTOSAVE_DEBOUNCE_MS = 30_000

export interface EasyEmailPersistence {
  isDirty: boolean
  isSaving: boolean
  lastSavedAt: Date | null
  warnings: string[]
  notifyChange: (ast: EasyEmailAST) => void
  saveAndContinue: (ast: EasyEmailAST) => Promise<void>
}

/**
 * Persistencia del editor (§9.4):
 *  1. Autosave del AST (design_json) con debounce de 30 s -> PATCH /autosave.
 *  2. "Guardar y continuar": AST + HTML compilado -> PUT /compile.
 */
export function useEasyEmailPersistence(campaignId: string): EasyEmailPersistence {
  const pendingRef = useRef<EasyEmailAST | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const flushAutosave = useCallback(async () => {
    const ast = pendingRef.current
    if (!ast) return
    pendingRef.current = null

    try {
      await api.autosave(campaignId, ast)
      setLastSavedAt(new Date())
      setIsDirty(false)
    } catch (err) {
      console.error('No se pudo autoguardar el diseño de la campaña:', err)
      // Se conserva el cambio pendiente para reintentar en el próximo ciclo.
      pendingRef.current = ast
    }
  }, [campaignId])

  const notifyChange = useCallback(
    (ast: EasyEmailAST) => {
      pendingRef.current = ast
      setIsDirty(true)
      clearTimer()
      timerRef.current = setTimeout(() => {
        void flushAutosave()
      }, AUTOSAVE_DEBOUNCE_MS)
    },
    [clearTimer, flushAutosave]
  )

  const saveAndContinue = useCallback(
    async (ast: EasyEmailAST) => {
      clearTimer()
      pendingRef.current = null
      setIsSaving(true)

      try {
        const blockData = ast as unknown as IBlockData
        const mjml = JsonToMjml({ data: blockData, mode: 'production', context: blockData })
        const { html, errors } = mjml2html(mjml, { validationLevel: 'soft' })

        // Las advertencias de MJML se muestran de forma no bloqueante (§9.4).
        setWarnings((errors ?? []).map((warning) => String(warning)))

        await api.compile(campaignId, ast, html)
        setIsDirty(false)
        setLastSavedAt(new Date())
      } catch (err) {
        console.error('No se pudo compilar y guardar la campaña:', err)
        throw err
      } finally {
        setIsSaving(false)
      }
    },
    [campaignId, clearTimer]
  )

  // Limpia el temporizador al desmontar.
  useEffect(() => clearTimer, [clearTimer])

  return { isDirty, isSaving, lastSavedAt, warnings, notifyChange, saveAndContinue }
}
