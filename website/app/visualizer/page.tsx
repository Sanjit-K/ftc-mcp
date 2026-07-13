import type { Metadata } from "next";
import { RichVisualizer } from "./rich-visualizer";

export const metadata: Metadata = {
  title: "Autonomous Studio — FTC Toolchain",
  description: "Build Pedro paths and robot-action state machines visually, with or without an AI agent.",
};

export default function VisualizerPage() {
  return <RichVisualizer />;
}
