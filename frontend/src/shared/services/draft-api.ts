import { del, get, post } from '@/shared/services/api'
import type { FormDraftData, ServerFormDraft } from '@/shared/types'

export async function fetchServerDraft(draftKey: string): Promise<FormDraftData | null> {
  try {
    const draft = await get<ServerFormDraft>(`/drafts/${encodeURIComponent(draftKey)}`)
    if (!draft) return null
    return {
      version: draft.version,
      lastSaved: new Date(draft.updated_at).getTime(),
      formId: draft.form_id,
      fields: draft.fields,
      uiState: draft.ui_state ?? undefined,
    }
  } catch {
    return null
  }
}

export async function saveServerDraft(
  draftKey: string,
  formId: string,
  data: FormDraftData
): Promise<boolean> {
  try {
    await post('/drafts', {
      draft_key: draftKey,
      form_id: formId,
      fields: data.fields,
      ui_state: data.uiState ?? null,
      version: data.version,
    })
    return true
  } catch {
    return false
  }
}

export async function deleteServerDraft(draftKey: string): Promise<boolean> {
  try {
    await del(`/drafts/${encodeURIComponent(draftKey)}`)
    return true
  } catch {
    return false
  }
}
