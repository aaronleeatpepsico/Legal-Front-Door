import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

if (typeof window !== 'undefined') {
  window.OrgChart = {
    mountPage(containerEl, options = {}) {
      const root = createRoot(containerEl)
      const ctrl = {}
      // Stable reference passed as prop so React's useEffect only fires once
      const registerFocusPerson = (fn) => { ctrl.focusPerson = fn }

      const render = () => root.render(
        <App {...options} registerFocusPerson={registerFocusPerson} />
      )
      render()

      return {
        refresh: render,
        focusPerson(id) { if (ctrl.focusPerson) ctrl.focusPerson(id) },
      }
    },
  }
}
