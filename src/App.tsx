import { Component, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { LatLng } from 'leaflet'
import MapView from './MapView'
import Panel from './Panel'
import { museums, computeStatus, recommend } from './geo'
import type { Home } from './types'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash">
          <p>Oops — the map hit a snag.</p>
          <button className="btn" onClick={() => location.reload()}>
            Reload the map
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  const [home, setHome] = useState<Home | null>(null)
  const [memberId, setMemberId] = useState<number | null>(null)
  const [pickingHome, setPickingHome] = useState(false)

  const member = useMemo(
    () => museums.find((m) => m.id === memberId) ?? null,
    [memberId]
  )
  const statusById = useMemo(() => computeStatus(home, member), [home, member])
  const recommendations = useMemo(() => recommend(home), [home])

  function handleMapClick(latlng: LatLng) {
    if (!pickingHome) return
    setHome({
      lat: latlng.lat,
      lon: latlng.lng,
      label: `Map pin (${latlng.lat.toFixed(3)}, ${latlng.lng.toFixed(3)})`,
    })
    setPickingHome(false)
  }

  return (
    <div className={`app ${pickingHome ? 'picking-home' : ''}`}>
      {/* rough-edge displacement shared by the passport stamps and popup flags */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <filter id="inkedge">
          <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" />
        </filter>
      </svg>
      <ErrorBoundary>
        <MapView
          home={home}
          member={member}
          statusById={statusById}
          onMapClick={handleMapClick}
          onPickMember={setMemberId}
        />
      </ErrorBoundary>
      <Panel
        home={home}
        setHome={setHome}
        member={member}
        setMemberId={setMemberId}
        pickingHome={pickingHome}
        setPickingHome={setPickingHome}
        statusById={statusById}
        recommendations={recommendations}
      />
    </div>
  )
}
