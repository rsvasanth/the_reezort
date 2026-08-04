import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { BrandWash } from './components/brand-wash'
import { ThemeProvider } from './components/theme-provider'
import { PageMetaProvider } from './components/workspace/workspace'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <PageMetaProvider>
        <BrandWash />
        <App />
      </PageMetaProvider>
    </ThemeProvider>
  </StrictMode>,
)
