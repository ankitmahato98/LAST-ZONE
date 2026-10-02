/**
 * Native (Capacitor) shell integration.
 *
 * Everything here is additive and platform-gated: on the web these functions are
 * inert, and the Capacitor runtime is loaded through a dynamic import so the
 * browser bundle never pays for it. The module only knows about the game's
 * menu service (`open()` / `isOpen`), never about gameplay, so combat, the
 * player controller and the renderer stay untouched.
 *
 * Android specifics it covers:
 *   - the hardware/gesture Back button: with `@capacitor/app` installed the
 *     OS handler is registered, so Back does nothing unless JS listens. We make
 *     it pause the match, and a second Back from the pause menu leaves the app.
 *   - the app returning to the foreground keeps whatever pause state the user
 *     left, because `MenuSystem` already pauses on `visibilitychange`.
 */

/** True only when running inside the Capacitor native shell (the APK). */
export function isNativePlatform() {
  return (
    typeof window !== 'undefined' &&
    typeof window.Capacitor?.isNativePlatform === 'function' &&
    window.Capacitor.isNativePlatform() === true
  );
}

/**
 * Back-button policy: pause first, quit only from the pause menu.
 *
 * Pure and dependency-injected so it can be unit tested without a device.
 *
 * @param {object} options
 * @param {{ isOpen?: boolean, open?: Function }} options.menu  menu service (or null)
 * @param {{ exitApp?: Function }} options.app  Capacitor App plugin (or null)
 * @returns {() => 'pause' | 'exit' | 'ignore'} the action taken, for tests/logging
 */
export function createBackButtonHandler({ menu = null, app = null } = {}) {
  return function onBackButton() {
    if (menu?.isOpen) {
      app?.exitApp?.();
      return 'exit';
    }
    if (typeof menu?.open === 'function') {
      menu.open({ reason: 'back' });
      return 'pause';
    }
    return 'ignore';
  };
}

/**
 * Wires the native shell up to the game. No-op on the web.
 *
 * @param {object} options
 * @param {{ isOpen?: boolean, open?: Function }} [options.menu]
 * @param {object} [options.app]        override the Capacitor App plugin (tests)
 * @param {() => boolean} [options.isNative] override the platform check (tests)
 * @returns {Promise<null | { handleBack: Function, dispose: () => void }>}
 */
export async function installNativeAppHandlers({
  menu = null,
  app = null,
  isNative = isNativePlatform,
} = {}) {
  if (!isNative()) return null;

  const plugin = app ?? (await import('@capacitor/app')).App;
  const handleBack = createBackButtonHandler({ menu, app: plugin });
  const listener = await plugin.addListener('backButton', () => handleBack());

  return {
    handleBack,
    dispose() {
      listener?.remove?.();
    },
  };
}
