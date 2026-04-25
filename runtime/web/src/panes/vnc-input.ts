// @ts-nocheck

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function encodeVncPointerEvent(buttonMask, x, y) {
    const buffer = new Uint8Array(6);
    const safeX = clamp(Math.floor(Number(x || 0)), 0, 0xffff);
    const safeY = clamp(Math.floor(Number(y || 0)), 0, 0xffff);
    buffer[0] = 5;
    buffer[1] = clamp(Math.floor(Number(buttonMask || 0)), 0, 0xff);
    buffer[2] = (safeX >> 8) & 0xff;
    buffer[3] = safeX & 0xff;
    buffer[4] = (safeY >> 8) & 0xff;
    buffer[5] = safeY & 0xff;
    return buffer;
}

export function vncButtonMaskForPointerButton(button) {
    switch (Number(button)) {
        case 0: return 1; // left
        case 1: return 2; // middle
        case 2: return 4; // right
        default: return 0;
    }
}

export function resolveVncPointerPressMask(event) {
    const direct = vncButtonMaskForPointerButton(event?.button);
    if (direct) return direct;

    const pointerType = String(event?.pointerType || '').toLowerCase();
    if (pointerType === 'touch' || pointerType === 'pen') {
        return vncButtonMaskForPointerButton(0);
    }

    const buttons = Number(event?.buttons || 0);
    if (buttons & 1) return vncButtonMaskForPointerButton(0);
    if (buttons & 4) return vncButtonMaskForPointerButton(1);
    if (buttons & 2) return vncButtonMaskForPointerButton(2);
    return 0;
}

export function shouldReleaseVncPointerContact(event) {
    const type = String(event?.type || '').toLowerCase();
    if (type === 'pointerup' || type === 'pointercancel' || type === 'lostpointercapture') {
        return true;
    }

    const buttons = Number(event?.buttons);
    if (Number.isFinite(buttons) && buttons === 0 && type !== 'pointerdown') {
        return true;
    }

    const pointerType = String(event?.pointerType || '').toLowerCase();
    const pressure = Number(event?.pressure);
    if ((pointerType === 'touch' || pointerType === 'pen')) {
        if ((type === 'pointerleave' || type === 'pointerout') && type !== 'pointerdown') {
            return true;
        }
        if (Number.isFinite(pressure) && pressure <= 0 && type !== 'pointerdown') {
            return true;
        }
    }

    return false;
}

export function shouldReleaseVncTouchContact(event) {
    const type = String(event?.type || '').toLowerCase();
    if (type === 'touchend' || type === 'touchcancel') {
        return true;
    }
    if (type === 'touchmove') {
        const activeTouches = Number(event?.touches?.length || 0);
        return activeTouches <= 0;
    }
    return false;
}

export function isVncDeferredTouchPointerType(pointerType) {
    return String(pointerType || '').toLowerCase() === 'touch';
}

export function getVncContactTravelDistance(startX, startY, clientX, clientY) {
    const dx = Number(clientX || 0) - Number(startX || 0);
    const dy = Number(clientY || 0) - Number(startY || 0);
    return Math.hypot(dx, dy);
}

export function hasVncTouchTapSlopBeenExceeded(options) {
    const maxDistancePx = Number.isFinite(options?.maxDistancePx) ? Number(options.maxDistancePx) : 14;
    return getVncContactTravelDistance(options?.startX, options?.startY, options?.clientX, options?.clientY) > maxDistancePx;
}

export function shouldTriggerVncTouchTap(options) {
    const maxElapsedMs = Number.isFinite(options?.maxElapsedMs) ? Number(options.maxElapsedMs) : 300;
    if (Number(options?.elapsedMs || 0) > maxElapsedMs) return false;
    return !hasVncTouchTapSlopBeenExceeded(options);
}

export function shouldArmVncImplicitReleaseTimer(pointerType) {
    const normalized = String(pointerType || '').toLowerCase();
    // Safari/iPad can report touch/pen inconsistently; anything that is not an
    // explicit mouse should get the safety-release timer.
    return normalized !== 'mouse';
}

export function mapClientToFramebufferPoint(clientX, clientY, rect, framebufferWidth, framebufferHeight) {
    const width = Math.max(1, Math.floor(Number(framebufferWidth || 0)));
    const height = Math.max(1, Math.floor(Number(framebufferHeight || 0)));
    const rectWidth = Math.max(1, Number(rect?.width || 0));
    const rectHeight = Math.max(1, Number(rect?.height || 0));
    const relX = (Number(clientX || 0) - Number(rect?.left || 0)) / rectWidth;
    const relY = (Number(clientY || 0) - Number(rect?.top || 0)) / rectHeight;
    return {
        x: clamp(Math.floor(relX * width), 0, Math.max(0, width - 1)),
        y: clamp(Math.floor(relY * height), 0, Math.max(0, height - 1)),
    };
}

export function buildVncWheelPointerEvents(deltaY, x, y, baseMask = 0) {
    const wheelBit = Number(deltaY) < 0 ? 8 : 16;
    const pressedMask = clamp((Number(baseMask || 0) | wheelBit), 0, 0xff);
    return [
        encodeVncPointerEvent(pressedMask, x, y),
        encodeVncPointerEvent(Number(baseMask || 0), x, y),
    ];
}

export function encodeVncKeyEvent(down, keysym) {
    const buffer = new Uint8Array(8);
    const safeKeysym = Math.max(0, Math.min(0xffffffff, Number(keysym || 0) >>> 0));
    buffer[0] = 4;
    buffer[1] = down ? 1 : 0;
    buffer[4] = (safeKeysym >>> 24) & 0xff;
    buffer[5] = (safeKeysym >>> 16) & 0xff;
    buffer[6] = (safeKeysym >>> 8) & 0xff;
    buffer[7] = safeKeysym & 0xff;
    return buffer;
}

export function shouldSkipDuplicateVncKeydown(existingKeysym, nextKeysym, repeat = false) {
    if (existingKeysym == null || nextKeysym == null) return false;
    return Boolean(repeat) || Number(existingKeysym) === Number(nextKeysym);
}

export function normalizeVncPassword(value) {
    if (typeof value !== 'string') return null;
    return value.length > 0 ? value : null;
}

export function computeContainedRemoteDisplayScale(availableWidth, availableHeight, framebufferWidth, framebufferHeight) {
    const safeAvailableWidth = Math.max(1, Math.floor(Number(availableWidth || 0)));
    const safeAvailableHeight = Math.max(1, Math.floor(Number(availableHeight || 0)));
    const safeFramebufferWidth = Math.max(1, Math.floor(Number(framebufferWidth || 0)));
    const safeFramebufferHeight = Math.max(1, Math.floor(Number(framebufferHeight || 0)));
    const scale = Math.min(safeAvailableWidth / safeFramebufferWidth, safeAvailableHeight / safeFramebufferHeight);
    if (!Number.isFinite(scale) || scale <= 0) return 1;
    return Math.max(0.01, scale);
}

const KEYSYM_BY_KEY = {
    Backspace: 0xff08,
    Tab: 0xff09,
    Enter: 0xff0d,
    Escape: 0xff1b,
    Insert: 0xff63,
    Delete: 0xffff,
    Home: 0xff50,
    End: 0xff57,
    PageUp: 0xff55,
    PageDown: 0xff56,
    ArrowLeft: 0xff51,
    ArrowUp: 0xff52,
    ArrowRight: 0xff53,
    ArrowDown: 0xff54,
    Shift: 0xffe1,
    ShiftLeft: 0xffe1,
    ShiftRight: 0xffe2,
    Control: 0xffe3,
    ControlLeft: 0xffe3,
    ControlRight: 0xffe4,
    Alt: 0xffe9,
    AltLeft: 0xffe9,
    AltRight: 0xffea,
    Meta: 0xffeb,
    MetaLeft: 0xffeb,
    MetaRight: 0xffec,
    Super: 0xffeb,
    Super_L: 0xffeb,
    Super_R: 0xffec,
    CapsLock: 0xffe5,
    NumLock: 0xff7f,
    ScrollLock: 0xff14,
    Pause: 0xff13,
    PrintScreen: 0xff61,
    ContextMenu: 0xff67,
    Menu: 0xff67,
    ' ': 0x20,
};

for (let i = 1; i <= 12; i += 1) {
    KEYSYM_BY_KEY[`F${i}`] = 0xffbe + (i - 1);
}

export function resolveVncKeysymFromKeyboardEvent(event) {
    const candidates = [event?.key, event?.code];
    for (const candidate of candidates) {
        if (candidate && Object.prototype.hasOwnProperty.call(KEYSYM_BY_KEY, candidate)) {
            return KEYSYM_BY_KEY[candidate];
        }
    }

    const key = String(event?.key || '');
    const keyCodePoint = key ? key.codePointAt(0) : null;
    const keyUnitLength = keyCodePoint == null ? 0 : (keyCodePoint > 0xffff ? 2 : 1);
    if (keyCodePoint != null && key.length === keyUnitLength) {
        if (keyCodePoint <= 0xff) return keyCodePoint;
        return (0x01000000 | keyCodePoint) >>> 0;
    }

    return null;
}
