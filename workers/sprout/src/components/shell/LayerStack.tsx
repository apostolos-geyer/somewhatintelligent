import { SECTION_REGISTRY } from "@/components/sections/registry";
import { SectionLayer } from "./SectionLayer";
import { useLayerStack } from "./use-layer-stack";

/**
 * Renders the active SectionLayer driven by the `?section=` search param. The
 * `Dialog` primitive inside `SectionLayer` owns scroll-lock, focus-trap, and
 * Escape-to-close; and because opening a layer is a same-route search change (the
 * grid never unmounts), the browser preserves its scroll offset on close for
 * free — so this is just: pick the section component and mount it in the layer.
 */
export function LayerStack() {
  const { section, closeLayer } = useLayerStack();
  if (!section) return null;
  const Content = SECTION_REGISTRY[section];
  return (
    <SectionLayer section={section} onClose={closeLayer}>
      <Content />
    </SectionLayer>
  );
}
