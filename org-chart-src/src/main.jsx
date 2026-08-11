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

  // Both the public front door and Admin already load this widget bundle.
  // Use that shared entry point to layer in the document-folder feature
  // without duplicating or rewriting the large static HTML files.
  if (!document.querySelector('script[data-document-folders]')) {
    const script = document.createElement('script')
    script.src = '/document-folders.js'
    script.async = false
    script.dataset.documentFolders = 'true'
    document.head.appendChild(script)
  }
}
