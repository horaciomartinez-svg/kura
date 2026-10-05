'use client'

import { useEffect } from 'react'
import { CampaignBuilder } from '@/components/CampaignBuilder'
import { useCampaignBuilderStore } from '@/store/useCampaignBuilderStore'

export default function BuilderPage() {
  const setCampaignId = useCampaignBuilderStore((s) => s.setCampaignId)

  useEffect(() => {
    // En producción el id proviene del route param /campaigns/[id]/edit.
    setCampaignId('cmp-12345')
  }, [setCampaignId])

  return <CampaignBuilder />
}
