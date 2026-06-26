import type { z } from "zod";
import { AppError, ErrorCodes } from "./errors.js";

/** Parse with a Zod schema, throwing AppError(VALIDATION) with a readable message. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new AppError(ErrorCodes.VALIDATION, msg, 400);
  }
  return result.data;
}
