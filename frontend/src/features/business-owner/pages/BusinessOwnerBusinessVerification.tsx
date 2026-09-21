import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { useActiveBusinessId } from '../services/use-active-business-id'
import { ArrowLeft, ShieldCheck, ShieldAlert, ShieldX, Clock, CheckCircle, XCircle, Send, FileText, AlertCircle } from 'lucide-react'

interface VerificationHistory {
  id: number
  status: string
  remarks: string
  created_at: string
}

interface RequiredDocument {
  type: string
  uploaded: boolean
}

interface VerificationData {
  current_status: string
  remarks: string
  history: VerificationHistory[]
  required_documents: RequiredDocument[]
}

export default function BusinessOwnerBusinessVerification() {
  const { id: urlId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const businessId = useActiveBusinessId(urlId)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (businessId !== null && urlId !== String(businessId)) {
      navigate(`/business-owner/businesses/${businessId}/verification`, { replace: true })
    }
  }, [businessId, urlId, navigate])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const { data: verification, isLoading } = useQuery({
    queryKey: ['bo-business-verification', businessId],
    queryFn: () => get<VerificationData>(`/business-owner/businesses/${businessId}/verification`),
    enabled: businessId !== null,
  })

  const submitMutation = useMutation({
    mutationFn: () => post(`/business-owner/businesses/${businessId}/verification/submit`, {}),
    onSuccess: () => {
      setErrorMessage(null)
      queryClient.invalidateQueries({ queryKey: ['bo-business-verification', businessId] })
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      const message = error?.response?.data?.message || 'Failed to submit for review. Please try again.'
      setErrorMessage(message)
    },
  })

  const statusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'approved': return <ShieldCheck className="w-8 h-8 text-[#16803C]" />
      case 'pending': case 'submitted': return <Clock className="w-8 h-8 text-[#A66F00]" />
      case 'rejected': return <ShieldX className="w-8 h-8 text-[#B91C1C]" />
      default: return <ShieldAlert className="w-8 h-8 text-[#647067]" />
    }
  }

  const statusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'approved': return 'bg-[#EAF6ED] border-[#BFE3CB] text-[#16803C]'
      case 'pending': case 'submitted': return 'bg-[#FFF7D6] border-[#F4B400]/40 text-[#A66F00]'
      case 'rejected': return 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
      default: return 'bg-[#F3F4F6] border-[#E5E7EB] text-[#647067]'
    }
  }

  const timelineDotColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'approved': return 'bg-[#16803C]'
      case 'rejected': return 'bg-[#B91C1C]'
      case 'submitted': return 'bg-[#F4B400]'
      default: return 'bg-[#9CA3AF]'
    }
  }

  if (isLoading) {
    return <div className="p-12 text-center text-[#647067] text-sm">Loading verification status...</div>
  }

  const status = verification?.current_status?.toLowerCase() ?? 'under_review'
  const canSubmit = status === 'under_review' || status === 'rejected'

  return (
    <div className="max-w-4xl mx-auto">
      <Link to="/business-owner/businesses" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Businesses
      </Link>

      <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32] mb-2">Business Verification</h1>
      <p className="text-sm text-[#647067] mb-8">Track your business verification status and requirements</p>

      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 mb-6">
        <div className="flex items-center gap-4">
          {statusIcon(status)}
          <div className="flex-1">
            <p className="text-xs text-[#647067] uppercase tracking-wider mb-0.5">Current Status</p>
            <p className={`text-xl font-bold capitalize inline-flex px-3 py-1 rounded-lg border text-sm ${statusColor(status)}`}>
              {verification?.current_status ?? 'Draft'}
            </p>
          </div>
          {canSubmit && (
            <button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition"
            >
              <Send className="w-4 h-4" />
              {submitMutation.isPending ? 'Submitting...' : 'Submit for Review'}
            </button>
          )}
        </div>
        {verification?.remarks && (
          <p className="mt-4 text-sm text-[#647067] bg-[#F3F8F4] rounded-xl px-4 py-3 border border-[#E2E8E3]">{verification.remarks}</p>
        )}
        {errorMessage && (
          <div className="mt-4 flex items-start gap-3 text-sm text-[#B91C1C] bg-[#FEF2F2] rounded-xl px-4 py-3 border border-[#FECACA]">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p>{errorMessage}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
          <h2 className="text-lg font-semibold text-[#17201A] mb-5">Verification History</h2>
          {!verification?.history?.length ? (
            <p className="text-sm text-[#647067]">No verification history yet.</p>
          ) : (
            <div className="relative ml-3">
              <div className="absolute left-0 top-1 bottom-1 w-px bg-[#E2E8E3]" />
              <div className="space-y-6">
                {verification.history.map((entry) => (
                  <div key={entry.id} className="relative flex gap-4 pl-6">
                    <div className={`absolute left-0 top-1.5 w-3 h-3 rounded-full border-2 border-white ${timelineDotColor(entry.status)} -translate-x-1/2`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium capitalize ${statusColor(entry.status)}`}>
                          {entry.status}
                        </span>
                        <span className="text-xs text-[#647067]">{new Date(entry.created_at).toLocaleDateString()}</span>
                      </div>
                      {entry.remarks && <p className="text-sm text-[#647067] mt-1">{entry.remarks}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
          <h2 className="text-lg font-semibold text-[#17201A] mb-5">Required Documents</h2>
          {!verification?.required_documents?.length ? (
            <p className="text-sm text-[#647067]">No document requirements found.</p>
          ) : (
            <div className="space-y-3">
              {verification.required_documents.map((doc) => (
                <div key={doc.type} className="flex items-center gap-3 bg-[#F3F8F4] rounded-xl px-4 py-3 border border-[#E2E8E3]">
                  <FileText className="w-5 h-5 text-[#647067] flex-shrink-0" />
                  <span className="flex-1 text-sm text-[#17201A]">{doc.type}</span>
                  {doc.uploaded ? (
                    <CheckCircle className="w-5 h-5 text-[#16803C] flex-shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-[#B91C1C] flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
