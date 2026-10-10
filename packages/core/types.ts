/**
 * KURA - Contratos de interfaces compartidos (packages/core/types.ts)
 * Fuente única de verdad para frontend (Next.js) y backend (Cloudflare Workers).
 */

/* -------------------------------------------------------------------------- */
/* Trial / Paywall                                                             */
/* -------------------------------------------------------------------------- */

export interface TrialStatus {
  isTrial: boolean;
  daysRemaining: number;
  sendsUsed: number;
  sendsLimit: number;
  isLocked: boolean; // true si daysRemaining < 0
}

/* -------------------------------------------------------------------------- */
/* Verificación de dominio                                                    */
/* -------------------------------------------------------------------------- */

export type DomainStatus = 'pending' | 'verified' | 'failed';

export interface DnsRecord {
  type: 'CNAME' | 'TXT';
  host: string;
  value: string;
}

export interface DomainVerificationState {
  domain: string;
  status: DomainStatus;
  records: DnsRecord[];
}

/* -------------------------------------------------------------------------- */
/* Editor de campañas (builder propio) — DEPRECADO                            */
/* -------------------------------------------------------------------------- */

/**
 * @deprecated El builder propio de bloques fue reemplazado por Easy-Email.
 * Usa `EasyEmailAST` como formato canónico de diseño (`design_json`, §9.1).
 */
export type BlockType = 'text' | 'image' | 'button' | 'divider';

/**
 * @deprecated El builder propio de bloques fue reemplazado por Easy-Email.
 * Usa `EasyEmailAST` como formato canónico de diseño (`design_json`, §9.1).
 */
export interface CampaignBlock {
  id: string;
  type: BlockType;
  properties: Record<string, any>;
}

/**
 * @deprecated El builder propio de bloques fue reemplazado por Easy-Email.
 * Usa `EasyEmailAST` como formato canónico de diseño (`design_json`, §9.1).
 */
export interface CampaignDesign {
  backgroundColor: string;
  contentWidth: string;
  blocks: CampaignBlock[];
}

/**
 * @deprecated El builder propio de bloques fue reemplazado por Easy-Email.
 * Usa `EasyEmailAST` como formato canónico de diseño (`design_json`, §9.1).
 */
export interface CampaignBuilderState {
  version: string;
  body: {
    backgroundColor: string;
    contentWidth: string;
    blocks: Array<{
      type: BlockType;
      properties: Record<string, any>;
    }>;
  };
}

/* -------------------------------------------------------------------------- */
/* Editor Easy-Email (AST canónico + artefacto HTML compilado) §9.1 / §20     */
/* -------------------------------------------------------------------------- */

export interface EasyEmailAST {
  type: 'page';
  data: { value: Record<string, any> };
  children: any[];
}

export interface CampaignSaveRequest {
  design_json: EasyEmailAST;
}

export interface CampaignCompileRequest extends CampaignSaveRequest {
  html_content: string; // HTML final compilado en el cliente (mjml-browser)
}

/* -------------------------------------------------------------------------- */
/* Contrato de la cola asíncrona (Cloudflare Queues -> AWS SES)               */
/* -------------------------------------------------------------------------- */

export interface QueuePayload {
  campaignId: string;
  contactId: string;
  contactEmail: string;
  contactVars: Record<string, string>;
  fromEmail: string;
  designJson: any; // Payload del diseño para compilar (MJML)
}

/* -------------------------------------------------------------------------- */
/* Eventos de telemetría (Edge Tracking)                                      */
/* -------------------------------------------------------------------------- */

export type CampaignEventType = 'open' | 'click' | 'bounce' | 'complaint';

export interface TrackingPayload {
  campaign_id: string;
  contact_id: string;
  event_type: CampaignEventType;
  url_clicked: string | null;
  is_machine_open: boolean;
}
