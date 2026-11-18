import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, post } from '@/shared/services/api'
import type { ModerationAction } from '@/features/municipal/types'

interface Target {
  id: number
  label: string
  action: ModerationAction
}

/**
 * Drives the confirm-with-reason dialog for approve / reject / suspend /
 * reactivate on one municipal resource (business owners, businesses, riders).
 * Every query whose key starts with `municipal` is refreshed afterwards so the
 * dashboard counters and lists stay in step.
 */
export function useModeration(baseUrl: string) {
  const queryClient = useQueryClient()
  const [target, setTarget] = useState<Target | null>(null)
  const [notice, setNotice] = useState('')

  const mutation = useMutation({
    mutationFn: ({ id, action, remarks }: { id: number; action: ModerationAction; remarks: string }) =>
      post(`${baseUrl}/${id}/${action}`, remarks ? { remarks } : {}),
    onSuccess: () => {
      setNotice(target ? `${target.label}: ${target.action} completed.` : 'Saved.')
      setTarget(null)
      queryClient.invalidateQueries({ queryKey: ['municipal'] })
    },
  })

  return {
    target,
    notice,
    clearNotice: () => setNotice(''),
    error: mutation.isError ? apiErrorMessage(mutation.error) : undefined,
    pending: mutation.isPending,
    open: (id: number, label: string, action: ModerationAction) => {
      mutation.reset()
      setTarget({ id, label, action })
    },
    cancel: () => {
      mutation.reset()
      setTarget(null)
    },
    confirm: (remarks: string) => {
      if (target) mutation.mutate({ id: target.id, action: target.action, remarks })
    },
  }
}
