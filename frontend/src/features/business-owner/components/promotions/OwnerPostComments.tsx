import { useState, type FormEvent } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Eye, EyeOff, Send, Store, Trash2, UserRound } from 'lucide-react'
import { apiErrorMessage, del, get, patch, post as postRequest } from '@/shared/services/api'
import { toAssetUrl } from '@/shared/utils'
import { postedAgo, type PostComment } from '@/shared/components/posts/post-types'
import { useBusinessPortal } from '../../services/business-portal'

interface CommentPage { data: PostComment[]; meta?: { current_page: number; last_page: number } }

/**
 * A post's comments for the business: every comment (hidden ones included)
 * with Hide / Show / Delete, and a box to comment as the business. Used on the
 * post card (Comment) and on the insights page.
 */
export default function OwnerPostComments({ postId, businessName, businessLogo, autoFocus = false }: {
  postId: number
  businessName: string
  businessLogo?: string | null
  autoFocus?: boolean
}) {
  const portal = useBusinessPortal()
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const [error, setError] = useState('')

  const comments = useInfiniteQuery({
    queryKey: ['bo-post-comments', portal.prefix, String(postId)],
    queryFn: ({ pageParam }) => get<CommentPage>(`${portal.prefix}/posts/${postId}/comments`, { params: { page: pageParam } }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last?.meta && last.meta.current_page < last.meta.last_page ? last.meta.current_page + 1 : undefined),
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['bo-post-comments'] })
    void queryClient.invalidateQueries({ queryKey: ['bo-post-insights'] })
    void queryClient.invalidateQueries({ queryKey: ['bo-posts'] })
  }
  const add = useMutation({
    mutationFn: (text: string) => postRequest(`${portal.prefix}/posts/${postId}/comments`, { body: text }),
    onSuccess: () => { setBody(''); refresh() },
    onError: (e) => setError(apiErrorMessage(e, 'Could not post your comment. Please try again.')),
  })
  const moderate = useMutation({
    mutationFn: ({ commentId, hidden }: { commentId: number; hidden: boolean }) => patch(`${portal.prefix}/posts/${postId}/comments/${commentId}`, { hidden }),
    onSuccess: refresh,
    onError: (e) => setError(apiErrorMessage(e, 'Could not change the comment.')),
  })
  const remove = useMutation({
    mutationFn: (commentId: number) => del(`${portal.prefix}/posts/${postId}/comments/${commentId}`),
    onSuccess: refresh,
    onError: (e) => setError(apiErrorMessage(e, 'Could not delete the comment.')),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const text = body.trim()
    if (!text) return setError('Write a comment first.')
    add.mutate(text)
  }

  const list = comments.data?.pages.flatMap((p) => p?.data ?? []) ?? []

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="flex items-end gap-3">
        {businessLogo
          ? <img src={toAssetUrl(businessLogo)} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
          : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0F4D2B] text-white"><Store className="h-4 w-4" aria-hidden="true" /></span>}
        <label htmlFor={`owner-comment-${postId}`} className="sr-only">Comment as {businessName}</label>
        <textarea
          id={`owner-comment-${postId}`}
          rows={1}
          maxLength={1000}
          value={body}
          autoFocus={autoFocus}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Comment as ${businessName}…`}
          className="min-h-[40px] flex-1 resize-none rounded-2xl border border-[#DDE5E0] bg-[#fff] px-3.5 py-2 text-sm text-[#17201B] focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25"
        />
        <button type="submit" disabled={add.isPending} aria-label="Post comment" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#16803C] text-white hover:bg-[#126B32] disabled:opacity-50">
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {comments.isLoading ? <p className="text-sm text-[#5E6B63]">Loading comments…</p> : list.length === 0 ? (
        <p className="text-sm text-[#5E6B63]">No comments yet.</p>
      ) : (
        <ul className="divide-y divide-[#EEF2EF]">
          {list.map((c) => (
            <li key={c.id} className={`flex gap-3 py-3 ${c.hidden ? 'opacity-60' : ''}`}>
              {c.author.avatar
                ? <img src={toAssetUrl(c.author.avatar)} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                : <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${c.author.is_business ? 'bg-[#0F4D2B] text-white' : 'bg-[#E9F7EF] text-[#087F3F]'}`}>
                    {c.author.is_business ? <Store className="h-4 w-4" aria-hidden="true" /> : <UserRound className="h-4 w-4" aria-hidden="true" />}
                  </span>}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-semibold text-[#17201B]">{c.author.name}</span>
                  {c.author.is_business && <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF6ED] px-2 py-0.5 text-[11px] font-bold text-[#16803C]"><BadgeCheck className="h-3 w-3" aria-hidden="true" /> Author</span>}
                  <span className="text-xs text-[#5E6B63]">{postedAgo(c.created_at)}</span>
                  {c.hidden && <span className="rounded-full bg-[#F1F3F2] px-2 py-0.5 text-[11px] font-bold text-[#56615B]">Hidden</span>}
                </p>
                <p className="whitespace-pre-line break-words text-sm text-[#17201B]">{c.body}</p>
              </div>
              <div className="flex shrink-0 items-start gap-1">
                <button type="button" onClick={() => moderate.mutate({ commentId: c.id, hidden: !c.hidden })} disabled={moderate.isPending}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[#16803C] hover:bg-[#EAF6ED]" aria-label={`${c.hidden ? 'Show' : 'Hide'} comment by ${c.author.name}`}>
                  {c.hidden ? <><Eye className="h-3.5 w-3.5" aria-hidden="true" /> Show</> : <><EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> Hide</>}
                </button>
                <button type="button" onClick={() => remove.mutate(c.id)} disabled={remove.isPending}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[#B42318] hover:bg-[#FDECEC]" aria-label={`Delete comment by ${c.author.name}`}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {comments.hasNextPage && (
        <button type="button" onClick={() => comments.fetchNextPage()} className="text-sm font-semibold text-[#16803C] hover:underline">More comments</button>
      )}
    </div>
  )
}
