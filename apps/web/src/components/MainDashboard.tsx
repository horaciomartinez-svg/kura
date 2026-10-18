'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import {
  Send,
  MailOpen,
  MousePointerClick,
  Timer,
  Pencil,
  CalendarX,
  Copy,
  CreditCard,
  Loader2,
  Plus,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react'
import type { CampaignStatus, TrialStatus } from '@kura/core'
import { api } from '@/lib/api'

export interface DashboardStats {
  totalSends: number
  openRate: number
  ctr: number
  bounceRate: number
  trial: TrialStatus
}

export interface CampaignRow {
  id: string
  name: string
  listName: string
  status: CampaignStatus
  date: string
  scheduledAt?: string | null
  engagement: number
}

function formatScheduledLocal(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatDateLocal(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export interface PerformancePoint {
  date: string
  opens: number
  clicks: number
}

interface MainDashboardProps {
  userName: string
  stats: DashboardStats
  performance: PerformancePoint[]
  onClone?: (campaignId: string) => void
}

export function MainDashboard({
  userName,
  stats,
  performance,
  onClone,
}: MainDashboardProps) {
  const router = useRouter()
  const { trial } = stats
  const showTrialBanner = trial.isTrial && trial.daysRemaining <= 3

  const [rows, setRows] = useState<CampaignRow[]>([])
  const [loadingCampaigns, setLoadingCampaigns] = useState(true)
  const [campaignsError, setCampaignsError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newCampaignName, setNewCampaignName] = useState('')
  const [newCampaignSubject, setNewCampaignSubject] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  const loadCampaigns = async () => {
    setLoadingCampaigns(true)
    setCampaignsError(null)

    try {
      const campaigns = await api.listCampaigns()
      setRows(
        campaigns.map((campaign) => ({
          id: campaign.id,
          name: campaign.name,
          listName: campaign.listName ?? 'Sin lista',
          status: campaign.status,
          date: formatDateLocal(campaign.createdAt),
          scheduledAt: campaign.scheduledAt,
          engagement: 0,
        }))
      )
    } catch (err) {
      setCampaignsError(
        err instanceof Error ? err.message : 'No se pudieron cargar las campañas.'
      )
    } finally {
      setLoadingCampaigns(false)
    }
  }

  useEffect(() => {
    void loadCampaigns()
  }, [])

  const openCreateDialog = () => {
    setNewCampaignName('')
    setNewCampaignSubject('')
    setCreateError(null)
    setCreateOpen(true)
  }

  const handleCreateCampaign = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const name = newCampaignName.trim()
    if (!name) {
      setCreateError('El nombre de la campaña es obligatorio.')
      return
    }

    setCreating(true)
    setCreateError(null)

    try {
      const campaign = await api.createCampaign({
        name,
        subject: newCampaignSubject.trim() || undefined,
      })
      setCreateOpen(false)
      router.push(`/builder?campaignId=${campaign.id}`)
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : 'No se pudo crear la campaña.'
      )
    } finally {
      setCreating(false)
    }
  }

  const handleCancelSchedule = async (campaignId: string) => {
    if (!window.confirm('¿Cancelar la programación de esta campaña?')) return

    setCancelingId(campaignId)
    setActionError(null)

    try {
      const { campaign } = await api.cancelCampaignSchedule(campaignId)
      setRows((current) =>
        current.map((row) =>
          row.id === campaignId
            ? {
                ...row,
                status: campaign.status,
                scheduledAt: null,
                date: '—',
              }
            : row
        )
      )
      router.refresh()
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'No se pudo cancelar la programación.'
      )
    } finally {
      setCancelingId(null)
    }
  }

  return (
    <div className="w-full min-h-screen bg-surface font-body text-typography">
      {/* Top Banner de aviso Trial */}
      {showTrialBanner && (
        <div className="w-full bg-[#111827] text-accent text-sm px-8 py-2.5 flex items-center gap-2">
          {trial.isLocked ? <ShieldAlert size={16} /> : <Timer size={16} />}
          {trial.isLocked ? (
            <span>Tu período de prueba finalizó. Actualiza a Pro para seguir enviando.</span>
          ) : (
            <span>
              Te quedan <strong>{trial.daysRemaining} días</strong> de prueba. Has usado{' '}
              {trial.sendsUsed}/{trial.sendsLimit} envíos.
            </span>
          )}
          <Link href="/billing" className="ml-auto font-medium underline text-accent-hover">
            Actualizar a Pro
          </Link>
        </div>
      )}

      <div className="p-8">
        {/* Header */}
        <header className="flex flex-wrap justify-between items-center gap-4 mb-8">
          <div>
            <h1 className="font-heading text-3xl font-semibold">Hola, {userName} 👋</h1>
            <p className="text-typography-muted">
              Aquí tienes el resumen de tu rendimiento en los últimos 30 días.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/contacts"
              className="flex items-center gap-2 border border-primary text-primary px-4 py-3 rounded-kura-md hover:bg-surface-card transition-colors font-medium"
            >
              <Users size={18} />
              Contactos
            </Link>
            <Link
              href="/billing"
              className="flex items-center gap-2 border border-primary text-primary px-4 py-3 rounded-kura-md hover:bg-surface-card transition-colors font-medium"
            >
              <CreditCard size={18} />
              Facturación
            </Link>
            <button
              type="button"
              onClick={openCreateDialog}
              className="flex items-center gap-2 bg-primary text-white px-6 py-3 rounded-kura-md hover:bg-primary-hover transition-colors font-medium shadow-kura-soft"
            >
              <Plus size={18} />
              Crear nueva campaña
            </button>
          </div>
        </header>

        {/* Nivel 1: KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
          <MetricCard
            title="ENVÍOS TOTALES"
            value={stats.totalSends.toLocaleString('es-ES')}
            icon={<Send size={18} />}
            trend="+12%"
          />
          <MetricCard
            title="TASA DE APERTURA"
            value={`${stats.openRate}%`}
            icon={<MailOpen size={18} />}
            trend="+2.4%"
          />
          <MetricCard
            title="TASA DE CLICS (CTR)"
            value={`${stats.ctr}%`}
            icon={<MousePointerClick size={18} />}
            trend="-0.5%"
            trendUp={false}
          />
          <TrialCard trial={trial} />
        </div>

        {/* Nivel 2: Analíticas */}
        <div className="bg-surface-card p-6 rounded-kura-lg shadow-kura-soft mb-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-heading text-lg font-medium">Rendimiento Histórico</h3>
            <div className="flex items-center gap-4 text-xs text-typography-muted">
              <Legend color="#014751" label="Aperturas" />
              <Legend color="#9CA3AF" label="Clics" />
            </div>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={performance} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorOpens" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#AFFECA" stopOpacity={0.9} />
                    <stop offset="95%" stopColor="#AFFECA" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#F1F3F7" />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#6B7280', fontSize: 12 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#6B7280', fontSize: 12 }}
                  width={48}
                />
                <Tooltip cursor={{ stroke: '#014751', strokeWidth: 1, strokeDasharray: '5 5' }} />
                <Area
                  type="monotone"
                  dataKey="opens"
                  name="Aperturas"
                  stroke="#014751"
                  fill="url(#colorOpens)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="clicks"
                  name="Clics"
                  stroke="#9CA3AF"
                  fill="transparent"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Nivel 3: Campañas Recientes */}
        <div className="bg-surface-card rounded-kura-lg shadow-kura-soft p-6">
          <h3 className="font-heading text-lg font-medium mb-4">Campañas Recientes</h3>
          {campaignsError && (
            <div className="mb-4 rounded-kura-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {campaignsError}
            </div>
          )}
          {actionError && (
            <div className="mb-4 rounded-kura-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {actionError}
            </div>
          )}
          {loadingCampaigns ? (
            <div className="flex items-center justify-center gap-2 py-16 text-typography-muted">
              <Loader2 size={18} className="animate-spin" />
              Cargando campañas…
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-typography-muted mb-4">
                Aún no tienes campañas. ¡Crea la primera!
              </p>
              <button
                type="button"
                onClick={openCreateDialog}
                className="inline-block border border-primary text-primary px-4 py-2 rounded-kura-md hover:bg-surface transition-colors"
              >
                Empezar ahora
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-typography-muted text-xs uppercase tracking-wider border-b border-gray-100">
                    <th className="pb-3 pr-4 font-medium">Campaña</th>
                    <th className="pb-3 pr-4 font-medium">Lista</th>
                    <th className="pb-3 pr-4 font-medium">Estado</th>
                    <th className="pb-3 pr-4 font-medium">Fecha</th>
                    <th className="pb-3 pr-4 font-medium">Engagement</th>
                    <th className="pb-3 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((campaign) => (
                    <tr
                      key={campaign.id}
                      className="border-b border-gray-50 hover:bg-surface transition-colors"
                    >
                      <td className="py-4 pr-4 font-medium">{campaign.name}</td>
                      <td className="py-4 pr-4 text-typography-muted text-sm">{campaign.listName}</td>
                      <td className="py-4 pr-4">
                        <StatusBadge status={campaign.status} />
                        {campaign.status === 'scheduled' && campaign.scheduledAt && (
                          <span className="mt-1 block text-[11px] text-typography-muted">
                            {formatScheduledLocal(campaign.scheduledAt)}
                          </span>
                        )}
                      </td>
                      <td className="py-4 pr-4 text-typography-muted text-sm whitespace-nowrap">
                        {campaign.status === 'scheduled' && campaign.scheduledAt
                          ? formatScheduledLocal(campaign.scheduledAt)
                          : campaign.date}
                      </td>
                      <td className="py-4 pr-4">
                        <EngagementBar value={campaign.engagement} />
                      </td>
                      <td className="py-4">
                        <div className="flex items-center justify-end gap-1">
                          {campaign.status === 'scheduled' && (
                            <ActionButton
                              title="Cancelar programación"
                              onClick={() => handleCancelSchedule(campaign.id)}
                              icon={
                                cancelingId === campaign.id ? (
                                  <Loader2 size={15} className="animate-spin" />
                                ) : (
                                  <CalendarX size={15} />
                                )
                              }
                            />
                          )}
                          <ActionButton
                            title="Editar campaña"
                            onClick={() => router.push(`/builder?campaignId=${campaign.id}`)}
                            icon={<Pencil size={15} />}
                          />
                          <ActionButton
                            title="Clonar campaña"
                            onClick={() => onClone?.(campaign.id)}
                            icon={<Copy size={15} />}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div
            className="w-full max-w-md rounded-kura-lg bg-surface-card p-6 shadow-kura-soft"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-campaign-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-kura-sm bg-accent/30 text-primary">
                  <Plus size={18} />
                </span>
                <div>
                  <h2 id="create-campaign-title" className="font-heading text-lg font-semibold">
                    Nueva campaña
                  </h2>
                  <p className="text-xs text-typography-muted">
                    Crea un borrador y continúa en el editor.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="text-typography-muted hover:text-typography"
                aria-label="Cerrar"
              >
                <X size={17} />
              </button>
            </div>

            <form onSubmit={handleCreateCampaign} className="mt-5 flex flex-col gap-4">
              <div>
                <label
                  htmlFor="campaign-name"
                  className="mb-1.5 block text-sm font-medium text-typography"
                >
                  Nombre de la campaña
                </label>
                <input
                  id="campaign-name"
                  type="text"
                  value={newCampaignName}
                  onChange={(event) => setNewCampaignName(event.target.value)}
                  placeholder="Ej. Newsletter de noviembre"
                  maxLength={255}
                  autoFocus
                  className="w-full rounded-kura-md border border-gray-200 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
                />
              </div>

              <div>
                <label
                  htmlFor="campaign-subject"
                  className="mb-1.5 block text-sm font-medium text-typography"
                >
                  Asunto <span className="text-typography-muted">(opcional)</span>
                </label>
                <input
                  id="campaign-subject"
                  type="text"
                  value={newCampaignSubject}
                  onChange={(event) => setNewCampaignSubject(event.target.value)}
                  placeholder="Ej. Novedades de este mes"
                  maxLength={255}
                  className="w-full rounded-kura-md border border-gray-200 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
                />
              </div>

              {createError && (
                <div className="rounded-kura-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {createError}
                </div>
              )}

              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  disabled={creating}
                  className="rounded-kura-md border border-gray-200 px-4 py-2 text-sm font-medium hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating || !newCampaignName.trim()}
                  className="flex items-center gap-2 rounded-kura-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  Crear y editar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({
  title,
  value,
  icon,
  trend,
  trendUp = true,
}: {
  title: string
  value: string | number
  icon: React.ReactNode
  trend?: string
  trendUp?: boolean
}) {
  return (
    <div className="bg-surface-card p-6 rounded-kura-md shadow-kura-soft flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-typography-muted tracking-wider">{title}</span>
        <span className="h-9 w-9 flex items-center justify-center rounded-kura-sm bg-surface text-primary">
          {icon}
        </span>
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="font-heading text-3xl font-semibold">{value}</span>
        {trend && (
          <span className={`text-sm font-medium ${trendUp ? 'text-primary' : 'text-amber-600'}`}>
            {trend}
          </span>
        )}
      </div>
    </div>
  )
}

function TrialCard({ trial }: { trial: TrialStatus }) {
  const { isTrial, daysRemaining, sendsUsed, sendsLimit, isLocked } = trial
  const pctUsed = Math.min(100, Math.round((sendsUsed / sendsLimit) * 100))
  const warning = isLocked || pctUsed >= 80

  return (
    <div className="bg-surface-card p-6 rounded-kura-md shadow-kura-soft flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-typography-muted tracking-wider">
          {isTrial ? 'PERÍODO DE PRUEBA' : 'PLAN PRO'}
        </span>
        <span
          className={`h-9 w-9 flex items-center justify-center rounded-kura-sm ${
            warning ? 'bg-red-50 text-red-600' : 'bg-accent/40 text-primary'
          }`}
        >
          {isLocked ? <ShieldAlert size={18} /> : <Timer size={18} />}
        </span>
      </div>
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="font-heading text-3xl font-semibold">
            {sendsUsed}
            <span className="text-base font-normal text-typography-muted">/{sendsLimit}</span>
          </span>
          <span className={`text-xs font-medium ${warning ? 'text-red-600' : 'text-primary'}`}>
            {isLocked ? 'Bloqueado' : `${daysRemaining} días restantes`}
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-surface overflow-hidden">
          <div
            className={`h-full rounded-full ${warning ? 'bg-red-500' : 'bg-primary'}`}
            style={{ width: `${pctUsed}%` }}
          />
        </div>
        <p className="text-xs text-typography-muted mt-2">Envíos usados durante la prueba</p>
      </div>
    </div>
  )
}

const STATUS_STYLES: Record<CampaignStatus, { label: string; className: string }> = {
  draft: { label: 'Borrador', className: 'bg-gray-100 text-gray-600' },
  scheduled: { label: 'Programada', className: 'bg-blue-50 text-blue-600' },
  preparing: { label: 'Preparando', className: 'bg-amber-50 text-amber-700' },
  sending: { label: 'Enviando', className: 'bg-amber-50 text-amber-700' },
  sent: { label: 'Enviada', className: 'bg-accent/40 text-primary' },
  paused_trial_expired: { label: 'Pausada (Trial)', className: 'bg-red-50 text-red-600' },
  failed: { label: 'Fallida', className: 'bg-red-50 text-red-600' },
  canceled: { label: 'Cancelada', className: 'bg-gray-100 text-gray-600' },
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  const { label, className } = STATUS_STYLES[status]
  const pulsing = status === 'sending' || status === 'preparing'

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${className}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full bg-current ${pulsing ? 'animate-pulse' : ''}`}
      />
      {label}
    </span>
  )
}

function EngagementBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="h-1.5 w-20 rounded-full bg-surface overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-medium text-typography-muted">{value}%</span>
    </div>
  )
}

function ActionButton({
  title,
  onClick,
  icon,
}: {
  title: string
  onClick: () => void
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="p-2 rounded-kura-sm text-typography-muted hover:text-primary hover:bg-surface transition-colors"
    >
      {icon}
    </button>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}
