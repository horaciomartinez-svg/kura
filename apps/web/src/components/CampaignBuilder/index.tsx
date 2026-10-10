'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ConfigProvider } from '@arco-design/web-react'
import { EmailEditor, EmailEditorProvider } from 'easy-email-editor'
import type { IEmailTemplate } from 'easy-email-editor'
import { SimpleLayout } from 'easy-email-extensions'
import type { FormApi, FormState } from 'final-form'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type { EasyEmailAST } from '@kura/core'
import { api } from '@/lib/api'
import { EditorHeader } from './EditorHeader'
import { KURA_EDITOR_LOCALE } from './locale'
import { KURA_MERGE_TAGS, createEmailTemplate } from './templates'
import { useEasyEmailPersistence } from './useEasyEmailPersistence'

import 'easy-email-editor/lib/style.css'
import 'easy-email-extensions/lib/style.css'
import '@arco-design/web-react/dist/css/arco.css'
import './editor-theme.css'

/** Altura del editor descontando la cabecera de KURA (56 px). */
const EDITOR_HEIGHT = 'calc(100vh - 57px)'

type TemplateFormApi = FormApi<IEmailTemplate, Partial<IEmailTemplate>>

interface CampaignBuilderProps {
  campaignId: string
}

/**
 * Wrapper de Easy-Email que reemplaza el builder propio (§9).
 * Carga el design_json de la campaña, persiste el AST (autosave 30 s) y
 * compila el HTML final bajo demanda.
 */
export function CampaignBuilder({ campaignId }: CampaignBuilderProps) {
  const [initialValues, setInitialValues] = useState<IEmailTemplate | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const persistence = useEasyEmailPersistence(campaignId)

  useEffect(() => {
    let active = true
    setInitialValues(null)
    setLoadError(null)

    api
      .getCampaign(campaignId)
      .then((campaign) => {
        if (!active) return
        setInitialValues(createEmailTemplate(campaign.designJson))
      })
      .catch((err: unknown) => {
        if (!active) return
        console.warn('No se pudo cargar la campaña; se usa la plantilla base.', err)
        setLoadError(
          'No se pudo cargar la campaña guardada. Se muestra una plantilla base en blanco.'
        )
        setInitialValues(createEmailTemplate(null))
      })

    return () => {
      active = false
    }
  }, [campaignId])

  if (!initialValues) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 text-typography-muted">
        <Loader2 size={18} className="animate-spin" />
        Cargando editor…
      </div>
    )
  }

  return (
    <ConfigProvider>
      <div className="kura-builder h-screen flex flex-col bg-surface overflow-hidden">
        <EmailEditorProvider
          key={campaignId}
          data={initialValues}
          height={EDITOR_HEIGHT}
          onUploadImage={api.uploadAsset}
          mergeTags={KURA_MERGE_TAGS}
          locale={KURA_EDITOR_LOCALE}
          dashed={false}
          autoComplete
        >
          {(_state: FormState<IEmailTemplate>, helper: TemplateFormApi) => (
            <EditorWorkspace
              helper={helper}
              notifyChange={persistence.notifyChange}
              saveAndContinue={persistence.saveAndContinue}
              isDirty={persistence.isDirty}
              isSaving={persistence.isSaving}
              lastSavedAt={persistence.lastSavedAt}
              warnings={persistence.warnings}
              loadError={loadError}
            />
          )}
        </EmailEditorProvider>
      </div>
    </ConfigProvider>
  )
}

interface EditorWorkspaceProps {
  helper: TemplateFormApi
  notifyChange: (ast: EasyEmailAST) => void
  saveAndContinue: (ast: EasyEmailAST) => Promise<void>
  isDirty: boolean
  isSaving: boolean
  lastSavedAt: Date | null
  warnings: string[]
  loadError: string | null
}

/**
 * Suscribe el editor a los cambios del formulario (react-final-form) para
 * disparar el autosave, y ofrece la acción "Guardar y continuar".
 */
function EditorWorkspace({
  helper,
  notifyChange,
  saveAndContinue,
  isDirty,
  isSaving,
  lastSavedAt,
  warnings,
  loadError,
}: EditorWorkspaceProps) {
  const valuesRef = useRef<EasyEmailAST | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = helper.subscribe(
      (state) => {
        const content = state.values?.content as unknown as EasyEmailAST | undefined
        if (!content) return
        valuesRef.current = content
        notifyChange(content)
      },
      { values: true }
    )
    return unsubscribe
  }, [helper, notifyChange])

  const handleSaveAndContinue = useCallback(() => {
    const ast =
      valuesRef.current ??
      (helper.getState().values?.content as unknown as EasyEmailAST | undefined)
    if (!ast) return

    setSaveError(null)
    saveAndContinue(ast).catch(() => {
      setSaveError('No se pudo compilar y guardar la campaña. Intenta nuevamente.')
    })
  }, [helper, saveAndContinue])

  return (
    <>
      <EditorHeader
        isDirty={isDirty}
        isSaving={isSaving}
        lastSavedAt={lastSavedAt}
        onSaveAndContinue={handleSaveAndContinue}
      />

      <Notices loadError={loadError} saveError={saveError} warnings={warnings} />

      <SimpleLayout>
        <EmailEditor />
      </SimpleLayout>
    </>
  )
}

interface NoticesProps {
  loadError: string | null
  saveError: string | null
  warnings: string[]
}

/** Avisos no bloqueantes: errores de carga/guardado y advertencias de MJML (§9.4). */
function Notices({ loadError, saveError, warnings }: NoticesProps) {
  const hasNotices = Boolean(loadError || saveError) || warnings.length > 0
  if (!hasNotices) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {loadError && <Notice tone="amber" title="Aviso" message={loadError} />}
      {saveError && <Notice tone="red" title="Error al guardar" message={saveError} />}
      {warnings.length > 0 && (
        <Notice
          tone="amber"
          title={`Advertencias de MJML (${warnings.length})`}
          message={warnings.slice(0, 3).join(' · ')}
        />
      )}
    </div>
  )
}

function Notice({
  tone,
  title,
  message,
}: {
  tone: 'amber' | 'red'
  title: string
  message: string
}) {
  const palette =
    tone === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-red-200 bg-red-50 text-red-700'

  return (
    <div
      className={`pointer-events-auto flex items-start gap-2 rounded-kura-md border px-3 py-2 text-xs shadow-kura-soft ${palette}`}
      role="status"
    >
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 leading-relaxed">{message}</p>
      </div>
    </div>
  )
}
