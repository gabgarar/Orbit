import WorkspaceSidebar from "../WorkspaceSidebar.jsx";
import ObjectDetailsPanel from "../ObjectDetailsPanel.jsx";
import ProjectActionDialog from "../ProjectActionDialog.jsx";
import ConfigPanel from "../ConfigPanel.jsx";
import ConfirmDialog from "../ConfirmDialog.jsx";
import CatalogDropOverlay from "../CatalogDropOverlay.jsx";
import LayerContextMenu from "../LayerContextMenu.jsx";
import TreeContextMenu from "../TreeContextMenu.jsx";
import CatalogModal from "../CatalogModal.jsx";
import FolderNameDialog from "../FolderNameDialog.jsx";
import ExportDialog from "../ExportDialog.jsx";
import GroundStationsPanel from "../GroundStationsPanel.jsx";
import GroundStationExportMenu from "../GroundStationExportMenu.jsx";
import CatalogFilters from "../CatalogFilters.jsx";
import AppDialog from "../AppDialog.jsx";
import SatelliteContextMenu from "../SatelliteContextMenu.jsx";
import SatelliteVisualizationDialog from "../SatelliteVisualizationDialog.jsx";
import SatelliteInfoDialog from "../SatelliteInfoDialog.jsx";
import ManualOrbitPanel from "../ManualOrbitPanel.jsx";
import PropagatedOrbitParametersPanel from "../PropagatedOrbitParametersPanel.jsx";

/** Mounts dialogs and panels that communicate with the Cesium runtime through orbit:* events. */
export default function OrbitOverlays() {
    return <><WorkspaceSidebar /><ObjectDetailsPanel /><ManualOrbitPanel /><PropagatedOrbitParametersPanel /><ProjectActionDialog /><ConfigPanel /><ConfirmDialog /><CatalogDropOverlay /><LayerContextMenu /><TreeContextMenu /><CatalogModal /><FolderNameDialog /><ExportDialog /><GroundStationsPanel /><GroundStationExportMenu /><CatalogFilters /><AppDialog /><SatelliteContextMenu /><SatelliteVisualizationDialog /><SatelliteInfoDialog /></>;
}
