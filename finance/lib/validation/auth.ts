import { z } from "zod";
import { normalizeMobile } from "@/lib/auth/mobile";
import { MAX_PASSWORD_LENGTH } from "@/lib/auth/password";

export const loginSchema = z.object({
  mobileNumber: z
    .string({ error: "Enter your mobile number." })
    .transform((v, ctx) => {
      const m = normalizeMobile(v);
      if (!m) {
        ctx.addIssue({ code: "custom", message: "Enter a valid 10-digit mobile number." });
        return z.NEVER;
      }
      return m;
    }),
  password: z
    .string({ error: "Enter your password." })
    .min(1, "Enter your password.")
    .max(MAX_PASSWORD_LENGTH, "Invalid mobile number or password."),
});
export type LoginInput = z.output<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password.").max(MAX_PASSWORD_LENGTH),
  newPassword: z.string().min(1, "Enter a new password.").max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters.`),
  confirmPassword: z.string().min(1, "Confirm the new password.").max(MAX_PASSWORD_LENGTH),
});

export const setUserActiveSchema = z.object({
  userId: z.uuid(),
  active: z.enum(["true", "false"]).transform((v) => v === "true"),
});
