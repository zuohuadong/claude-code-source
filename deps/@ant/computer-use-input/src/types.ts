/**
 * Cross-platform input backend interface.
 *
 * Defines the contract that platform-specific backends implement.
 * The index.ts loader selects darwin or win32 based on process.platform.
 *
 * Original: this interface was inferred from the NAPI-RS binary exports
 * (8 functions) and cross-referenced with the haking-code- TS reimplementation.
 */

export interface FrontmostAppInfo {
  /** macOS: bundle identifier (e.g. "com.apple.Safari"). Windows: exe path. */
  bundleId: string
  /** Display name (e.g. "Safari"). Windows: process name. */
  appName: string
}

export interface InputBackend {
  /** Move cursor to (x, y). Animated uses ease-out interpolation. */
  moveMouse(x: number, y: number, animated?: boolean): Promise<void>
  /** Press, release, or click a single key. */
  key(key: string, action?: 'click' | 'press' | 'release'): Promise<void>
  /** Press a key chord (e.g. ["cmd", "c"]). */
  keys(parts: string[]): Promise<void>
  /** Get current cursor position. */
  mouseLocation(): Promise<{ x: number; y: number }>
  /** Perform a mouse button action. count = click count. */
  mouseButton(
    button: 'left' | 'right' | 'middle',
    action: 'click' | 'press' | 'release',
    count?: number,
  ): Promise<void>
  /** Scroll the mouse wheel. */
  mouseScroll(amount: number, direction: 'vertical' | 'horizontal'): Promise<void>
  /** Type text via the keyboard. */
  typeText(text: string): Promise<void>
  /** Get the frontmost application, or null. */
  getFrontmostAppInfo(): FrontmostAppInfo | null
}
