/**
 * Shared, compact action-menu language for workspace, layer and scene
 * context menus.  The domain owner still supplies the actions; this module
 * only makes their hierarchy and accessibility consistent.
 */
export function ActionMenuSurface({
    id,
    title,
    icon,
    children,
    placement = "context",
    left,
    top,
    ariaLabel,
    className = "",
    ...props
}) {
    const isContext = placement === "context";
    const style = isContext
        ? { left: `${left ?? 8}px`, top: `${top ?? 8}px` }
        : undefined;

    return <div
        id={id}
        data-context-menu="true"
        className={`orbit-action-menu orbit-action-menu--${placement}${className ? ` ${className}` : ""}`}
        style={style}
        role="menu"
        aria-label={ariaLabel || title}
        onPointerDown={(event) => event.stopPropagation()}
        {...props}
    >
        <div className="orbit-action-menu__header" data-context-menu-header="true">
            {icon && <span className="orbit-action-menu__icon" data-context-menu-icon="true" aria-hidden="true">{icon}</span>}
            <span className="orbit-action-menu__title" data-context-menu-title="true" title={title}>{title}</span>
        </div>
        <div className="orbit-action-menu__items">{children}</div>
    </div>;
}

export function ActionMenuSeparator() {
    return <div className="orbit-action-menu__separator" role="separator" />;
}

export function ActionMenuItem({
    title,
    description,
    danger = false,
    trailing = true,
    className = "",
    children,
    ...props
}) {
    return <button
        data-context-menu-action="true"
        className={`orbit-action-menu__item${danger ? " is-danger" : ""}${className ? ` ${className}` : ""}`}
        type="button"
        role="menuitem"
        {...props}
    >
        <span className="orbit-action-menu__copy">
            <span className="orbit-action-menu__item-title" data-context-menu-action-title="true">{title}</span>
            {description && <span className="orbit-action-menu__item-description" data-context-menu-action-description="true">{description}</span>}
            {children}
        </span>
        {trailing === true && <span className="orbit-action-menu__chevron" aria-hidden="true">›</span>}
        {trailing !== true && trailing}
    </button>;
}
