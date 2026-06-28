/** Consistent response envelope used by every route. */
export type Meta = { total?: number; page?: number; limit?: number };

export type Envelope<T> =
  | { success: true; data: T; meta?: Meta }
  | { success: false; error: { code: string; message: string } };

export const ok = <T>(data: T, meta?: Meta): Envelope<T> =>
  meta ? { success: true, data, meta } : { success: true, data };

export const fail = (code: string, message: string): Envelope<never> => ({
  success: false,
  error: { code, message },
});
