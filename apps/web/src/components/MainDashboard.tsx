'use client'

import React from 'react'
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
  Copy,
  Plus,
  ShieldAlert,
} from 'lucide-react'
import type { TrialStatus } from '@kura/core'

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'preparing'
  | 'sending'
  | 'sent'
  | 'paused_trial_expired'

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
  engagement: number
}

export interface PerformancePoint {
  date: string
  opens: number
  clicks: number
}

interface MainDashboardProps {
  userName: string
  stats: DashboardStats
  campaigns: CampaignRow[]
  performance: PerformancePoint[]
  onClone?: (campaignId: string) => void
}

export function MainDashboard({
  userName,
  stats,
  campaigns,
  performance,
  onClone,
}: MainDashboardProps) {
  const router = useRouter()
  const { trial } = stats
  const showTrialBanner = trial.isTrial && trial.daysRemaining <= 3

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
          <Link href="/settings/billing" className="ml-auto font-medium underline text-accent-hover">
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
          <Link
            href="/builder"
            className="flex items-center gap-2 bg-primary text-white px-6 py-3 rounded-kura-md hover:bg-primary-hover transition-colors font-medium shadow-kura-soft"
          >
            <Plus size={18} />
            Crear nueva campaña
          </Link>
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
          {campaigns.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-typography-muted mb-4">
                Aún no has enviado ninguna campaña. ¡Rompe el hielo!
              </p>
              <Link
                href="/builder"
                className="inline-block border border-primary text-primary px-4 py-2 rounded-kura-md hover:bg-surface transition-colors"
              >
                Empezar ahora
              </Link>
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
                  {campaigns.map((campaign) => (
                    <tr
                      key={campaign.id}
                      className="border-b border-gray-50 hover:bg-surface transition-colors"
                    >
                      <td className="py-4 pr-4 font-medium">{campaign.name}</td>
                      <td className="py-4 pr-4 text-typography-muted text-sm">{campaign.listName}</td>
                      <td className="py-4 pr-4">
                        <StatusBadge status={campaign.status} />
                      </td>
                      <td className="py-4 pr-4 text-typography-muted text-sm whitespace-nowrap">
                        {campaign.date}
                      </td>
                      <td className="py-4 pr-4">
                        <EngagementBar value={campaign.engagement} />
                      </td>
                      <td className="py-4">
                        <div className="flex items-center justify-end gap-1">
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
