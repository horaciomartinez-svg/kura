import { MainDashboard } from '@/components/MainDashboard'
import type { CampaignRow, DashboardStats, PerformancePoint } from '@/components/MainDashboard'

const stats: DashboardStats = {
  totalSends: 48210,
  openRate: 42.6,
  ctr: 6.8,
  bounceRate: 1.4,
  trial: {
    isTrial: true,
    daysRemaining: 3,
    sendsUsed: 38,
    sendsLimit: 50,
    isLocked: false,
  },
}

const performance: PerformancePoint[] = [
  { date: '01 Oct', opens: 400, clicks: 24 },
  { date: '05 Oct', opens: 320, clicks: 18 },
  { date: '09 Oct', opens: 480, clicks: 32 },
  { date: '13 Oct', opens: 430, clicks: 28 },
  { date: '17 Oct', opens: 560, clicks: 45 },
  { date: '21 Oct', opens: 610, clicks: 52 },
  { date: '25 Oct', opens: 540, clicks: 41 },
  { date: '29 Oct', opens: 680, clicks: 58 },
]

const campaigns: CampaignRow[] = [
  {
    id: 'cmp-12345',
    name: 'Lanzamiento Otoño',
    listName: 'Suscriptores Newsletter',
    status: 'sent',
    date: '29 Oct 2026',
    engagement: 68,
  },
  {
    id: 'cmp-12346',
    name: 'Oferta Black Friday',
    listName: 'Clientes VIP',
    status: 'sending',
    date: '30 Oct 2026',
    engagement: 41,
  },
  {
    id: 'cmp-12347',
    name: 'Recordatorio Webinar',
    listName: 'Leads Q4',
    status: 'scheduled',
    date: '02 Nov 2026',
    engagement: 0,
  },
  {
    id: 'cmp-12348',
    name: 'Bienvenida nuevos usuarios',
    listName: 'Onboarding',
    status: 'draft',
    date: '—',
    engagement: 0,
  },
  {
    id: 'cmp-12349',
    name: 'Campaña pausada',
    listName: 'Suscriptores Newsletter',
    status: 'paused_trial_expired',
    date: '20 Oct 2026',
    engagement: 33,
  },
]

export default function DashboardPage() {
  return (
    <MainDashboard userName="Equipo KURA" stats={stats} campaigns={campaigns} performance={performance} />
  )
}
