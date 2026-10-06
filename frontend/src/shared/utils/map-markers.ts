import L from 'leaflet'

// Canonical live-map markers shared by every rider/delivery/ride map:
// the delivery rider marker (green arrow), amber pickup pin, red destination
// pin. Single source of truth — extracted from the duplicated definitions that
// previously lived in TouristOrderStatus.tsx and RiderMap.tsx.

const riderArrowSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
  <filter id="mkr-shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.4"/>
  </filter>
  <g filter="url(#mkr-shadow)">
    <circle cx="22" cy="22" r="18" fill="#087F3F" stroke="#ffffff" stroke-width="3"/>
    <path d="M 22 10 L 30 29 L 22 24 L 14 29 Z" fill="#ffffff"/>
  </g>
</svg>
`.trim()

export const riderMarkerIcon = L.icon({
  iconUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(riderArrowSvg)}`,
  iconSize: [44, 44],
  iconAnchor: [22, 22],
  popupAnchor: [0, -22],
})

export const pickupMarkerIcon = L.divIcon({
  className: 'custom-pickup-marker',
  html: `
    <div style="
      width: 36px;
      height: 36px;
      background: #D97706;
      border: 2px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 3px 10px rgba(217, 119, 6, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18],
})

export const destinationMarkerIcon = L.divIcon({
  className: 'custom-delivery-marker',
  html: `
    <div style="
      width: 36px;
      height: 36px;
      background: #DC2626;
      border: 2px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 3px 10px rgba(220, 38, 38, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 19 21 12 17 5 21 12 2"/>
      </svg>
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18],
})