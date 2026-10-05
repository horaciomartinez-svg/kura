'use client'

import { useState } from 'react'
import { DomainVerificationPanel } from '@/components/DomainVerificationPanel'
import type { DnsRecord, DomainVerificationState } from '@kura/core'

function buildRecords(domain: string): DnsRecord[] {
  const slug = domain.split('.')[0]
  return [
    {
      type: 'CNAME',
      host: `kura._domainkey.${domain}`,
      value: `kura-${slug}.dkim.amazonses.com`,
    },
    {
      type: 'CNAME',
      host: `kura2._domainkey.${domain}`,
      value: `kura2-${slug}.dkim.amazonses.com`,
    },
    {
      type: 'TXT',
      host: '@',
      value: 'v=spf1 include:amazonses.com ~all',
    },
    {
      type: 'TXT',
      host: `_dmarc.${domain}`,
      value: 'v=DMARC1; p=none; rua=mailto:dmarc@kura.email',
    },
  ]
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export default function DomainsPage() {
  const [domain, setDomain] = useState('midominio.com')
  const [status, setStatus] = useState<DomainVerificationState['status']>('pending')
  const [records, setRecords] = useState<DnsRecord[]>(() => buildRecords('midominio.com'))
  const [isVerifying, setIsVerifying] = useState(false)

  const handleAddDomain = async (newDomain: string) => {
    // Simula la creación del dominio y la generación de tokens DKIM en el backend.
    await delay(1200)
    setDomain(newDomain)
    setRecords(buildRecords(newDomain))
    setStatus('pending')
  }

  const handleVerify = async () => {
    // Simula la comprobación DNS contra AWS SES.
    setIsVerifying(true)
    await delay(1500)
    setStatus('verified')
    setIsVerifying(false)
  }

  return (
    <div className="w-full min-h-screen bg-surface font-body text-typography p-8">
      <DomainVerificationPanel
        domain={domain}
        status={status}
        records={records}
        isVerifying={isVerifying}
        onAddDomain={handleAddDomain}
        onVerify={handleVerify}
      />
    </div>
  )
}
