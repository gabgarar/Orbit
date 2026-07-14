/**
 * Adds persistent right-edge resizing to a left-side panel.
 * Dragging below the minimum width closes the panel and clears its saved size.
 */
export function setupResizableSidePanel({
    panel,
    triggerButton,
    storageKey,
    cssVariable,
    minimumWidth = 180,
    maximumWidth = () => Math.min(640, window.innerWidth * 0.72),
    onLayoutChange = () => {}
}) {
    const handle = panel?.querySelector(".sidebar-panel-resize-handle");
    if (!panel || !triggerButton || !handle) {
        return () => {};
    }

    const setWidth = (width, persist = true) => {
        const maxWidth = Math.max(minimumWidth + 40, maximumWidth());
        const safeWidth = Math.round(Math.min(Math.max(width, minimumWidth), maxWidth));
        panel.style.setProperty(cssVariable, `${safeWidth}px`);
        if (persist) {
            localStorage.setItem(storageKey, String(safeWidth));
        }
        onLayoutChange();
    };

    const savedWidth = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(savedWidth) && savedWidth >= minimumWidth) {
        setWidth(savedWidth, false);
    }

    const onPointerDown = (event) => {
        event.preventDefault();
        const panelRect = panel.getBoundingClientRect();
        const startWidth = panelRect.width;
        const startX = event.clientX;

        handle.setPointerCapture?.(event.pointerId);
        panel.classList.add("is-resizing");

        const stopResizing = () => {
            panel.classList.remove("is-resizing");
            window.removeEventListener("pointermove", resizePanel);
            window.removeEventListener("pointerup", stopResizing);
            window.removeEventListener("pointercancel", stopResizing);
        };

        const resizePanel = (moveEvent) => {
            const nextWidth = startWidth + moveEvent.clientX - startX;
            if (nextWidth <= minimumWidth) {
                panel.style.removeProperty(cssVariable);
                localStorage.removeItem(storageKey);
                panel.classList.remove("open");
                triggerButton.classList.remove("active");
                onLayoutChange();
                stopResizing();
                return;
            }
            setWidth(nextWidth);
        };

        window.addEventListener("pointermove", resizePanel);
        window.addEventListener("pointerup", stopResizing);
        window.addEventListener("pointercancel", stopResizing);
    };

    handle.addEventListener("pointerdown", onPointerDown);
    return () => handle.removeEventListener("pointerdown", onPointerDown);
}
