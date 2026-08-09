export function BellIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>;
}

export function HelpIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.6 2.6 0 1 1 4.4 1.9c-1.1 1-1.9 1.5-1.9 3.1M12 17h.01" /></svg>;
}

export function FolderIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.2A2.2 2.2 0 0 1 5.7 6h3.2l1.9 2.3H17a2.2 2.2 0 0 1 2.2 2.2v6.9a2.2 2.2 0 0 1-2.2 2.2H5.7a2.2 2.2 0 0 1-2.2-2.2Z" /><path d="M3.8 11.1h16.4" /></svg>;
}

export function SatelliteIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" data-orbit-icon="layers">
        {/* Keep the colour on each layer local: sidebar SVG rules deliberately
            use stroked icons, while this supplied Layers glyph is filled. */}
        <path fill="#83a6ff" stroke="none" d="M12 2.9 2.5 7.8 12 12.7l9.5-4.9L12 2.9Z" />
        <path fill="#6387ef" stroke="none" d="m2.5 11.2 9.5 4.9 9.5-4.9v3.5L12 19.6l-9.5-4.9v-3.5Z" />
        <path fill="#466ddd" stroke="none" d="m2.5 16.1 9.5 4.9 9.5-4.9v2.1L12 23l-9.5-4.8v-2.1Z" />
    </svg>;
}

/** Compact line icons for headers and menus.  Keep these separate from the
 * filled Layers rail glyph so contextual surfaces remain monochrome. */
export function OrbitalSatelliteIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="8" width="6" height="8" rx="1.1" /><path d="M9 10H4.5v4H9m6-4h4.5v4H15M11 8V5m2 0v3m-2 8v3m2-3v3" /><path d="m10.4 5 1.6-2 1.6 2M10.4 19l1.6 2 1.6-2" /></svg>;
}

export function EarthIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2" /><path d="M3.9 12h16.2M12 3.8c2.1 2.2 3.2 5 3.2 8.2S14.1 18 12 20.2C9.9 18 8.8 15.2 8.8 12S9.9 6 12 3.8" /><path d="M5.7 7.5c1.9.9 4 1.3 6.3 1.3s4.4-.4 6.3-1.3M5.7 16.5c1.9-.9 4-1.3 6.3-1.3s4.4.4 6.3 1.3" /></svg>;
}

export function BodiesIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.4" /><path d="M3 12c2.4-3.1 5.5-4.7 9-4.7 3.5 0 6.6 1.6 9 4.7-2.4 3.1-5.5 4.7-9 4.7-3.5 0-6.6-1.6-9-4.7Z" /><circle cx="18.5" cy="6.2" r="1.35" /><path d="M5.1 18.1h4.4" /></svg>;
}

export function ControlPanelIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="3" /><path d="M7 9h10M7 15h10M10 7v4M15 13v4" /></svg>;
}

export function CalendarIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M8 3.5v4M16 3.5v4M4 10h16M8 14h.01M12 14h.01M16 14h.01" /></svg>;
}

export function ChevronDownIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 9 5.5 5.5L17.5 9" /></svg>;
}

export function EyeIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.6" /></svg>;
}

export function EyeOffIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.7 4.2A10.8 10.8 0 0 1 12 4c6 0 9.5 6 9.5 8a11 11 0 0 1-3 4.1" /><path d="M6.5 6.5C4 8.1 2.5 10.7 2.5 12c0 2 3.5 8 9.5 8 1.3 0 2.6-.3 3.7-.8" /></svg>;
}

export function TrashIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>;
}

export function PlusIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

export function SearchIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.3 4.3" /></svg>;
}

export function SlidersIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6M16 14v6" /></svg>;
}

export function CameraIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.75" y="7" width="12.75" height="10" rx="2.1" /><path d="m15.5 10 4.1-2.05A1.25 1.25 0 0 1 21.5 9v6a1.25 1.25 0 0 1-1.9 1.05L15.5 14Z" /><circle cx="9.15" cy="12" r="2.45" /><path d="M5.5 5.25h5.25" /></svg>;
}

export function ManualOrbitIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="12" rx="9" ry="4.7" transform="rotate(-32 12 12)" /><circle cx="16.9" cy="6.2" r="1.75" /><path d="M4 18.5h5M6.5 16v5" /></svg>;
}

export function GroundStationIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M8 20l2.1-8.5h3.8L16 20M8.5 8a3.5 3.5 0 0 1 7 0" /><path d="M5 5a10 10 0 0 1 14 0M7 7a7 7 0 0 1 10 0" /></svg>;
}

export function PassTableIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M3.5 9h17M8.5 4v16M13.8 13h3M15.3 11.5v3" /></svg>;
}

export function PropagatedParametersIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5V4.5M4 19.5h16" /><path d="m6.5 15.5 4-4 3 2.25 4-6.25" /><circle cx="6.5" cy="15.5" r="1" /><circle cx="10.5" cy="11.5" r="1" /><circle cx="13.5" cy="13.75" r="1" /><circle cx="17.5" cy="7.5" r="1" /></svg>;
}
