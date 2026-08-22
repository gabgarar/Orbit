import assert from "node:assert/strict";
import test from "node:test";

import {
    isProjectWorkspaceState,
    PROJECT_WORKSPACE_STATES,
    projectWorkspaceStateForMetadata
} from "../../js/features/projects/projectStates.js";

test("project workspace states expose a fail-closed explicit lifecycle", () => {
    assert.equal(projectWorkspaceStateForMetadata(null), PROJECT_WORKSPACE_STATES.NO_PROJECT_OPEN);
    assert.equal(projectWorkspaceStateForMetadata({}), PROJECT_WORKSPACE_STATES.NO_PROJECT_OPEN);
    assert.equal(projectWorkspaceStateForMetadata({ id: "p-import", creationMode: "project_imported" }), PROJECT_WORKSPACE_STATES.PROJECT_OPEN);
    assert.equal(projectWorkspaceStateForMetadata({ id: "p-new", creationMode: "project_new" }), PROJECT_WORKSPACE_STATES.PROJECT_NEW);
    assert.equal(projectWorkspaceStateForMetadata({ id: "p-generated", creationMode: "project_generated" }), PROJECT_WORKSPACE_STATES.PROJECT_GENERATED);
    assert.equal(isProjectWorkspaceState("project_open"), true);
    assert.equal(isProjectWorkspaceState("made-up-state"), false);
});
