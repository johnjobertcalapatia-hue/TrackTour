import type { FormDraftData } from '@/shared/types'

const DRAFT_PREFIX = 'form-draft:'
const CURRENT_VERSION = 1

function storageKey(draftKey: string): string {
  return `${DRAFT_PREFIX}${draftKey}`
}

function getStorage(): Storage {
  return sessionStorage
}

export function getLocalDraft(draftKey: string): FormDraftData | null {
  try {
    const raw = getStorage().getItem(storageKey(draftKey))
    if (!raw) return null
    const parsed: FormDraftData = JSON.parse(raw)
    if (!parsed || typeof parsed.version !== 'number') return null
    if (parsed.version !== CURRENT_VERSION) {
      removeLocalDraft(draftKey)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function saveLocalDraft(draftKey: string, data: FormDraftData): boolean {
  try {
    const serialized = JSON.stringify(data)
    if (serialized.length > 1_048_576) {
      const stripped = { ...data, fields: {} }
      getStorage().setItem(storageKey(draftKey), JSON.stringify(stripped))
      return false
    }
    getStorage().setItem(storageKey(draftKey), serialized)
    return true
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      removeLocalDraft(draftKey)
    }
    return false
  }
}

export function removeLocalDraft(draftKey: string): void {
  try {
    getStorage().removeItem(storageKey(draftKey))
  } catch {}
}

export function getAllLocalDraftKeys(): string[] {
  try {
    const keys: string[] = []
    const storage = getStorage()
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(DRAFT_PREFIX)) {
        keys.push(key.slice(DRAFT_PREFIX.length))
      }
    }
    return keys
  } catch {
    return []
  }
}

export function removeExpiredLocalDrafts(): void {
  const keys = getAllLocalDraftKeys()
  const now = Date.now()
  for (const key of keys) {
    const draft = getLocalDraft(key)
    if (draft && draft.lastSaved > 0 && now - draft.lastSaved > 7 * 24 * 60 * 60 * 1000) {
      removeLocalDraft(key)
    }
  }
}
