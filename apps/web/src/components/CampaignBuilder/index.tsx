'use client'

import React from 'react'
import { TopBar } from './TopBar'
import { LeftSidebar } from './LeftSidebar'
import { Canvas } from './Canvas'

export function CampaignBuilder() {
  return (
    <div className="h-screen flex flex-col bg-surface font-body text-typography overflow-hidden">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <LeftSidebar />
        <Canvas />
      </div>
    </div>
  )
}
