import React from 'react'
import ReactDOM from 'react-dom/client'
import 'drag-drop-touch'  // Polyfill: enables HTML5 DnD on touch devices
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
