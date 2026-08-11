import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

function placeTooltip(trigger) {
    const rect = trigger?.getBoundingClientRect?.();
    if (!rect || typeof window === "undefined") return null;

    const viewportPadding = 12;
    const estimatedTooltipHeight = 116;
    const placeAbove = rect.bottom + estimatedTooltipHeight > window.innerHeight - viewportPadding
        && rect.top > estimatedTooltipHeight + viewportPadding;
    return {
        left: Math.max(viewportPadding, Math.min(window.innerWidth - viewportPadding, rect.left + rect.width / 2)),
        top: placeAbove ? Math.max(viewportPadding, rect.top - 8) : Math.min(window.innerHeight - viewportPadding, rect.bottom + 8),
        placement: placeAbove ? "top" : "bottom"
    };
}

/**
 * A small inspector-field tooltip that remains above scroll containers.
 *
 * Native title remains as a non-JavaScript fallback, while the portalled
 * tooltip is reachable by keyboard focus and never gets clipped by the
 * resizable object-details panel.
 */
export default function FieldHelpTooltip({ label, description, children, className = "" }) {
    const triggerRef = useRef(null);
    const tooltipId = useId();
    const [tooltip, setTooltip] = useState(null);

    const showTooltip = () => setTooltip(placeTooltip(triggerRef.current));
    const hideTooltip = () => setTooltip(null);

    useEffect(() => {
        if (!tooltip) return undefined;
        const dismiss = () => hideTooltip();
        window.addEventListener("resize", dismiss);
        // Scroll can move a fixed tooltip away from its field. Dismissing it
        // is less surprising than leaving stale help floating over a value.
        document.addEventListener("scroll", dismiss, true);
        return () => {
            window.removeEventListener("resize", dismiss);
            document.removeEventListener("scroll", dismiss, true);
        };
    }, [tooltip]);

    const closeOnEscape = (event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        hideTooltip();
        triggerRef.current?.blur?.();
    };

    const content = (
        <div
            ref={triggerRef}
            className={`relative cursor-help rounded-[5px] px-1.5 py-1 outline-none transition-colors hover:bg-[rgba(45,81,123,.14)] focus-visible:bg-[rgba(45,81,123,.2)] focus-visible:ring-1 focus-visible:ring-[#5683bc] ${className}`.trim()}
            tabIndex={0}
            title={description}
            aria-describedby={tooltipId}
            aria-label={`${label}. ${description}`}
            data-field-help={label}
            onPointerEnter={showTooltip}
            onPointerLeave={hideTooltip}
            onFocus={showTooltip}
            onBlur={hideTooltip}
            onKeyDown={closeOnEscape}
        >
            {children}
            <span id={tooltipId} className="sr-only">{description}</span>
        </div>
    );

    if (!tooltip || typeof document === "undefined") return content;
    return <>
        {content}
        {createPortal(
            <span
                role="tooltip"
                aria-hidden="true"
                className="pointer-events-none fixed z-[10220] block w-[min(300px,calc(100vw-24px))] rounded-[7px] border border-[#4b719b] bg-[rgba(7,18,33,.98)] px-2.5 py-2 text-left text-[10px] leading-[1.45] font-medium text-[#d8e6f7] shadow-[0_10px_30px_rgba(0,0,0,.48)]"
                style={{
                    left: tooltip.left,
                    top: tooltip.top,
                    transform: tooltip.placement === "top" ? "translate(-50%, -100%)" : "translateX(-50%)"
                }}
            >
                <span className="mr-1.5 inline-flex size-3 items-center justify-center rounded-full border border-[#5c86b6] text-[8px] leading-none font-bold text-[#a9c9f0]" aria-hidden="true">i</span>
                {description}
            </span>,
            document.body
        )}
    </>;
}
