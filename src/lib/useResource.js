import { useEffect, useRef, useState } from 'react'

// Keyed state prevents late responses and one-frame stale cohort displays.
export default function useResource(key, load) {
  const loader = useRef(load)
  loader.current = load
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState({})
  useEffect(() => {
    let active = true
    const request = loader.current
    setState({ key, revision })
    Promise.resolve().then(request).then(
      data => { if (active) setState({ key, revision, data }) },
      error => { if (active) setState({ key, revision, error }) },
    )
    return () => { active = false }
  }, [key, revision])
  const current = state.key === key && state.revision === revision ? state : {}
  return { ...current, retry: () => setRevision(r => r + 1) }
}
