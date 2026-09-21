import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, put } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { toAssetUrl, cn } from '@/shared/utils'
import {
  Settings2, Video, Upload, Save, Plus, Trash2, Check,
  MapPin, Star, Link as LinkIcon, Film, LayoutGrid, Image as ImageIcon,
} from 'lucide-react'

interface LandingCategory {
  label: string
  color: string
  image: string
  tab: string
}

interface LandingSpot {
  title: string
  location: string
  rating: number
  category: string
}

interface LandingContent {
  hero_badge: string
  hero_title: string
  hero_title_highlight: string
  hero_subtitle: string
  hero_video: string
  categories: LandingCategory[]
  spots: LandingSpot[]
}

const inputClass =
  'w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50'

const sectionLabel = 'text-xs font-semibold uppercase tracking-wider text-gray-500'
const fieldLabel = 'block text-xs font-medium text-gray-400 mb-1.5'

export default function TourismOfficeLandingContent() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<LandingContent | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [saved, setSaved] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['to-landing-content'],
    queryFn: () => get<LandingContent>('/tourism-office/landing-content'),
  })

  useEffect(() => {
    if (data && !form) {
      setForm(data)
      setVideoUrl(data.hero_video ?? '')
    }
  }, [data, form])

  const saveMutation = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      if (!form) throw new Error('No content to save')
      fd.append('hero_badge', form.hero_badge)
      fd.append('hero_title', form.hero_title)
      fd.append('hero_title_highlight', form.hero_title_highlight)
      fd.append('hero_subtitle', form.hero_subtitle)
      fd.append('categories_json', JSON.stringify(form.categories))
      fd.append('spots_json', JSON.stringify(form.spots))
      if (videoFile) fd.append('hero_video', videoFile)
      if (videoUrl.trim()) fd.append('hero_video_url', videoUrl.trim())
      return put<LandingContent>('/tourism-office/landing-content', fd, { timeout: 300000 })
    },
    onSuccess: (updated) => {
      setForm(updated)
      setVideoFile(null)
      setVideoUrl(updated?.hero_video ?? '')
      queryClient.invalidateQueries({ queryKey: ['to-landing-content'] })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 3000)
    },
  })

  if (isLoading || !form) {
    return <DashboardSkeleton />
  }

  const setField = <K extends keyof LandingContent>(key: K, value: LandingContent[K]) => {
    setForm({ ...form, [key]: value })
  }

  const setCategory = (i: number, key: keyof LandingCategory, value: string) => {
    setField('categories', form.categories.map((c, idx) => (idx === i ? { ...c, [key]: value } : c)))
  }

  const addCategory = () => {
    setField('categories', [...form.categories, { label: '', color: '#087F3F', image: '', tab: 'places' }])
  }

  const removeCategory = (i: number) => {
    setField('categories', form.categories.filter((_, idx) => idx !== i))
  }

  const setSpot = (i: number, key: keyof LandingSpot, value: string | number) => {
    setField('spots', form.spots.map((s, idx) => (idx === i ? { ...s, [key]: value } : s)))
  }

  const addSpot = () => {
    setField('spots', [...form.spots, { title: '', location: '', rating: 5, category: 'Beach' }])
  }

  const removeSpot = (i: number) => {
    setField('spots', form.spots.filter((_, idx) => idx !== i))
  }

  const previewVideoSrc = videoUrl.startsWith('/storage/') ? toAssetUrl(videoUrl) : videoUrl

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600/20 flex items-center justify-center">
            <Settings2 className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-100">Landing Page Content</h1>
            <p className="text-sm text-gray-500">Edit what visitors see on the public landing page.</p>
          </div>
        </div>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className={cn(
            'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all',
            saveMutation.isPending
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
              : 'bg-emerald-600 text-white hover:bg-emerald-500'
          )}
        >
          <Save className="w-4 h-4" />
          {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {saved && (
        <div className="flex items-center gap-2 bg-emerald-900/30 border border-emerald-800/50 text-emerald-200 rounded-xl px-4 py-3 text-sm">
          <Check className="w-4 h-4" /> Landing page content saved.
        </div>
      )}

      {saveMutation.isError && (
        <div className="bg-red-900/30 border border-red-800/50 text-red-200 rounded-xl px-4 py-3 text-sm">
          Failed to save. Check that the video file is not too large (max 200MB) and try again.
        </div>
      )}

      {/* Hero */}
      <section className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Film className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-gray-200">Hero Section</h2>
        </div>

        <div>
          <label className={fieldLabel}>Badge (small text with pin icon)</label>
          <input
            className={inputClass}
            value={form.hero_badge}
            onChange={(e) => setField('hero_badge', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={fieldLabel}>Title (before highlighted word)</label>
            <input
              className={inputClass}
              value={form.hero_title}
              onChange={(e) => setField('hero_title', e.target.value)}
            />
          </div>
          <div>
            <label className={fieldLabel}>Title highlight (colored word)</label>
            <input
              className={inputClass}
              value={form.hero_title_highlight}
              onChange={(e) => setField('hero_title_highlight', e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className={fieldLabel}>Subtitle</label>
          <textarea
            className={inputClass}
            rows={2}
            value={form.hero_subtitle}
            onChange={(e) => setField('hero_subtitle', e.target.value)}
          />
        </div>

        <div className="space-y-3">
          <label className={fieldLabel}>Background Video</label>
          <div className="rounded-xl overflow-hidden border border-gray-700/50 aspect-video w-full max-w-md bg-gray-800 flex items-center justify-center">
            {previewVideoSrc ? (
              <video key={videoUrl} src={previewVideoSrc} controls muted preload="metadata" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-500">
                <Video className="w-8 h-8" />
                <p className="text-xs">No video</p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-700 bg-gray-800/60 text-sm text-gray-300 hover:bg-gray-800 cursor-pointer">
              <Upload className="w-4 h-4" />
              {videoFile ? videoFile.name : 'Upload new video'}
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) {
                    setVideoFile(file)
                    setVideoUrl(URL.createObjectURL(file))
                  }
                }}
              />
            </label>
            <div className="flex-1 min-w-[220px]">
              <div className="relative">
                <LinkIcon className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  className={cn(inputClass, 'pl-9')}
                  placeholder="...or paste a video URL"
                  value={videoUrl.startsWith('blob:') ? '' : videoUrl}
                  onChange={(e) => {
                    setVideoUrl(e.target.value)
                    setVideoFile(null)
                  }}
                />
              </div>
            </div>
            <button
              onClick={() => {
                setVideoUrl('/assets/tracktour-web.mp4')
                setVideoFile(null)
              }}
              className="px-3 py-2 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-gray-200"
            >
              Reset to default
            </button>
          </div>
          <p className="text-xs text-gray-500">Supports MP4, MOV, WEBM up to 200MB. Leave unchanged to keep the current video.</p>
        </div>
      </section>

      {/* Categories */}
      <section className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutGrid className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-gray-200">Explore Categories</h2>
          </div>
          <button onClick={addCategory} className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300">
            <Plus className="w-4 h-4" /> Add Category
          </button>
        </div>
        <p className={sectionLabel}>The 4 cards that link visitors into each category page.</p>

        <div className="space-y-4">
          {form.categories.map((cat, i) => (
            <div key={i} className="flex flex-wrap items-end gap-3 border border-gray-800/60 rounded-xl p-4 bg-gray-900/40">
              <div className="w-32">
                <label className={fieldLabel}>Label</label>
                <input className={inputClass} value={cat.label} onChange={(e) => setCategory(i, 'label', e.target.value)} />
              </div>
              <div className="w-28">
                <label className={fieldLabel}>Tab</label>
                <input className={inputClass} value={cat.tab} onChange={(e) => setCategory(i, 'tab', e.target.value)} />
              </div>
              <div className="w-24">
                <label className={fieldLabel}>Color</label>
                <input type="color" className="h-[38px] w-full bg-gray-800/60 border border-gray-700/50 rounded-xl cursor-pointer" value={cat.color} onChange={(e) => setCategory(i, 'color', e.target.value)} />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className={fieldLabel}>Image URL</label>
                <input className={inputClass} value={cat.image} onChange={(e) => setCategory(i, 'image', e.target.value)} />
              </div>
              <div className="w-24 h-16 rounded-lg overflow-hidden border border-gray-700/50 flex items-center justify-center bg-gray-800">
                {cat.image ? (
                  <img src={cat.image} alt="" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="w-4 h-4 text-gray-600" />
                )}
              </div>
              <button onClick={() => removeCategory(i)} className="p-2 text-gray-500 hover:text-red-400 rounded-lg hover:bg-gray-800">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Promo spots */}
      <section className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-gray-200">Promo Spot Cards</h2>
          </div>
          <button onClick={addSpot} className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300">
            <Plus className="w-4 h-4" /> Add Spot
          </button>
        </div>
        <p className={sectionLabel}>The tourist spot cards shown below the categories.</p>

        <div className="space-y-4">
          {form.spots.map((spot, i) => (
            <div key={i} className="flex flex-wrap items-end gap-3 border border-gray-800/60 rounded-xl p-4 bg-gray-900/40">
              <div className="w-52">
                <label className={fieldLabel}>Title</label>
                <input className={inputClass} value={spot.title} onChange={(e) => setSpot(i, 'title', e.target.value)} />
              </div>
              <div className="w-40">
                <label className={fieldLabel}>Location</label>
                <input className={inputClass} value={spot.location} onChange={(e) => setSpot(i, 'location', e.target.value)} />
              </div>
              <div className="w-24">
                <label className={fieldLabel}>Rating</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="5"
                  className={inputClass}
                  value={spot.rating}
                  onChange={(e) => setSpot(i, 'rating', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="w-32">
                <label className={fieldLabel}>Category</label>
                <input className={inputClass} value={spot.category} onChange={(e) => setSpot(i, 'category', e.target.value)} />
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-gray-800/60 border border-gray-700/50 px-3 py-2 text-xs text-gray-400">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                Preview
              </div>
              <button onClick={() => removeSpot(i)} className="p-2 text-gray-500 hover:text-red-400 rounded-lg hover:bg-gray-800">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="flex justify-end">
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className={cn(
            'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all',
            saveMutation.isPending
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
              : 'bg-emerald-600 text-white hover:bg-emerald-500'
          )}
        >
          <Save className="w-4 h-4" />
          {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}