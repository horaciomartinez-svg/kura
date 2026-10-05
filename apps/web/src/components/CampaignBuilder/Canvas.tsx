'use client'

import React, { useState } from 'react'
import { GripVertical, Trash2 } from 'lucide-react'
import type { BlockType } from '@kura/core'
import { useCampaignBuilderStore } from '@/store/useCampaignBuilderStore'
import { BlockRenderer } from './BlockRenderer'
import { createBlock } from './constants'

type DragPayload = { source: 'palette'; type: BlockType } | { source: 'canvas'; index: number }

function parseDrag(event: React.DragEvent): DragPayload | null {
  try {
    const raw = event.dataTransfer.getData('application/json')
    if (!raw) return null
    return JSON.parse(raw) as DragPayload
  } catch {
    return null
  }
}

export function Canvas() {
  const blocks = useCampaignBuilderStore((s) => s.design.blocks)
  const backgroundColor = useCampaignBuilderStore((s) => s.design.backgroundColor)
  const contentWidth = useCampaignBuilderStore((s) => s.design.contentWidth)
  const selectedBlockId = useCampaignBuilderStore((s) => s.selectedBlockId)
  const selectBlock = useCampaignBuilderStore((s) => s.selectBlock)
  const updateBlock = useCampaignBuilderStore((s) => s.updateBlock)
  const removeBlock = useCampaignBuilderStore((s) => s.removeBlock)
  const addBlock = useCampaignBuilderStore((s) => s.addBlock)
  const moveBlock = useCampaignBuilderStore((s) => s.moveBlock)

  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    const payload = parseDrag(event)
    const target = dropIndex ?? blocks.length
    setDropIndex(null)

    if (!payload) return
    if (payload.source === 'palette') {
      addBlock(createBlock(payload.type), target)
    } else {
      moveBlock(payload.index, target)
    }
  }

  return (
    <main className="flex-1 overflow-y-auto flex justify-center py-10 px-6">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (dropIndex === null) setDropIndex(blocks.length)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDropIndex(null)
        }}
        onDrop={handleDrop}
        style={{ backgroundColor, maxWidth: contentWidth }}
        className={`w-full self-start min-h-[560px] rounded-kura-lg shadow-kura-soft p-6 flex flex-col gap-1 border-2 border-dashed transition-colors ${
          dropIndex !== null ? 'border-accent' : 'border-transparent'
        }`}
      >
        {blocks.length === 0 ? (
          <div className="m-auto text-center py-16">
            <p className="text-typography-muted text-sm">
              Arrastra un bloque desde el panel izquierdo.
            </p>
            <p className="text-typography-muted text-xs mt-1">
              El lienzo usa bordes punteados <span className="text-primary">#AFFECA</span> al arrastrar.
            </p>
          </div>
        ) : (
          blocks.map((block, index) => {
            const isSelected = selectedBlockId === block.id
            return (
              <React.Fragment key={block.id}>
                <DropIndicator visible={dropIndex === index} />
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const rect = e.currentTarget.getBoundingClientRect()
                    const before = e.clientY < rect.top + rect.height / 2
                    setDropIndex(before ? index : index + 1)
                  }}
                  onDrop={(e) => {
                    e.stopPropagation()
                    handleDrop(e)
                  }}
                  onClick={() => selectBlock(block.id)}
                  className={`group relative flex items-center gap-2 rounded-kura-md p-2 border-2 transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/[0.03]'
                      : 'border-transparent hover:border-accent'
                  }`}
                >
                  <span
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData(
                        'application/json',
                        JSON.stringify({ source: 'canvas', index })
                      )
                    }}
                    title="Arrastrar para reordenar"
                    className={`self-stretch flex items-center text-typography-muted cursor-grab active:cursor-grabbing transition-opacity ${
                      isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <GripVertical size={16} />
                  </span>
                  <div className="flex-1 min-w-0 py-1">
                    <BlockRenderer
                      block={block}
                      editable={isSelected}
                      onChange={(properties) => updateBlock(block.id, properties)}
                    />
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeBlock(block.id)
                    }}
                    title="Eliminar bloque"
                    className={`self-start p-1.5 rounded-kura-sm text-typography-muted hover:text-red-600 hover:bg-gray-100 transition ${
                      isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </React.Fragment>
            )
          })
        )}
        {blocks.length > 0 && <DropIndicator visible={dropIndex === blocks.length} />}
      </div>
    </main>
  )
}

function DropIndicator({ visible }: { visible: boolean }) {
  return (
    <div
      className={`h-0.5 rounded-full transition-all ${
        visible ? 'bg-accent my-1' : 'bg-transparent'
      }`}
    />
  )
}
