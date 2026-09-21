import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { ArrowUp, Search, Volume2, VolumeX, GitFork } from 'lucide-react'

interface ActiveNavigationMapProps {
  riderLatitude?: number
  riderLongitude?: number
  headingDegrees?: number
  currentSpeed?: number
  nextInstruction?: string
  routeCoordinates?: [number, number][]
}

export default function ActiveNavigationMap({
  riderLatitude = 14.5995,
  riderLongitude = 120.9842,
  headingDegrees = 0,
  currentSpeed = 0,
  nextInstruction = 'Strong Republic Nautical Highway',
  routeCoordinates,
}: ActiveNavigationMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const [isMuted, setIsMuted] = useState(false)

  // Step 1: Initialize the core WebGL map container environment
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          'dark-matter-tiles': {
            type: 'raster',
            tiles: ['https://cartocdn.com/dark_all/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; CARTO',
          },
        },
        layers: [
          {
            id: 'dark-matter-layer',
            type: 'raster',
            source: 'dark-matter-tiles',
            minzoom: 0,
            maxzoom: 20,
          },
        ],
      },
      center: [riderLongitude, riderLatitude],
      zoom: 16.5,
      pitch: 60, // Force 3D horizon ground tilt angle
      bearing: headingDegrees, // Rotate camera viewpoint to face target direction
      attributionControl: false,
    })

    mapRef.current = map

    // Create a custom element for the current location pulse indicator node
    const el = document.createElement('div')
    el.className =
      'w-7 h-7 bg-blue-500 rounded-full border-3 border-white shadow-[0_0_20px_rgba(59,130,246,0.9)] animate-pulse flex items-center justify-center'

    // Affix the tracking marker onto the layer grid bounds
    markerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat([riderLongitude, riderLatitude])
      .addTo(map)

    // Inject custom path layout models once styles complete rendering
    map.on('load', () => {
      const coords = routeCoordinates || [
        [riderLongitude, riderLatitude],
        [riderLongitude + 0.002, riderLatitude + 0.005],
        [riderLongitude + 0.003, riderLatitude + 0.009],
      ]

      map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: coords,
          },
        },
      })

      // Render the glowing aqua polyline framework
      map.addLayer({
        id: 'route-layer',
        type: 'line',
        source: 'route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#00e5ff', // Neon aqua route color
          'line-width': 7,
          'line-opacity': 0.95,
        },
      })
    })

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  // Step 2: Push fluent updates whenever live location or hardware sensors tick updates
  useEffect(() => {
    if (!mapRef.current) return

    mapRef.current.easeTo({
      center: [riderLongitude, riderLatitude],
      bearing: headingDegrees,
      duration: 800,
      essential: true,
    })

    if (markerRef.current) {
      markerRef.current.setLngLat([riderLongitude, riderLatitude])
    }

    if (mapRef.current.isStyleLoaded() && mapRef.current.getSource('route') && routeCoordinates) {
      const source = mapRef.current.getSource('route') as maplibregl.GeoJSONSource
      source.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: routeCoordinates,
        },
      })
    }
  }, [riderLatitude, riderLongitude, headingDegrees, routeCoordinates])

  return (
    <div className="relative w-full h-screen bg-[#001d29] overflow-hidden font-sans select-none text-white">
      {/* 🗺️ FREE MAPLIBRE CANVAS ENGINE VIEW */}
      <div ref={mapContainerRef} className="absolute inset-0 z-0 w-full h-full" />

      {/* 🟢 TOP CONTROLS HUD: BANNER FOR CURRENT DIRECTIONAL MANEUVER */}
      <div className="absolute top-4 left-4 right-4 z-10 flex items-center bg-[#004d40] p-4 rounded-xl shadow-xl border border-[#005d4e]">
        <div className="mr-4 text-3xl font-extrabold flex items-center justify-center animate-bounce text-emerald-300">
          <ArrowUp className="w-8 h-8 stroke-[3]" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-xs text-emerald-300 font-semibold tracking-wider uppercase">toward</span>
          <span className="text-lg font-bold truncate max-w-[240px]">{nextInstruction}</span>
        </div>
      </div>

      {/* 🔵 BOTTOM LEFT HUD: REALTIME SPEEDOMETER NODE */}
      <div className="absolute bottom-6 left-4 z-10 flex flex-col items-center justify-center w-14 h-14 bg-black/85 rounded-full border border-gray-800 shadow-xl">
        <span className="text-sm font-mono font-bold tracking-tight">
          {currentSpeed > 0 ? currentSpeed : '--'}
        </span>
        <span className="text-[9px] text-gray-400 uppercase font-bold -mt-0.5">km/h</span>
      </div>

      {/* 🔴 BOTTOM RIGHT HUD: COMPASS & INTERACTIVE COMMAND CONTROLS */}
      <div className="absolute bottom-6 right-4 z-10 flex flex-col gap-3">
        {/* Dynamic Compass Indicator Button */}
        <button
          onClick={() => mapRef.current?.easeTo({ bearing: 0, pitch: 60, duration: 1000 })}
          className="w-12 h-12 bg-black/85 hover:bg-black rounded-full shadow-lg flex items-center justify-center border border-gray-800 transition active:scale-95 group"
          title="Reset view orientation back to North"
          type="button"
        >
          <div
            className="w-6 h-6 relative transition-transform duration-300"
            style={{ transform: `rotate(${-headingDegrees}deg)` }}
          >
            {/* Red North arrow point pointer */}
            <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[10px] border-b-red-500 absolute top-0 left-1/2 -translate-x-1/2" />
            {/* Gray South arrow point pointer */}
            <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[10px] border-t-gray-400 absolute bottom-0 left-1/2 -translate-x-1/2" />
          </div>
        </button>

        {/* Search Toggle Action */}
        <button
          className="w-12 h-12 bg-black/85 hover:bg-black rounded-full shadow-lg flex items-center justify-center border border-gray-800 transition active:scale-95"
          type="button"
        >
          <Search className="w-5 h-5 text-gray-300" />
        </button>

        {/* Audio Speaker Mute Action Toggle */}
        <button
          onClick={() => setIsMuted(!isMuted)}
          type="button"
          className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center border transition active:scale-95 ${
            isMuted ? 'bg-red-950/80 border-red-800 text-red-400' : 'bg-black/85 border-gray-800 text-white'
          }`}
        >
          {isMuted ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5 text-white" />}
        </button>

        {/* Alternate Routing Layout Split Action */}
        <button
          className="w-12 h-12 bg-black/85 hover:bg-black rounded-full shadow-lg flex items-center justify-center border border-gray-800 transition active:scale-95"
          type="button"
        >
          <GitFork className="w-5 h-5 text-gray-300" />
        </button>
      </div>
    </div>
  )
}
