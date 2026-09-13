const COMMANDS: &[&str] = &[
    "is_supported",
    "access_granted",
    "open_settings",
    "drain_pending",
    "show_capture_prompt",
    "cancel_capture_prompt",
    "drain_capture_actions",
    "notification_posting_allowed",
    "request_notification_permission",
    "set_capture_settings",
    "secure_get",
    "secure_set",
    "secure_delete",
    "biometric_available",
    "biometric_authenticate",
    "set_widget_spent_today",
    "take_deep_link",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
