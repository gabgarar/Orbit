import { useEffect, useState } from "react";
import {
    bindOperationEvents,
    getActiveOperations,
    subscribeToOperations
} from "../../../front/js/features/operations/operationsContract.js";

/**
 * React view of the global operation ledger.  The ledger itself deliberately
 * lives in `front/` so the scene runtime can publish work without React.
 */
export default function useOrbitOperations() {
    const [operations, setOperations] = useState(getActiveOperations);

    useEffect(() => {
        const unbind = bindOperationEvents(window);
        const unsubscribe = subscribeToOperations(setOperations);
        return () => {
            unsubscribe();
            unbind();
        };
    }, []);

    return operations;
}
