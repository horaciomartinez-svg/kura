'use client'

import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'

// Easy-Email usa APIs del navegador (window) al importarse: se carga solo en
// cliente para evitar errores durante el prerenderizado de Next.js.
const CampaignBuilder = dynamic(
  () => import('@/components/CampaignBuilder').then((mod) => mod.CampaignBuilder),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center text-typography-muted">
        Cargando editor…
      </div>
    ),
  }
)

function BuilderPageContent() {
  const searchParams = useSearchParams()
  const campaignId = searchParams.get('campaignId')

  if (!campaignId) {
    return (
      <div className="flex h-screen items-center justify-center px-6 text-center">
        <p className="text-typography-muted">
          Falta el parámetro{' '}
          <code className="rounded-kura-sm bg-surface-card px-1.5 py-0.5 font-mono text-sm">
            campaignId
          </code>{' '}
          en la URL.
        </p>
      </div>
    )
  }

  return <CampaignBuilder campaignId={campaignId} />
}

export default function BuilderPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center text-typography-muted">
          Cargando editor…
        </div>
      }
    >
      <BuilderPageContent />
    </Suspense>
  )
}
