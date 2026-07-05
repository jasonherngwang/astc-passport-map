import museumsRaw from '../data/museums.json'
import type { Home, LatLon, Museum, MuseumStatus, Recommendation, StatusMap } from './types'

export const museums = museumsRaw as Museum[]

// Official rule: no reciprocal admission within 90 miles ("as the crow flies")
// of your residence OR of the museum where you hold your membership.
export const RADIUS_MILES = 90
export const RADIUS_METERS = RADIUS_MILES * 1609.344

const EARTH_RADIUS_MILES = 3958.7613

export function milesBetween(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(s))
}

/** Compute passport status for every museum given the current home and member. */
export function computeStatus(home: Home | null, member: Museum | null): StatusMap {
  const result: StatusMap = new Map()
  for (const m of museums) {
    const dHome = home ? milesBetween(home, m) : null
    const dMember = member ? milesBetween(member, m) : null
    let status: MuseumStatus['status']
    if (member && m.id === member.id) status = 'member'
    else if (home === null && member === null) status = 'unknown'
    else if (
      (dHome !== null && dHome < RADIUS_MILES) ||
      (dMember !== null && dMember < RADIUS_MILES)
    )
      status = 'excluded'
    else status = 'eligible'
    result.set(m.id, { status, dHome, dMember })
  }
  return result
}

/**
 * Rank membership candidates near home by how many museums they unlock.
 * A museum is "unlocked" if it's outside 90mi of home AND outside 90mi of
 * the candidate. Museums near home are lost causes regardless of choice.
 */
export function recommend(home: Home | null, limit = 10): Recommendation[] {
  if (!home) return []
  const candidates = museums
    .map((museum) => ({ museum, dHome: milesBetween(home, museum) }))
    .sort((a, b) => a.dHome - b.dHome)

  // consider museums within 90mi of home (a membership you could plausibly
  // buy and use locally); if home is remote, fall back to the nearest 10
  let pool = candidates.filter((c) => c.dHome < RADIUS_MILES)
  if (pool.length === 0) pool = candidates.slice(0, 10)

  const awayMuseums = museums.filter((m) => milesBetween(home, m) >= RADIUS_MILES)
  const scored: Recommendation[] = pool.map(({ museum, dHome }) => {
    let unlocked = 0
    for (const m of awayMuseums) {
      if (m.id !== museum.id && milesBetween(museum, m) >= RADIUS_MILES) unlocked++
    }
    return { museum, dHome, unlocked }
  })
  scored.sort((a, b) => b.unlocked - a.unlocked || a.dHome - b.dHome)
  return scored.slice(0, limit)
}
