'use client'

import React, { useEffect, useRef } from 'react'
import type { CampaignBlock } from '@kura/core'

interface BlockRendererProps {
  block: CampaignBlock
  editable?: boolean
  onChange?: (properties: Record<string, any>) => void
}

export function BlockRenderer({ block, editable = false, onChange }: BlockRendererProps) {
  const { properties: p } = block
  const update = onChange ?? (() => {})

  switch (block.type) {
    case 'text': {
      const style: React.CSSProperties = {
        fontSize: `${p.fontSize ?? 16}px`,
        textAlign: p.align ?? 'left',
        color: p.color ?? '#111827',
        lineHeight: p.lineHeight ?? 1.6,
      }

      if (editable) {
        return (
          <EditableContent
            as="p"
            multiline
            value={p.text ?? ''}
            onCommit={(text) => update({ text })}
            style={style}
          />
        )
      }

      return <p style={style}>{p.text}</p>
    }

    case 'image':
      // eslint-disable-next-line @next/next/no-img-element
      return (
        <img
          src={p.src}
          alt={p.alt ?? ''}
          style={{ width: p.width ?? '100%' }}
          className="rounded-kura-sm block mx-auto"
        />
      )

    case 'button': {
      const buttonStyle: React.CSSProperties = {
        backgroundColor: p.backgroundColor ?? '#014751',
        color: p.textColor ?? '#FFFFFF',
      }

      if (editable) {
        return (
          <div style={{ textAlign: p.align ?? 'center' }}>
            <EditableContent
              value={p.text ?? ''}
              onCommit={(text) => update({ text })}
              style={buttonStyle}
              className="inline-block px-6 py-3 rounded-kura-md font-medium"
            />
          </div>
        )
      }

      return (
        <div style={{ textAlign: p.align ?? 'center' }}>
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            style={buttonStyle}
            className="inline-block px-6 py-3 rounded-kura-md font-medium"
          >
            {p.text}
          </a>
        </div>
      )
    }

    case 'divider':
      return (
        <hr
          style={{
            borderColor: p.color ?? '#E5E7EB',
            borderTopWidth: `${p.thickness ?? 1}px`,
            width: p.width ?? '100%',
          }}
          className="border-t mx-auto"
        />
      )

    default:
      return null
  }
}

interface EditableContentProps {
  as?: React.ElementType
  value: string
  onCommit: (value: string) => void
  style?: React.CSSProperties
  className?: string
  multiline?: boolean
}

function EditableContent({
  as: Tag = 'span',
  value,
  onCommit,
  style,
  className,
  multiline = false,
}: EditableContentProps) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el && el.innerText !== value) el.innerText = value
  }, [value])

  return (
    <Tag
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      tabIndex={0}
      onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
        if (!multiline && e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      onBlur={(e: React.FocusEvent<HTMLElement>) => {
        const text = e.currentTarget.innerText.replace(/\u00a0/g, ' ')
        if (text !== value) onCommit(text)
      }}
      style={style}
      className={`outline-none rounded-kura-sm focus:ring-2 focus:ring-accent/60 cursor-text ${className ?? ''}`}
    />
  )
}
