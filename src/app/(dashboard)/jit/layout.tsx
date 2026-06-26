import { globalMetaTitle } from "@utils/meta";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { JitProvider } from "@/modules/jit/JitProvider";

export const metadata: Metadata = {
  title: `Just-in-Time Access - ${globalMetaTitle}`,
};

export default function JitLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <JitProvider>{children}</JitProvider>;
}
