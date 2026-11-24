import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Send, Store, Trash2, UserRound } from 'lucide-react'
import { apiErrorMessage, del, get, post as postRequest } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { toAssetUrl } from '@/shared/utils'
import { postedAgo, type PostComment } from '@/shared/components/posts/post-types'
import { patchPost } from './post-actions'

interface CommentPage { data: PostComment[]; meta?: { current_page: number; last_page: number } }

/**
 * Comments on a post. Tourists write and delete their own; the business can
 * hide or delete any comment from its portal (hidden ones disappear here).
 */
export default function PostComments({ postId, dark = false, autoFocus = false }: { postId: number; dark?: boolean; autoFocus?: boolean }) {
  const user = useAuthStore((s) => s.user)
  const isTourist = user?.role === 'tourist'
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const key = ['tourist-post-comments', postId]

  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => get<CommentPage>(`/tourist/posts/${postId}/comments`, { params: { page: pageParam } }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last?.meta && last.meta.current_page < last.meta.last_page ? last.meta.current_page + 1 : undefined),
  })
  const comments = query.data?.pages.flatMap((p) => p?.data ?? []) ?? []

  const add = useMutation({
    mutationFn: (text: string) => postRequest<PostComment & { comments_count: number }>(`/tourist/posts/${postId}/comments`, { body: text }),
    onSuccess: (data) => {
      setBody('')
      if (data) patchPost(queryClient, postId, { comments_count: data.comments_count })
      void queryClient.invalidateQueries({ queryKey: key })
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not post your comment. Please try again.')),
  })
  const remove = useMutation({
    mutationFn: (id: number) => del<{ comments_count: number }>(`/tourist/posts/${postId}/comments/${id}`),
    onSuccess: (data) => {
      if (data) patchPost(queryClient, postId, { comments_count: data.comments_count })
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const text = body.trim()
    if (!text) return setError('Write a comment first.')
    add.mutate(text)
  }

  const muted = dark ? 'text-white/60' : 'text-[#56615B]'
  const bubble = dark ? 'bg-white/10 text-white' : 'bg-[#F1F4F2] text-[#17201B]'

  return (
    <section aria-label="Comments" className="space-y-3">
      {query.isLoading ? <p className={`text-sm ${muted}`}>Loading comments…</p> : comments.length === 0 ? (
        <p className={`text-sm ${muted}`}>No comments yet{isTourist ? '. Be the first to comment.' : '.'}</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              {c.author.avatar
                ? <img src={toAssetUrl(c.author.avatar)} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                : <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${c.author.is_business ? 'bg-[#0F4D2B] text-white' : dark ? 'bg-white/15 text-white' : 'bg-[#E9F7EF] text-[#087F3F]'}`}>
                    {c.author.is_business ? <Store className="h-4 w-4" aria-hidden="true" /> : <UserRound className="h-4 w-4" aria-hidden="true" />}
                  </span>}
              <div className="min-w-0 flex-1">
                <div className={`inline-block max-w-full rounded-2xl px-3 py-2 ${bubble}`}>
                  <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold">
                    {c.author.name}
                    {c.author.is_business && (
                      <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-bold ${dark ? 'bg-[#F4B400] text-[#17201B]' : 'bg-[#EAF6ED] text-[#16803C]'}`}>
                        <BadgeCheck className="h-3 w-3" aria-hidden="true" /> Author
                      </span>
                    )}
                  </p>
                  <p className="whitespace-pre-line break-words text-sm">{c.body}</p>
                </div>
                <div className={`mt-0.5 flex items-center gap-3 px-2 text-xs ${muted}`}>
                  <span>{postedAgo(c.created_at)}</span>
                  {c.mine && (
                    <button type="button" onClick={() => remove.mutate(c.id)} disabled={remove.isPending} className="inline-flex items-center gap-1 font-semibold hover:underline" aria-label="Delete your comment">
                      <Trash2 className="h-3 w-3" aria-hidden="true" /> Delete
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <button type="button" onClick={() => query.fetchNextPage()} className={`text-sm font-semibold ${dark ? 'text-white' : 'text-[#087F3F]'} hover:underline`}>
          {query.isFetchingNextPage ? 'Loading…' : 'More comments'}
        </button>
      )}

      {isTourist ? (
        <form onSubmit={submit} className="flex items-end gap-2">
          <label htmlFor={`comment-${postId}`} className="sr-only">Write a comment</label>
          <textarea
            id={`comment-${postId}`}
            rows={1}
            maxLength={1000}
            value={body}
            autoFocus={autoFocus}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a comment…"
            className={`min-h-[40px] flex-1 resize-none rounded-2xl border px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#087F3F]/30 ${dark ? 'border-white/20 bg-white/10 text-white placeholder:text-white/50' : 'border-[#DDE5E0] bg-[#fff] text-[#17201B]'}`}
          />
          <button type="submit" disabled={add.isPending} aria-label="Post comment" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#087F3F] text-white hover:bg-[#066B35] disabled:opacity-50">
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
      ) : (
        <p className={`text-sm ${muted}`}><Link to="/login" className="font-semibold text-[#087F3F] hover:underline">Log in</Link> as a tourist to comment.</p>
      )}
      {error && <p role="alert" className="text-sm text-[#D14343]">{error}</p>}
    </section>
  )
}
