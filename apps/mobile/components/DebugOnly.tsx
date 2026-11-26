import type { ReactNode } from "react";
import { isDebugMode } from "@minerva/core";

/** Renders children only when EXPO_PUBLIC_MINERVA_DEBUG=1. */
export function DebugOnly({ children }: { children: ReactNode }) {
  if (!isDebugMode()) return null;
  return <>{children}</>;
}
