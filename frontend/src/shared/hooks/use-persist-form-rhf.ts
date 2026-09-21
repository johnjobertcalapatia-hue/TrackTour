import { useCallback, useEffect, useRef } from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'
import type { FormDraftUiState } from '@/shared/types'
import { getLocalDraft, removeLocalDraft, saveLocalDraft } from '@/shared/services/draft-storage'
import { deleteServerDraft, fetchServerDraft, saveServerDraft } from '@/shared/services/draft-api'

const DEBOUNCE_MS = 500
const SAVE_TIMEOUT_MS = 5_000

interface UsePersistFormRHFOptions<T extends FieldValues> {
  draftKey: string
  formId: string
  form: UseFormReturn<T>
  uiState?: FormDraftUiState
  onRestored?: () => void
}

export function usePersistFormRHF<T extends FieldValues>({
  draftKey,
  formId,
  form,
  uiState,
  onRestored,
}: UsePersistFormRHFOptions<T>) {
  const authToken = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveInFlight = useRef(false)
  const clearedRef = useRef(false)

  const doSave = useCallback(
    (values: Record<string, unknown>) => {
      if (saveInFlight.current) return
      saveInFlight.current = true

      saveLocalDraft(draftKey, {
        version: 1,
        lastSaved: Date.now(),
        formId,
        fields: values,
        uiState,
      })

      if (authToken) {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS)
        saveServerDraft(draftKey, formId, {
          version: 1,
          lastSaved: Date.now(),
          formId,
          fields: values,
          uiState,
        }).finally(() => {
          clearTimeout(timeoutId)
          saveInFlight.current = false
        })
      } else {
        saveInFlight.current = false
      }
    },
    [draftKey, formId, authToken, uiState]
  )

  const onRestoredRef = useRef(onRestored)
  onRestoredRef.current = onRestored

  useEffect(() => {
    let cancelled = false

    async function restore() {
      let restored = getLocalDraft(draftKey)

      if (!restored && authToken) {
        const serverDraft = await fetchServerDraft(draftKey)
        if (serverDraft) {
          restored = serverDraft
          saveLocalDraft(draftKey, serverDraft)
        }
      }

      if (cancelled || !restored) return
      if (clearedRef.current) return

      form.reset(restored.fields as T, { keepDefaultValues: true })
      onRestoredRef.current?.()
    }

    restore()
    return () => { cancelled = true }
  }, [draftKey, authToken, form])

  useEffect(() => {
    const sub = form.watch((values) => {
      if (clearedRef.current) return
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        doSave(values as Record<string, unknown>)
      }, DEBOUNCE_MS)
    })
    return () => {
      sub.unsubscribe()
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [form.watch, doSave])

  const clearDraft = useCallback(() => {
    clearedRef.current = true
    removeLocalDraft(draftKey)
    if (authToken) {
      deleteServerDraft(draftKey)
    }
  }, [draftKey, authToken])

  return { clearDraft }
}
