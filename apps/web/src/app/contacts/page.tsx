'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { ChangeEvent, FormEvent } from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  Upload,
  Users,
  X,
} from 'lucide-react'
import type {
  Contact,
  ContactsImportResult,
  ContactStatus,
} from '@kura/core'
import { api } from '@/lib/api'

const PAGE_SIZE = 25

const STATUS_STYLES: Record<ContactStatus, { label: string; className: string }> = {
  active: { label: 'Activo', className: 'bg-accent/40 text-primary' },
  bounced: { label: 'Rebotado', className: 'bg-red-50 text-red-600' },
  unsubscribed: { label: 'Baja', className: 'bg-gray-100 text-gray-600' },
  complained: { label: 'Queja', className: 'bg-rose-50 text-rose-700' },
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [summary, setSummary] = useState<ContactsImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const loadContacts = useCallback(async (targetPage: number, targetSearch: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.listContacts({
        page: targetPage,
        limit: PAGE_SIZE,
        search: targetSearch,
      })
      setContacts(result.contacts)
      setTotal(result.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los contactos.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadContacts(page, search)
  }, [page, search, loadContacts])

  const handleSearch = (event: FormEvent) => {
    event.preventDefault()
    setPage(1)
    setSearch(searchInput.trim())
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setImporting(true)
    setError(null)
    setSummary(null)

    try {
      const text = await file.text()
      const result = await api.importContactsCsv(text)
      setSummary(result)
      setPage(1)
      await loadContacts(1, search)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo importar el CSV.')
    } finally {
      setImporting(false)
    }
  }

  const isEmpty = !loading && contacts.length === 0
  const isSearchEmpty = isEmpty && search.length > 0

  return (
    <div className="min-h-screen bg-surface p-6 font-body text-typography md:p-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-kura-sm p-2 text-typography-muted transition-colors hover:bg-surface-card hover:text-primary"
              aria-label="Volver al dashboard"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="font-heading text-3xl font-semibold">Contactos</h1>
              <p className="text-typography-muted">
                Gestiona tu audiencia e importa contactos desde un archivo CSV.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={handleImportClick}
              disabled={importing}
              className="flex items-center gap-2 rounded-kura-md bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {importing ? 'Importando…' : 'Importar CSV'}
            </button>
          </div>
        </header>

        {summary && (
          <div className="flex items-start gap-3 rounded-kura-md border border-primary/20 bg-accent/20 px-4 py-3 text-sm text-typography">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
            <div className="flex-1">
              <p className="font-medium">Importación completada</p>
              <p className="mt-0.5 text-typography-muted">
                Importados: <strong className="text-typography">{summary.imported}</strong> ·
                Duplicados: <strong className="text-typography">{summary.duplicates}</strong> ·
                Inválidos: <strong className="text-typography">{summary.invalid}</strong> · En
                suppression list:{' '}
                <strong className="text-typography">{summary.suppressed}</strong> · Total filas:{' '}
                {summary.total_rows}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSummary(null)}
              className="text-typography-muted hover:text-typography"
              aria-label="Cerrar resumen"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-kura-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="rounded-kura-lg bg-surface-card shadow-kura-soft">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-5">
            <form onSubmit={handleSearch} className="flex w-full max-w-md items-center gap-2">
              <div className="relative flex-1">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-typography-muted"
                />
                <input
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Buscar por email o nombre…"
                  className="w-full rounded-kura-md border border-gray-200 bg-surface py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
                />
              </div>
              <button
                type="submit"
                className="rounded-kura-md border border-primary px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-surface"
              >
                Buscar
              </button>
            </form>

            <p className="text-sm text-typography-muted">
              {total.toLocaleString('es-CL')} contacto{total === 1 ? '' : 's'}
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-typography-muted">
              <Loader2 size={18} className="animate-spin" />
              Cargando contactos…
            </div>
          ) : isSearchEmpty ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
              <Search size={28} className="text-typography-muted" />
              <p className="font-medium">No encontramos contactos para “{search}”.</p>
              <button
                type="button"
                onClick={() => {
                  setSearchInput('')
                  setSearch('')
                  setPage(1)
                }}
                className="text-sm font-medium text-primary underline"
              >
                Limpiar búsqueda
              </button>
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/30 text-primary">
                <Users size={22} />
              </span>
              <h2 className="font-heading text-xl font-semibold">Importa tu primer CSV</h2>
              <p className="max-w-md text-sm text-typography-muted">
                Sube un archivo con tus contactos. La primera fila debe contener los encabezados y
                las siguientes, una persona por línea.
              </p>
              <code className="rounded-kura-sm bg-surface px-3 py-2 font-mono text-xs text-typography-muted">
                email,first_name,last_name
              </code>
              <button
                type="button"
                onClick={handleImportClick}
                disabled={importing}
                className="mt-1 flex items-center gap-2 rounded-kura-md bg-primary px-4 py-2 font-medium text-white hover:bg-primary-hover disabled:opacity-50"
              >
                <Upload size={16} />
                Seleccionar CSV
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-typography-muted">
                    <th className="px-5 py-3 font-medium">Email</th>
                    <th className="px-5 py-3 font-medium">Nombre</th>
                    <th className="px-5 py-3 font-medium">Apellido</th>
                    <th className="px-5 py-3 font-medium">Estado</th>
                    <th className="px-5 py-3 font-medium">Fecha de alta</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact) => {
                    const status = STATUS_STYLES[contact.status] ?? STATUS_STYLES.active
                    return (
                      <tr
                        key={contact.id}
                        className="border-b border-gray-50 transition-colors hover:bg-surface"
                      >
                        <td className="px-5 py-3.5 font-medium">{contact.email}</td>
                        <td className="px-5 py-3.5 text-sm text-typography-muted">
                          {contact.firstName ?? '—'}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-typography-muted">
                          {contact.lastName ?? '—'}
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            {status.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-sm text-typography-muted">
                          {formatDate(contact.createdAt)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !isEmpty && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-4">
              <p className="text-sm text-typography-muted">
                Página {page} de {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                  className="flex items-center gap-1 rounded-kura-md border border-gray-200 px-3 py-1.5 text-sm font-medium transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft size={15} />
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page >= totalPages}
                  className="flex items-center gap-1 rounded-kura-md border border-gray-200 px-3 py-1.5 text-sm font-medium transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Siguiente
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}
        </section>

        <p className="text-center text-xs text-typography-muted">
          Se aceptan encabezados <code>email/correo</code>, <code>first_name/nombre</code> y{' '}
          <code>last_name/apellido</code>. Los correos en suppression list nunca se importan.
        </p>
      </div>
    </div>
  )
}
