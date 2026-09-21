import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, put } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { API_ENDPOINTS } from '@/shared/constants'
import { Scan, AlertTriangle } from 'lucide-react'

interface OcrSettings {
  ocr_enabled: boolean
}

export default function AdminSystemOcrSettings() {
  const queryClient = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['admin-ocr-settings'],
    queryFn: () => get<OcrSettings>(API_ENDPOINTS.ADMIN.OCR_SETTINGS),
  })

  const mutation = useMutation({
    mutationFn: (data: OcrSettings) => put<OcrSettings>(API_ENDPOINTS.ADMIN.OCR_SETTINGS, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-ocr-settings'] })
    },
  })

  if (isLoading) return <TableSkeleton rows={1} cols={1} />

  if (!settings) return <div className="text-center py-20 text-[#6B7280]">Unable to load OCR settings.</div>

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">OCR Settings</h1>
        <p className="mt-1 text-sm lg:text-base text-[#6B7280]">
          Control automatic document scanning and data extraction using OCR
        </p>
      </div>

      <div className="max-w-2xl">
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-tourism">
          <div className="px-6 py-4 border-b border-[#E2E8E3] flex items-center gap-3">
            <div className="w-10 h-10 bg-[#EAF6ED] rounded-xl flex items-center justify-center">
              <Scan className="w-5 h-5 text-[#16803C]" />
            </div>
            <h2 className="text-lg font-semibold text-[#17201A]">Document OCR</h2>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[#17201A]">Enable OCR Extraction</p>
                <p className="mt-1 text-xs text-[#6B7280]">
                  When enabled, uploaded documents will be automatically scanned to extract
                  document numbers, dates, and other key information during business registration.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={settings.ocr_enabled}
                  disabled={mutation.isPending}
                  onChange={() => {
                    mutation.mutate({ ocr_enabled: !settings.ocr_enabled })
                  }}
                />
                <div className="w-11 h-6 bg-[#E2E8E3] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#16803C]/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-[#E2E8E3] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#16803C]"></div>
              </label>
            </div>

            {!settings.ocr_enabled && (
              <div className="mt-4 flex items-start gap-3 p-3 bg-[#FFF7D6] border border-[#F59E0B]/20 rounded-xl">
                <AlertTriangle className="w-5 h-5 text-[#D97706] shrink-0 mt-0.5" />
                <p className="text-sm text-[#92400E]">
                  OCR is disabled. Business owners will need to manually enter document details
                  during registration. Re-enable OCR to automatically extract data from uploaded documents.
                </p>
              </div>
            )}

            {mutation.isError && (
              <div className="mt-4 flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">Failed to update OCR settings. Please try again.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
