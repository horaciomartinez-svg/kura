'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, Lock, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setNotice(null)

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      setLoading(false)
      return
    }

    const supabase = createClient()
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    if (data.session) {
      router.replace('/dashboard')
      router.refresh()
      return
    }

    setNotice('Cuenta creada. Revisa tu correo para confirmar la cuenta.')
    setLoading(false)
  }

  return (
    <div className="w-full max-w-md">
      <div className="text-center mb-8">
        <h1 className="font-heading text-3xl font-semibold text-primary">KURA</h1>
        <p className="text-sm text-typography-muted mt-2">Crea tu cuenta y empieza gratis</p>
      </div>

      <div className="bg-surface-card rounded-kura-lg shadow-kura-soft border border-gray-100 p-8">
        {notice ? (
          <div className="flex flex-col items-center text-center gap-3 py-4">
            <CheckCircle2 size={36} className="text-primary" />
            <p className="text-sm text-typography">{notice}</p>
            <Link href="/login" className="text-primary text-sm font-medium hover:underline">
              Ir a iniciar sesión
            </Link>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <label className="block">
                <span className="block text-xs font-medium text-typography-muted mb-1">
                  Correo
                </span>
                <div className="relative">
                  <Mail
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-typography-muted"
                  />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@correo.com"
                    className="w-full rounded-kura-md border border-gray-200 pl-9 pr-3 py-2.5 text-sm focus:border-primary focus:ring-primary"
                  />
                </div>
              </label>

              <label className="block">
                <span className="block text-xs font-medium text-typography-muted mb-1">
                  Contraseña
                </span>
                <div className="relative">
                  <Lock
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-typography-muted"
                  />
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full rounded-kura-md border border-gray-200 pl-9 pr-3 py-2.5 text-sm focus:border-primary focus:ring-primary"
                  />
                </div>
              </label>

              {error && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-kura-sm px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex items-center justify-center gap-2 bg-primary text-white rounded-kura-md py-2.5 font-medium hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                Crear cuenta
              </button>
            </form>

            <p className="text-center text-sm text-typography-muted mt-6">
              ¿Ya tienes cuenta?{' '}
              <Link href="/login" className="text-primary font-medium hover:underline">
                Inicia sesión
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
