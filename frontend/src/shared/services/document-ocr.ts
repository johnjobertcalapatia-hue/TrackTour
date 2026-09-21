import { post, get } from './api'

export interface OcrFieldResult {
  business_name?: string
  owner_name?: string
  document_number?: string
  tin?: string
  issue_date?: string
  expiry_date?: string
  [key: string]: string | undefined
}

export interface OcrExtractResult {
  detected_type: string | null
  detected_label: string | null
  fields: OcrFieldResult
  raw_text: string
}

export interface OcrStatusResult {
  tesseract_installed: boolean
  binary_path: string | null
}

export async function extractDocument(
  file: File,
  documentType?: string,
): Promise<OcrExtractResult> {
  const formData = new FormData()
  formData.append('file', file)
  if (documentType) {
    formData.append('document_type', documentType)
  }

  return post<OcrExtractResult>('/documents/extract', formData)
}

export async function getOcrStatus(): Promise<OcrStatusResult> {
  return get<OcrStatusResult>('/documents/ocr-status')
}
