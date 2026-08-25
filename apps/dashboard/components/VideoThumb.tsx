"use client";

export function VideoThumb({ src, label }: { src: string; label: string }) {
  return (
    <div style={{ width: "100%", height: 90, background: "var(--bg-primary)", position: "relative", overflow: "hidden" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`Variation ${label}`}
        loading="lazy"
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
      <div style={{
        position: "absolute", bottom: 4, right: 4,
        background: "rgba(0,0,0,0.7)", color: "#fff",
        padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600,
      }}>
        {label}
      </div>
    </div>
  );
}
