/**
 * Latest-request guard for the transient manual-ERP preflight.
 *
 * Reading a local File cannot be aborted reliably in every browser.  A
 * monotonically increasing generation therefore complements AbortController:
 * a late file read or HTTP response can never attach an ERP after the user
 * has cleared it, replaced it, closed the editor, or changed project.
 */
export function createManualErpUploadGate({ AbortControllerImpl = AbortController } = {}) {
    let generation = 0;
    let currentController = null;

    function cancel() {
        generation += 1;
        if (currentController) {
            currentController.abort();
            currentController = null;
        }
    }

    function begin() {
        cancel();
        const controller = new AbortControllerImpl();
        currentController = controller;
        const requestGeneration = ++generation;

        return Object.freeze({
            controller,
            isCurrent: () => requestGeneration === generation && currentController === controller,
            finish: () => {
                if (currentController === controller) {
                    currentController = null;
                }
            }
        });
    }

    return Object.freeze({ cancel, begin });
}
