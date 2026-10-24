import { createFileRoute } from "@tanstack/react-router";
import { Terminal } from "@/components/terminal/Terminal";

export const Route = createFileRoute("/app")({ component: Terminal });
