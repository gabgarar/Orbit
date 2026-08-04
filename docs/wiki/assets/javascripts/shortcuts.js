document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") {
    return;
  }

  event.preventDefault();
  const search = document.querySelector(".md-search__input");
  if (search instanceof HTMLInputElement) {
    search.focus();
    search.select();
  }
});
