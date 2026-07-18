export function setupSimulationActions(actions) {
    window.addEventListener("orbit:simulation-action", async (event) => {
        const { type, value } = event.detail || {};
        if (type === "mode") return actions.setMode(value);
        if (type === "play-toggle") return actions.togglePlayback();
        if (type === "pause") return actions.pause();
        if (type === "rewind") return actions.rewind();
        if (type === "speed") return actions.setSpeed(value);
        if (type === "timeline") return actions.seek(value);
        if (type === "range") return actions.setRange(value);
        if (type === "record-toggle") return actions.toggleRecording();
    });
}
