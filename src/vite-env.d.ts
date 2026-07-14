/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Google Maps API key (restrict it by HTTP referrer; Places API (New)
   * enabled). Optional — without it, address search falls back to the free
   * OSM geocoders.
   */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
