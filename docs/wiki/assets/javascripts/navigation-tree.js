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

  // Opening a documentation area should reveal its entire tree, rather than
  // making the reader expand every intermediate level. These are ordinary
  // Material checkboxes: after the initial expansion the reader can collapse
  // any branch with its chevron and the script will not override that action.
  section?.querySelectorAll(":scope .md-nav__item--nested > .md-nav__toggle")
    .forEach((toggle) => {
      if (toggle instanceof HTMLInputElement) {
        toggle.checked = true;
      }
    });
});
