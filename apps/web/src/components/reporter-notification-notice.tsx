import type { ReporterNotificationStatus } from "@openwish/shared";

import { cn } from "#/lib/utils";

export function ReporterNotificationNotice({
  status,
  error,
}: {
  status?: ReporterNotificationStatus | null;
  error?: string | null;
}) {
  const notice = error
    ? {
        title: "Action failed",
        detail: error,
        className: "border-red-400/30 bg-red-400/10 text-red-100",
      }
    : status === "failed"
      ? {
          title: "Saved, but email failed",
          detail: "The admin action was saved, but OpenWish could not hand the email to the provider.",
          className: "border-red-400/30 bg-red-400/10 text-red-100",
        }
      : status === "skipped_no_email"
        ? {
            title: "Saved without email",
            detail: "This reporter did not provide an email address.",
            className: "border-amber-300/30 bg-amber-300/10 text-amber-100",
          }
        : status === "skipped_unsubscribed"
          ? {
              title: "Saved without email",
              detail: "This reporter unsubscribed from OpenWish emails.",
              className: "border-amber-300/30 bg-amber-300/10 text-amber-100",
            }
          : status === "accepted"
            ? {
                title: "Email accepted",
                detail: "Cloudflare accepted the message for delivery. This is not a final inbox confirmation.",
                className: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
              }
            : null;

  if (!notice) {
    return null;
  }

  return (
    <div className={cn("rounded-md border p-3 text-xs", notice.className)} role={error || status === "failed" ? "alert" : "status"}>
      <p className="font-medium">{notice.title}</p>
      <p className="mt-1 opacity-80">{notice.detail}</p>
    </div>
  );
}
