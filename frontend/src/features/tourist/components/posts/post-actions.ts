import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { del, post as postRequest } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { postLink, type FeedPage, type FeedPost } from '@/shared/components/posts/post-types'

/** Apply a change to one post in every cached feed page and its single-post query. */
export function patchPost(queryClient: QueryClient, id: number, changes: Partial<FeedPost> | ((p: FeedPost) => Partial<FeedPost>)) {
  const apply = (p: FeedPost) => (p.id === id ? { ...p, ...(typeof changes === 'function' ? changes(p) : changes) } : p)
  queryClient.setQueriesData<InfiniteData<FeedPage>>({ queryKey: ['tourist-posts'] }, (data) => data && {
    ...data,
    pages: data.pages.map((page) => page && ({ ...page, data: page.data.map(apply) })),
  })
  queryClient.setQueriesData<FeedPost>({ queryKey: ['tourist-post', id] }, (p) => p && apply(p))
}

/** Same for every post of one business (Follow is per business). */
function patchBusiness(queryClient: QueryClient, businessId: number, following: boolean) {
  const apply = (p: FeedPost) => (p.business_id === businessId && p.business ? { ...p, business: { ...p.business, following } } : p)
  queryClient.setQueriesData<InfiniteData<FeedPage>>({ queryKey: ['tourist-posts'] }, (data) => data && {
    ...data,
    pages: data.pages.map((page) => page && ({ ...page, data: page.data.map(apply) })),
  })
  queryClient.setQueriesData<FeedPost>({ queryKey: ['tourist-post'] }, (p) => p && apply(p))
}

/**
 * Like, save, share and follow for one post. The server enforces one like,
 * save and follow per tourist and counts shares once a day per viewer; the
 * page updates at once and then takes the server's counts.
 */
export function usePostActions(post: FeedPost) {
  const user = useAuthStore((s) => s.user)
  const isTourist = user?.role === 'tourist'
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState('')

  const like = useMutation({
    mutationFn: (on: boolean) => (on ? postRequest<{ likes_count: number }>(`/tourist/posts/${post.id}/like`) : del<{ likes_count: number }>(`/tourist/posts/${post.id}/like`)),
    onMutate: (on) => patchPost(queryClient, post.id, (p) => ({ liked: on, likes_count: Math.max(0, p.likes_count + (on ? 1 : -1)) })),
    onSuccess: (data, on) => data && patchPost(queryClient, post.id, { liked: on, likes_count: data.likes_count }),
    onError: (_e, on) => patchPost(queryClient, post.id, (p) => ({ liked: !on, likes_count: Math.max(0, p.likes_count + (on ? -1 : 1)) })),
  })

  const save = useMutation({
    mutationFn: (on: boolean) => (on ? postRequest<{ saves_count: number }>(`/tourist/posts/${post.id}/save`) : del<{ saves_count: number }>(`/tourist/posts/${post.id}/save`)),
    onMutate: (on) => patchPost(queryClient, post.id, (p) => ({ saved: on, saves_count: Math.max(0, p.saves_count + (on ? 1 : -1)) })),
    onSuccess: (data, on) => {
      if (data) patchPost(queryClient, post.id, { saved: on, saves_count: data.saves_count })
      setNotice(on ? 'Saved to your saved posts.' : 'Removed from your saved posts.')
      void queryClient.invalidateQueries({ queryKey: ['tourist-posts', 'saved'] })
    },
    onError: (_e, on) => patchPost(queryClient, post.id, (p) => ({ saved: !on, saves_count: Math.max(0, p.saves_count + (on ? -1 : 1)) })),
  })

  const follow = useMutation({
    mutationFn: (on: boolean) => (on ? postRequest(`/tourist/businesses/${post.business_id}/follow`) : del(`/tourist/businesses/${post.business_id}/follow`)),
    onMutate: (on) => patchBusiness(queryClient, post.business_id, on),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tourist-posts', 'following'] }),
    onError: (_e, on) => patchBusiness(queryClient, post.business_id, !on),
  })

  const share = async () => {
    const url = postLink(post.id)
    let channel: 'native' | 'link' | null = null
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: post.business?.name ?? 'TrackTour post', text: post.caption ?? undefined, url })
        channel = 'native'
      } else {
        await navigator.clipboard.writeText(url)
        channel = 'link'
        setNotice('Link copied.')
      }
    } catch {
      return // the tourist closed the share sheet, or the clipboard is blocked: nothing shared
    }
    try {
      const data = await postRequest<{ shares_count: number }>(`/tourist/posts/${post.id}/share`, { channel })
      if (data) patchPost(queryClient, post.id, { shares_count: data.shares_count })
    } catch { /* the share happened; the count can wait */ }
  }

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(''), 2500)
    return () => window.clearTimeout(t)
  }, [notice])

  return { isTourist, like, save, follow, share, notice }
}

const reported = new Set<number>()

/**
 * Report a view when at least half of the post is on screen for one second
 * (or at once with `immediate`, e.g. the media viewer). Reported once per
 * post per page load; the server applies the real rule (once per viewer per
 * 30 minutes), so refreshes and replays never inflate the count.
 */
export function useTrackView(postId: number, immediate = false) {
  const ref = useRef<HTMLElement | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (reported.has(postId)) return
    const send = () => {
      if (reported.has(postId)) return
      reported.add(postId)
      postRequest<{ counted: boolean; views_count: number }>(`/tourist/posts/${postId}/view`)
        .then((data) => data && patchPost(queryClient, postId, { views_count: data.views_count }))
        .catch(() => reported.delete(postId))
    }
    if (immediate) { send(); return }
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    let timer: number | undefined
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) timer = window.setTimeout(send, 1000)
      else window.clearTimeout(timer)
    }, { threshold: 0.5 })
    observer.observe(el)
    return () => { observer.disconnect(); window.clearTimeout(timer) }
  }, [postId, immediate, queryClient])

  return ref
}

/** For tests. */
export function resetReportedViews() {
  reported.clear()
}
