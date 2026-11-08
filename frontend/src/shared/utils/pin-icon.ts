import L from 'leaflet'

const PIN_SHAPE =
  'M16 0.5 C23 0.5 29 6 29 14 C29 18.5 27.4 22 25.4 24.2 ' +
  'C23.6 26.2 19.6 29.2 16 31 C12.4 29.2 8.4 26.2 6.6 24.2 ' +
  'C4.6 22 3 18.5 3 14 C3 6 9 0.5 16 0.5Z'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Wraps a marker's whole artwork (pin + name label) in one element that turns
 * about the pin's tip. On the rotating tourist navigation map, CSS rotates
 * this wrapper by the map bearing, so the restaurant name turns *with* its pin
 * (following the compass) and stays readable, instead of spinning off on its
 * own. Without that CSS it renders exactly as before.
 */
function rotatable(html: string, [w, h]: [number, number], [ax, ay]: [number, number]): string {
  return `<div class="marker-rot" style="position:relative;width:${w}px;height:${h}px;transform-origin:${ax}px ${ay}px;">${html}</div>`
}

export function pinSvg(label = '', selected = false) {
  const labelHtml = label
    ? `<span class="marker-label" style="position:absolute;left:50%;top:var(--ty, 0px);white-space:nowrap;background:rgba(255,255,255,0.92);color:#064E2E;font:600 11px/1.2 system-ui,sans-serif;padding:3px 8px;border-radius:10px;transform:translateX(var(--tx, 18px));transition:transform .3s ease, top .3s ease;">${escapeHtml(label)}</span>`
    : ''
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="54" viewBox="-5 -7 46 52" style="position:absolute;left:0;top:0;">
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
  return L.divIcon({
    className: 'landing-pin',
    html: rotatable(pinSvg(label, selected), [48, 54], [24, 40]),
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

const logoIconCache = new Map<string, L.DivIcon>()

export function businessLogoIcon(src: string, label = '', selected = false): L.DivIcon {
  const key = `${selected ? 's' : 'n'}|${src}|${label}`
  const cached = logoIconCache.get(key)
  if (cached) return cached

  const labelHtml = label
    ? `<span style="position:absolute;left:42px;top:16px;white-space:nowrap;background:rgba(255,255,255,0.94);color:#064E2E;font:600 11px/1.2 system-ui,sans-serif;padding:4px 8px;border-radius:10px;box-shadow:none;transform:translateY(-50%);">${escapeHtml(label)}</span>`
    : ''
  const html = `<div style="position:relative;width:48px;height:54px;"><div style="position:absolute;left:18px;top:29px;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:11px solid #087F3F;"></div><div style="position:absolute;left:8px;top:0;width:32px;height:32px;box-sizing:border-box;border:3px solid #087F3F;border-radius:50%;background:#087F3F;overflow:hidden;"><img src="${escapeHtml(src)}" alt="" style="display:block;width:100%;height:100%;border-radius:50%;object-fit:cover;" /></div></div>${labelHtml}`
  const icon = L.divIcon({
    className: 'landing-pin',
    html: rotatable(html, [48, 54], [24, 40]),
    iconSize: [48, 54],
    iconAnchor: [24, 40],
  })

  if (logoIconCache.size > 500) logoIconCache.clear()
  logoIconCache.set(key, icon)
  return icon
}

function userPinSvg(includeShadow = true) {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="54" viewBox="-5 -7 46 52" style="position:absolute;left:0;top:0;">
    ${includeShadow ? `<path d="${PIN_SHAPE}" fill="rgba(0,0,0,0.22)" stroke="none" style="transform:translate(0px, 5px);"/>` : ''}
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
  html: rotatable(userPinSvg(), [48, 54], [24, 40]),
  iconSize: [48, 54],
  iconAnchor: [24, 40],
})

export const checkoutPinIcon = L.divIcon({
  className: 'checkout-location-pin',
  html: userPinSvg(false),
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
  html: rotatable(beachPinSvg(), [48, 54], [24, 40]),
  iconSize: [48, 54],
  iconAnchor: [24, 40],
})
const profileIconCache = new Map<string, L.DivIcon>()

/**
 * "You are here" pin with the tourist's profile photo: the same round image
 * pin as restaurants (businessLogoIcon), in the same brand green and
 * slightly larger so it stands apart from business markers. Without a photo it shows the initials.
 */
export function profilePinIcon(photoUrl: string | null | undefined, initials = ''): L.DivIcon {
  const key = `${photoUrl ?? ''}|${initials}`
  const cached = profileIconCache.get(key)
  if (cached) return cached

  const face = photoUrl
    ? `<img src="${escapeHtml(photoUrl)}" alt="" style="display:block;width:100%;height:100%;border-radius:50%;object-fit:cover;" />`
    : `<span style="display:flex;width:100%;height:100%;align-items:center;justify-content:center;color:#fff;font:700 13px/1 system-ui,sans-serif;">${escapeHtml(initials.slice(0, 2).toUpperCase())}</span>`
  const html = `<div class="profile-pin" style="position:relative;width:48px;height:54px;"><div style="position:absolute;left:17px;top:33px;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:12px solid #087F3F;"></div><div style="position:absolute;left:5px;top:0;width:38px;height:38px;box-sizing:border-box;border:3px solid #087F3F;border-radius:50%;background:#087F3F;overflow:hidden;">${face}</div></div>`
  const icon = L.divIcon({
    className: 'landing-pin user-location-pin',
    html: rotatable(html, [48, 54], [24, 45]),
    iconSize: [48, 54],
    iconAnchor: [24, 45],
  })
  if (profileIconCache.size > 50) profileIconCache.clear()
  profileIconCache.set(key, icon)
  return icon
}
