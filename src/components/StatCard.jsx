export default function StatCard({ label, value, note, tone = 'violet' }) {
  return (
    <div className={`stat-card admin-stat tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  )
}
