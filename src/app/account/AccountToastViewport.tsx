'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, AlertCircle } from 'lucide-react'

type Toast = {
  id: number
  message: string
  type?: 'success' | 'error'
}

export const TOAST_EVENT = 'hush-account-toast'
export const TOAST_STORAGE_KEY = 'hush-account-toast'

export function showAccountToast(message: string, type: 'success' | 'error' = 'success') {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message, type } }))
}

export default function AccountToastViewport() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    function push(message: string, type: 'success' | 'error' = 'success') {
      const id = Date.now() + Math.random()
      setToasts((current) => [...current, { id, message, type }].slice(-3))
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id))
      }, 3200)
    }

    const stored = window.sessionStorage.getItem(TOAST_STORAGE_KEY)
    if (stored) {
      window.sessionStorage.removeItem(TOAST_STORAGE_KEY)
      try {
        const parsed = JSON.parse(stored) as { message?: string; type?: 'success' | 'error' }
        if (parsed.message) push(parsed.message, parsed.type ?? 'success')
      } catch {
        push(stored)
      }
    }

    function onToast(event: Event) {
      const detail = (event as CustomEvent<{ message?: string; type?: 'success' | 'error' }>).detail
      if (detail?.message) push(detail.message, detail.type ?? 'success')
    }

    window.addEventListener(TOAST_EVENT, onToast)
    return () => window.removeEventListener(TOAST_EVENT, onToast)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[90] flex flex-col gap-2" style={{ width: 'min(calc(100vw - 2rem), 360px)' }}>
      {toasts.map((toast) => {
        const isError = toast.type === 'error'
        const Icon = isError ? AlertCircle : CheckCircle2
        return (
          <div
            key={toast.id}
            className="hush-menu-pop flex items-start gap-2 rounded-xl px-3 py-3 text-sm shadow-xl"
            style={{
              background: isError ? '#FBEAE6' : '#FFFFFF',
              border: `1px solid ${isError ? '#E8C2B8' : '#DDD5C5'}`,
              color: isError ? '#7A2A1F' : '#254F22',
            }}
          >
            <Icon className="mt-0.5 h-4 w-4 flex-none" />
            <span>{toast.message}</span>
          </div>
        )
      })}
    </div>
  )
}
