export default function HelpPanel({ onClose }) {
    return <aside className="react-help-panel"><button type="button" onClick={onClose} aria-label="Cerrar ayuda">&#215;</button><strong>Ayuda</strong><p>Busca un satelite, seleccionalo y usa la barra temporal para explorar su orbita.</p></aside>;
}
