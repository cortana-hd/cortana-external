import { CronClient } from "./cron-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function CronPage() {
  return <CronClient />;
}
