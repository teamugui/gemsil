import { initDashboardComponent } from "./dashboard-component.js";
import { initFormComponent } from "./form-component.js";

function initMobileTabs() {
  const tabInput = document.getElementById("tab-input");
  const tabDashboard = document.getElementById("tab-dashboard");
  const navInput = document.getElementById("nav-input");
  const navDashboard = document.getElementById("nav-dashboard");

  if (!tabInput || !tabDashboard) return;

  function switchTab(tab) {
    if (tab === "input") {
      tabInput.classList.remove("hidden");
      tabInput.classList.add("block");
      tabDashboard.classList.remove("block");
      tabDashboard.classList.add("hidden", "lg:block");

      if (navInput && navDashboard) {
        navInput.classList.add("text-teal-600");
        navInput.classList.remove("text-gray-400");
        navDashboard.classList.add("text-gray-400");
        navDashboard.classList.remove("text-teal-600");
      }
      return;
    }

    tabDashboard.classList.remove("hidden");
    tabDashboard.classList.add("block");
    tabInput.classList.remove("block");
    tabInput.classList.add("hidden", "lg:block");

    if (navInput && navDashboard) {
      navDashboard.classList.add("text-teal-600");
      navDashboard.classList.remove("text-gray-400");
      navInput.classList.add("text-gray-400");
      navInput.classList.remove("text-teal-600");
    }
  }

  if (navInput) {
    navInput.addEventListener("click", () => switchTab("input"));
  }
  if (navDashboard) {
    navDashboard.addEventListener("click", () => switchTab("dashboard"));
  }
}

initMobileTabs();
initDashboardComponent();
initFormComponent();
