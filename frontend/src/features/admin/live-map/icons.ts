import L from 'leaflet'
import { ACTIVITY_META, TOURIST_COLOR, type RiderActivity } from './types'

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Round rider marker: photo or initials, ringed in the activity colour, name below when selected. */
export function riderIcon(opts: { photo: string | null; initials: string; activity: RiderActivity; name: string; selected: boolean; stale: boolean; sos?: boolean }): L.DivIcon {
  const color = opts.sos ? '#DC2626' : ACTIVITY_META[opts.activity].color
  const size = opts.selected ? 46 : 38
  // Initials always sit underneath; a photo covers them and removes itself if it fails to load.
  const face = `<span style="display:flex;width:100%;height:100%;align-items:center;justify-content:center;color:#fff;font:700 14px/1 Poppins,system-ui,sans-serif">${esc(opts.initials)}</span>`
    + (opts.photo ? `<img src="${esc(opts.photo)}" alt="" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%" />` : '')
  const label = opts.selected
    ? `<span style="position:absolute;top:${size + 4}px;left:50%;transform:translateX(-50%);white-space:nowrap;background:#0F2E1D;color:#fff;font:600 11px/1.2 Poppins,system-ui,sans-serif;padding:3px 8px;border-radius:999px;box-shadow:0 2px 6px rgba(0,0,0,.25)">${esc(opts.name)}</span>`
    : ''
  // The rider pressed SOS: red radar waves around the rider's own marker.
  const sosRadar = opts.sos
    ? `<div class="sos-radar" style="--c:#DC2626;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)"><span></span><span></span><span></span></div>`
      + `<span style="position:absolute;left:50%;top:-18px;transform:translateX(-50%);background:#DC2626;color:#fff;border:2px solid #fff;border-radius:999px;padding:1px 6px;font:800 9px/1.4 Poppins,system-ui,sans-serif;letter-spacing:.05em;box-shadow:0 2px 6px rgba(0,0,0,.3)">SOS</span>`
    : ''
  const staleBadge = opts.stale
    ? `<span title="Last GPS update is old" style="position:absolute;right:-4px;bottom:-4px;width:18px;height:18px;border-radius:50%;background:#6B7280;border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font:700 10px/1 system-ui,sans-serif">&#9719;</span>`
    : ''
  return L.divIcon({
    className: 'admin-live-rider',
    html: `<div style="position:relative;width:${size}px;height:${size}px">${sosRadar}<div style="position:relative;width:100%;height:100%;border-radius:50%;border:3px solid ${color};background:${color};box-shadow:0 0 0 2px #fff,0 3px 10px rgba(0,0,0,.35);overflow:hidden">${face}</div>${staleBadge}${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

/** Small numbered stop marker: pickup (amber, ✓ when collected) or drop-off (flag). */
export function stopIcon(kind: 'pickup' | 'dropoff', text: string, done = false): L.DivIcon {
  const bg = kind === 'dropoff' ? '#DC2626' : done ? '#9CA3AF' : '#F59E0B'
  const glyph = kind === 'dropoff' ? '⚑' : done ? '✓' : esc(text)
  return L.divIcon({
    className: 'admin-live-stop',
    html: `<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${bg};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font:700 12px/1 system-ui,sans-serif">${glyph}</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
  })
}

/** SOS pin with expanding radar rings (keyframes live in the page stylesheet). */
export function sosRadarIcon(pending: boolean): L.DivIcon {
  const color = pending ? '#DC2626' : '#F97316'
  return L.divIcon({
    className: 'admin-live-sos',
    html: `<div class="sos-radar" style="--c:${color}"><span></span><span></span><span></span><b>SOS</b></div>`,
    iconSize: [120, 120],
    iconAnchor: [60, 60],
  })
}

/**
 * Town marker for the zoomed-out view: the municipality logo (or its initial)
 * with a count badge and the town name beside it, like a travel-map cluster.
 */
export function municipalityIcon(opts: { name: string; logo: string | null; count: number; selected: boolean }): L.DivIcon {
  const ring = opts.selected ? '#FFD000' : '#fff'
  const face = opts.logo
    ? `<img src="${esc(opts.logo)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;background:#fff" />`
    : `<span style="display:flex;width:100%;height:100%;align-items:center;justify-content:center;color:#fff;font:700 15px/1 Poppins,system-ui,sans-serif">${esc(opts.name.charAt(0).toUpperCase())}</span>`
  const badgeBg = opts.count > 0 ? '#17201A' : '#9CA3AF'
  return L.divIcon({
    className: 'admin-live-town',
    html: `<div style="position:relative;width:44px;height:44px;cursor:pointer">
      <div style="width:44px;height:44px;border-radius:50%;background:#0B5D2E;border:3px solid ${ring};box-shadow:0 3px 10px rgba(0,0,0,.35);overflow:hidden">${face}</div>
      <span style="position:absolute;top:-6px;right:-8px;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:${badgeBg};color:#fff;border:2px solid #fff;font:700 11px/18px Poppins,system-ui,sans-serif;text-align:center;box-sizing:border-box">${opts.count}</span>
      <span style="position:absolute;left:52px;top:50%;transform:translateY(-50%);white-space:nowrap;background:rgba(255,255,255,.95);color:#17201A;font:700 11px/1 Poppins,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:5px 8px;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.2)">${esc(opts.name)}</span>
    </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  })
}

/** Tourist sharing their location: violet round marker with photo or initials. */
export function touristIcon(opts: { photo: string | null; initials: string; name: string; selected: boolean }): L.DivIcon {
  const size = opts.selected ? 40 : 32
  const face = `<span style="display:flex;width:100%;height:100%;align-items:center;justify-content:center;color:#fff;font:700 12px/1 Poppins,system-ui,sans-serif">${esc(opts.initials)}</span>`
    + (opts.photo ? `<img src="${esc(opts.photo)}" alt="" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%" />` : '')
  const label = opts.selected
    ? `<span style="position:absolute;top:${size + 4}px;left:50%;transform:translateX(-50%);white-space:nowrap;background:${TOURIST_COLOR};color:#fff;font:600 11px/1.2 Poppins,system-ui,sans-serif;padding:3px 8px;border-radius:999px;box-shadow:0 2px 6px rgba(0,0,0,.25)">${esc(opts.name)}</span>`
    : ''
  return L.divIcon({
    className: 'admin-live-tourist',
    html: `<div style="position:relative;width:${size}px;height:${size}px"><div style="position:relative;width:100%;height:100%;border-radius:50%;border:3px solid ${TOURIST_COLOR};background:${TOURIST_COLOR};box-shadow:0 0 0 2px #fff,0 3px 10px rgba(0,0,0,.35);overflow:hidden">${face}</div>${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}
