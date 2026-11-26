import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import type { WarningSeverity } from "@minerva/core";

interface Props {
  severity: WarningSeverity;
  title: string;
  detail?: string;
}

const accentClass: Record<WarningSeverity, string> = {
  info: "bg-mv-line-strong",
  review: "bg-warn",
  warning: "bg-warn",
  critical: "bg-crit",
};

const iconClass: Record<WarningSeverity, string> = {
  info: "text-mv-mist",
  review: "text-warn",
  warning: "text-warn",
  critical: "text-crit",
};

/** Source: Minerva Network — mv-panel surface with a 2px left accent. */
export function WarningCard({ severity, title, detail }: Props) {
  const Icon = severity === "info" ? Info : severity === "critical" ? ShieldAlert : AlertTriangle;
  return (
    <div className="flex rounded-md overflow-hidden bg-mv-panel border border-mv-line">
      <div className={`w-1 ${accentClass[severity]}`} />
      <div className="flex gap-3 p-4 flex-1">
        <Icon size={20} className={`shrink-0 ${iconClass[severity]}`} />
        <div className="flex-1">
          <div className="text-sm font-semibold text-mv-bone">{title}</div>
          {detail ? <div className="text-xs text-mv-mist mt-1">{detail}</div> : null}
        </div>
      </div>
    </div>
  );
}
