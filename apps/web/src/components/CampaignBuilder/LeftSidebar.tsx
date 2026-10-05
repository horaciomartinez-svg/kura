'use client'

import React from 'react'
import {
  Type,
  Image as ImageIcon,
  MousePointerClick,
  Minus,
  LayoutGrid,
  Pencil,
} from 'lucide-react'
import type { BlockType, CampaignBlock } from '@kura/core'
import { useCampaignBuilderStore } from '@/store/useCampaignBuilderStore'
import { BLOCK_PALETTE, createBlock } from './constants'

const PALETTE_ICONS: Record<BlockType, React.ReactNode> = {
  text: <Type size={18} />,
  image: <ImageIcon size={18} />,
  button: <MousePointerClick size={18} />,
  divider: <Minus size={18} />,
}

export function LeftSidebar() {
  const tab = useCampaignBuilderStore((s) => s.sidebarTab)
  const setTab = useCampaignBuilderStore((s) => s.setSidebarTab)
  const addBlock = useCampaignBuilderStore((s) => s.addBlock)
  const backgroundColor = useCampaignBuilderStore((s) => s.design.backgroundColor)
  const contentWidth = useCampaignBuilderStore((s) => s.design.contentWidth)
  const updateDesign = useCampaignBuilderStore((s) => s.updateDesign)
  const selectedBlockId = useCampaignBuilderStore((s) => s.selectedBlockId)
  const selectedBlock = useCampaignBuilderStore((s) =>
    s.design.blocks.find((b) => b.id === s.selectedBlockId) ?? null
  )

  const handleDragStart = (event: React.DragEvent, type: BlockType) => {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('application/json', JSON.stringify({ source: 'palette', type }))
  }

  return (
    <aside className="w-[300px] shrink-0 border-r border-gray-100 bg-surface-card flex flex-col">
      <div className="flex border-b border-gray-100">
        <TabButton active={tab === 'blocks'} onClick={() => setTab('blocks')} icon={<LayoutGrid size={16} />}>
          Bloques
        </TabButton>
        <TabButton active={tab === 'edit'} onClick={() => setTab('edit')} icon={<Pencil size={16} />}>
          Editar
        </TabButton>
      </div>

      <div className="p-4 overflow-y-auto flex-1">
        {tab === 'blocks' ? (
          <>
            <p className="text-xs text-typography-muted mb-3">
              Arrastra un bloque al lienzo o haz clic para agregarlo.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {BLOCK_PALETTE.map(({ type, label }) => (
                <button
                  key={type}
                  draggable
                  onDragStart={(e) => handleDragStart(e, type)}
                  onClick={() => addBlock(createBlock(type))}
                  className="flex flex-col items-center gap-2 border border-dashed border-accent rounded-kura-md py-4 text-xs font-medium text-typography hover:bg-accent/20 transition-colors cursor-grab active:cursor-grabbing"
                >
                  <span className="text-primary">{PALETTE_ICONS[type]}</span>
                  {label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <StylePanel
            backgroundColor={backgroundColor}
            contentWidth={contentWidth}
            updateDesign={updateDesign}
            selectedBlock={selectedBlock}
            selectedBlockId={selectedBlockId}
          />
        )}
      </div>
    </aside>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
        active
          ? 'text-primary border-b-2 border-primary'
          : 'text-typography-muted hover:text-typography'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

function StylePanel({
  backgroundColor,
  contentWidth,
  updateDesign,
  selectedBlock,
  selectedBlockId,
}: {
  backgroundColor: string
  contentWidth: string
  updateDesign: (patch: { backgroundColor?: string; contentWidth?: string }) => void
  selectedBlock: CampaignBlock | null
  selectedBlockId: string | null
}) {
  const updateBlock = useCampaignBuilderStore((s) => s.updateBlock)

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="text-sm font-medium mb-3">Estilos generales</h3>
        <Field label="Color de fondo">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={backgroundColor}
              onChange={(e) => updateDesign({ backgroundColor: e.target.value })}
              className="h-9 w-10 rounded-kura-sm border border-gray-200 bg-white p-0.5"
            />
            <input
              type="text"
              value={backgroundColor}
              onChange={(e) => updateDesign({ backgroundColor: e.target.value })}
              className="flex-1 rounded-kura-sm border border-gray-200 px-3 py-1.5 font-mono text-xs"
            />
          </div>
        </Field>
        <Field label="Ancho del contenido">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={480}
              max={720}
              step={10}
              value={parseInt(contentWidth, 10) || 600}
              onChange={(e) => updateDesign({ contentWidth: `${e.target.value}px` })}
              className="flex-1 accent-primary"
            />
            <span className="w-14 text-right font-mono text-xs text-typography-muted">
              {contentWidth}
            </span>
          </div>
        </Field>
      </section>

      <section className="border-t border-gray-100 pt-5">
        <h3 className="text-sm font-medium mb-3">
          {selectedBlock ? `Editar: ${selectedBlock.type}` : 'Bloque seleccionado'}
        </h3>
        {!selectedBlock ? (
          <p className="text-xs text-typography-muted">
            Selecciona un bloque en el lienzo para editar sus propiedades.
          </p>
        ) : (
          <BlockProperties
            key={selectedBlockId}
            block={selectedBlock}
            onChange={(properties) => updateBlock(selectedBlock.id, properties)}
          />
        )}
      </section>
    </div>
  )
}

function BlockProperties({
  block,
  onChange,
}: {
  block: CampaignBlock
  onChange: (properties: Record<string, any>) => void
}) {
  const p = block.properties

  switch (block.type) {
    case 'text':
      return (
        <>
          <Field label="Texto">
            <textarea
              value={p.text ?? ''}
              onChange={(e) => onChange({ text: e.target.value })}
              rows={4}
              className="w-full rounded-kura-sm border border-gray-200 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Tamaño (px)">
            <input
              type="number"
              min={10}
              max={72}
              value={p.fontSize ?? 16}
              onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
              className="w-full rounded-kura-sm border border-gray-200 px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label="Alineación">
            <AlignSelect value={p.align} onChange={(align) => onChange({ align })} />
          </Field>
          <Field label="Color">
            <ColorInput value={p.color} onChange={(color) => onChange({ color })} />
          </Field>
        </>
      )

    case 'image':
      return (
        <>
          <Field label="URL de la imagen">
            <input
              type="text"
              value={p.src ?? ''}
              onChange={(e) => onChange({ src: e.target.value })}
              className="w-full rounded-kura-sm border border-gray-200 px-3 py-1.5 text-xs font-mono"
            />
          </Field>
          <Field label="Texto alternativo">
            <input
              type="text"
              value={p.alt ?? ''}
              onChange={(e) => onChange({ alt: e.target.value })}
              className="w-full rounded-kura-sm border border-gray-200 px-3 py-1.5 text-sm"
            />
          </Field>
        </>
      )

    case 'button':
      return (
        <>
          <Field label="Etiqueta">
            <input
              type="text"
              value={p.text ?? ''}
              onChange={(e) => onChange({ text: e.target.value })}
              className="w-full rounded-kura-sm border border-gray-200 px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label="Enlace (URL)">
            <input
              type="text"
              value={p.url ?? ''}
              onChange={(e) => onChange({ url: e.target.value })}
              className="w-full rounded-kura-sm border border-gray-200 px-3 py-1.5 text-xs font-mono"
            />
          </Field>
          <Field label="Color de fondo">
            <ColorInput
              value={p.backgroundColor}
              onChange={(backgroundColor) => onChange({ backgroundColor })}
            />
          </Field>
          <Field label="Color del texto">
            <ColorInput value={p.textColor} onChange={(textColor) => onChange({ textColor })} />
          </Field>
          <Field label="Alineación">
            <AlignSelect value={p.align} onChange={(align) => onChange({ align })} />
          </Field>
        </>
      )

    case 'divider':
      return (
        <>
          <Field label="Color">
            <ColorInput value={p.color} onChange={(color) => onChange({ color })} />
          </Field>
          <Field label="Grosor (px)">
            <input
              type="number"
              min={1}
              max={10}
              value={p.thickness ?? 1}
              onChange={(e) => onChange({ thickness: Number(e.target.value) })}
              className="w-full rounded-kura-sm border border-gray-200 px-3 py-1.5 text-sm"
            />
          </Field>
        </>
      )

    default:
      return null
  }
}

function AlignSelect({
  value,
  onChange,
}: {
  value?: string
  onChange: (value: string) => void
}) {
  return (
    <select
      value={value ?? 'left'}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-kura-sm border border-gray-200 px-3 py-1.5 text-sm"
    >
      <option value="left">Izquierda</option>
      <option value="center">Centro</option>
      <option value="right">Derecha</option>
    </select>
  )
}

function ColorInput({ value, onChange }: { value?: string; onChange: (value: string) => void }) {
  const current = value ?? '#111827'
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-10 rounded-kura-sm border border-gray-200 bg-white p-0.5"
      />
      <input
        type="text"
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded-kura-sm border border-gray-200 px-3 py-1.5 font-mono text-xs"
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-typography-muted mb-1">{label}</span>
      {children}
    </label>
  )
}
