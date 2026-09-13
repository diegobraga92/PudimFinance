/**
 * Bridge between the webview and the native notification-capture backend.
 *
 * Android uses the Tauri plugin (`pudim-android-native`), which emits the
 * `notificationCaptured` event with `{ app_name, title, text, post_time }`,
 * reachable through the `plugin:pudim-native|…` command prefix. On desktop
 * capture is unsupported, so everything here degrades to no-ops.
 */

import { addPluginListener, invoke } from '@tauri-apps/api/core';

export interface CapturedNotification {
  app_name: string;
  title: string;
  text: string;
  post_time: number;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** True when the native capture backend is available (Android build). */
export async function captureSupported(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>('plugin:pudim-native|is_supported');
  } catch {
    return false;
  }
}

/** Subscribes to native captured notifications. Returns an unlisten function. */
export async function subscribeNativeNotifications(
  cb: (notification: CapturedNotification) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const unlisten = await addPluginListener<CapturedNotification>(
      'pudim-native',
      'notificationCaptured',
      (payload) => cb(payload),
    );
    return () => {
      void unlisten.unregister();
    };
  } catch {
    return () => {};
  }
}

/** Drains notifications captured while the app was killed (Android). */
export async function drainNativeNotifications(): Promise<CapturedNotification[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<CapturedNotification[]>('plugin:pudim-native|drain_pending');
  } catch {
    return [];
  }
}

/** Whether Android "Notification access" was granted (Android only). */
export async function notificationAccessGranted(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>('plugin:pudim-native|access_granted');
  } catch {
    return false;
  }
}

/** Whether biometrics are available and enrolled (Android only). */
export async function biometricAvailable(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>('plugin:pudim-native|biometric_available');
  } catch {
    return false;
  }
}

/** Shows the system biometric prompt. Resolves true only on success. */
export async function authenticateBiometric(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>('plugin:pudim-native|biometric_authenticate');
  } catch {
    return false;
  }
}

/** Pushes a fresh "spent today" value to every home-screen widget (Android). */
export async function setWidgetSpentToday(value: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('plugin:pudim-native|set_widget_spent_today', { value });
  } catch {
    // Non-fatal (no widget on desktop).
  }
}

/** Returns (and clears) a deep link captured at cold start (Android). */
export async function takeDeepLink(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string | null>('plugin:pudim-native|take_deep_link');
  } catch {
    return null;
  }
}

/** Subscribes to home-screen widget deep links while the app is running. */
export async function subscribeDeepLinks(cb: (link: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const unlisten = await addPluginListener<{ link: string }>(
      'pudim-native',
      'deepLink',
      (payload) => cb(payload.link),
    );
    return () => {
      void unlisten.unregister();
    };
  } catch {
    return () => {};
  }
}

/** Opens the Android "Notification access" settings screen (Android only). */
export async function openNotificationAccessSettings(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('plugin:pudim-native|open_settings');
  } catch {
    // Non-fatal.
  }
}
