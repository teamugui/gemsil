import { initActualComponent } from "./actual-component.js";
import { initDashboardComponent } from "./dashboard-component.js";
import { initFormComponent } from "./form-component.js";
import { initGoalComponent } from "./goal-component.js";

function initMobileNav() {
  const tabInput = document.getElementById("tab-input");
  const tabDashboard = document.getElementById("tab-dashboard");

  if (!tabInput || !tabDashboard) return;

  function showInput() {
    tabInput.classList.remove("hidden");
    tabInput.classList.add("block");
    tabDashboard.classList.remove("block");
    tabDashboard.classList.add("hidden", "lg:block");
    window.scrollTo({ top: 0 });
  }

  function showDashboard() {
    tabDashboard.classList.remove("hidden");
    tabDashboard.classList.add("block");
    tabInput.classList.remove("block");
    tabInput.classList.add("hidden", "lg:block");
    window.scrollTo({ top: 0 });
  }

  document.getElementById("nav-to-dashboard")?.addEventListener("click", showDashboard);
  document.getElementById("nav-to-input")?.addEventListener("click", showInput);
}

initMobileNav();
initDashboardComponent();
initFormComponent();
initGoalComponent();
initActualComponent();
