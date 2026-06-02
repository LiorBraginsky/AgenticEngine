/**
 * Bun test preload — sets up a happy-dom GlobalWindow so DOM renderer tests
 * (text-reply, etc.) can call document.createElement, querySelector, etc.
 * GlobalWindow installs all DOM globals correctly (element.window references
 * are properly wired, compound selectors work).
 * Only affects test files. Does NOT affect production code.
 */
import { GlobalWindow } from "happy-dom";

const globalWindow = new GlobalWindow();
// Install all DOM globals. GlobalWindow handles all internal back-references
// (element.ownerDocument.defaultView etc.) which bare Window+manual inject misses.
/* eslint-disable @typescript-eslint/no-explicit-any */
(globalThis as any).window = globalWindow;
(globalThis as any).document = globalWindow.document;
(globalThis as any).HTMLElement = globalWindow.HTMLElement;
(globalThis as any).Node = globalWindow.Node;
/* eslint-enable @typescript-eslint/no-explicit-any */
