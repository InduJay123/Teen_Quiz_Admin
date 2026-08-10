export default function EmptyState({ title = 'Nothing here yet', message = 'No matching records were found.' }) {
  return <div className="empty-panel compact-empty"><div className="empty-icon">○</div><h3>{title}</h3><p>{message}</p></div>
}
