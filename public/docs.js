document.querySelectorAll("[data-copy-target]").forEach((button) => {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.textContent);
      const original = button.textContent;
      button.textContent = "已复制";
      button.classList.add("copied");
      setTimeout(() => { button.textContent = original; button.classList.remove("copied"); }, 1600);
    } catch {
      button.textContent = "复制失败";
    }
  });
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add("active");
  });
});

document.querySelectorAll(".docs-sidebar a").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".docs-sidebar a").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});
