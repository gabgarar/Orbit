/**
 * Start optional startup work without making the interactive runtime wait for
 * it.  The returned promise remains useful to callers/tests, while attaching
 * the lifecycle callbacks immediately prevents an unhandled rejection when a
 * service is unavailable.
 */
export function startNonBlockingStartupTask(task, {
    onFulfilled = null,
    onRejected = null
} = {}) {
    const work = Promise.resolve().then(() => task());
    void work.then((value) => {
        if (typeof onFulfilled === "function") {
            onFulfilled(value);
        }
    }).catch((error) => {
        if (typeof onRejected === "function") {
            onRejected(error);
        }
    });
    return work;
}
