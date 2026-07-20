import { checkboxes, colors, labels, selectOptions } from "./configSchema.js";

const fieldClass = "flex flex-col gap-1 font-sans [font-size:calc(12px*var(--orbit-ui-scale))]";
const controlClass = "rounded-lg border border-[var(--orbit-border-primary)] bg-[var(--orbit-bg-input)] px-[calc(8px*var(--orbit-ui-scale))] py-[calc(7px*var(--orbit-ui-scale))] font-[inherit] text-[var(--orbit-text-primary)]";

export default function ConfigField({ section, field, value, onChange }) {
    if (checkboxes.has(field)) {
        return <label className="mt-[18px] flex items-center gap-2 font-sans [font-size:calc(12px*var(--orbit-ui-scale))]">
            <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(section, field, event.target.checked)} />
            <span className="text-[var(--orbit-text-secondary)]">{labels[field]}</span>
        </label>;
    }

    const input = selectOptions[field]
        ? <select className={controlClass} value={value ?? ""} onChange={(event) => onChange(section, field, event.target.value)}>{selectOptions[field].map((option) => <option key={option}>{option}</option>)}</select>
        : <input className={controlClass} type={colors.has(field) ? "color" : "number"} step="any" value={value ?? ""} onChange={(event) => onChange(section, field, event.target.value)} />;

    return <div className={fieldClass}>
        <label className="text-[var(--orbit-text-secondary)]">{labels[field]}</label>
        {input}
    </div>;
}
