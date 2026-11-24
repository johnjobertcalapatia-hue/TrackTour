/** SOS (2026-11-18): what the sender sees about their own alert. */
export interface SenderSos {
  id: number
  reference: string
  status: 'pending' | 'acknowledged' | 'responding' | 'resolved'
  active: boolean
  raised_at: string | null
  acknowledged_at: string | null
  responding_at: string | null
  responder: string | null
  sender_safe_at: string | null
  resolved_at: string | null
}

export interface SosLocation {
  latitude: number
  longitude: number
  accuracy: number | null
}

/** The device's position for an SOS, or null (never blocks sending). */
export function deviceFix(timeoutMs = 5000): Promise<SosLocation | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    let settled = false
    const done = (v: SosLocation | null) => { if (!settled) { settled = true; resolve(v) } }
    const guard = setTimeout(() => done(null), timeoutMs + 500)
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(guard); done({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy ?? null }) },
      () => { clearTimeout(guard); done(null) },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    )
  })
}

/** Headline and detail for the sender's SOS card. */
export function sosStatusText(sos: SenderSos): { title: string; body: string } {
  if (!sos.active) return { title: 'SOS closed', body: 'The Bansud Tourism Office closed your SOS.' }
  if (sos.status === 'responding') {
    return { title: 'Help is on the way', body: sos.responder ? `${sos.responder} has been sent to you.` : 'The Tourism Office has sent help.' }
  }
  if (sos.status === 'acknowledged') return { title: 'The Tourism Office has seen your SOS', body: 'They are arranging help now.' }
  return { title: 'SOS sent', body: 'The Bansud Tourism Office has been alerted with your location.' }
}
