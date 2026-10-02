import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createBackButtonHandler,
  installNativeAppHandlers,
  isNativePlatform,
} from '../src/platform/nativeApp.js';

/**
 * Native (Capacitor) shell integration.
 *
 * These tests never touch a device: the Capacitor App plugin and the platform
 * check are injected, so the Android back-button policy is verified as plain
 * logic. That policy is what stops the Back gesture from doing nothing (the
 * `@capacitor/app` handler swallows the press once the plugin is installed).
 */

function fakeMenu(initialOpen = false) {
  const menu = {
    isOpen: initialOpen,
    opens: [],
    open(options) {
      menu.opens.push(options ?? {});
      menu.isOpen = true;
    },
  };
  return menu;
}

function fakeApp() {
  const app = {
    exitCount: 0,
    listeners: [],
    exitApp() {
      app.exitCount += 1;
    },
    addListener(eventName, handler) {
      const entry = { eventName, handler, removed: false };
      app.listeners.push(entry);
      return Promise.resolve({
        remove() {
          entry.removed = true;
          return Promise.resolve();
        },
      });
    },
  };
  return app;
}

test('platform check is false outside the native shell', () => {
  // Plain node here: no Capacitor global exists, so the shell is "not native".
  assert.equal(isNativePlatform(), false);

  // A browser runtime that is not native (the web build of @capacitor/core)
  // reports false as well.
  globalThis.window = { Capacitor: { isNativePlatform: () => false } };
  try {
    assert.equal(isNativePlatform(), false);
    globalThis.window.Capacitor.isNativePlatform = () => true;
    assert.equal(isNativePlatform(), true);
  } finally {
    delete globalThis.window;
  }
});

test('back button pauses a live match instead of quitting', () => {
  const menu = fakeMenu(false);
  const app = fakeApp();
  const onBack = createBackButtonHandler({ menu, app });

  assert.equal(onBack(), 'pause');
  assert.equal(menu.isOpen, true);
  assert.deepEqual(menu.opens, [{ reason: 'back' }]);
  assert.equal(app.exitCount, 0, 'back must never drop the player out of a match');
});

test('back button exits the app only while the pause menu is open', () => {
  const menu = fakeMenu(true);
  const app = fakeApp();
  const onBack = createBackButtonHandler({ menu, app });

  assert.equal(onBack(), 'exit');
  assert.equal(app.exitCount, 1);
  assert.equal(menu.opens.length, 0, 'an already-open menu is not re-opened');
});

test('back button handler tolerates a missing menu or plugin', () => {
  assert.equal(createBackButtonHandler({})(), 'ignore');
  assert.equal(createBackButtonHandler({ menu: fakeMenu(false) })(), 'pause');
  assert.doesNotThrow(() => createBackButtonHandler({ menu: fakeMenu(true) })());
});

test('installNativeAppHandlers is inert on the web', async () => {
  const menu = fakeMenu(false);
  let imported = false;

  const result = await installNativeAppHandlers({
    menu,
    isNative: () => false,
    app: {
      addListener() {
        imported = true;
        return Promise.resolve({ remove() {} });
      },
    },
  });

  assert.equal(result, null);
  assert.equal(imported, false, 'no plugin call is made when not native');
  assert.equal(menu.opens.length, 0);
});

test('installNativeAppHandlers subscribes on native and can be disposed', async () => {
  const menu = fakeMenu(false);
  const app = fakeApp();

  const installed = await installNativeAppHandlers({
    menu,
    app,
    isNative: () => true,
  });

  assert.ok(installed, 'handlers are installed inside the native shell');
  assert.equal(app.listeners.length, 1);
  assert.equal(app.listeners[0].eventName, 'backButton');

  // The registered listener follows the same pause-then-exit policy.
  app.listeners[0].handler();
  assert.equal(menu.isOpen, true);
  app.listeners[0].handler();
  assert.equal(app.exitCount, 1);

  installed.dispose();
  await Promise.resolve();
  assert.equal(app.listeners[0].removed, true);
});
