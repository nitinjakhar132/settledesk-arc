import { ImageResponse } from "next/og";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        background: "#c4f582",
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 116,
        fontWeight: 800,
        color: "#101110",
        borderRadius: 36,
      }}
    >
      s.
    </div>,
    size,
  );
}
