/// <reference types="vite/client" />

declare global {
  interface Window {
    api: import("./shared/contracts").DesktopApi
  }
}

export {}
