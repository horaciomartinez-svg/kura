'use client'

import React, { useState } from 'react'
import {
  Copy,
  Check,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Plus,
} from 'lucide-react'
import type { DnsRecord, DomainVerificationState } from '@kura/core'

interface DomainVerificationPanelProps {
  domain: string
  status: DomainVerificationState['status']
  records: DnsRecord[]
  isVerifying?: boolean
  onAddDomain?: (domain: string) => Promise<void> | void
  onVerify?: () => Promise<void> | void
}

export function DomainVerificationPanel({
  domain,
  status,
  records,
  isVerifying = false,
  onAddDomain,
  onVerify,
}: DomainVerificationPanelProps) {
  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6">
      <EducationalBanner />
      <div className="bg-surface-card rounded-kura-lg shadow-kura-soft p-8">
        <Header domain={domain} status={status} />
        <AddDomainForm onAddDomain={onAddDomain} />
        {domain && <DnsRecords records={records} />}
        <div className="flex justify-between items-center border-t border-gray-100 pt-6 mt-2">
          <a
            href="https://support.google.com/a/answer/33786"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary underline hover:text-primary-hover font-medium"
          >
            ¿Necesitas ayuda con tu proveedor?
          </a>
          <button
            type="button"
            onClick={() => onVerify?.()}
            disabled={isVerifying || !domain}
            className="flex items-center gap-2 border-2 border-primary text-primary px-6 py-2 rounded-kura-md hover:bg-surface font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isVerifying && <Loader2 size={16} className="animate-spin" />}
            Comprobar estado de validación
          </button>
        </div>
      </div>
    </div>
  )
}

function EducationalBanner() {
  return (
    <div className="bg-surface rounded-kura-md border border-gray-100 p-5 flex gap-4">
      <span className="shrink-0 h-9 w-9 rounded-kura-sm bg-amber-50 text-amber-600 flex items-center justify-center">
        <ShieldAlert size={18} />
      </span>
      <div className="text-sm text-typography">
        <p className="font-medium mb-1">
          No envíes campañas desde dominios públicos (@gmail.com, @yahoo.com, @outlook.com).
        </p>
        <p className="text-typography-muted leading-relaxed">
          Los proveedores de correo penalizan estos remitentes y tus envíos caerán en Spam o
          Promociones. Configura <strong>DKIM</strong> y <strong>SPF</strong> en un dominio
          corporativo para autenticar tu identidad y proteger la reputación de tu marca.
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-primary text-xs font-medium">
          <ShieldCheck size={14} />
          La verificación del dominio habilita automáticamente DKIM, SPF y DMARC.
        </p>
      </div>
    </div>
  )
}

function Header({
  domain,
  status,
}: {
  domain: string
  status: DomainVerificationState['status']
}) {
  return (
    <div className="flex flex-wrap justify-between items-start gap-4 mb-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold mb-2">Autentica tu Dominio</h2>
        <p className="text-typography-muted text-sm">
          {domain ? (
            <>
              Para que tus correos lleguen a la bandeja de entrada y no a spam, necesitamos verificar
              que eres dueño de <strong>{domain}</strong>.
            </>
          ) : (
            'Añade un dominio corporativo para comenzar la verificación vía DNS.'
          )}
        </p>
      </div>
      <StatusBadge status={status} />
    </div>
  )
}

const STATUS_MAP: Record<
  DomainVerificationState['status'],
  { label: string; className: string; icon: React.ReactNode }
> = {
  pending: {
    label: 'Pendiente de verificación',
    className: 'bg-yellow-50 text-amber-700',
    icon: <Loader2 size={16} className="animate-spin" />,
  },
  verified: {
    label: 'Verificado',
    className: 'bg-accent text-primary',
    icon: <CheckCircle2 size={16} />,
  },
  failed: {
    label: 'Verificación fallida',
    className: 'bg-red-50 text-red-600',
    icon: <XCircle size={16} />,
  },
}

function StatusBadge({ status }: { status: DomainVerificationState['status'] }) {
  const { label, className, icon } = STATUS_MAP[status]
  return (
    <span
      className={`px-4 py-1.5 rounded-full flex items-center gap-2 text-sm font-medium whitespace-nowrap ${className}`}
    >
      {icon}
      {label}
    </span>
  )
}

function AddDomainForm({
  onAddDomain,
}: {
  onAddDomain?: (domain: string) => Promise<void> | void
}) {
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleaned = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')

    if (!cleaned || !cleaned.includes('.')) {
      setError('Ingresa un dominio válido, por ejemplo: midominio.com')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await onAddDomain?.(cleaned)
      setValue('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-8">
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="midominio.com"
          disabled={loading}
          className="flex-1 bg-white border border-gray-200 rounded-kura-md px-4 py-2.5 font-mono text-sm text-typography placeholder:text-typography-muted focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading}
          className="flex items-center justify-center gap-2 bg-primary text-white px-6 py-2.5 rounded-kura-md font-medium hover:bg-primary-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          {loading ? 'Añadiendo…' : 'Añadir dominio'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </form>
  )
}

function DnsRecords({ records }: { records: DnsRecord[] }) {
  return (
    <div className="mb-8">
      <div className="bg-gray-50 border border-gray-100 rounded-kura-md p-4 mb-4">
        <p className="text-sm text-typography">
          ⚠️ <strong>Importante:</strong> Algunos proveedores (como GoDaddy o Namecheap) añaden tu
          dominio automáticamente al final. Si es tu caso, copia solo la parte del Nombre antes de
          <code className="font-mono"> .tudominio.com</code>.
        </p>
      </div>

      <div className="hidden md:grid grid-cols-12 gap-4 text-xs font-medium text-typography-muted uppercase tracking-wider px-4 mb-2">
        <div className="col-span-3">Host</div>
        <div className="col-span-2">Tipo</div>
        <div className="col-span-7">Valor esperado</div>
      </div>

      <div className="flex flex-col gap-3">
        {records.length === 0 ? (
          <p className="text-sm text-typography-muted px-4 py-6 text-center">
            No hay registros DNS para mostrar todavía.
          </p>
        ) : (
          records.map((record, index) => (
            <div
              key={`${record.type}-${record.host}-${index}`}
              className="grid grid-cols-1 md:grid-cols-12 items-center gap-3 md:gap-4 bg-surface p-4 rounded-kura-md border border-gray-100"
            >
              <div className="md:col-span-3">
                <span className="md:hidden block text-xs text-typography-muted mb-1">Host</span>
                <CopyField value={record.host} />
              </div>
              <div className="md:col-span-2">
                <span className="inline-block px-2.5 py-1 rounded-kura-sm bg-white border border-gray-200 font-mono text-xs font-medium text-primary">
                  {record.type}
                </span>
              </div>
              <div className="md:col-span-7">
                <span className="md:hidden block text-xs text-typography-muted mb-1">
                  Valor esperado
                </span>
                <CopyField value={record.value} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Entorno sin permisos de portapapeles: se mantiene el feedback visual.
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full bg-surface border border-gray-200 rounded-kura-sm px-3 py-1.5 font-mono text-xs text-typography focus:outline-none focus:ring-1 focus:ring-accent select-all"
      />
      <button
        type="button"
        onClick={handleCopy}
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-kura-sm text-xs font-medium transition-colors flex-shrink-0 ${
          copied ? 'text-primary bg-accent/40' : 'text-typography-muted hover:bg-gray-200'
        }`}
        title="Copiar al portapapeles"
      >
        {copied ? (
          <>
            <Check size={14} />
            ¡Copiado!
          </>
        ) : (
          <Copy size={14} />
        )}
      </button>
    </div>
  )
}
