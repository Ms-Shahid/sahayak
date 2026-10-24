import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod/v4";
import { ZodError as GeneratedZodError } from "zod";
import { AccessError } from "./access";

export const apiErrorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof AccessError) { res.status(error.status).json({ error: error.message }); return; }
  if (error instanceof ZodError || error instanceof GeneratedZodError) {
    res.status(400).json({ error: "Invalid request. Check the required fields." }); return;
  }
  if (error?.code === "23505" || error?.cause?.code === "23505") {
    res.status(409).json({ error: "This account, membership or submission already exists." }); return;
  }
  req.log?.error({ err: error }, "Request failed");
  res.status(500).json({ error: "Unable to complete this request." });
};
