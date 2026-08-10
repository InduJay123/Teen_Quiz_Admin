export default function PageHeader({ eyebrow = 'Analytics', title, description, actions }) {
  return (
    <div className="page-heading page-heading--admin">
      <div>
        <h1>{title}</h1>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}
