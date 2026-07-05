import { useEffect, useMemo } from 'react'
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Circle,
  Marker,
  Popup,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import L from 'leaflet'
import type { LatLng, LatLngTuple, PathOptions, PointExpression } from 'leaflet'
import { museums, RADIUS_METERS, RADIUS_MILES } from './geo'
import { StarIcon, CheckIcon, CloseIcon, IdCardIcon } from './icons'
import type { Home, LatLon, Museum, MuseumStatus, Status, StatusMap } from './types'

// State lives entirely in the theme. Eligible museums fill solid navy (they
// count); excluded ones render hollow — a ghosted ring the eye skips, the way
// a SaaS list dims a disabled row — so no red/green is needed to tell them
// apart. Unknown is a light neutral before any home is set; member is the lone
// gold accent, drawn as a star pin rather than a dot.
const NAVY = '#26547c'
const SLATE = '#94a0ab'
const PAPER = '#faf5ea'

const MAP_CENTER: LatLngTuple = [39.5, -96]
const DOT_TIP_OFFSET: PointExpression = [0, -6]
const PIN_TIP_OFFSET: PointExpression = [0, -32]

const toLatLng = (p: LatLon): LatLngTuple => [p.lat, p.lon]

// Per-status CircleMarker options. Excluded is the only hollow one.
function dotOptions(status: Status): PathOptions {
  if (status === 'excluded')
    return { color: SLATE, weight: 1.5, fillColor: PAPER, fillOpacity: 0.85 }
  if (status === 'eligible')
    return { color: '#ffffff', weight: 1.5, fillColor: NAVY, fillOpacity: 0.92 }
  // unknown
  return { color: '#ffffff', weight: 1.5, fillColor: '#a7b3be', fillOpacity: 0.85 }
}

// divIcon pins take raw HTML, so the two pin glyphs live here as strings; the
// badge circle and tail come from the .pin-badge styles.
const homeIcon = L.divIcon({
  className: 'pin-badge pin-home',
  html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4.5 11.2L12 5l7.5 6.2M6.5 10.4V18.6h11v-8.2" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  iconSize: [32, 32],
  iconAnchor: [16, 30],
})

const memberIcon = L.divIcon({
  className: 'pin-badge pin-member',
  html: '<svg width="15" height="15" viewBox="0 0 24 24"><path d="M12 3.3l2.6 5.2 5.8.85-4.2 4.1 1 5.75L12 16.5l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85z" fill="#fff" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  iconSize: [32, 32],
  iconAnchor: [16, 30],
})

function ClickCatcher({ onMapClick }: { onMapClick: (latlng: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng)
    },
  })
  return null
}

function FlyTo({ home }: { home: Home | null }) {
  const map = useMap()
  useEffect(() => {
    if (!home) return
    try {
      const zoom = Math.max(map.getZoom() ?? 4, 7)
      map.flyTo([home.lat, home.lon], zoom, { duration: 0.8 })
    } catch {
      // map not ready (e.g. mid-remount) — skip the animation, never crash
    }
  }, [home?.lat, home?.lon])
  return null
}

interface MuseumPopupProps {
  museum: Museum
  status: MuseumStatus
  onPickMember: (id: number) => void
}

function MuseumPopup({ museum, status, onPickMember }: MuseumPopupProps) {
  const { dHome, dMember } = status
  const closeReason =
    dHome !== null && dHome < RADIUS_MILES
      ? `${Math.round(dHome)} mi from home`
      : dMember !== null && dMember < RADIUS_MILES
        ? `${Math.round(dMember)} mi from your museum`
        : null
  return (
    <div className="popup">
      <h3>{museum.name}</h3>
      <p className="popup-address">
        {museum.address}
        {museum.country !== 'US' ? ` · ${titleCase(museum.country)}` : ''}
      </p>
      <p className="popup-links">
        {museum.url && (
          <a href={museum.url} target="_blank" rel="noreferrer">
            Website
          </a>
        )}
        {museum.phone && <span>{museum.phone}</span>}
      </p>
      {status.status === 'excluded' && (
        <>
          <p className="flag flag-close">
            <CloseIcon size={10} /> Too close
          </p>
          {closeReason && (
            <p className="flag-detail">
              {closeReason} — needs {RADIUS_MILES}+ mi
            </p>
          )}
        </>
      )}
      {status.status === 'eligible' && (
        <p className="flag flag-free">
          <CheckIcon /> Free with your passport
        </p>
      )}
      {status.status === 'member' && (
        <p className="flag flag-member">
          <StarIcon size={11} /> Your museum
        </p>
      )}
      <p className="tiers-label">Memberships that travel</p>
      <dl className="tier-grid">
        <dt>Individual</dt>
        <dd>
          {museum.individualTiers.length
            ? museum.individualTiers.join(', ')
            : '— none —'}
        </dd>
        <dt>Family</dt>
        <dd>{museum.groupTiers.length ? museum.groupTiers.join(', ') : '— none —'}</dd>
      </dl>
      {museum.proofOfResidence && (
        <p className="residence">
          <IdCardIcon /> Bring proof of residence
        </p>
      )}
      {status.status !== 'member' && (
        <button className="popup-pick" onClick={() => onPickMember(museum.id)}>
          <StarIcon size={14} /> Make this my museum
        </button>
      )}
    </div>
  )
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

interface MapViewProps {
  home: Home | null
  member: Museum | null
  statusById: StatusMap
  onMapClick: (latlng: LatLng) => void
  onPickMember: (id: number) => void
}

export default function MapView({
  home,
  member,
  statusById,
  onMapClick,
  onPickMember,
}: MapViewProps) {
  // computeStatus() always covers every museum, so the lookup is never missing.
  const markers = useMemo(
    () => museums.map((m) => ({ museum: m, status: statusById.get(m.id)! })),
    [statusById]
  )

  return (
    <>
      <MapContainer
        center={MAP_CENTER}
        zoom={4}
        className="map"
        worldCopyJump
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />
        <ClickCatcher onMapClick={onMapClick} />
        <FlyTo home={home} />

        {home && (
          <Circle
            center={toLatLng(home)}
            radius={RADIUS_METERS}
            interactive={false}
            pathOptions={{
              color: '#26547c',
              weight: 2,
              dashArray: '8 8',
              fillColor: '#26547c',
              fillOpacity: 0.06,
            }}
          />
        )}
        {member && (
          <Circle
            center={toLatLng(member)}
            radius={RADIUS_METERS}
            interactive={false}
            pathOptions={{
              color: '#d3a23a',
              weight: 2,
              dashArray: '2 8',
              fillColor: '#e3b44a',
              fillOpacity: 0.08,
            }}
          />
        )}

        {markers.map(({ museum: m, status }) =>
          status.status === 'member' ? null : (
            <CircleMarker
              key={m.id}
              center={toLatLng(m)}
              radius={status.status === 'excluded' ? 5 : 6}
              pathOptions={dotOptions(status.status)}
            >
              <Tooltip direction="top" offset={DOT_TIP_OFFSET}>
                {m.name}
              </Tooltip>
              <Popup maxWidth={320}>
                <MuseumPopup museum={m} status={status} onPickMember={onPickMember} />
              </Popup>
            </CircleMarker>
          )
        )}

        {member && (
          <Marker position={toLatLng(member)} icon={memberIcon}>
            <Tooltip direction="top" offset={PIN_TIP_OFFSET}>
              {member.name} (your museum)
            </Tooltip>
            <Popup maxWidth={320}>
              <MuseumPopup
                museum={member}
                status={statusById.get(member.id)!}
                onPickMember={onPickMember}
              />
            </Popup>
          </Marker>
        )}

        {home && (
          <Marker position={toLatLng(home)} icon={homeIcon}>
            <Tooltip direction="top" offset={PIN_TIP_OFFSET}>
              Home
            </Tooltip>
          </Marker>
        )}
      </MapContainer>

      <div className="legend">
        <span>
          <i style={{ background: '#a7b3be' }} /> Not rated yet
        </span>
        <span>
          <i style={{ background: NAVY }} /> Free to visit
        </span>
        <span>
          <i className="legend-hollow" /> Too close
        </span>
        <span className="legend-star">
          <StarIcon size={11} />
          <span className="legend-label">Your museum</span>
        </span>
      </div>
    </>
  )
}
