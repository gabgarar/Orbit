document.addEventListener("DOMContentLoaded", () => {
  const activeLink = document.querySelector(".md-sidebar--primary .md-nav__link--active");
  let item = activeLink?.closest(".md-nav__item");
  let section = null;

  while (item) {
    const toggle = item.querySelector(":scope > .md-nav__toggle");
    if (toggle instanceof HTMLInputElement) {
      toggle.checked = true;
      section = item;
    }
    item = item.parentElement?.closest(".md-nav__item") ?? null;
  }

  // Reveal a useful overview of the area without flooding the sidebar with
  // every leaf: the active section and its first nested level (two levels in
  // total). The active page path above remains open even when it is
  // deeper. These are ordinary Material checkboxes, so readers can still
  // collapse any branch with its chevron afterwards.
  const sectionNav = section?.querySelector(":scope > .md-nav");
  const sectionLevel = Number(sectionNav?.dataset.mdLevel ?? 1);
  const maximumOverviewLevel = sectionLevel + 1;

  section?.querySelectorAll(":scope .md-nav__item--nested > .md-nav__toggle")
    .forEach((toggle) => {
      const nestedNav = toggle.parentElement?.querySelector(":scope > .md-nav");
      const nestedLevel = Number(nestedNav?.dataset.mdLevel);

      if (toggle instanceof HTMLInputElement && nestedLevel <= maximumOverviewLevel) {
        toggle.checked = true;
      }
    });
});
