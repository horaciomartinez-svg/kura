'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Lock, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      setError('Credenciales inválidas. Verifica tu correo y contraseña.')
      setLoading(false)
      return
    }

    const redirectTo =
      new URLSearchParams(window.location.search).get('redirectedFrom') ?? '/dashboard'
    router.replace(redirectTo)
    router.refresh()
  }

  return (
    <div className="w-full max-w-md">
      <div className="text-center mb-8">
        <h1 className="font-heading text-3xl font-semibold text-primary">KURA</h1>
        <p className="text-sm text-typography-muted mt-2">Inicia sesión en tu cuenta</p>
      </div>

      <div className="bg-surface-card rounded-kura-lg shadow-kura-soft border border-gray-100 p-8">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <label className="block">
            <span className="block text-xs font-medium text-typography-muted mb-1">Correo</span>
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
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
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
            Entrar
          </button>
        </form>

        <p className="text-center text-sm text-typography-muted mt-6">
          ¿No tienes cuenta?{' '}
          <Link href="/register" className="text-primary font-medium hover:underline">
            Regístrate
          </Link>
        </p>
      </div>
    </div>
  )
}
