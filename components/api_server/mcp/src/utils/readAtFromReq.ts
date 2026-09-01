import { Request } from "express";

// getAtFromReq returns AT from headers.
// @param req Express req
// If not found, returns null.
export const getAtFromReq = (req: Request): string | null => {
  const authHeader = req.header("Authorization");
  if (!authHeader) return null;

  if (authHeader.startsWith("Bearer ")) {
    return authHeader.replace("Bearer ", "");
  }

  return null;
}
