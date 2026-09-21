import L from 'leaflet'

const PIN_SHAPE =
  'M16 0.5 C23 0.5 29 6 29 14 C29 18.5 27.4 22 25.4 24.2 ' +
  'C23.6 26.2 19.6 29.2 16 31 C12.4 29.2 8.4 26.2 6.6 24.2 ' +
  'C4.6 22 3 18.5 3 14 C3 6 9 0.5 16 0.5Z'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function pinSvg(label = '', selected = false) {
  const labelHtml = label
    ? `<span class="marker-label" style="position:absolute;left:50%;top:var(--ty, 0px);white-space:nowrap;background:rgba(255,255,255,0.92);color:#064E2E;font:600 11px/1.2 system-ui,sans-serif;padding:3px 8px;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,0.25);transform:translateX(var(--tx, 18px));transition:transform .3s ease, top .3s ease;">${escapeHtml(label)}</span>`
    : ''
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="54" viewBox="-5 -7 46 52" style="position:absolute;left:0;top:0;">
    <path class="marker-shadow" d="${PIN_SHAPE}" fill="rgba(0,0,0,0.22)" stroke="none" style="transform:translate(var(--sx, 0px), var(--sy, 5px));transition:transform .25s ease;"/>
    <path d="${PIN_SHAPE}" fill="#fff" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="16" cy="13.5" r="14" fill="${selected ? '#087F3F' : '#EF5350'}" stroke="#fff" stroke-width="2.4"/>
    <svg x="9" y="6.5" width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M7 2v20" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </svg>${labelHtml}`
}

function makePinIcon(label = '', selected = false) {
  const el = document.createElement('div')
  el.style.width = '48px'
  el.style.height = '54px'
  el.innerHTML = pinSvg(label, selected)
  return L.divIcon({
    className: 'landing-pin',
    html: el.outerHTML,
    iconSize: [48, 54],
    iconAnchor: [24, 40],
  })
}

const iconCache = new Map<string, L.DivIcon>()

export function pinIcon(label = '', selected = false): L.DivIcon {
  const key = `${selected ? 's' : 'n'}|${label}`
  const cached = iconCache.get(key)
  if (cached) return cached
  const icon = makePinIcon(label, selected)
  if (iconCache.size > 500) iconCache.clear()
  iconCache.set(key, icon)
  return icon
}

function userPinSvg() {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="54" viewBox="-5 -7 46 52" style="position:absolute;left:0;top:0;">
    <path d="${PIN_SHAPE}" fill="rgba(0,0,0,0.22)" stroke="none" style="transform:translate(0px, 5px);"/>
    <path d="${PIN_SHAPE}" fill="#fff" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="16" cy="13.5" r="14" fill="#087F3F" stroke="#fff" stroke-width="2.4"/>
    <svg x="9" y="6.5" width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="7.5" r="3.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M4.5 20v-1.2a6.8 6.8 0 0 1 6.8-6.8h1.4a6.8 6.8 0 0 1 6.8 6.8V20" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </svg>`
}

export const userPinIcon = L.divIcon({
  className: 'landing-pin',
  html: userPinSvg(),
  iconSize: [48, 54],
  iconAnchor: [24, 40],
})

function beachPinSvg() {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="54" viewBox="-5 -7 46 52" style="position:absolute;left:0;top:0;">
    <path d="${PIN_SHAPE}" fill="rgba(0,0,0,0.22)" stroke="none" style="transform:translate(0px, 5px);"/>
    <path d="${PIN_SHAPE}" fill="#fff" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="16" cy="13.5" r="14" fill="#0EA5E9" stroke="#fff" stroke-width="2.4"/>
    <svg x="8" y="5.5" width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 10a9 9 0 0 1 18 0Z" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M2 10h20" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M12 10v11" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M12 21h5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
    </svg>
  </svg>`
}

export const beachPinIcon = L.divIcon({
  className: 'landing-pin',
  html: beachPinSvg(),
  iconSize: [48, 54],
  iconAnchor: [24, 40],
})