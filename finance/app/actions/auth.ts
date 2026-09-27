"use server";

import { revalidatePath } from "next/cache";
import { changePassword, setUserActive } from "@/lib/auth/account";
import { signOut } from "@/lib/auth/auth";
import { adminActorOrRedirect } from "@/lib/auth/dal";
import { DomainError } from "@/lib/services/errors";
import { changePasswordSchema, setUserActiveSchema } from "@/lib/validation/auth";

/** Revokes the DB session and records LOGOUT (via the Auth.js signOut event), clears the cookie, → /login. */
export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

export interface ChangePasswordState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Partial<Record<"currentPassword" | "newPassword" | "confirmPassword", string>>;
}

export async function changePasswordAction(_prev: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const { user, actor } = await adminActorOrRedirect();
  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const f = parsed.error.flatten().fieldErrors;
    return { fieldErrors: { currentPassword: f.currentPassword?.[0], newPassword: f.newPassword?.[0], confirmPassword: f.confirmPassword?.[0] } };
  }
  try {
    const result = await changePassword({ userId: user.id, currentSessionId: user.sessionRef, ...parsed.data }, actor);
    if (!result.ok) return { fieldErrors: { [result.field]: result.error } };
    return {
      ok: true,
      message:
        result.otherSessionsRevoked > 0
          ? `Password changed. ${result.otherSessionsRevoked} other session(s) were signed out.`
          : "Password changed.",
    };
  } catch (err) {
    console.error("[auth] change password failed", err instanceof Error ? err.name : err);
    return { message: "Unable to change the password right now. Please try again." };
  }
}

export interface UserStatusState {
  ok?: boolean;
  error?: string;
}

export async function setUserActiveAction(_prev: UserStatusState, formData: FormData): Promise<UserStatusState> {
  const { actor } = await adminActorOrRedirect();
  const parsed = setUserActiveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };
  try {
    await setUserActive({ targetUserId: parsed.data.userId, active: parsed.data.active }, actor);
    revalidatePath("/settings/users");
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message };
    console.error("[auth] set user active failed", err instanceof Error ? err.name : err);
    return { error: "Unable to update the account right now." };
  }
}
