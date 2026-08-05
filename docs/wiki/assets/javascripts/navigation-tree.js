document.addEventListener("DOMContentLoaded", () => {
  const activeLink = document.querySelector(".md-sidebar--primary .md-nav__link--active");
  let item = activeLink?.closest(".md-nav__item");

  while (item) {
    const toggle = item.querySelector(":scope > .md-nav__toggle");
    if (toggle instanceof HTMLInputElement) {
      toggle.checked = true;
    }
    item = item.parentElement?.closest(".md-nav__item") ?? null;
  }
});
