'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Check,
  CreditCard,
  Gauge,
  Loader2,
  ShieldAlert,
  X,
} from 'lucide-react'
import type { BillingPlan, EffectivePlanCode, MeResponse, PlanCode } from '@kura/core'
import { api } from '@/lib/api'

const PLANS: BillingPlan[] = [
  { code: 'free', name: 'Free', priceMonthlyCents: 0, monthlyEmailQuota: 500 },
  { code: 'pro', name: 'Pro', priceMonthlyCents: 1900, monthlyEmailQuota: 10000 },
  { code: 'business', name: 'Business', priceMonthlyCents: 4900, monthlyEmailQuota: 50000 },
]

const PLAN_LABELS: Record<EffectivePlanCode, string> = {
  free: 'Free',
  pro: 'Pro',
  business: 'Business',
  trial: 'Trial',
  expired: 'Trial expirado',
}

const BADGE_STYLES: Record<EffectivePlanCode, string> = {
  free: 'bg-gray-100 text-gray-700',
  pro: 'bg-accent/40 text-primary',
  business: 'bg-primary text-white',
  trial: 'bg-amber-50 text-amber-700',
  expired: 'bg-red-50 text-red-600',
}

interface Toast {
  tone: 'success' | 'info' | 'error'
  message: string
}

function formatPrice(cents: number): string {
  if (cents === 0) return 'Gratis'
  return `$${(cents / 100).toFixed(0)}/mes`
}

function formatQuota(quota: number): string {
  return `${quota.toLocaleString('es-CL')} correos/mes`
}

export default function BillingPage() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [checkoutPlan, setCheckoutPlan] = useState<PlanCode | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  const fetchMe = useCallback(async () => {
    setLoadError(null)
    try {
      setMe(await api.getMe())
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'No se pudo cargar la información de facturación.'
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchMe()
  }, [fetchMe])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('success') === '1') {
      setToast({ tone: 'success', message: 'Suscripción activada. ¡Gracias por confiar en KURA!' })
      void fetchMe()
    } else if (params.get('canceled') === '1') {
      setToast({ tone: 'info', message: 'El proceso de pago fue cancelado. No se realizó ningún cargo.' })
    }

    if (params.has('success') || params.has('canceled')) {
      window.history.replaceState({}, '', '/billing')
    }
  }, [fetchMe])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  const handleCheckout = async (plan: Exclude<PlanCode, 'free'>) => {
    setCheckoutPlan(plan)
    try {
      const { url } = await api.createCheckout(plan)
      window.location.href = url
    } catch (err) {
      setToast({
        tone: 'error',
        message: err instanceof Error ? err.message : 'No se pudo iniciar el pago.',
      })
      setCheckoutPlan(null)
    }
  }

  const handlePortal = async () => {
    setPortalLoading(true)
    try {
      const { url } = await api.createPortal()
      window.location.href = url
    } catch (err) {
      setToast({
        tone: 'error',
        message: err instanceof Error ? err.message : 'No se pudo abrir el portal de facturación.',
      })
      setPortalLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-surface text-typography-muted">
        <Loader2 size={18} className="animate-spin" />
        Cargando facturación…
      </div>
    )
  }

  if (loadError || !me) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
        <ShieldAlert size={28} className="text-red-500" />
        <p className="text-typography-muted">{loadError ?? 'No se pudo cargar tu plan.'}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true)
            void fetchMe()
          }}
          className="rounded-kura-md bg-primary px-4 py-2 font-medium text-white hover:bg-primary-hover"
        >
          Reintentar
        </button>
      </div>
    )
  }

  const currentPlan = me.user.plan
  const isTrialBase = currentPlan === 'trial' || currentPlan === 'expired'
  const hasActiveSubscription =
    me.subscription?.status === 'active' || me.subscription?.status === 'trialing'
  const quota = me.user.quota
  const used = me.user.used
  const usagePct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0
  const usageWarning = quota > 0 && usagePct >= 80

  return (
    <div className="min-h-screen bg-surface p-6 font-body text-typography md:p-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-kura-sm p-2 text-typography-muted transition-colors hover:bg-surface-card hover:text-primary"
              aria-label="Volver al dashboard"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="font-heading text-3xl font-semibold">Facturación</h1>
              <p className="text-typography-muted">
                Gestiona tu plan, tu cuota mensual y tu método de pago.
              </p>
            </div>
          </div>

          {hasActiveSubscription && (
            <button
              type="button"
              onClick={handlePortal}
              disabled={portalLoading}
              className="flex items-center gap-2 rounded-kura-md border border-primary px-4 py-2 font-medium text-primary transition-colors hover:bg-surface-card disabled:opacity-50"
            >
              {portalLoading ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
              Administrar suscripción
            </button>
          )}
        </header>

        {/* Resumen del plan y uso del periodo */}
        <section className="rounded-kura-lg bg-surface-card p-6 shadow-kura-soft md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-typography-muted">
                Plan actual
              </p>
              <div className="mt-2 flex items-center gap-3">
                <h2 className="font-heading text-2xl font-semibold">
                  {PLAN_LABELS[currentPlan]}
                </h2>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${BADGE_STYLES[currentPlan]}`}
                >
                  {currentPlan === 'expired' ? <ShieldAlert size={12} /> : <Check size={12} />}
                  {currentPlan === 'expired' ? 'Bloqueado' : 'Activo'}
                </span>
              </div>
              <p className="mt-2 text-sm text-typography-muted">
                {quota > 0 ? formatQuota(quota) : 'Sin cuota activa: actualiza tu plan para enviar.'}
              </p>
              {me.subscription?.cancelAtPeriodEnd && (
                <p className="mt-2 text-sm font-medium text-amber-700">
                  Tu suscripción se cancelará al final del periodo actual.
                </p>
              )}
            </div>

            <div className="min-w-[240px] flex-1 md:max-w-sm">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-typography-muted">
                  <Gauge size={15} /> Uso del mes
                </span>
                <span className={`font-medium ${usageWarning ? 'text-red-600' : 'text-primary'}`}>
                  {used.toLocaleString('es-CL')} / {quota.toLocaleString('es-CL')}
                </span>
              </div>
              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-surface">
                <div
                  className={`h-full rounded-full transition-all ${
                    usageWarning ? 'bg-red-500' : 'bg-primary'
                  }`}
                  style={{ width: `${usagePct}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-typography-muted">
                Periodo iniciado el {me.periodStart}. El contador se reinicia el día 1 de cada mes.
              </p>
            </div>
          </div>
        </section>

        {/* Tarjetas de planes */}
        <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {PLANS.map((plan) => {
            const isCurrent =
              currentPlan === plan.code || (plan.code === 'free' && isTrialBase)
            const isPaid = plan.code !== 'free'
            const showUpgrade =
              isPaid && currentPlan !== plan.code && currentPlan !== 'business'
            const isLoading = checkoutPlan === plan.code

            return (
              <article
                key={plan.code}
                className={`relative flex flex-col rounded-kura-lg border bg-surface-card p-6 shadow-kura-soft ${
                  isCurrent ? 'border-primary ring-1 ring-primary/20' : 'border-gray-100'
                }`}
              >
                {isCurrent && (
                  <span className="absolute right-4 top-4 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-white">
                    Plan actual
                  </span>
                )}

                <h3 className="font-heading text-xl font-semibold">{plan.name}</h3>
                <p className="mt-1 font-heading text-3xl font-semibold">
                  {formatPrice(plan.priceMonthlyCents)}
                </p>
                <p className="mt-2 text-sm text-typography-muted">{formatQuota(plan.monthlyEmailQuota)}</p>

                <ul className="mt-5 flex flex-1 flex-col gap-2 text-sm text-typography-muted">
                  <li className="flex items-center gap-2">
                    <Check size={15} className="text-primary" />
                    {plan.monthlyEmailQuota.toLocaleString('es-CL')} correos al mes
                  </li>
                  <li className="flex items-center gap-2">
                    <Check size={15} className="text-primary" />
                    Envío ilimitado de campañas
                  </li>
                  <li className="flex items-center gap-2">
                    <Check size={15} className="text-primary" />
                    Métricas y suppression list
                  </li>
                </ul>

                <div className="mt-6">
                  {showUpgrade ? (
                    <button
                      type="button"
                      onClick={() => handleCheckout(plan.code as Exclude<PlanCode, 'free'>)}
                      disabled={checkoutPlan !== null}
                      className="flex w-full items-center justify-center gap-2 rounded-kura-md bg-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isLoading ? <Loader2 size={16} className="animate-spin" /> : null}
                      Actualizar a {plan.name}
                    </button>
                  ) : (
                    <div
                      className={`w-full rounded-kura-md px-4 py-2.5 text-center text-sm font-medium ${
                        isCurrent ? 'bg-accent/30 text-primary' : 'bg-surface text-typography-muted'
                      }`}
                    >
                      {isCurrent ? 'Tu plan actual' : 'Incluido en tu plan'}
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </section>

        <p className="text-center text-xs text-typography-muted">
          Los pagos se procesan de forma segura con Stripe. Puedes cambiar de plan o cancelar en
          cualquier momento desde el portal de facturación.
        </p>
      </div>

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex max-w-sm items-start gap-2 rounded-kura-md border border-gray-100 bg-surface-card px-4 py-3 text-sm shadow-kura-soft">
          <span
            className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
              toast.tone === 'success'
                ? 'bg-primary'
                : toast.tone === 'error'
                  ? 'bg-red-500'
                  : 'bg-amber-500'
            }`}
          />
          <p className="flex-1">{toast.message}</p>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-typography-muted hover:text-typography"
            aria-label="Cerrar aviso"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
