import { MainDashboard } from '@/components/MainDashboard'
import type { DashboardStats, PerformancePoint } from '@/components/MainDashboard'

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

export default function DashboardPage() {
  return <MainDashboard userName="Equipo KURA" stats={stats} performance={performance} />
}
