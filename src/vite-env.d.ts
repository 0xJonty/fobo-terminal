/// <reference types="vite/client" />

/** Build stamp injected by vite.config.ts `define`; surfaces as data-fobo-build on the host. */
declare const __FOBO_BUILD__: string

// Vite returns a data URI for ?inline asset imports; vite/client only types the bare '*.png'.
declare module '*.png?inline' {
  const src: string
  export default src
}
