import { Navigate } from "@tanstack/react-router";

import { useRole } from "@/rpc/session.ts";

import type { ReactNode } from "react";

/** Shows its content to admins and sends users to Projects, for pages users can't use. */
export function AdminOnly({ children }: { readonly children: ReactNode }) {
  return useRole() === "admin" ? children : <Navigate to="/" replace />;
}
