"use server";

import { headers } from "next/headers";
import { clientIp } from "@/server/http/client-ip";
import { submitRemoval, type SubmitResult } from "@/server/privacy/removal-server";

/** The public removal form (docs/PLAN.md 4.8, 12.7). Server actions get Next's origin check. */
export async function requestRemoval(form: unknown): Promise<SubmitResult> {
  return submitRemoval(form, clientIp(await headers()));
}
