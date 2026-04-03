import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1a1f2a',
            color: '#e8f0fe',
            border: '1px solid #2a3040',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: '13px',
          },
          success: { iconTheme: { primary: '#6fcf97', secondary: '#1a1f2a' } },
          error: { iconTheme: { primary: '#eb5757', secondary: '#1a1f2a' } },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>,
)
