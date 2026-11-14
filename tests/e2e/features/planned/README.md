# Planned UX contracts

This root is reserved for desired, unimplemented contracts tagged `@planned @not-implemented`.

The single-user passkey Settings contract has moved, retaining all scenario IDs, to [shared/single-user-passkey-settings.feature](../shared/single-user-passkey-settings.feature). [Implementation evidence and manual-device limits](../../../../docs/reviews/single-user-passkey-settings.md).

The SVG-image cases introduced by #1324 have moved, without duplicate IDs, to [shared/svg-images.feature](../shared/svg-images.feature). #1325 implements them in Classic and supplies Chromium/WebKit assertions. Import shared acceptance with either skin root; do not treat future planned contracts as passing implementations.
