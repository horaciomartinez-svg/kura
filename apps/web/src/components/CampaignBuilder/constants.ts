import type { BlockType, CampaignBlock } from '@kura/core'

export const BLOCK_PALETTE: { type: BlockType; label: string }[] = [
  { type: 'text', label: 'Texto' },
  { type: 'image', label: 'Imagen' },
  { type: 'button', label: 'Botón' },
  { type: 'divider', label: 'Divisor' },
]

export const BLOCK_LABELS: Record<BlockType, string> = {
  text: 'Texto',
  image: 'Imagen',
  button: 'Botón',
  divider: 'Divisor',
}

export const DEFAULT_PROPERTIES: Record<BlockType, Record<string, any>> = {
  text: {
    text: 'Escribe aquí tu mensaje…',
    fontSize: 16,
    align: 'left',
    color: '#111827',
    lineHeight: 1.6,
  },
  image: {
    src: 'https://placehold.co/600x300/AFFECA/014751?text=KURA',
    alt: 'Imagen de la campaña',
    width: '100%',
  },
  button: {
    text: 'Haz clic aquí',
    url: 'https://example.com',
    backgroundColor: '#014751',
    textColor: '#FFFFFF',
    align: 'center',
  },
  divider: {
    color: '#E5E7EB',
    thickness: 1,
    width: '100%',
  },
}

export function createBlock(type: BlockType): CampaignBlock {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? `${type}-${crypto.randomUUID()}`
      : `${type}-${Math.random().toString(36).slice(2, 10)}`

  return { id, type, properties: { ...DEFAULT_PROPERTIES[type] } }
}
