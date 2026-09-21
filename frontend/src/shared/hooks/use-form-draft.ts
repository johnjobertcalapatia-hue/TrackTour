import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormDraftData, FormDraftUiState } from '@/shared/types'
import { getLocalDraft, removeLocalDraft, saveLocalDraft } from '@/shared/services/draft-storage'
import { deleteServerDraft, fetchServerDraft, saveServerDraft } from '@/shared/services/draft-api'

const CURRENT_VERSION = 1
const DEBOUNCE_MS = 500
const SAVE_TIMEOUT_MS = 5_000

interface UseFormDraftOptions {
  draftKey: string
  formId: string
  initialFields?: Record<string, unknown>
  initialUiState?: FormDraftUiState
  debounceMs?: number
  onRestored?: (data: FormDraftData) => void
}

interface UseFormDraftReturn {
  fields: Record<string, unknown>
  uiState: FormDraftUiState | undefined
  isRestoring: boolean
  hasDraft: boolean
  setFields: (fields: Record<string, unknown>) => void
  setUiState: (state: FormDraftUiState) => void
  updateField: (key: string, value: unknown) => void
  updateUiState: (partial: Partial<FormDraftUiState>) => void
  reset: () => void
  clear: () => void
  forceSave: () => Promise<void>
}

export function useFormDraft(options: UseFormDraftOptions): UseFormDraftReturn {
  const {
    draftKey,
    formId,
    initialFields = {},
    initialUiState,
    debounceMs = DEBOUNCE_MS,
    onRestored,
  } = options

  const [fields, setFieldsState] = useState<Record<string, unknown>>(initialFields)
  const [uiState, setUiStateState] = useState<FormDraftUiState | undefined>(initialUiState)
  const [isRestoring, setIsRestoring] = useState(true)
  const [hasDraft, setHasDraft] = useState(false)

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveInFlight = useRef(false)
  const lastSavedFields = useRef(JSON.stringify(initialFields))
  const lastSavedUiState = useRef(JSON.stringify(initialUiState ?? null))
  const onRestoredRef = useRef(onRestored)
  onRestoredRef.current = onRestored

  const authToken = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null

  const doSave = useCallback(
    async (currentFields: Record<string, unknown>, currentUiState: FormDraftUiState | undefined) => {
      if (saveInFlight.current) return

      saveInFlight.current = true
      const data: FormDraftData = {
        version: CURRENT_VERSION,
        lastSaved: Date.now(),
        formId,
        fields: currentFields,
        uiState: currentUiState,
      }

      saveLocalDraft(draftKey, data)

      if (authToken) {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS)
        try {
          await saveServerDraft(draftKey, formId, data)
        } catch {
          // local save already succeeded; server save is best-effort
        } finally {
          clearTimeout(timeoutId)
        }
      }

      saveInFlight.current = false
    },
    [draftKey, formId, authToken]
  )

  const scheduleSave = useCallback(
    (currentFields: Record<string, unknown>, currentUiState: FormDraftUiState | undefined) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)

      const fieldsStr = JSON.stringify(currentFields)
      const uiStateStr = JSON.stringify(currentUiState ?? null)
      if (fieldsStr === lastSavedFields.current && uiStateStr === lastSavedUiState.current) return

      debounceTimer.current = setTimeout(() => {
        lastSavedFields.current = fieldsStr
        lastSavedUiState.current = uiStateStr
        doSave(currentFields, currentUiState)
      }, debounceMs)
    },
    [debounceMs, doSave]
  )

  useEffect(() => {
    let cancelled = false

    async function restore() {
      let restored: FormDraftData | null = null

      const localDraft = getLocalDraft(draftKey)
      if (localDraft) {
        restored = localDraft
      }

      if (!restored && authToken) {
        const serverDraft = await fetchServerDraft(draftKey)
        if (serverDraft) {
          restored = serverDraft
          saveLocalDraft(draftKey, serverDraft)
        }
      }

      if (cancelled || !restored) {
        if (!cancelled) setIsRestoring(false)
        return
      }

      setFieldsState(restored.fields)
      lastSavedFields.current = JSON.stringify(restored.fields)

      if (restored.uiState) {
        setUiStateState(restored.uiState)
        lastSavedUiState.current = JSON.stringify(restored.uiState)
      }

      setHasDraft(true)
      setIsRestoring(false)

      onRestoredRef.current?.(restored)
    }

    restore()

    return () => {
      cancelled = true
    }
  }, [draftKey, authToken])

  useEffect(() => {
    if (!isRestoring) {
      scheduleSave(fields, uiState)
    }
  }, [fields, uiState, isRestoring, scheduleSave])

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [])

  const setFields = useCallback((newFields: Record<string, unknown>) => {
    setFieldsState(newFields)
  }, [])

  const setUiState = useCallback((state: FormDraftUiState) => {
    setUiStateState(state)
  }, [])

  const updateField = useCallback((key: string, value: unknown) => {
    setFieldsState(prev => ({ ...prev, [key]: value }))
  }, [])

  const updateUiState = useCallback((partial: Partial<FormDraftUiState>) => {
    setUiStateState(prev => ({ ...(prev ?? {}), ...partial } as FormDraftUiState))
  }, [])

  const reset = useCallback(() => {
    setFieldsState(initialFields)
    setUiStateState(initialUiState)
    lastSavedFields.current = JSON.stringify(initialFields)
    lastSavedUiState.current = JSON.stringify(initialUiState ?? null)
    removeLocalDraft(draftKey)
  }, [initialFields, initialUiState, draftKey])

  const clear = useCallback(() => {
    removeLocalDraft(draftKey)
    if (authToken) {
      deleteServerDraft(draftKey)
    }
  }, [draftKey, authToken])

  const forceSave = useCallback(async () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    lastSavedFields.current = JSON.stringify(fields)
    lastSavedUiState.current = JSON.stringify(uiState ?? null)
    await doSave(fields, uiState)
  }, [fields, uiState, doSave])

  return {
    fields,
    uiState,
    isRestoring,
    hasDraft,
    setFields,
    setUiState,
    updateField,
    updateUiState,
    reset,
    clear,
    forceSave,
  }
}
