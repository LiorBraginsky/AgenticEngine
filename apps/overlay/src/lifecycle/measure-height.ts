/**
 * Height auto-resize helpers for the widget window (gotcha #44, Task 4.3, chunk 4).
 *
 * The widget window previously had a fixed height:200 in tauri.conf.json.
 * resizeToContent() in widget.ts uses these constants to compute a clamped
 * height that fits the current content without overflowing the screen.
 *
 * Width stays fixed at 360 (WIDGET_WIDTH_LOGICAL in main.ts) so the existing
 * right-anchor (computeWidgetX) needs no recomputation.
 *
 * DOM-free — testable in isolation via bun test.
 */

/** Minimum pixel height for the widget window regardless of content. */
export const WIDGET_MIN_HEIGHT = 64;

/**
 * Maximum fraction of screen height the widget may occupy (65%).
 * Applied in resizeToContent() (widget.ts) as a px cap derived from
 * window.screen.availHeight — NOT as a vh CSS rule (vh is window-relative
 * and circular with the resize; see the regression note in widget.ts).
 */
export const MAX_HEIGHT_FRACTION = 0.65;

/**
 * Clamp a measured content height to the safe range:
 *   [WIDGET_MIN_HEIGHT, floor(screenHeight * MAX_HEIGHT_FRACTION)]
 *
 * @param contentHeight - measured scrollHeight of the widget host (px)
 * @param screenHeight  - available screen height (px, e.g. window.screen.availHeight)
 * @returns clamped height in logical pixels
 */
export function clampWidgetHeight(contentHeight: number, screenHeight: number): number {
  const ceiling = Math.floor(screenHeight * MAX_HEIGHT_FRACTION);
  return Math.min(Math.max(contentHeight, WIDGET_MIN_HEIGHT), ceiling);
}
