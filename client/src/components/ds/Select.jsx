import FilterSelect from './FilterSelect.jsx';

/**
 * A dropdown for forms and tables, in place of the browser's own <select>. Options are { value, label, group?, dot?, person? } with
 * string values; onChange gets the chosen value as a string, like the native element did. `variant` is 'field' (like the other inputs
 * in a form, the default) or 'inline' (compact, for a table cell or a line of text).
 */
export default function Select({ label, value, onChange, options, variant = 'field', ...rest }) {
  return <FilterSelect label={label} value={value} onChange={onChange} options={options} variant={variant} {...rest} />;
}
