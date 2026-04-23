import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Profile, resolveAvatarUrl } from "@/lib/breeze/api";
import { useAuth } from "@/lib/breeze/auth-context";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();
  const { user, refreshUser, signOut } = useAuth();

  const [customName, setCustomName] = useState("");
  const [useGoogleAvatar, setUseGoogleAvatar] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Bumped after every avatar-mutation so the preview <img> refetches even
  // though the server URL is the same (`v=` query param changes anyway, but
  // we need to force React to treat the src as new when nothing in the URL
  // actually changes).
  const [avatarBust, setAvatarBust] = useState(0);

  useEffect(() => {
    // Seed the form once the user record arrives. We show the Google name as
    // the placeholder so an empty input visibly means "fall back to Google".
    if (!user) return;
    const custom =
      user.displayName && user.displayName !== user.googleDisplayName
        ? user.displayName
        : "";
    setCustomName(custom);
    setUseGoogleAvatar(user.useGoogleAvatar ?? true);
  }, [user?.id, user?.displayName, user?.googleDisplayName, user?.useGoogleAvatar, user]);

  const googleDefault = user?.googleDisplayName ?? "";
  const effectiveName = customName.trim().length > 0 ? customName.trim() : googleDefault;
  const avatarSrc = useMemo(() => {
    const resolved = resolveAvatarUrl(user?.avatarUrl);
    if (!resolved) return null;
    const sep = resolved.includes("?") ? "&" : "?";
    return `${resolved}${sep}_b=${avatarBust}`;
  }, [user?.avatarUrl, avatarBust]);
  const initial = (effectiveName || user?.email || "?").charAt(0).toUpperCase();

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const trimmed = customName.trim();
      await Profile.update({
        // Always send the name so clearing works; empty string is treated as
        // "remove the override" server-side.
        customDisplayName: trimmed,
        useGoogleAvatar,
      });
      toast.success("Profile saved");
      await refreshUser();
      setAvatarBust((n) => n + 1);
    } catch (err) {
      const e = err as { message?: string };
      toast.error(e?.message ?? "Couldn't save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the input value so picking the same file again still triggers
    // onChange — otherwise a re-upload of the same filename silently fails.
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image is too large (max 5 MB)");
      return;
    }
    setUploading(true);
    try {
      await Profile.uploadAvatar(file);
      setUseGoogleAvatar(false);
      toast.success("Custom avatar uploaded");
      await refreshUser();
      setAvatarBust((n) => n + 1);
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "Upload failed";
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  const removeCustom = async () => {
    setUploading(true);
    try {
      await Profile.deleteAvatar();
      setUseGoogleAvatar(true);
      toast.success("Reverted to Google picture");
      await refreshUser();
      setAvatarBust((n) => n + 1);
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "Couldn't remove avatar";
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-linen-200 bg-white/60 px-6">
        <button
          onClick={() => navigate({ to: "/app" })}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-linen-100 hover:text-foreground"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to messages
        </button>
        <button
          onClick={async () => {
            await signOut();
            navigate({ to: "/" });
          }}
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50"
        >
          Log out
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-10 md:py-14">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Account
          </p>
          <h1 className="mt-1 font-display text-4xl">Profile</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Choose how you appear to other people on Breeze — your display name
            and your profile picture.
          </p>

          {/* Avatar card */}
          <section className="mt-8 rounded-2xl border border-linen-200 bg-card p-6 shadow-soft">
            <h2 className="text-sm font-semibold text-foreground">Profile picture</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Use the photo from your Google account, or upload your own.
            </p>

            <div className="mt-5 flex items-center gap-5">
              <div className="shrink-0">
                {avatarSrc ? (
                  <img
                    key={avatarSrc}
                    src={avatarSrc}
                    alt=""
                    className="size-20 rounded-full border border-linen-200 object-cover"
                  />
                ) : (
                  <div className="flex size-20 items-center justify-center rounded-full bg-linen-200 text-2xl font-semibold text-muted-foreground">
                    {initial}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                  >
                    {uploading ? "Working..." : "Upload new"}
                  </button>
                  {user?.hasCustomAvatar && (
                    <button
                      type="button"
                      onClick={() => void removeCustom()}
                      disabled={uploading}
                      className="rounded-lg border border-linen-200 bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-linen-50 disabled:opacity-60"
                    >
                      Remove custom
                    </button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={handleFile}
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  PNG, JPG, WEBP or GIF · up to 5 MB
                </p>
              </div>
            </div>

            <label className="mt-6 flex items-start gap-3 rounded-xl border border-linen-200 bg-linen-50 p-3">
              <input
                type="checkbox"
                checked={useGoogleAvatar}
                onChange={(e) => setUseGoogleAvatar(e.target.checked)}
                className="mt-0.5 size-4 accent-primary"
                disabled={!user?.hasCustomAvatar}
              />
              <div className="text-xs">
                <div className="font-medium text-foreground">
                  Use my Google account picture
                </div>
                <div className="mt-0.5 text-muted-foreground">
                  {user?.hasCustomAvatar
                    ? "Switch between your uploaded picture and your Google photo without losing the upload."
                    : "Upload a custom picture first to unlock switching."}
                </div>
              </div>
            </label>
          </section>

          {/* Display name card */}
          <section className="mt-6 rounded-2xl border border-linen-200 bg-card p-6 shadow-soft">
            <h2 className="text-sm font-semibold text-foreground">Display name</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Shown to everyone you chat with. Leave blank to use the name on
              your Google account
              {googleDefault ? (
                <>
                  {" "}
                  (<span className="font-medium text-foreground">{googleDefault}</span>).
                </>
              ) : (
                "."
              )}
            </p>
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              maxLength={100}
              placeholder={googleDefault || "Your name"}
              className="mt-4 w-full rounded-xl border border-linen-200 bg-linen-50 px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-primary focus:bg-white"
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              Preview:{" "}
              <span className="font-medium text-foreground">{effectiveName || "—"}</span>
            </p>
          </section>

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => void saveProfile()}
              disabled={saving}
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
