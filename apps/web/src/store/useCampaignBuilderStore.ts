import { create } from 'zustand'
import type { CampaignBlock } from '@kura/core'
import { api } from '@/lib/api'

export type SidebarTab = 'blocks' | 'edit'

interface DesignSettings {
  backgroundColor: string
  contentWidth: string
}

interface CampaignState {
  campaignId: string | null
  isDirty: boolean
  selectedBlockId: string | null
  sidebarTab: SidebarTab
  design: {
    backgroundColor: string
    contentWidth: string
    blocks: CampaignBlock[]
  }
  setCampaignId: (id: string) => void
  selectBlock: (id: string | null) => void
  setSidebarTab: (tab: SidebarTab) => void
  updateDesign: (patch: Partial<DesignSettings>) => void
  addBlock: (block: CampaignBlock, index?: number) => void
  updateBlock: (id: string, properties: Record<string, any>) => void
  removeBlock: (id: string) => void
  moveBlock: (from: number, to: number) => void
  saveDesign: () => Promise<void>
}

export const useCampaignBuilderStore = create<CampaignState>((set, get) => ({
  campaignId: null,
  isDirty: false,
  selectedBlockId: null,
  sidebarTab: 'blocks',
  design: {
    backgroundColor: '#F7F9FC',
    contentWidth: '600px',
    blocks: [],
  },

  setCampaignId: (id) => set({ campaignId: id }),

  selectBlock: (id) =>
    set((state) => ({
      selectedBlockId: id,
      // Al seleccionar un bloque del lienzo, abrimos la pestaña de edición.
      sidebarTab: id ? 'edit' : state.sidebarTab,
    })),

  setSidebarTab: (tab) => set({ sidebarTab: tab }),

  updateDesign: (patch) =>
    set((state) => ({
      design: { ...state.design, ...patch },
      isDirty: true,
    })),

  addBlock: (block, index) =>
    set((state) => {
      const newBlocks = [...state.design.blocks]
      if (index !== undefined) newBlocks.splice(index, 0, block)
      else newBlocks.push(block)
      return {
        design: { ...state.design, blocks: newBlocks },
        isDirty: true,
        selectedBlockId: block.id,
      }
    }),

  updateBlock: (id, properties) =>
    set((state) => ({
      design: {
        ...state.design,
        blocks: state.design.blocks.map((b) =>
          b.id === id ? { ...b, properties: { ...b.properties, ...properties } } : b
        ),
      },
      isDirty: true,
    })),

  removeBlock: (id) =>
    set((state) => ({
      design: { ...state.design, blocks: state.design.blocks.filter((b) => b.id !== id) },
      isDirty: true,
      selectedBlockId: state.selectedBlockId === id ? null : state.selectedBlockId,
    })),

  moveBlock: (from, to) =>
    set((state) => {
      const blocks = [...state.design.blocks]
      if (from < 0 || from >= blocks.length) return state
      const [moved] = blocks.splice(from, 1)
      const target = to > from ? to - 1 : to
      const clamped = Math.max(0, Math.min(target, blocks.length))
      blocks.splice(clamped, 0, moved)
      return { design: { ...state.design, blocks }, isDirty: true }
    }),

  saveDesign: async () => {
    const { campaignId, design } = get()
    if (!campaignId) return

    await api.saveDesign(campaignId, design)
    set({ isDirty: false })
  },
}))
