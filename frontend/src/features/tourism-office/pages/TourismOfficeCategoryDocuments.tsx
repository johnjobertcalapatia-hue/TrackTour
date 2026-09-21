import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put, del } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { FileText, Plus, Trash2, X, Check, ChevronRight } from 'lucide-react'

interface RequiredDocument {
  id: number
  code: string
  name: string
  description: string | null
  file_types: string
  max_size_kb: number
  accepts_multiple: boolean
  is_expirable: boolean
  remarks: string | null
  status: string
  pivot?: { required: boolean; display_order: number }
}

interface BusinessCategory {
  id: number
  name: string
  required_documents: RequiredDocument[]
}

export default function TourismOfficeCategoryDocuments() {
  const queryClient = useQueryClient()
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)
  const [showAddDocModal, setShowAddDocModal] = useState(false)
  const [showCreateDocModal, setShowCreateDocModal] = useState(false)
  const [selectedDocId, setSelectedDocId] = useState('')
  const [newDoc, setNewDoc] = useState({ name: '', description: '', file_types: 'pdf,jpg,jpeg,png', max_size_kb: 5120, accepts_multiple: false, is_expirable: false, remarks: '' })

  const { data: categories, isLoading } = useQuery({
    queryKey: ['to-category-documents'],
    queryFn: () => get<{ data: BusinessCategory[] }>('/tourism-office/category-documents'),
  })

  const { data: allDocs } = useQuery({
    queryKey: ['to-documents'],
    queryFn: () => get<{ data: RequiredDocument[] }>('/tourism-office/documents'),
  })

  const addDocMutation = useMutation({
    mutationFn: ({ categoryId, documentId }: { categoryId: number; documentId: number }) =>
      post(`/tourism-office/category-documents/${categoryId}/documents`, { required_document_id: documentId, required: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['to-category-documents'] })
      setShowAddDocModal(false)
      setSelectedDocId('')
    },
  })

  const toggleRequiredMutation = useMutation({
    mutationFn: ({ categoryId, documentId, required }: { categoryId: number; documentId: number; required: boolean }) =>
      put(`/tourism-office/category-documents/${categoryId}/documents/${documentId}`, { required }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['to-category-documents'] }),
  })

  const removeDocMutation = useMutation({
    mutationFn: ({ categoryId, documentId }: { categoryId: number; documentId: number }) =>
      del(`/tourism-office/category-documents/${categoryId}/documents/${documentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['to-category-documents'] }),
  })

  const createDocMutation = useMutation({
    mutationFn: () => post('/tourism-office/documents', {
      name: newDoc.name,
      description: newDoc.description || null,
      file_types: newDoc.file_types,
      max_size_kb: newDoc.max_size_kb,
      accepts_multiple: newDoc.accepts_multiple,
      is_expirable: newDoc.is_expirable,
      remarks: newDoc.remarks || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['to-documents'] })
      setShowCreateDocModal(false)
      setNewDoc({ name: '', description: '', file_types: 'pdf,jpg,jpeg,png', max_size_kb: 5120, accepts_multiple: false, is_expirable: false, remarks: '' })
    },
  })

  const cats = categories?.data ?? []
  const docs = allDocs?.data ?? []
  const selectedCategory = cats.find((c) => c.id === selectedCategoryId)
  const assignedDocIds = new Set(selectedCategory?.required_documents?.map((d) => d.id) ?? [])
  const availableDocs = docs.filter((d) => !assignedDocIds.has(d.id))

  if (isLoading) return <DashboardSkeleton />

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-100">Category Documents</h1>
        <p className="mt-1 text-sm text-gray-400">Manage required documents for each business category</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Category List */}
        <div className="lg:col-span-1">
          <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 shadow-lg shadow-black/5 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800/50">
              <h2 className="text-sm font-semibold text-gray-100">Business Categories</h2>
            </div>
            <div className="divide-y divide-gray-800/50 max-h-[600px] overflow-y-auto">
              {cats.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`w-full text-left px-5 py-3.5 flex items-center justify-between transition-colors ${
                    selectedCategoryId === cat.id
                      ? 'bg-emerald-900/20 border-l-2 border-emerald-500'
                      : 'hover:bg-gray-800/30 border-l-2 border-transparent'
                  }`}
                >
                  <div>
                    <p className={`text-sm font-medium ${selectedCategoryId === cat.id ? 'text-emerald-300' : 'text-gray-100'}`}>{cat.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{cat.required_documents?.length ?? 0} documents</p>
                  </div>
                  <ChevronRight className={`w-4 h-4 ${selectedCategoryId === cat.id ? 'text-emerald-400' : 'text-gray-600'}`} />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Document List */}
        <div className="lg:col-span-2">
          {!selectedCategoryId ? (
            <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-12 text-center">
              <FileText className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">Select a category to view its required documents.</p>
            </div>
          ) : (
            <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 shadow-lg shadow-black/5 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-800/50 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-100">{selectedCategory?.name}</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{selectedCategory?.required_documents?.length ?? 0} required documents</p>
                </div>
                <button
                  onClick={() => setShowAddDocModal(true)}
                  className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-xl text-xs font-medium transition"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Document
                </button>
              </div>

              {!selectedCategory?.required_documents?.length ? (
                <div className="p-12 text-center">
                  <p className="text-gray-500">No documents assigned to this category yet.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800/50 bg-gray-800/30">
                        <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Document</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">File Types</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Expires</th>
                        <th className="text-center px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Required</th>
                        <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {selectedCategory.required_documents.map((doc) => (
                        <tr key={doc.id} className="hover:bg-gray-800/30 transition-colors">
                          <td className="px-5 py-3">
                            <p className="font-medium text-gray-100">{doc.name}</p>
                            {doc.description && <p className="text-xs text-gray-500 mt-0.5 max-w-[300px] truncate">{doc.description}</p>}
                          </td>
                          <td className="px-5 py-3 text-gray-400 text-xs">{doc.file_types}</td>
                          <td className="px-5 py-3">
                            {doc.is_expirable ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-900/20 text-amber-300 border border-amber-800/50">Yes</span>
                            ) : (
                              <span className="text-gray-600 text-xs">No</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-center">
                            <button
                              onClick={() => toggleRequiredMutation.mutate({
                                categoryId: selectedCategoryId!,
                                documentId: doc.id,
                                required: !doc.pivot?.required,
                              })}
                              className={`inline-flex items-center justify-center w-7 h-7 rounded-lg transition ${
                                doc.pivot?.required
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-gray-800 text-gray-500 hover:bg-gray-700'
                              }`}
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <button
                              onClick={() => {
                                if (confirm(`Remove "${doc.name}" from this category?`)) {
                                  removeDocMutation.mutate({ categoryId: selectedCategoryId!, documentId: doc.id })
                                }
                              }}
                              className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded-lg transition"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add Document Modal */}
      {showAddDocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700/50 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800/50">
              <h2 className="text-lg font-semibold text-gray-100">Add Document to {selectedCategory?.name}</h2>
              <button onClick={() => setShowAddDocModal(false)} className="text-gray-400 hover:text-gray-200"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Select Document *</label>
                <select value={selectedDocId} onChange={(e) => setSelectedDocId(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50">
                  <option value="">-- Choose a document --</option>
                  {availableDocs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              {availableDocs.length === 0 && (
                <p className="text-xs text-gray-500">All documents are already assigned. Create a new document type first.</p>
              )}
              <button
                onClick={() => {
                  setShowAddDocModal(false)
                  setShowCreateDocModal(true)
                }}
                className="text-xs text-emerald-400 hover:underline"
              >
                + Create new document type
              </button>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-800/50">
              <button onClick={() => setShowAddDocModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition">Cancel</button>
              <button
                onClick={() => {
                  if (selectedDocId && selectedCategoryId) {
                    addDocMutation.mutate({ categoryId: selectedCategoryId, documentId: parseInt(selectedDocId) })
                  }
                }}
                disabled={!selectedDocId || addDocMutation.isPending}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition"
              >
                {addDocMutation.isPending ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Document Type Modal */}
      {showCreateDocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700/50 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800/50">
              <h2 className="text-lg font-semibold text-gray-100">Create Document Type</h2>
              <button onClick={() => setShowCreateDocModal(false)} className="text-gray-400 hover:text-gray-200"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Name *</label>
                <input type="text" value={newDoc.name} onChange={(e) => setNewDoc({ ...newDoc, name: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50" placeholder="e.g. Business License" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Description</label>
                <textarea value={newDoc.description} onChange={(e) => setNewDoc({ ...newDoc, description: e.target.value })} rows={2} className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">File Types</label>
                  <input type="text" value={newDoc.file_types} onChange={(e) => setNewDoc({ ...newDoc, file_types: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Max Size (KB)</label>
                  <input type="number" value={newDoc.max_size_kb} onChange={(e) => setNewDoc({ ...newDoc, max_size_kb: parseInt(e.target.value) || 5120 })} className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50" />
                </div>
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={newDoc.accepts_multiple} onChange={(e) => setNewDoc({ ...newDoc, accepts_multiple: e.target.checked })} className="w-4 h-4 rounded bg-gray-800 border-gray-600 text-emerald-500 focus:ring-emerald-500" />
                  <span className="text-xs text-gray-400">Accepts multiple files</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={newDoc.is_expirable} onChange={(e) => setNewDoc({ ...newDoc, is_expirable: e.target.checked })} className="w-4 h-4 rounded bg-gray-800 border-gray-600 text-emerald-500 focus:ring-emerald-500" />
                  <span className="text-xs text-gray-400">Has expiration</span>
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Remarks</label>
                <input type="text" value={newDoc.remarks} onChange={(e) => setNewDoc({ ...newDoc, remarks: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-800/50">
              <button onClick={() => setShowCreateDocModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition">Cancel</button>
              <button
                onClick={() => createDocMutation.mutate()}
                disabled={!newDoc.name || createDocMutation.isPending}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition"
              >
                {createDocMutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
