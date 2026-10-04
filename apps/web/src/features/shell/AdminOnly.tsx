import { Navigate } from "@tanstack/react-router";

import { useRole } from "@/rpc/session.ts";

import type { ReactNode } from "react";

export function AdminOnly({ children }: { readonly children: ReactNode }) {
  return useRole() === "admin" ? children : <Navigate to="/" replace />;
}
