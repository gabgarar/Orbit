import {
    masterTimeRangeObjectStatus,
    resolveMasterTimeRangeObjectStatus
} from "../../../front/js/features/masterTimeRange/ui.js";

/**
 * Reusable status row for object lists and detail panels.
 *
 * The caller supplies the object state published by the MTR runtime.  This
 * component does not infer coverage or propagate anything; it only makes the
 * fail-closed `out_of_range` state explicit to the operator.
 */
export default function MasterTimeRangeOutOfRangeStatus({ status, object, className = "", compact = false }) {
    const presentation = status === undefined
        ? resolveMasterTimeRangeObjectStatus(object)
        : masterTimeRangeObjectStatus(status);
    if (!presentation.outOfRange) return null;

    return <div
        className={`flex min-w-0 items-start gap-2 rounded-[7px] border border-[rgba(184,136,67,.68)] bg-[rgba(73,48,19,.34)] px-2.5 py-2 font-sans text-[10px] leading-[1.42] text-[#e9cb96] ${className}`.trim()}
        data-master-time-range-status={presentation.status}
        role="status"
    >
        <span className="shrink-0 font-semibold">{compact ? "Fuera de rango" : presentation.label}</span>
        {!compact && <span className="min-w-0 text-[#d8c196]">{presentation.message}</span>}
    </div>;
}
