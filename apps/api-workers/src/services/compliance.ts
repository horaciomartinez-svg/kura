/**
 * Validación de cumplimiento anti-spam obligatoria antes de enviar (§9.5).
 * Se invoca en /send, /schedule y /test antes de cambiar el estado de la campaña.
 */

export class ComplianceError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ComplianceError';
  }
}

const MAX_HTML_BYTES = 102 * 1024; // Gmail recorta correos > 102 KB

export function assertCampaignCompliance(html: string | null): void {
  if (!html || !html.includes('{{unsubscribe_url}}')) {
    throw new ComplianceError(
      'COMPLIANCE_ERROR',
      'La campaña debe incluir la variable {{unsubscribe_url}} (normativa anti-spam).'
    );
  }

  if (html.length > MAX_HTML_BYTES) {
    throw new ComplianceError(
      'HTML_TOO_LARGE',
      'El HTML supera 102 KB y Gmail lo recortaría.'
    );
  }
}
