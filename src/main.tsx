import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import './index.css'
import App from './App.tsx'
import { Blocker } from './components/Blocker.tsx'
import { Overlay } from './components/Overlay.tsx'
import { Popup } from './components/Popup.tsx'

// Excalidraw is heavy — lazy chunk so only the canvas window ever downloads it
const CanvasMode = lazy(() => import('./components/Canvas.tsx'))

const label = getCurrentWebviewWindow().label

// kill the raw WebView2 context menu (Voltar/Atualizar/Salvar como/DevTools) —
// text fields keep it so paste/spellcheck still work
document.addEventListener('contextmenu', (e) => {
  const el = e.target as HTMLElement | null
  if (el?.closest('input, textarea, [contenteditable="true"]')) return
  e.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {label === 'overlay' ? (
      <Overlay />
    ) : label === 'blocker' ? (
      <Blocker />
    ) : label === 'popup' ? (
      <Popup />
    ) : label === 'refboard' ? (
      <Suspense fallback={<div className="h-screen w-screen bg-bg" />}>
        <CanvasMode />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
