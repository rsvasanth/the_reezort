import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Theme } from '@radix-ui/themes'
// Tokens only, not styles.css. `<Theme>` is used purely as a token provider —
// it renders `.radix-themes[data-accent-color=gold][data-gray-color=sand]`, and
// tokens.css is what turns those attributes into the --accent-*/--gray-* scales
// our own variables are built on. Every component in components/ui is a Radix
// primitive styled with Tailwind, so no Themes component CSS is used: importing
// styles.css instead costs 620 kB of stylesheet nothing renders.
import '@radix-ui/themes/tokens.css'
import './index.css'
import './styles/reezort-radix.css'
import App from './App.tsx'
import { ThemeProvider } from './components/theme-provider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <Theme accentColor="gold" grayColor="sand" radius="large" panelBackground="solid">
        <App />
      </Theme>
    </ThemeProvider>
  </StrictMode>,
)
