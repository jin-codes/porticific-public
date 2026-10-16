'use client'

import { useActionState } from 'react'
import type { ActionState } from '@/app/actions'
import { buttonCls } from './ui'

type Action = (state: ActionState, fd: FormData) => Promise<ActionState>

/** A form bound to a server action that shows the action's success / error message. */
export function ActionForm({
  action,
  children,
  submit,
  className = '',
  confirm,
}: {
  action: Action
  children: React.ReactNode
  submit: string
  className?: string
  /** Ask the user to confirm before the action runs. */
  confirm?: string
}) {
  const [state, formAction, pending] = useActionState(action, undefined)
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault()
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button className={buttonCls} disabled={pending}>
          {pending ? '처리 중…' : submit}
        </button>
        {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state?.ok && state.message && <span className="text-sm text-emerald-600">{state.message}</span>}
      </div>
      {state?.secret && (
        <code className="mt-2 block break-all rounded bg-neutral-100 p-2 text-xs dark:bg-neutral-800">{state.secret}</code>
      )}
    </form>
  )
}

/** A button-only form (no inputs) bound to a server action. */
export function ActionButton({ action, label, hidden }: { action: Action; label: string; hidden?: Record<string, string> }) {
  return (
    <ActionForm action={action} submit={label}>
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
    </ActionForm>
  )
}
