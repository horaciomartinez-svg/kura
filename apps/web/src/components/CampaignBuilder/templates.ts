import { BasicType, BlockManager } from 'easy-email-core'
import type { IBlockData, IPage } from 'easy-email-core'
import type { IEmailTemplate } from 'easy-email-editor'
import type { EasyEmailAST } from '@kura/core'

/**
 * Plantillas, merge tags y theming base del editor Easy-Email (§9.3, §9.4).
 * El AST de Easy-Email es el formato canónico que se persiste en design_json.
 */

/** Merge tags soportados por KURA (§9.3, §12.4). */
export const KURA_MERGE_TAGS: Record<string, unknown> = {
  contact: {
    first_name: 'Nombre',
    last_name: 'Apellido',
    email: 'Correo',
  },
  unsubscribe_url: 'URL de baja',
  sender_address: 'Dirección del remitente',
}

/** Crea la página base (hoja de 600 px) con fondo Gris Hielo (#F7F9FC). */
function createBasePage(): IPage {
  return BlockManager.getBlockByType(BasicType.PAGE)!.create({
    attributes: { 'background-color': '#F7F9FC' },
  }) as unknown as IPage
}

/** Plantilla base vacía con un bloque de texto de bienvenida. */
export function createWelcomeTemplate(): EasyEmailAST {
  const page = createBasePage()

  const section = BlockManager.getBlockByType(BasicType.SECTION)!.create()
  const column = BlockManager.getBlockByType(BasicType.COLUMN)!.create()
  const text = BlockManager.getBlockByType(BasicType.TEXT)!.create({
    data: {
      value: {
        content:
          'Bienvenido a KURA. Escribe aquí tu mensaje y arrastra bloques para dar forma a tu campaña.',
      },
    },
  })

  column.children = [text] as IBlockData[]
  section.children = [column] as IBlockData[]
  page.children = [section] as IBlockData[]

  return page as unknown as EasyEmailAST
}

/** Construye los initialValues del provider a partir del design_json guardado. */
export function createEmailTemplate(designJson: EasyEmailAST | null): IEmailTemplate {
  const content = (designJson ?? createWelcomeTemplate()) as unknown as IPage
  return { subject: '', subTitle: '', content }
}
