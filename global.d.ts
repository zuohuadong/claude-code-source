type MacroConfig = {
  VERSION: string
  BUILD_TIME?: string
  PACKAGE_URL: string
  NATIVE_PACKAGE_URL?: string
  FEEDBACK_CHANNEL: string
  ISSUES_EXPLAINER: string
  VERSION_CHANGELOG?: string
}

declare global {
  var MACRO: MacroConfig
}

// Bun text loader: import X from './file.md' resolves to a string at build time
declare module '*.md' {
  const content: string
  export default content
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': any
      'ink-text': any
      'ink-link': any
      'ink-raw-ansi': any
    }
  }
}

export {}
