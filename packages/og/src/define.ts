import type { ReactNode } from "react";

export type OgDefinition = {
  name: string;
  size: { width: number; height: number };
  contentType?: string;
  render: () => ReactNode | Promise<ReactNode>;
};

export function defineOg(def: OgDefinition): OgDefinition {
  return def;
}
