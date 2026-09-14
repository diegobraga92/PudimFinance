/**
 * Bridge between the webview and the native notification-capture backend.
 *
 * Android uses the Tauri plugin (`pudim-android-native`), which emits the
 * `notificationCaptured` event with `{ app_name, title, text, post_time }`,
 * reachable through the `plugin:pudim-native|…` command prefix. On desktop
 * capture is unsupported, so everything here degrades to no-ops.
 */

import { addPluginListener, invoke } from '@tauri-apps/api/core';
import type { CaptureActionKind } from './capture';

export interface CapturedNotification {
  app_name: string;
  /** Resolved user-visible app label (e.g. "Nubank"); falls back to app_name. */
  app_label?: string;
  title: string;
  text: string;
  post_time: number;
  /** Id assigned by the listener when captured while the app was dead. */
  capture_id?: string;
  /** Whether the listener already posted an import prompt for it. */
  prompted?: boolean;
}

/** Content of an OS notification asking how to import a captured transaction. */
export interface CapturePrompt {
  /** Pending-capture id the prompt belongs to. */
  id: string;
  /** Notification title (localized by the caller). */
  title: string;
  /** Notification body (localized by the caller). */
  body: string;
  /** Human-readable source app label, shown as the sub-text. */
  appLabel: string;
}

/** A tap on one of the capture-prompt action buttons. */
export interface CaptureAction {
  capture_id: string;
  action: CaptureActionKind;
  /** Source app id/label and raw notification, present for listener-posted prompts. */
  app_name?: string;
  app_label?: string;
  title?: string;
  text?: string;
  post_time?: number;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let lastNativeError: string | null = null;

function nativeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function recordNativeError(operation: string, error: unknown): void {
  lastNativeError = `${operation}: ${nativeErrorMessage(error)}`;
  console.error(`[PudimFinance native] ${lastNativeError}`, error);
}

/** Returns the most recent native bridge error for an in-app diagnostic. */
export function getLastNativeError(): string | null {
  return lastNativeError;
}

/** Clears the most recent native bridge error after a successful retry. */
export function clearLastNativeError(): void {
  lastNativeError = null;
}

/** True when the native capture backend is available (Android build). */
export async function captureSupported(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const supported = await invoke<boolean>('plugin:pudim-native|is_supported');
    clearLastNativeError();
    return supported;
  } catch (error) {
    recordNativeError('is_supported', error);
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
  } catch (error) {
    recordNativeError('notificationCaptured listener', error);
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

/**
 * Posts an Android notification with Income / Debit / Credit import actions.
 * No-ops on desktop (no equivalent OS API).
 */
export async function showCapturePrompt(prompt: CapturePrompt): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('plugin:pudim-native|show_capture_prompt', {
      id: prompt.id,
      title: prompt.title,
      body: prompt.body,
      appLabel: prompt.appLabel,
    });
  } catch {
    // Non-fatal: the capture is still queued in the review inbox.
  }
}

/** Dismisses a capture-prompt notification already handled in-app (Android). */
export async function cancelCapturePrompt(id: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('plugin:pudim-native|cancel_capture_prompt', { id });
  } catch {
    // Non-fatal.
  }
}

/** Drains import actions tapped while the app was killed (Android). */
export async function drainCaptureActions(): Promise<CaptureAction[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<CaptureAction[]>('plugin:pudim-native|drain_capture_actions');
  } catch {
    return [];
  }
}

/** Subscribes to capture-prompt action taps. Returns an unlisten function. */
export async function subscribeCaptureActions(
  cb: (action: CaptureAction) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const unlisten = await addPluginListener<CaptureAction>(
      'pudim-native',
      'captureAction',
      (payload) => cb(payload),
    );
    return () => {
      void unlisten.unregister();
    };
  } catch {
    return () => {};
  }
}

/** Whether the OS currently allows PudimFinance to post notifications (Android). */
export async function notificationPostingAllowed(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const allowed = await invoke<boolean>('plugin:pudim-native|notification_posting_allowed');
    clearLastNativeError();
    return allowed;
  } catch (error) {
    recordNativeError('notification_posting_allowed', error);
    return false;
  }
}

/** Requests the Android 13+ notification permission. Resolves the resulting state. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const allowed = await invoke<boolean>('plugin:pudim-native|request_notification_permission');
    clearLastNativeError();
    return allowed;
  } catch (error) {
    recordNativeError('request_notification_permission', error);
    return false;
  }
}

/**
 * Mirrors the capture settings to the native listener so it can keep prompting
 * for detected transactions while the app process is dead.
 */
export async function syncCaptureSettings(settings: {
  enabled: boolean;
  pushPrompt: boolean;
  monitoredApps: string[];
}): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('plugin:pudim-native|set_capture_settings', {
      enabled: settings.enabled,
      pushPrompt: settings.pushPrompt,
      monitoredApps: settings.monitoredApps,
    });
  } catch (error) {
    recordNativeError('set_capture_settings', error);
    // Non-fatal: while the app is alive JS still drives capture/prompting.
  }
}

/** Whether Android "Notification access" was granted (Android only). */
export async function notificationAccessGranted(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const granted = await invoke<boolean>('plugin:pudim-native|access_granted');
    clearLastNativeError();
    return granted;
  } catch (error) {
    recordNativeError('access_granted', error);
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
export async function openNotificationAccessSettings(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    await invoke('plugin:pudim-native|open_settings');
    clearLastNativeError();
    return true;
  } catch (error) {
    recordNativeError('open_settings', error);
    return false;
  }
}
