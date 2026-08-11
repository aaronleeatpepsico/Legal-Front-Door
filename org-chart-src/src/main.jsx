import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

if (typeof window !== 'undefined') {
  window.OrgChart = {
    mountPage(containerEl, options = {}) {
      const root = createRoot(containerEl)
      const render = () => root.render(<App {...options} />)
      render()
      return { refresh: render }
    }
  }
}
