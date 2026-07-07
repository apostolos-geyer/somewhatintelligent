import React from "react";
import { FONT_MONO } from "../load-fonts";

/** A desktop browser chrome showing a brand portal at *.sproutportal.ca. */
export const BrowserFrame: React.FC<{
  host: string;
  accent: string;
  children: React.ReactNode;
  width?: number;
  height?: number;
}> = ({ host, accent, children, width = 1180, height = 740 }) => {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 22,
        overflow: "hidden",
        background: "hsl(40, 10%, 10%)",
        border: "1px solid hsl(40, 8%, 24%)",
        boxShadow: "0 50px 120px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: 52,
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "0 20px",
          background: "hsl(40, 9%, 14%)",
          borderBottom: "1px solid hsl(40, 8%, 20%)",
        }}
      >
        <div style={{ display: "flex", gap: 9 }}>
          {["hsl(8,70%,60%)", "hsl(45,80%,60%)", "hsl(130,50%,55%)"].map((c) => (
            <div key={c} style={{ width: 13, height: 13, borderRadius: "50%", background: c }} />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            height: 32,
            borderRadius: 8,
            background: "hsl(40, 8%, 9%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            color: "hsl(44,14%,72%)",
            fontFamily: FONT_MONO,
            fontSize: 18,
            fontWeight: 500,
          }}
        >
          <span style={{ color: accent }}>●</span>
          {host}
        </div>
      </div>
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>{children}</div>
    </div>
  );
};

/** A phone frame for the vertical (9:16) shorts. */
export const PhoneFrame: React.FC<{
  accent: string;
  children: React.ReactNode;
  width?: number;
}> = ({ accent, children, width = 620 }) => {
  const height = width * 2.06;
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 64,
        padding: 14,
        background: "linear-gradient(160deg, hsl(40,8%,18%), hsl(40,10%,8%))",
        boxShadow: "0 50px 120px rgba(0,0,0,0.65), inset 0 0 0 2px rgba(255,255,255,0.04)",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 52,
          overflow: "hidden",
          position: "relative",
          background: "hsl(40,10%,9%)",
        }}
      >
        {/* notch */}
        <div
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            width: 150,
            height: 30,
            borderRadius: 18,
            background: "#000",
            zIndex: 20,
          }}
        />
        <div style={{ position: "absolute", inset: 0 }}>{children}</div>
        {/* status accent dot */}
        <div
          style={{
            position: "absolute",
            top: 24,
            right: 36,
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: accent,
            zIndex: 20,
            boxShadow: `0 0 12px ${accent}`,
          }}
        />
      </div>
    </div>
  );
};
