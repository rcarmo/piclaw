import { expect, test } from "bun:test";

import {
  buildVncWheelPointerEvents,
  computeContainedRemoteDisplayScale,
  encodeVncKeyEvent,
  encodeVncPointerEvent,
  getVncContactTravelDistance,
  hasVncTouchTapSlopBeenExceeded,
  isVncDeferredTouchPointerType,
  mapClientToFramebufferPoint,
  normalizeVncPassword,
  resolveVncKeysymFromKeyboardEvent,
  resolveVncPointerPressMask,
  shouldArmVncImplicitReleaseTimer,
  shouldReleaseVncPointerContact,
  shouldReleaseVncTouchContact,
  shouldSkipDuplicateVncKeydown,
  shouldTriggerVncTouchTap,
  vncButtonMaskForPointerButton,
} from "../../web/src/panes/vnc-input.js";

test("encodeVncPointerEvent writes VNC pointer-event bytes", () => {
  expect(Array.from(encodeVncPointerEvent(5, 300, 400))).toEqual([
    5,
    5,
    0x01,
    0x2c,
    0x01,
    0x90,
  ]);
});

test("vncButtonMaskForPointerButton maps primary mouse buttons", () => {
  expect(vncButtonMaskForPointerButton(0)).toBe(1);
  expect(vncButtonMaskForPointerButton(1)).toBe(2);
  expect(vncButtonMaskForPointerButton(2)).toBe(4);
  expect(vncButtonMaskForPointerButton(5)).toBe(0);
});

test("resolveVncPointerPressMask falls back to left button for touch/pen", () => {
  expect(resolveVncPointerPressMask({ button: -1, pointerType: "touch" })).toBe(1);
  expect(resolveVncPointerPressMask({ button: -1, pointerType: "pen" })).toBe(1);
  expect(resolveVncPointerPressMask({ button: 2, pointerType: "mouse" })).toBe(4);
  expect(resolveVncPointerPressMask({ button: -1, buttons: 1, pointerType: "mouse" })).toBe(1);
});

test("shouldReleaseVncPointerContact detects implicit touch/pen release states", () => {
  expect(shouldReleaseVncPointerContact({ type: "pointerup", pointerType: "pen", buttons: 1, pressure: 0.5 })).toBe(true);
  expect(shouldReleaseVncPointerContact({ type: "pointermove", pointerType: "touch", buttons: 0, pressure: 0 })).toBe(true);
  expect(shouldReleaseVncPointerContact({ type: "pointerleave", pointerType: "pen", buttons: 1, pressure: 0 })).toBe(true);
  expect(shouldReleaseVncPointerContact({ type: "pointermove", pointerType: "mouse", buttons: 1, pressure: 0.5 })).toBe(false);
  expect(shouldReleaseVncPointerContact({ type: "pointerdown", pointerType: "touch", buttons: 1, pressure: 0.5 })).toBe(false);
});

test("shouldReleaseVncTouchContact detects touchend/touchcancel and zero-touch moves", () => {
  expect(shouldReleaseVncTouchContact({ type: "touchend", changedTouches: [{}] })).toBe(true);
  expect(shouldReleaseVncTouchContact({ type: "touchcancel", changedTouches: [{}] })).toBe(true);
  expect(shouldReleaseVncTouchContact({ type: "touchmove", touches: [] })).toBe(true);
  expect(shouldReleaseVncTouchContact({ type: "touchmove", touches: [{}] })).toBe(false);
  expect(shouldReleaseVncTouchContact({ type: "touchstart", touches: [{}] })).toBe(false);
});

test("isVncDeferredTouchPointerType only defers finger touch contacts", () => {
  expect(isVncDeferredTouchPointerType("touch")).toBe(true);
  expect(isVncDeferredTouchPointerType("pen")).toBe(false);
  expect(isVncDeferredTouchPointerType("mouse")).toBe(false);
  expect(isVncDeferredTouchPointerType("")).toBe(false);
});

test("touch tap helpers distinguish taps from drags", () => {
  expect(getVncContactTravelDistance(10, 10, 13, 14)).toBeCloseTo(5, 5);
  expect(hasVncTouchTapSlopBeenExceeded({ startX: 10, startY: 10, clientX: 18, clientY: 18, maxDistancePx: 10 })).toBe(true);
  expect(hasVncTouchTapSlopBeenExceeded({ startX: 10, startY: 10, clientX: 14, clientY: 13, maxDistancePx: 10 })).toBe(false);
  expect(shouldTriggerVncTouchTap({ startX: 10, startY: 10, clientX: 14, clientY: 13, elapsedMs: 180 })).toBe(true);
  expect(shouldTriggerVncTouchTap({ startX: 10, startY: 10, clientX: 40, clientY: 13, elapsedMs: 180 })).toBe(false);
  expect(shouldTriggerVncTouchTap({ startX: 10, startY: 10, clientX: 14, clientY: 13, elapsedMs: 450 })).toBe(false);
});

test("shouldArmVncImplicitReleaseTimer covers touch, pen, and unknown non-mouse pointers", () => {
  expect(shouldArmVncImplicitReleaseTimer("touch")).toBe(true);
  expect(shouldArmVncImplicitReleaseTimer("pen")).toBe(true);
  expect(shouldArmVncImplicitReleaseTimer("" )).toBe(true);
  expect(shouldArmVncImplicitReleaseTimer(undefined)).toBe(true);
  expect(shouldArmVncImplicitReleaseTimer("mouse")).toBe(false);
});

test("mapClientToFramebufferPoint maps scaled display coordinates into framebuffer space", () => {
  expect(mapClientToFramebufferPoint(150, 75, { left: 100, top: 50, width: 200, height: 100 }, 800, 400))
    .toEqual({ x: 200, y: 100 });
  expect(mapClientToFramebufferPoint(999, -20, { left: 100, top: 50, width: 200, height: 100 }, 800, 400))
    .toEqual({ x: 799, y: 0 });
});

test("buildVncWheelPointerEvents emits press+release events", () => {
  const [press, release] = buildVncWheelPointerEvents(-1, 10, 20, 1);
  expect(Array.from(press)).toEqual([5, 9, 0, 10, 0, 20]);
  expect(Array.from(release)).toEqual([5, 1, 0, 10, 0, 20]);
});

test("encodeVncKeyEvent writes VNC key-event bytes", () => {
  expect(Array.from(encodeVncKeyEvent(true, 0xff0d))).toEqual([
    4,
    1,
    0,
    0,
    0,
    0,
    0xff,
    0x0d,
  ]);
});

test("shouldSkipDuplicateVncKeydown suppresses duplicate non-repeat hardware keydown events", () => {
  expect(shouldSkipDuplicateVncKeydown(0x61, 0x61, false)).toBe(true);
  expect(shouldSkipDuplicateVncKeydown(0x61, 0x61, true)).toBe(true);
  expect(shouldSkipDuplicateVncKeydown(0x61, 0x62, false)).toBe(false);
  expect(shouldSkipDuplicateVncKeydown(null, 0x61, false)).toBe(false);
});

test("resolveVncKeysymFromKeyboardEvent maps special keys and printable characters", () => {
  expect(resolveVncKeysymFromKeyboardEvent({ key: "Enter" })).toBe(0xff0d);
  expect(resolveVncKeysymFromKeyboardEvent({ key: "ArrowLeft" })).toBe(0xff51);
  expect(resolveVncKeysymFromKeyboardEvent({ key: "a" })).toBe(0x61);
  expect(resolveVncKeysymFromKeyboardEvent({ key: "é" })).toBe(0xe9);
  expect(resolveVncKeysymFromKeyboardEvent({ key: "😀" })).toBe((0x01000000 | 0x1f600) >>> 0);
  expect(resolveVncKeysymFromKeyboardEvent({ key: "Unidentified", code: "ShiftRight" })).toBe(0xffe2);
  expect(resolveVncKeysymFromKeyboardEvent({ key: "Dead" })).toBeNull();
});

test("normalizeVncPassword treats empty strings as unset", () => {
  expect(normalizeVncPassword("")).toBeNull();
  expect(normalizeVncPassword("secret")).toBe("secret");
  expect(normalizeVncPassword(null)).toBeNull();
});

test("computeContainedRemoteDisplayScale fits the framebuffer without integer snap", () => {
  expect(computeContainedRemoteDisplayScale(1000, 700, 800, 600)).toBeCloseTo(1.1666666, 5);
  expect(computeContainedRemoteDisplayScale(400, 300, 800, 600)).toBe(0.5);
});
