import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import './index.css'
import App from './App.tsx'
import { Blocker } from './components/Blocker.tsx'
import { Overlay } from './components/Overlay.tsx'
import { Popup } from './components/Popup.tsx'
import { Refboard } from './components/Refboard.tsx'

const label = getCurrentWebviewWindow().label

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {label === 'overlay' ? (
      <Overlay />
    ) : label === 'blocker' ? (
      <Blocker />
    ) : label === 'popup' ? (
      <Popup />
    ) : label === 'refboard' ? (
      <Refboard />
    ) : (
      <App />
    )}
  </StrictMode>,
)
