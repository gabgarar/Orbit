/** Keep body-parser failures inside the JSON contract used by the browser client. */
export function registerApiErrorHandler(app) {
    app.use((error, _request, response, next) => {
        if (error?.type === "entity.parse.failed") {
            return response.status(400).json({ ok: false, error: "Payload JSON invalido." });
        }
        if (error?.type === "entity.too.large") {
            return response.status(413).json({ ok: false, error: "Payload demasiado grande." });
        }
        return next(error);
    });
}
