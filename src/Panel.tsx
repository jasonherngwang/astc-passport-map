import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import Fuse from 'fuse.js'
import { museums, RADIUS_MILES } from './geo'
import { TicketIcon, HouseIcon, StarIcon, CloseIcon, ChevronIcon } from './icons'
import { searchPlaces, type PlaceHit } from './placeSearch'
import type { Home, Museum, Recommendation, StatusMap } from './types'

function useFuse(): Fuse<Museum> {
  return useMemo(
    () =>
      new Fuse<Museum>(museums, {
        keys: [
          { name: 'name', weight: 3 },
          { name: 'address', weight: 1 },
          { name: 'region', weight: 1 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    []
  )
}

// Count up from 0 whenever the target changes; jumps straight there for
// reduced-motion users.
function useCountUp(target: number): number {
  const [value, setValue] = useState(target)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target)
      return
    }
    let raf: number
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 700)
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return value
}

function StampNumber({ value }: { value: number }) {
  return <span className="stamp-number">{useCountUp(value)}</span>
}

interface ClearChipProps {
  icon: 'home' | 'star'
  label: string
  onClear: () => void
  clearLabel: string
}

function ClearChip({ icon, label, onClear, clearLabel }: ClearChipProps) {
  return (
    <p className="chip">
      <span className={`chip-ic ${icon === 'home' ? 'home' : 'star'}`} aria-hidden="true">
        {icon === 'home' ? <HouseIcon /> : <StarIcon />}
      </span>
      <span className="chip-label">{label}</span>
      <button className="chip-x" aria-label={clearLabel} onClick={onClear}>
        <CloseIcon />
      </button>
    </p>
  )
}

interface AddressSearchProps {
  home: Home | null
  setHome: Dispatch<SetStateAction<Home | null>>
  pickingHome: boolean
  setPickingHome: Dispatch<SetStateAction<boolean>>
}

function AddressSearch({ home, setHome, pickingHome, setPickingHome }: AddressSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const justPickedRef = useRef(false)

  // Debounced typeahead: fire ~280ms after the user stops typing, aborting any
  // in-flight request so only the latest query resolves. (Google requests
  // can't be cancelled mid-flight, but a stale response still lands with its
  // signal already aborted, so it's discarded the same way.)
  useEffect(() => {
    const q = query.trim()
    if (justPickedRef.current) {
      justPickedRef.current = false
      return
    }
    if (q.length < 3) {
      setResults(null)
      setBusy(false)
      abortRef.current?.abort()
      return
    }
    setBusy(true)
    const ctrl = new AbortController()
    abortRef.current?.abort()
    abortRef.current = ctrl
    const timer = setTimeout(async () => {
      try {
        const items = await searchPlaces(q, ctrl.signal)
        if (!ctrl.signal.aborted) setResults(items)
      } catch (e) {
        if (!(e instanceof DOMException) || e.name !== 'AbortError') {
          if (!ctrl.signal.aborted) setResults([])
        }
      } finally {
        if (!ctrl.signal.aborted) setBusy(false)
      }
    }, 280)
    return () => clearTimeout(timer)
  }, [query])

  async function choose(item: PlaceHit) {
    // Coordinates may need a follow-up fetch (Google place details), so keep
    // the spinner up until they land. Failures leave the list open to retry.
    setBusy(true)
    try {
      const { lat, lon } = await item.resolve()
      justPickedRef.current = true
      setHome({ lat, lon, label: item.label })
      setResults(null)
      setQuery('')
    } catch (e) {
      console.error('Failed to resolve place', e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel-section">
      <div className="step-head">
        <span className="badge" aria-hidden="true">1</span>
        <h2>Where do you live?</h2>
      </div>
      <div className="search-wrap">
        <div className="search-row">
          <input
            type="text"
            value={query}
            placeholder="Town, address, or ZIP…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results?.length) choose(results[0])
              if (e.key === 'Escape') setResults(null)
            }}
            aria-label="Home address"
            autoComplete="off"
          />
          {busy && <span className="search-spinner" aria-hidden="true" />}
        </div>
        {results && (
          <ul className="result-list" role="listbox">
            {results.length === 0 && (
              <li className="result-empty">
                No match yet — keep typing the street, city, and ZIP.
              </li>
            )}
            {results.map((r, i) => (
              <li key={`${r.label}-${i}`}>
                <button onClick={() => choose(r)}>
                  <strong>{r.primary}</strong>
                  {r.secondary && <span className="result-sub">{r.secondary}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        className={`btn btn-ghost ${pickingHome ? 'btn-armed' : ''}`}
        onClick={() => setPickingHome(!pickingHome)}
      >
        {pickingHome ? 'Now tap the map…' : 'Drop a pin on the map instead'}
      </button>
      {home && (
        <ClearChip
          icon="home"
          label={home.label}
          clearLabel="Clear home"
          onClear={() => setHome(null)}
        />
      )}
    </section>
  )
}

interface MuseumPickerProps {
  member: Museum | null
  setMemberId: Dispatch<SetStateAction<number | null>>
}

function MuseumPicker({ member, setMemberId }: MuseumPickerProps) {
  const fuse = useFuse()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const matches = useMemo(
    () => (query.trim() ? fuse.search(query).slice(0, 8) : []),
    [query, fuse]
  )

  return (
    <section className="panel-section">
      <div className="step-head">
        <span className="badge" aria-hidden="true">2</span>
        <h2>Pick your museum</h2>
      </div>
      <div className="search-wrap">
        <div className="search-row">
          <input
            type="text"
            value={query}
            placeholder="Search museums… or tap one on the map"
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            aria-label="Museum search"
          />
        </div>
        {open && matches.length > 0 && (
          <ul className="result-list" role="listbox">
            {matches.map(({ item }) => (
              <li key={item.id}>
                <button
                  onClick={() => {
                    setMemberId(item.id)
                    setQuery('')
                    setOpen(false)
                  }}
                >
                  <strong>{item.name}</strong>
                  <span className="result-sub">{item.region}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {member && (
        <ClearChip
          icon="star"
          label={member.name}
          clearLabel="Clear museum"
          onClear={() => setMemberId(null)}
        />
      )}
    </section>
  )
}

interface RecommendationsProps {
  recommendations: Recommendation[]
  member: Museum | null
  setMemberId: Dispatch<SetStateAction<number | null>>
  home: Home | null
}

function Recommendations({ recommendations, member, setMemberId, home }: RecommendationsProps) {
  if (recommendations.length === 0) return null
  const best = recommendations[0]?.unlocked ?? 0
  // Only crown a "Top pick" when one museum strictly leads — a tie has no winner.
  const uniqueTop =
    recommendations.length === 1 || recommendations[0].unlocked > recommendations[1].unlocked
  return (
    <section className="panel-section">
      <div className="step-head">
        <h2>Best memberships near you</h2>
      </div>
      <p className="section-hint">
        Ranked by how many faraway museums each one unlocks.
      </p>
      {/* keyed by home so the deal-in stagger replays when home moves */}
      <ol className="reco-list" key={home ? `${home.lat},${home.lon}` : 'none'}>
        {recommendations.map(({ museum, dHome, unlocked }, i) => (
          <li key={museum.id}>
            <button
              className={member?.id === museum.id ? 'reco reco-active' : 'reco'}
              onClick={() => setMemberId(museum.id)}
            >
              <span className="rank" aria-hidden="true">{i + 1}</span>
              <span className="reco-name">
                {museum.name}
                {i === 0 && uniqueTop && <span className="top-tag">Top pick</span>}
                <span className="reco-sub">{Math.round(dHome)} mi from home</span>
              </span>
              <span className={`reco-count ${unlocked === best ? 'reco-best' : ''}`}>
                {unlocked}
                <small>unlocked</small>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

interface ResultsProps {
  home: Home | null
  member: Museum | null
  statusById: StatusMap
}

function Results({ home, member, statusById }: ResultsProps) {
  const [showExcluded, setShowExcluded] = useState(false)
  const groups = useMemo(() => {
    const eligible: Museum[] = []
    const nearHome: { m: Museum; d: number }[] = []
    const nearMember: { m: Museum; d: number }[] = []
    for (const m of museums) {
      const s = statusById.get(m.id)!
      if (s.status === 'eligible') eligible.push(m)
      else if (s.status === 'excluded') {
        if (s.dHome !== null && s.dHome < RADIUS_MILES) nearHome.push({ m, d: s.dHome })
        // excluded but not near home ⇒ it's within range of the member museum
        else nearMember.push({ m, d: s.dMember! })
      }
    }
    nearHome.sort((a, b) => a.d - b.d)
    nearMember.sort((a, b) => a.d - b.d)
    return { eligible, nearHome, nearMember }
  }, [statusById])

  if (!home && !member) return null
  const excludedTotal = groups.nearHome.length + groups.nearMember.length

  return (
    <section className="panel-section">
      <div className="results-head">
        <h2>Your passport</h2>
      </div>
      {/* keys restart the stamp-in animation whenever the counts change */}
      <div className="stamp-row">
        <div className="stamp" key={`free-${groups.eligible.length}`}>
          <StampNumber value={groups.eligible.length} />
          <span className="stamp-label">
            museums
            <br />
            free to visit
          </span>
        </div>
        <div className="stamp stamp-muted" key={`close-${excludedTotal}`}>
          <StampNumber value={excludedTotal} />
          <span className="stamp-label">
            too close
            <br />
            to count
          </span>
          <span className="stamp-date">{RADIUS_MILES} mi rule</span>
        </div>
      </div>

      <button
        className="btn btn-ghost"
        onClick={() => setShowExcluded(!showExcluded)}
        aria-expanded={showExcluded}
      >
        {showExcluded ? 'Hide' : 'Show'} the {excludedTotal} too-close museums
      </button>

      {showExcluded && (
        <div className="excluded-lists">
          {groups.nearHome.length > 0 && (
            <>
              <h3>Within {RADIUS_MILES} mi of home ({groups.nearHome.length})</h3>
              <ul>
                {groups.nearHome.map(({ m, d }) => (
                  <li key={m.id}>
                    {m.name} <span className="dist">{Math.round(d)} mi</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {groups.nearMember.length > 0 && member && (
            <>
              <h3>
                Within {RADIUS_MILES} mi of {member.name} ({groups.nearMember.length})
              </h3>
              <ul>
                {groups.nearMember.map(({ m, d }) => (
                  <li key={m.id}>
                    {m.name} <span className="dist">{Math.round(d)} mi</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {excludedTotal === 0 && <p>Nothing is excluded — happy travels!</p>}
        </div>
      )}
    </section>
  )
}

interface PanelProps {
  home: Home | null
  setHome: Dispatch<SetStateAction<Home | null>>
  member: Museum | null
  setMemberId: Dispatch<SetStateAction<number | null>>
  pickingHome: boolean
  setPickingHome: Dispatch<SetStateAction<boolean>>
  statusById: StatusMap
  recommendations: Recommendation[]
}

export default function Panel({
  home,
  setHome,
  member,
  setMemberId,
  pickingHome,
  setPickingHome,
  statusById,
  recommendations,
}: PanelProps) {
  const [collapsed, setCollapsed] = useState(false)

  // On phones the whole cover works as the sheet toggle — a 44px-wide reach
  // beats hunting for the chevron with a thumb. Desktop keeps header text
  // selectable, so only the button toggles there.
  function onHeaderTap() {
    if (window.matchMedia('(max-width: 640px)').matches) setCollapsed(!collapsed)
  }

  return (
    <aside className={`panel ${collapsed ? 'panel-folded' : ''}`}>
      <header className="panel-header" onClick={onHeaderTap}>
        <div className="brand">
          <span className="mark" aria-hidden="true">
            <TicketIcon />
          </span>
          <h1>Museum Passport</h1>
          <button
            className="fold-btn"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
            onClick={(e) => {
              e.stopPropagation()
              setCollapsed(!collapsed)
            }}
          >
            <ChevronIcon />
          </button>
        </div>
        <p className="tagline">
          Join one science museum, visit hundreds more free, anywhere{' '}
          {RADIUS_MILES}+ miles from home <em>and</em> from your museum.
        </p>
      </header>
      <div className="perf" aria-hidden="true" />
      <div className="fold">
        <div className="fold-inner">
          <div className="panel-body">
            <AddressSearch
              home={home}
              setHome={setHome}
              pickingHome={pickingHome}
              setPickingHome={setPickingHome}
            />
            <MuseumPicker member={member} setMemberId={setMemberId} />
            <Results home={home} member={member} statusById={statusById} />
            <Recommendations
              recommendations={recommendations}
              member={member}
              setMemberId={setMemberId}
              home={home}
            />
            <footer className="panel-footer">
              <p>Data: ASTC Travel Passport participant list (May–Oct 2026).</p>
            </footer>
          </div>
        </div>
      </div>
    </aside>
  )
}
