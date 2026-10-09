import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, get, openAuthenticatedDocument, post } from '@/shared/services/api'
import { useActiveBusinessId } from '../services/use-active-business-id'
import { ArrowLeft, Upload, FileText, Download, File, Lock, AlertTriangle, Calendar, ChevronDown, ChevronRight } from 'lucide-react'

interface RequiredDocument {
  id: number
  name: string
  file_name?: string | null
  is_expirable: boolean
  description?: string
}

interface BusinessDocument {
  id: number
  name: string
  document_number: string | null
  registered_name: string | null
  issued_by: string | null
  issue_date: string | null
  expiration_date: string | null
  owner_remarks: string | null
  admin_remarks: string | null
  verification_status: string
  created_at: string
  required_document?: RequiredDocument
  requiredDocument?: RequiredDocument
  type?: string
  file_url?: string | null
  status?: string
}

interface AvailableDoc {
  id: number
  name: string
  is_expirable: boolean
}

interface DocumentsResponse {
  documents: BusinessDocument[]
  available_docs: AvailableDoc[]
  business_status: string
}

export default function BusinessOwnerBusinessDocuments() {
  const { id: urlId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const businessId = useActiveBusinessId(urlId)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (businessId !== null && urlId !== String(businessId)) {
      navigate(`/business-owner/businesses/${businessId}/documents`, { replace: true })
    }
  }, [businessId, urlId, navigate])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedRequiredDocId, setSelectedRequiredDocId] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [expirationDate, setExpirationDate] = useState('')
  const [expandedDocId, setExpandedDocId] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['bo-business-documents', businessId],
    queryFn: () => get<DocumentsResponse>(`/business-owner/businesses/${businessId}/documents`),
    enabled: businessId !== null,
  })

  const documents = data?.documents ?? []
  const availableDocs = data?.available_docs ?? []
  const businessStatus = data?.business_status ?? ''
  const isApproved = businessStatus === 'approved'
  const isSuspended = businessStatus === 'suspended'

  const selectedDocMeta = availableDocs.find(
    (d) => String(d.id) === selectedRequiredDocId
  )
  const showExpirationPicker = selectedDocMeta?.is_expirable

  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) => post(`/business-owner/businesses/${businessId}/documents`, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-business-documents', businessId] })
      setSelectedRequiredDocId('')
      setSelectedFile(null)
      setExpirationDate('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
  })

  const handleUpload = () => {
    if (!selectedFile || !selectedRequiredDocId) return
    if (showExpirationPicker && !expirationDate) return
    const formData = new FormData()
    formData.append('required_document_id', selectedRequiredDocId)
    formData.append('file', selectedFile)
    if (expirationDate) formData.append('expiration_date', expirationDate)
    uploadMutation.mutate(formData)
  }

  const isExpired = (doc: BusinessDocument) => {
    if (!doc.expiration_date) return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return new Date(doc.expiration_date) < today
  }

  const isExpiringSoon = (doc: BusinessDocument) => {
    if (!doc.expiration_date) return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const expDate = new Date(doc.expiration_date)
    const diffDays = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    return diffDays >= 0 && diffDays <= 30
  }

  const statusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'approved': return 'text-[#16803C] bg-[#EAF6ED]'
      case 'verified': return 'text-[#16803C] bg-[#EAF6ED]'
      case 'pending': return 'text-[#A66F00] bg-[#FFF7D6]'
      case 'rejected': return 'text-[#B91C1C] bg-[#FEF2F2]'
      default: return 'text-[#647067] bg-[#F3F4F6]'
    }
  }

  const docName = (doc: BusinessDocument) => {
    return doc.requiredDocument?.name ?? doc.required_document?.name ?? doc.name ?? doc.type ?? 'Unknown'
  }

  const docStatus = (doc: BusinessDocument) => {
    return doc.verification_status ?? doc.status ?? 'pending'
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Link to="/business-owner/businesses" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Businesses
      </Link>

      <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32] mb-2">Business Documents</h1>
      <p className="text-sm text-[#647067] mb-8">Upload and manage documents for this business</p>

      {isSuspended && (
        <div className="bg-white rounded-2xl border border-[#FECACA] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 mb-6">
          <div className="flex items-center gap-3 text-[#B91C1C]">
            <AlertTriangle className="w-5 h-5" />
            <p className="text-sm font-medium">Business operations are suspended due to expired document(s). Upload renewed documents to reactivate.</p>
          </div>
        </div>
      )}

      {isApproved ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 mb-6">
          <div className="flex items-center gap-3 text-[#A66F00]">
            <Lock className="w-5 h-5" />
            <p className="text-sm font-medium">Documents are locked. They cannot be modified once the business is approved.</p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 mb-6">
          <h2 className="text-lg font-semibold text-[#17201A] mb-4">Upload Document</h2>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <select
                value={selectedRequiredDocId}
                onChange={(e) => { setSelectedRequiredDocId(e.target.value); setExpirationDate('') }}
                className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition"
              >
                <option value="">Select document type</option>
                {availableDocs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}{d.is_expirable ? ' (Expirable)' : ''}
                  </option>
                ))}
              </select>

              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[#16803C] file:text-white file:cursor-pointer hover:file:bg-[#126B32] transition"
              />
            </div>

            {showExpirationPicker && (
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-[#647067] shrink-0" />
                <input
                  type="date"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                  className="w-full sm:w-64 px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition"
                />
                <span className="text-xs text-[#647067]">This document type requires an expiration date</span>
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={!selectedFile || !selectedRequiredDocId || (showExpirationPicker && !expirationDate) || uploadMutation.isPending}
              className="self-start inline-flex items-center justify-center gap-2 bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition whitespace-nowrap"
            >
              <Upload className="w-4 h-4" />
              {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
        <div className="p-6 border-b border-[#E2E8E3]">
          <h2 className="text-lg font-semibold text-[#17201A]">Uploaded Documents</h2>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-[#647067] text-sm">Loading documents...</div>
        ) : !documents.length ? (
          <div className="p-12 text-center">
            <File className="w-12 h-12 text-[#647067] mx-auto mb-3" />
            <p className="text-[#647067] text-sm">No documents uploaded yet</p>
            <p className="text-[#647067] text-xs mt-1">Upload your first document using the form above</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8E3] text-left text-[#647067]">
                  <th className="px-6 py-3 font-medium w-8"></th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">File</th>
                  <th className="px-6 py-3 font-medium">Document Number</th>
                  <th className="px-6 py-3 font-medium">Issued By</th>
                  <th className="px-6 py-3 font-medium">Issue Date</th>
                  <th className="px-6 py-3 font-medium">Expires</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8E3]">
                {documents.map((doc) => (
                  <>
                    <tr
                      key={doc.id}
                      className="hover:bg-[#F6F8F4] transition cursor-pointer"
                      onClick={() => setExpandedDocId(expandedDocId === doc.id ? null : doc.id)}
                    >
                      <td className="px-6 py-4">
                        {expandedDocId === doc.id
                          ? <ChevronDown className="w-4 h-4 text-[#647067]" />
                          : <ChevronRight className="w-4 h-4 text-[#647067]" />
                        }
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <FileText className="w-5 h-5 text-[#647067]" />
                          <span className="text-[#17201A] font-medium">{docName(doc)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-[#647067]">{doc.file_name ?? '—'}</td>
                      <td className="px-6 py-4 text-[#4B5563]">{doc.document_number ?? '—'}</td>
                      <td className="px-6 py-4 text-[#4B5563]">{doc.issued_by ?? '—'}</td>
                      <td className="px-6 py-4 text-[#4B5563]">{doc.issue_date ?? '—'}</td>
                      <td className="px-6 py-4">
                        {doc.expiration_date ? (
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-[#647067]" />
                            <span className={`text-sm ${isExpired(doc) ? 'text-[#B91C1C]' : isExpiringSoon(doc) ? 'text-[#A66F00]' : 'text-[#4B5563]'}`}>
                              {doc.expiration_date}
                            </span>
                            {isExpired(doc) && (
                              <span className="text-xs text-[#B91C1C] bg-[#FEF2F2] px-2 py-0.5 rounded-full font-medium">Expired</span>
                            )}
                            {isExpiringSoon(doc) && (
                              <span className="text-xs text-[#A66F00] bg-[#FFF7D6] px-2 py-0.5 rounded-full font-medium">Expiring Soon</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[#647067] text-sm">N/A</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-medium capitalize ${statusColor(docStatus(doc))}`}>
                          {docStatus(doc)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => doc.file_url && void openAuthenticatedDocument(doc.file_url).catch((error: unknown) => window.alert(apiErrorMessage(error, 'Unable to open this document.')))}
                          className="inline-flex items-center gap-1.5 text-[#647067] hover:text-[#16803C] transition disabled:pointer-events-none"
                          disabled={!doc.file_url}
                        >
                          <Download className="w-4 h-4" /> View
                        </button>
                      </td>
                    </tr>
                    {expandedDocId === doc.id && (
                      <tr key={`${doc.id}-details`}>
                        <td colSpan={9} className="px-6 py-4 bg-[#F6F8F4]">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                            <div>
                              <span className="text-[#647067] text-xs block">Registered Name</span>
                              <span className="text-[#17201A]">{doc.registered_name ?? '—'}</span>
                            </div>
                            <div>
                              <span className="text-[#647067] text-xs block">Document Number</span>
                              <span className="text-[#17201A]">{doc.document_number ?? '—'}</span>
                            </div>
                            <div>
                              <span className="text-[#647067] text-xs block">Issued By</span>
                              <span className="text-[#17201A]">{doc.issued_by ?? '—'}</span>
                            </div>
                            <div>
                              <span className="text-[#647067] text-xs block">Issue Date</span>
                              <span className="text-[#17201A]">{doc.issue_date ?? '—'}</span>
                            </div>
                            <div>
                              <span className="text-[#647067] text-xs block">Expiration Date</span>
                              <span className="text-[#17201A]">{doc.expiration_date ?? '—'}</span>
                            </div>
                            <div>
                              <span className="text-[#647067] text-xs block">Owner Remarks</span>
                              <span className="text-[#17201A]">{doc.owner_remarks ?? '—'}</span>
                            </div>
                            <div>
                              <span className="text-[#647067] text-xs block">Admin Remarks</span>
                              <span className="text-[#17201A]">{doc.admin_remarks ?? '—'}</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
