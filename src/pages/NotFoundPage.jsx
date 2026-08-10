import { Link } from 'react-router-dom'
export default function NotFoundPage(){return <div className="auth-page"><div className="auth-card"><span className="eyebrow">404</span><h1>Page not found</h1><p>The admin page you requested does not exist.</p><Link className="primary-button" to="/dashboard">Go to dashboard</Link></div></div>}
