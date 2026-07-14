/// <reference types="google.maps" />
import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import type { DescribedPlace, GeoResult, LatLon } from './types'

// Address search runs on Google Places Autocomplete when a (referrer-
// restricted) API key is provided at build time — far faster and more
// forgiving of typos than the free OSM geocoders. Without a key we fall back
// to the original keyless setup:
// - Photon (Komoot) is built for fast as-you-type search — great for cities
//   and streets, low latency, autocomplete-friendly.
// - Nominatim parses full messy address strings far better (and tolerates a
//   wrong ZIP), but its policy discourages per-keystroke use. So we only call
//   it as a fallback when Photon finds nothing for a settled query.
const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
export const usingGooglePlaces = Boolean(GOOGLE_KEY)

/**
 * One autocomplete suggestion. Coordinates arrive via resolve(): instant for
 * OSM hits, a place-details fetch for Google (billed per selection, so it
 * only runs when the user actually picks a result).
 */
export interface PlaceHit extends DescribedPlace {
  resolve(): Promise<LatLon>
}

export function searchPlaces(q: string, signal: AbortSignal): Promise<PlaceHit[]> {
  return usingGooglePlaces ? searchGoogle(q) : searchOsm(q, signal)
}

// ---------------------------------------------------------------------------
// Google Places (New) via the official JS loader

let placesLib: Promise<google.maps.PlacesLibrary> | null = null
let optionsSet = false

function loadPlaces(): Promise<google.maps.PlacesLibrary> {
  if (!placesLib) {
    if (!optionsSet) {
      setOptions({ key: GOOGLE_KEY!, v: 'weekly' })
      optionsSet = true
    }
    const lib = importLibrary('places')
    // Don't cache a failed load — the loader re-injects its script on the
    // next call, so a transient network failure heals on a later keystroke.
    lib.catch(() => {
      if (placesLib === lib) placesLib = null
    })
    placesLib = lib
  }
  return placesLib
}

// Autocomplete billing groups keystrokes into a session that ends when place
// details are fetched — reuse one token across keystrokes, drop it on pick.
let sessionToken: google.maps.places.AutocompleteSessionToken | null = null

async function searchGoogle(q: string): Promise<PlaceHit[]> {
  const { AutocompleteSuggestion, AutocompleteSessionToken } = await loadPlaces()
  sessionToken ??= new AutocompleteSessionToken()
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input: q,
    sessionToken,
  })
  return suggestions.flatMap((s) => {
    const p = s.placePrediction
    if (!p) return []
    const primary = p.mainText?.toString() || p.text.toString()
    const secondary = p.secondaryText?.toString() ?? ''
    return [
      {
        primary,
        secondary,
        label: [primary, secondary].filter(Boolean).join(', '),
        resolve: async () => {
          const place = p.toPlace()
          await place.fetchFields({ fields: ['location'] })
          sessionToken = null
          const loc = place.location
          if (!loc) throw new Error('Place has no location')
          return { lat: loc.lat(), lon: loc.lng() }
        },
      },
    ]
  })
}

// ---------------------------------------------------------------------------
// Keyless OSM fallback (Photon + Nominatim)

const PHOTON = 'https://photon.komoot.io/api/'
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

// Loose shape shared by Photon feature properties and our Nominatim adapter.
interface AddressProps {
  name?: string
  housenumber?: string
  street?: string
  city?: string
  county?: string
  state?: string
  countrycode?: string
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: AddressProps
}

interface PhotonResponse {
  features?: PhotonFeature[]
}

interface NominatimAddress {
  house_number?: string
  road?: string
  city?: string
  town?: string
  village?: string
  hamlet?: string
  suburb?: string
  county?: string
  state?: string
  country_code?: string
}

interface NominatimItem {
  lat: string
  lon: string
  name?: string
  address?: NominatimAddress
}

// Turn a Photon GeoJSON feature into a display record that always leads with
// the street address. OSM often attaches an address to a named building
// ("Chase Plaza" instead of the bare street number), so we surface the street
// first and demote any building/business name to a muted hint.
function describe(props: AddressProps): DescribedPlace {
  const cc = props.countrycode?.toUpperCase()
  const locality = [props.city || props.county, props.state].filter(Boolean).join(', ')
  const streetLine =
    props.housenumber && props.street
      ? `${props.housenumber} ${props.street}`
      : props.street
  const primary = streetLine || props.name || locality || cc || 'Unknown place'

  const context: string[] = []
  if ((streetLine || props.name) && locality && locality !== primary)
    context.push(locality)
  if (cc) context.push(cc)
  const hint =
    streetLine && props.name && props.name !== props.street ? props.name : null
  const secondary = [context.join(', '), hint].filter(Boolean).join(' · ')
  const label = [primary, locality !== primary ? locality : null]
    .filter(Boolean)
    .join(', ')
  return { primary, secondary, label }
}

// Normalize a Nominatim result into the same shape describe() expects.
function fromNominatim(item: NominatimItem): GeoResult {
  const a = item.address || {}
  return {
    lat: parseFloat(item.lat),
    lon: parseFloat(item.lon),
    ...describe({
      name: item.name || undefined,
      housenumber: a.house_number,
      street: a.road,
      city: a.city || a.town || a.village || a.hamlet || a.suburb,
      county: a.county,
      state: a.state,
      countrycode: a.country_code,
    }),
  }
}

async function fetchPhoton(q: string, signal: AbortSignal): Promise<GeoResult[]> {
  const params = new URLSearchParams({ q, limit: '6', lang: 'en' })
  const resp = await fetch(`${PHOTON}?${params}`, { signal })
  const data = (await resp.json()) as PhotonResponse
  return (data.features || []).map((f) => ({
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    ...describe(f.properties),
  }))
}

async function fetchNominatim(q: string, signal: AbortSignal): Promise<GeoResult[]> {
  const params = new URLSearchParams({
    q,
    format: 'json',
    addressdetails: '1',
    limit: '6',
  })
  const resp = await fetch(`${NOMINATIM}?${params}`, { signal })
  const data = (await resp.json()) as NominatimItem[]
  return data.map(fromNominatim)
}

async function searchOsm(q: string, signal: AbortSignal): Promise<PlaceHit[]> {
  // A query that starts with a house number is an address lookup — send it
  // to Nominatim first (it parses full addresses and tolerates a bad ZIP).
  // A bare place/street name is typeahead — Photon is faster there. Either
  // way, fall back to the other engine if the first finds nothing.
  const houseNum = q.match(/^\s*(\d+)\b/)?.[1]
  const [primary, fallback] = houseNum
    ? [fetchNominatim, fetchPhoton]
    : [fetchPhoton, fetchNominatim]
  let items = await primary(q, signal)
  if (items.length === 0) items = await fallback(q, signal)
  // For an address, drop results that don't actually start with the typed
  // house number — that's what removes the fuzzy same-street-name noise.
  if (houseNum)
    items = items.filter((it) => it.primary.startsWith(houseNum + ' '))
  const seen = new Set<string>()
  items = items.filter(
    (it) => it.primary && !seen.has(it.label) && seen.add(it.label)
  )
  return items.map((it) => ({
    primary: it.primary,
    secondary: it.secondary,
    label: it.label,
    resolve: async () => ({ lat: it.lat, lon: it.lon }),
  }))
}
