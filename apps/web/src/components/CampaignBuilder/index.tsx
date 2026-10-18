'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ConfigProvider } from '@arco-design/web-react'
import { EmailEditor, EmailEditorProvider } from 'easy-email-editor'
import type { IEmailTemplate } from 'easy-email-editor'
import { SimpleLayout } from 'easy-email-extensions'
import type { FormApi, FormState } from 'final-form'
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, X } from 'lucide-react'
import type { EasyEmailAST } from '@kura/core'
import { api, isQuotaExceeded } from '@/lib/api'
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
const MIN_SCHEDULE_AHEAD_MS = 2 * 60 * 1000

/** Convierte una fecha local a `YYYY-MM-DDTHH:mm` para datetime-local. */
function toDatetimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

function formatLocalDateTime(date: Date): string {
  return date.toLocaleString('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

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
              campaignId={campaignId}
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
  campaignId: string
  helper: TemplateFormApi
  notifyChange: (ast: EasyEmailAST) => void
  saveAndContinue: (ast: EasyEmailAST) => Promise<void>
  isDirty: boolean
  isSaving: boolean
  lastSavedAt: Date | null
  warnings: string[]
  loadError: string | null
}

interface SendError {
  message: string
  billingLink: boolean
}

/**
 * Suscribe el editor a los cambios del formulario (react-final-form) para
 * disparar el autosave, y ofrece la acción "Guardar y continuar".
 */
function EditorWorkspace({
  campaignId,
  helper,
  notifyChange,
  saveAndContinue,
  isDirty,
  isSaving,
  lastSavedAt,
  warnings,
  loadError,
}: EditorWorkspaceProps) {
  const router = useRouter()
  const valuesRef = useRef<EasyEmailAST | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<SendError | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isScheduling, setIsScheduling] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleValue, setScheduleValue] = useState('')
  const [scheduleError, setScheduleError] = useState<SendError | null>(null)
  const [scheduleSuccess, setScheduleSuccess] = useState<string | null>(null)

  const minScheduleValue = toDatetimeLocalValue(
    new Date(Date.now() + MIN_SCHEDULE_AHEAD_MS)
  )

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

  const handleSend = useCallback(async () => {
    const ast =
      valuesRef.current ??
      (helper.getState().values?.content as unknown as EasyEmailAST | undefined)
    if (!ast) return

    setSaveError(null)
    setSendError(null)
    setIsSending(true)

    try {
      // Compila y persiste el HTML antes de encolar el envío.
      await saveAndContinue(ast)
      await api.sendCampaign(campaignId)
    } catch (err) {
      if (isQuotaExceeded(err)) {
        setSendError({
          message: `Alcanzaste la cuota de tu plan (${err.quota ?? 0} correos/mes, ${err.used ?? 0} usados). Actualiza tu plan para seguir enviando.`,
          billingLink: true,
        })
      } else if (
        err instanceof Error &&
        'code' in err &&
        (err as { code?: string }).code === 'SUBSCRIPTION_REQUIRED'
      ) {
        setSendError({
          message: 'Tu periodo de prueba expiró. Actualiza a un plan para seguir enviando.',
          billingLink: true,
        })
      } else {
        setSendError({
          message:
            err instanceof Error ? err.message : 'No se pudo iniciar el envío de la campaña.',
          billingLink: false,
        })
      }
    } finally {
      setIsSending(false)
    }
  }, [campaignId, helper, saveAndContinue])

  const openScheduleDialog = useCallback(() => {
    const suggested = new Date(Date.now() + 10 * 60 * 1000)
    setScheduleValue(toDatetimeLocalValue(suggested))
    setScheduleError(null)
    setScheduleOpen(true)
  }, [])

  const handleSchedule = useCallback(async () => {
    const ast =
      valuesRef.current ??
      (helper.getState().values?.content as unknown as EasyEmailAST | undefined)
    if (!ast) return

    const chosen = new Date(scheduleValue)
    if (
      Number.isNaN(chosen.getTime()) ||
      chosen.getTime() < Date.now() + MIN_SCHEDULE_AHEAD_MS
    ) {
      setScheduleError({
        message: 'Elige una fecha válida con al menos 2 minutos de anticipación.',
        billingLink: false,
      })
      return
    }

    setScheduleError(null)
    setIsScheduling(true)

    try {
      // El endpoint exige html_content compilado: guarda antes de programar.
      await saveAndContinue(ast)
      await api.scheduleCampaign(campaignId, chosen.toISOString())
      setScheduleOpen(false)
      setScheduleSuccess(`Campaña programada para ${formatLocalDateTime(chosen)}`)
      setTimeout(() => router.push('/dashboard'), 1400)
    } catch (err) {
      const code =
        err instanceof Error && 'code' in err
          ? (err as { code?: string }).code
          : undefined

      if (code === 'SUBSCRIPTION_REQUIRED') {
        setScheduleError({
          message: 'Tu periodo de prueba expiró. Actualiza a un plan para programar envíos.',
          billingLink: true,
        })
      } else if (code === 'INVALID_SCHEDULE_TIME') {
        setScheduleError({
          message: 'La fecha debe estar al menos 2 minutos en el futuro.',
          billingLink: false,
        })
      } else {
        setScheduleError({
          message:
            err instanceof Error ? err.message : 'No se pudo programar el envío.',
          billingLink: false,
        })
      }
    } finally {
      setIsScheduling(false)
    }
  }, [campaignId, helper, router, saveAndContinue, scheduleValue])

  return (
    <>
      <EditorHeader
        isDirty={isDirty}
        isSaving={isSaving}
        isSending={isSending}
        isScheduling={isScheduling}
        lastSavedAt={lastSavedAt}
        onSaveAndContinue={handleSaveAndContinue}
        onSend={handleSend}
        onSchedule={openScheduleDialog}
      />

      <Notices
        loadError={loadError}
        saveError={saveError}
        sendError={sendError}
        warnings={warnings}
      />

      <SimpleLayout>
        <EmailEditor />
      </SimpleLayout>

      {scheduleOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div
            className="w-full max-w-md rounded-kura-lg bg-surface-card p-6 shadow-kura-soft"
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-kura-sm bg-accent/30 text-primary">
                  <CalendarClock size={18} />
                </span>
                <div>
                  <h2 id="schedule-title" className="font-heading text-lg font-semibold">
                    Programar envío
                  </h2>
                  <p className="text-xs text-typography-muted">
                    La fecha se guarda en UTC y se muestra en tu hora local.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setScheduleOpen(false)}
                className="text-typography-muted hover:text-typography"
                aria-label="Cerrar"
              >
                <X size={17} />
              </button>
            </div>

            <div className="mt-5">
              <label
                htmlFor="schedule-at"
                className="mb-1.5 block text-sm font-medium text-typography"
              >
                Fecha y hora local
              </label>
              <input
                id="schedule-at"
                type="datetime-local"
                value={scheduleValue}
                min={minScheduleValue}
                onChange={(event) => setScheduleValue(event.target.value)}
                className="w-full rounded-kura-md border border-gray-200 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
              />
              {scheduleValue && !Number.isNaN(new Date(scheduleValue).getTime()) && (
                <p className="mt-2 text-xs text-typography-muted">
                  Se enviará el{' '}
                  <strong className="text-typography">
                    {formatLocalDateTime(new Date(scheduleValue))}
                  </strong>
                </p>
              )}
            </div>

            {scheduleError && (
              <div className="mt-4 rounded-kura-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <p>{scheduleError.message}</p>
                {scheduleError.billingLink && (
                  <Link href="/billing" className="mt-1 inline-block font-medium underline">
                    Ver planes y facturación
                  </Link>
                )}
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setScheduleOpen(false)}
                disabled={isScheduling}
                className="rounded-kura-md border border-gray-200 px-4 py-2 text-sm font-medium hover:border-primary hover:text-primary disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSchedule}
                disabled={isScheduling || !scheduleValue}
                className="flex items-center gap-2 rounded-kura-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isScheduling ? <Loader2 size={15} className="animate-spin" /> : <CalendarClock size={15} />}
                Confirmar programación
              </button>
            </div>
          </div>
        </div>
      )}

      {scheduleSuccess && (
        <div className="fixed bottom-4 left-4 z-[80] flex items-start gap-2 rounded-kura-md border border-primary/20 bg-surface-card px-4 py-3 text-sm shadow-kura-soft">
          <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-primary" />
          <p>{scheduleSuccess}</p>
        </div>
      )}
    </>
  )
}

interface NoticesProps {
  loadError: string | null
  saveError: string | null
  sendError: SendError | null
  warnings: string[]
}

/** Avisos no bloqueantes: errores de carga/guardado/envío y advertencias (§9.4). */
function Notices({ loadError, saveError, sendError, warnings }: NoticesProps) {
  const hasNotices = Boolean(loadError || saveError || sendError) || warnings.length > 0
  if (!hasNotices) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {loadError && <Notice tone="amber" title="Aviso" message={loadError} />}
      {saveError && <Notice tone="red" title="Error al guardar" message={saveError} />}
      {sendError && (
        <Notice
          tone={sendError.billingLink ? 'amber' : 'red'}
          title={sendError.billingLink ? 'Límite de envíos' : 'Error al enviar'}
          message={sendError.message}
          href={sendError.billingLink ? '/billing' : undefined}
          hrefLabel="Ver planes y facturación"
        />
      )}
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
  href,
  hrefLabel,
}: {
  tone: 'amber' | 'red'
  title: string
  message: string
  href?: string
  hrefLabel?: string
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
        {href && (
          <Link
            href={href}
            className="mt-1.5 inline-block font-medium underline hover:no-underline"
          >
            {hrefLabel ?? 'Ver más'}
          </Link>
        )}
      </div>
    </div>
  )
}
