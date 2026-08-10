export default function ErrorPanel({ error, retry }) {
  return (
    <div className="panel-card error-panel">
      <strong>Could not load this data</strong>
      <p>{error?.message || String(error || 'Unknown error')}</p>
      {retry && <button className="primary-button" onClick={retry}>Try again</button>}
    </div>
  )
}
