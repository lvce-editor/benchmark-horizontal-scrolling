declare module 'rollup-plugin-css-only' {
  import type { Plugin } from 'rollup'
  export default function css(options?: { readonly fileName?: string }): Plugin
}
