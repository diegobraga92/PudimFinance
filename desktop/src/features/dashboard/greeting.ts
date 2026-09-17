interface GreetingUser {
  email?: string | null;
  display_name?: string | null;
}

/** Prefer the user's chosen display name, showing only its first name. */
export function displayNameForGreeting(user?: GreetingUser | null): string | null {
  const displayName = user?.display_name?.trim();
  if (displayName) return displayName.split(/\s+/)[0];

  const handle = user?.email?.split('@')[0].trim();
  if (!handle) return null;
  return handle.charAt(0).toUpperCase() + handle.slice(1);
}