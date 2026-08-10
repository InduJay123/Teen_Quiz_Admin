export default function LoadingPanel({ text = 'Loading data…' }) {
  return <div className="panel-card loading-panel"><div className="spinner" />{text}</div>
}
