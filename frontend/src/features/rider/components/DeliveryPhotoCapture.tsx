import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, CheckCircle2, Loader2, RefreshCw, Send, X } from 'lucide-react'

/** Longest side of the saved photo (px): sharp enough as proof, small to upload. */
const MAX_EDGE_PX = 1600
const JPEG_QUALITY = 0.85

type Step = 'live' | 'review'

function canUseLiveCamera(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
}

/** Draw the current video frame into a JPEG file (scaled down to MAX_EDGE_PX). */
function grabFrame(video: HTMLVideoElement): Promise<File | null> {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) return Promise.resolve(null)
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ? new File([blob], `delivery-proof-${Date.now()}.jpg`, { type: 'image/jpeg' }) : null),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

/**
 * Proof of delivery (rider, at the drop-off): a photo of the tourist
 * receiving the food. "Open camera" shows the rear camera live inside the app;
 * the rider takes the shot, checks it, and taps "Submit photo". Only then does
 * the parent get the file (and enable "Confirm Delivered").
 *
 * Where the browser can't open a live camera (no getUserMedia, e.g. the app
 * opened over plain http on a phone, or the permission was refused) it falls
 * back to the phone's camera app (`<input capture="environment">`), and the
 * shot still goes through the same review + Submit step.
 */
export function DeliveryPhotoCapture({ photo, onSubmit, note }: {
  /** The submitted photo, if any. */
  photo: File | null
  /** Called with the photo when the rider taps "Submit photo". */
  onSubmit: (photo: File) => void
  /** Small print under the button (e.g. the 50 m / COD reminder). */
  note?: string
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('live')
  const [shot, setShot] = useState<File | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fallbackInput = useRef<HTMLInputElement | null>(null)

  const shotUrl = useObjectUrl(shot)
  const photoUrl = useObjectUrl(photo)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  // Live camera while the camera step is open; always released afterwards.
  useEffect(() => {
    if (!open || step !== 'live' || !canUseLiveCamera()) return
    let cancelled = false
    setStarting(true)
    setCameraError(null)
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          void video.play?.()?.catch?.(() => {})
        }
      })
      .catch(() => {
        if (!cancelled) setCameraError("Couldn't open the camera. Allow camera access, or use your phone's camera app.")
      })
      .finally(() => {
        if (!cancelled) setStarting(false)
      })
    return () => {
      cancelled = true
      stopCamera()
    }
  }, [open, step, stopCamera])

  const openCamera = () => {
    setShot(null)
    setCameraError(null)
    setStep('live')
    if (canUseLiveCamera()) {
      setOpen(true)
    } else {
      // No live camera in this browser: the phone's camera app (same tap, so it's allowed).
      fallbackInput.current?.click()
    }
  }

  const close = () => {
    stopCamera()
    setOpen(false)
    setShot(null)
  }

  const takePhoto = async () => {
    const video = videoRef.current
    if (!video) return
    const file = await grabFrame(video)
    if (!file) {
      setCameraError('The camera is not ready yet. Try again in a moment.')
      return
    }
    stopCamera()
    setShot(file)
    setStep('review')
  }

  const retake = () => {
    setShot(null)
    if (canUseLiveCamera() && !cameraError) setStep('live')
    else fallbackInput.current?.click()
  }

  const submit = () => {
    if (!shot) return
    onSubmit(shot)
    close()
  }

  const fallback = (
    <input
      ref={fallbackInput}
      type="file"
      accept="image/*"
      capture="environment"
      aria-label="Take a photo of the tourist receiving the food"
      className="sr-only"
      onChange={(e) => {
        const file = e.target.files?.[0] ?? null
        e.target.value = ''
        if (!file) return
        stopCamera()
        setShot(file)
        setStep('review')
        setOpen(true)
      }}
    />
  )

  return (
    <div className="space-y-2">
      {fallback}
      {photo && photoUrl ? (
        <div className="flex items-center gap-3 rounded-xl border border-[#CFE8D6] bg-[#F4FBF6] p-2">
          <img src={photoUrl} alt="Submitted delivery photo" className="h-16 w-16 rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            <p className="inline-flex items-center gap-1 text-sm font-bold text-[#16803C]">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Photo submitted
            </p>
            <p className="text-xs text-[#6B7280]">You can now confirm the delivery.</p>
          </div>
          <button
            type="button"
            onClick={openCamera}
            className="inline-flex items-center gap-1 rounded-lg bg-[#F3F4F6] px-3 py-2 text-xs font-bold text-[#17201B] hover:bg-[#E5E7EB]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retake
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={openCamera}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#16803C] bg-[#FFFFFF] py-3.5 text-sm font-bold text-[#16803C] hover:bg-[#F0FDF4]"
        >
          <Camera className="h-4 w-4" aria-hidden="true" /> Open camera
        </button>
      )}
      <p className="text-xs text-[#6B7280]">
        Take a photo of the tourist receiving the food, then submit it.{note ? ` ${note}` : ''}
      </p>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Delivery photo camera"
          className="fixed inset-0 z-[10000] flex flex-col bg-black text-white"
        >
          <div className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
            <p className="text-sm font-bold">
              {step === 'live' ? 'Photo of the tourist receiving the food' : 'Check the photo'}
            </p>
            <button type="button" onClick={close} aria-label="Close camera" className="rounded-full bg-white/15 p-2 hover:bg-white/25">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="relative flex flex-1 items-center justify-center overflow-hidden">
            {step === 'live' ? (
              <>
                <video
                  ref={videoRef}
                  data-testid="delivery-camera-video"
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
                {starting && !cameraError && (
                  <Loader2 className="absolute h-8 w-8 animate-spin text-white/80" aria-label="Starting camera" />
                )}
                {cameraError && (
                  <div className="absolute inset-x-4 rounded-xl bg-white p-4 text-center text-[#17201B]">
                    <p role="alert" className="text-sm font-medium">{cameraError}</p>
                    <button
                      type="button"
                      onClick={() => fallbackInput.current?.click()}
                      className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#16803C] px-4 py-2.5 text-sm font-bold text-white"
                    >
                      <Camera className="h-4 w-4" aria-hidden="true" /> Use phone camera app
                    </button>
                  </div>
                )}
              </>
            ) : (
              shotUrl && <img src={shotUrl} alt="Photo preview" className="h-full w-full object-contain" />
            )}
          </div>

          <div className="flex items-center justify-center gap-3 px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            {step === 'live' ? (
              <button
                type="button"
                onClick={takePhoto}
                disabled={starting || !!cameraError}
                aria-label="Take photo"
                className="h-[72px] w-[72px] rounded-full border-4 border-white bg-white/90 shadow-lg transition active:scale-95 disabled:opacity-40"
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={retake}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-white/15 py-3.5 text-base font-bold hover:bg-white/25"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retake
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!shot}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[#16803C] py-3.5 text-base font-bold text-white hover:bg-[#126B32] disabled:opacity-50"
                >
                  <Send className="h-4 w-4" aria-hidden="true" /> Submit photo
                </button>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

/** Object URL for a file, revoked when it changes or unmounts. */
function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file) {
      setUrl(null)
      return
    }
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  return url
}
