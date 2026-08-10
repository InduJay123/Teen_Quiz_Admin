import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AdminAuthProvider } from './context/AdminAuthContext.jsx'
import './styles/theme.css'
import './styles/admin.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AdminAuthProvider>
        <App />
      </AdminAuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
