import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { apply, getMode } from './lib/theme'

// Before first paint, so a dark-preferring browser never flashes a light page.
apply(getMode())

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
