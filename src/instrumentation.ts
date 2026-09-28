import { type Instrumentation } from "next";

/**
 * Runs once when a server instance starts (not during `next build`): refuse to
 * start with an invalid configuration. Next.js keeps serving (every request
 * failing with 500) when `register` throws, so exit explicitly: the platform
 * then reports a failed deployment instead of a running but broken instance.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateConfigurationAtStartup, exitOnInvalidConfiguration } =
    await import("@/server/startup");
  try {
    validateConfigurationAtStartup();
  } catch (error) {
    exitOnInvalidConfiguration(error);
  }
}

/** Structured log entry for every server-side request error. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportRequestError } = await import("@/server/startup");
  reportRequestError(error, request, context);
};
