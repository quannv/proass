"use client";
import dynamic from "next/dynamic";

// The app depends on browser-only APIs (audio, localStorage), so skip server rendering.
const MeetingApp = dynamic(() => import("@/components/MeetingApp"), { ssr: false });

export default function Page() {
  return <MeetingApp />;
}
