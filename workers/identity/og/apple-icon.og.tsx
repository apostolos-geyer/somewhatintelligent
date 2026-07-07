import { defineOg } from "@greenroom/og";
import { LogoIcon } from "@greenroom/ui/components/logo";

export default defineOg({
  name: "apple-icon",
  size: { width: 180, height: 180 },
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
      <LogoIcon colorScheme="light" size={180} />
    </div>
  ),
});
