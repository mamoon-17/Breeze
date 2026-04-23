import { User } from './user.entity';

/**
 * The "public-ish" view of a user that we surface through every API payload
 * (conversation peers, group members, /auth/me, etc.). Keeping this in one
 * place ensures we apply `customDisplayName` / avatar preferences consistently
 * no matter which module hands the user out.
 */
export interface PublicUserProjection {
  id: string;
  email: string;
  displayName: string;
  /**
   * Relative URL served by our backend (e.g. `/user/<id>/avatar?v=3`) or
   * `null` when the user has no avatar bytes on disk at all. Clients prepend
   * the API base. We never return raw Google URLs — see `AvatarService`.
   */
  avatarUrl: string | null;
}

export function effectiveDisplayName(user: User): string {
  const custom = user.customDisplayName?.trim();
  if (custom && custom.length > 0) return custom;
  return user.displayName;
}

export function effectiveAvatarUrl(user: User): string | null {
  const useGoogle = user.useGoogleAvatar;
  const hasCustom = !!user.customAvatarPath;
  const hasGoogleCache = !!user.cachedGoogleAvatarPath;

  if (!useGoogle && hasCustom) {
    return buildAvatarUrl(user.id, user.avatarVersion);
  }
  if (hasGoogleCache) {
    return buildAvatarUrl(user.id, user.avatarVersion);
  }
  return null;
}

function buildAvatarUrl(userId: string, version: string | number | undefined): string {
  const v = version != null ? String(version) : '0';
  return `/user/${userId}/avatar?v=${encodeURIComponent(v)}`;
}

export function toPublicUserProjection(user: User): PublicUserProjection {
  return {
    id: user.id,
    email: user.email,
    displayName: effectiveDisplayName(user),
    avatarUrl: effectiveAvatarUrl(user),
  };
}
