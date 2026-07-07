import { defineOg } from "@si/og";
import { OgBrand } from "./_brand.tsx";

export default defineOg({
  name: "opengraph-image",
  size: { width: 1200, height: 630 },
  render: () => (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "hsl(40, 15%, 93%)",
      }}
    >
      <OgBrand iconSize={220} />
    </div>
  ),
});
