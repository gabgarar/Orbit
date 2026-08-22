import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { initialBitWarningNotice } from "../../../front/js/features/diagnostics/bitPresentation.js";

// Module scope survives an App remount in the same browser session (including
// React development checks) without persisting acknowledgement across a page
// reload, where the current initial-BIT result should be announced again.
let initialBitWarningPresented = false;

/**
 * Shows a completed initial-BIT warning once per mounted application. The
 * diagnostics endpoint is polled continuously, so keeping this session-local
 * acknowledgement prevents every identical poll from reopening the notice.
 * A browser reload starts a new operator session and may show the current
 * initial-BIT warning again, which is intentional.
 */
export default function useInitialBitWarningNotice(diagnostics) {
    const candidate = useMemo(() => initialBitWarningNotice(diagnostics), [diagnostics]);
    const shownRef = useRef(false);
    const [notice, setNotice] = useState(null);

    useEffect(() => {
        if (!candidate || shownRef.current || initialBitWarningPresented) return;
        shownRef.current = true;
        initialBitWarningPresented = true;
        setNotice(candidate);
    }, [candidate]);

    const dismiss = useCallback(() => setNotice(null), []);

    return {
        notice,
        dismiss
    };
}
