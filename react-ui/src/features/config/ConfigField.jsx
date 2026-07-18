import { checkboxes, colors, labels, selectOptions } from "./configSchema.js";

export default function ConfigField({ section, field, value, onChange }) {
    if (checkboxes.has(field)) return <label className="config-field checkbox"><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(section, field, event.target.checked)} />{labels[field]}</label>;
    const input = selectOptions[field] ? <select value={value ?? ""} onChange={(event) => onChange(section, field, event.target.value)}>{selectOptions[field].map((option) => <option key={option}>{option}</option>)}</select> : <input type={colors.has(field) ? "color" : "number"} step="any" value={value ?? ""} onChange={(event) => onChange(section, field, event.target.value)} />;
    return <div className="config-field"><label>{labels[field]}</label>{input}</div>;
}
