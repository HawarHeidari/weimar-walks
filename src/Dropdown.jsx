// A dropdown we can style, unlike the browser's own <select>: every option can carry a colour bar and a small icon.
// Keyboard: Enter, Space or arrow down opens it; arrows move; Enter picks; Escape closes.
import { useEffect, useId, useRef, useState } from 'react'

// options: [{ value, label, group?, color?, icon?, note?, action? }]. An option with `action` runs it instead of
// becoming the value (for "Choose on map").
export default function Dropdown({ label, value, options, onChange, placeholder = 'Choose…' }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef()
  const list = useRef()
  const id = useId()
  const current = options.find((o) => o.value === value && !o.action)

  useEffect(() => {
    if (!open) return
    const away = (e) => !root.current?.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  // Keep the highlighted option in view.
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const show = () => {
    const i = options.findIndex((o) => o.value === value && !o.action)
    setActive(i >= 0 ? i : 0)
    setOpen(true)
  }
  const choose = (o) => {
    setOpen(false)
    if (o.action) o.action()
    else onChange(o.value)
  }
  const onKey = (e) => {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown'].includes(e.key)) {
        e.preventDefault()
        show()
      }
      return
    }
    if (e.key === 'Escape') setOpen(false)
    else if (e.key === 'ArrowDown') setActive((a) => Math.min(options.length - 1, a + 1))
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1))
    else if (e.key === 'Enter' || e.key === ' ') choose(options[active])
    else return
    e.preventDefault()
  }

  let lastGroup = null
  return (
    <div className="field dropdown" ref={root}>
      <span id={`${id}-label`}>{label}</span>
      <button
        type="button"
        className={`dd-button${current ? '' : ' empty'}`}
        style={current?.color ? { '--bar': current.color } : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        {current?.icon}
        <span id={`${id}-value`} className="dd-value">{current ? current.label : placeholder}</span>
        <span className="dd-caret" aria-hidden="true" />
      </button>
      {open && (
        <ul className="dd-list" role="listbox" aria-labelledby={`${id}-label`} ref={list}>
          {options.map((o, i) => {
            const heading = o.group && o.group !== lastGroup ? o.group : null
            lastGroup = o.group ?? lastGroup
            return [
              heading && (
                <li key={`g-${heading}`} role="presentation" className="dd-group">
                  {heading}
                </li>
              ),
              <li
                key={o.value}
                id={`${id}-${i}`}
                data-index={i}
                role="option"
                aria-selected={o.value === value && !o.action}
                className={`dd-option${i === active ? ' active' : ''}${o.action ? ' action' : ''}`}
                style={o.color ? { '--bar': o.color } : undefined}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
              >
                {o.icon}
                <span>
                  {o.label}
                  {o.note && <span className="note">{o.note}</span>}
                </span>
              </li>,
            ]
          })}
        </ul>
      )}
    </div>
  )
}
