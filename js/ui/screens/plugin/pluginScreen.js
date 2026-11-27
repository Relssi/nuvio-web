import { ScreenUtils } from "../../navigation/screen.js";
import { focusWithoutScroll } from "../../navigation/focusWithoutScroll.js";
import { scrollFocusedIntoContainer } from "../../navigation/scrollFocusedIntoContainer.js";
import { Router } from "../../navigation/routerState.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { LibrarySyncService } from "../../../core/profile/librarySyncService.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { Platform } from "../../../platform/index.js";
import { QrCodeGenerator } from "../../../core/qr/qrCodeGenerator.js";
import { ExperienceModeStore } from "../../../data/local/experienceModeStore.js";
import { I18n } from "../../../i18n/index.js";

function t(key, fallback) {
  return I18n.t(key, {}, { fallback });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const PHONE_MANAGER_URL = "https://nuvio.tv/account?tab=addons";
const ADDONS_ROUTE_ENTER_DURATION_MS = 350;

async function getPhoneManagerUrl() {
  return PHONE_MANAGER_URL;
}

function normalizeAddonInputUrl(rawUrl) {
  let value = String(rawUrl || "").trim();
  if (!value) {
    return "";
  }
  if (/^stremio:\/\//i.test(value)) {
    value = value.replace(/^stremio:\/\//i, "https://");
  } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return addonRepository.canonicalizeUrl(parsed.href);
  } catch (_) {
    return "";
  }
}

export const PluginScreen = {
  async mount() {
    this.container = document.getElementById("plugin");
    ScreenUtils.show(this.container);
    this.pluginRouteEnterPending = true;
    this.contentRow = Number.isFinite(this.contentRow) ? this.contentRow : 0;
    this.contentCol = Number.isFinite(this.contentCol) ? this.contentCol : 0;
    this.qrOverlayOpen = false;
    this.syncing = false;
    this.installing = false;
    this.busyAddonUrl = "";
    this.installUrlDraft = this.installUrlDraft || "";
    this.installError = "";
    this.installSuccess = "";
    this.model = await this.collectModel();
    await this.render({ refreshModel: false });
    if (AuthManager.isAuthenticated) {
      this.scheduleInitialRefresh();
    }
  },

  scheduleInitialRefresh() {
    if (this.initialRefreshTimer) {
      clearTimeout(this.initialRefreshTimer);
    }
    this.initialRefreshTimer = setTimeout(() => {
      this.initialRefreshTimer = null;
      if (Router.getCurrent() === "plugin") {
        void this.refreshAddons();
      }
    }, ADDONS_ROUTE_ENTER_DURATION_MS + 80);
  },

  async collectModel() {
    const addonUrls = addonRepository.getInstalledAddonUrls();
    const enabledStates = addonRepository.getAddonEnabledStates();
    const fetchedAddons = await addonRepository
      .getInstalledAddons({ includeDisabled: true, cacheOnly: true })
      .catch(() => []);
    const byUrl = new Map(
      (Array.isArray(fetchedAddons) ? fetchedAddons : []).map((addon) => [
        addonRepository.normalizeUrl(addon?.baseUrl || addon?.url || ""),
        addon
      ])
    );
    const installedAddons = addonUrls.map((url) => {
      const cleanUrl = addonRepository.canonicalizeUrl(url);
      const cached = byUrl.get(addonRepository.normalizeUrl(cleanUrl)) || null;
      const overrideName = addonRepository.getAddonDisplayNameOverride(cleanUrl);
      const enabled = addonRepository.isAddonEnabled(cleanUrl, enabledStates);
      return {
        url: cleanUrl,
        id: cached?.id || "",
        name: overrideName || cached?.displayName || cached?.name || cleanUrl,
        version: cached?.version || "",
        description: cached?.description || "",
        catalogCount: Array.isArray(cached?.catalogs) ? cached.catalogs.length : 0,
        resourceCount: Array.isArray(cached?.resources) ? cached.resources.length : 0,
        loaded: Boolean(cached),
        enabled
      };
    });
    return {
      addonCount: addonUrls.length,
      installedAddons,
      canEdit: addonRepository.canEdit(),
      authenticated: AuthManager.isAuthenticated,
      syncStatus: LibrarySyncService.getLastPullStatus(),
      phoneManagerUrl: await getPhoneManagerUrl(),
      isEssential: ExperienceModeStore.isEssential()
    };
  },

  buildSyncStatusText() {
    if (this.syncing) {
      return "Syncing addons...";
    }
    if (this.installSuccess) {
      return this.installSuccess;
    }
    if (!this.model?.authenticated) {
      return "Manage addons locally below, or sign in to sync across devices.";
    }
    const status = this.model?.syncStatus || {};
    if (status.state === "error") {
      return "Couldn't reach the sync service. Local addons still work normally.";
    }
    if (this.model?.addonCount > 0) {
      return "Addons are up to date.";
    }
    return "No addons linked yet. Install one below or add via phone.";
  },

  async installAddonFromInput() {
    if (this.installing) {
      return;
    }
    if (!this.model?.canEdit) {
      this.installError = t(
        "addon_profile_readonly",
        "This profile shares addons from the primary profile and cannot edit them."
      );
      this.installSuccess = "";
      await this.render({ refreshModel: false });
      return;
    }
    const input = this.container?.querySelector(".addons-install-input");
    const rawValue = input ? input.value : this.installUrlDraft;
    this.installUrlDraft = String(rawValue || "");
    const normalizedUrl = normalizeAddonInputUrl(this.installUrlDraft);
    if (!normalizedUrl) {
      this.installError = t(
        "addon_invalid_url",
        "Enter a valid addon URL (e.g. https://example.com/manifest.json)."
      );
      this.installSuccess = "";
      await this.render({ refreshModel: false });
      return;
    }

    const existing = addonRepository.getInstalledAddonUrls();
    const normalizedKey = addonRepository.normalizeUrl(normalizedUrl);
    if (existing.some((entry) => addonRepository.normalizeUrl(entry) === normalizedKey)) {
      this.installError = t("addon_already_installed", "This addon is already installed.");
      this.installSuccess = "";
      await this.render({ refreshModel: false });
      return;
    }

    this.installing = true;
    this.installError = "";
    this.installSuccess = "";
    await this.render({ refreshModel: false });

    try {
      const fetchResult = await addonRepository.fetchAddon(normalizedUrl, { force: true });
      if (fetchResult?.status !== "success" || !fetchResult?.data) {
        this.installError =
          fetchResult?.message ||
          t("addon_fetch_failed", "Could not load manifest.json from that URL (check URL/CORS).");
        return;
      }
      const targetUrl = fetchResult.data.baseUrl || normalizedUrl;
      const added = await addonRepository.addAddon(targetUrl);
      if (!added) {
        this.installError = t("addon_already_installed", "This addon is already installed.");
        return;
      }
      catalogRepository.clearCache();
      this.installUrlDraft = "";
      this.installError = "";
      this.installSuccess = `Installed: ${fetchResult.data.displayName || fetchResult.data.name || targetUrl}`;
    } catch (error) {
      this.installError = String(error?.message || error || "Failed to install addon.");
    } finally {
      this.installing = false;
      if (Router.getCurrent() === "plugin") {
        await this.render({ refreshModel: true });
      }
    }
  },

  async toggleInstalledAddon(addon) {
    if (!addon?.url || !this.model?.canEdit || this.busyAddonUrl) {
      return;
    }
    this.busyAddonUrl = addon.url;
    this.installError = "";
    this.installSuccess = "";
    try {
      const nextEnabled = !addon.enabled;
      addonRepository.setAddonEnabledStates([{ url: addon.url, enabled: nextEnabled }], {
        replace: false
      });
      catalogRepository.clearCache();
      this.installSuccess = `${addon.name} ${nextEnabled ? "enabled" : "disabled"}.`;
    } finally {
      this.busyAddonUrl = "";
      if (Router.getCurrent() === "plugin") {
        await this.render({ refreshModel: true });
      }
    }
  },

  async refreshInstalledAddon(addon) {
    if (!addon?.url || this.busyAddonUrl) {
      return;
    }
    this.busyAddonUrl = addon.url;
    this.installError = "";
    this.installSuccess = "";
    await this.render({ refreshModel: false });
    try {
      const result = await addonRepository.refreshAddon(addon.url);
      if (result?.status === "success") {
        catalogRepository.clearCache();
        this.installSuccess = `Refreshed: ${result.data?.displayName || result.data?.name || addon.name}`;
      } else {
        this.installError = result?.message || `Failed to refresh ${addon.name}.`;
      }
    } finally {
      this.busyAddonUrl = "";
      if (Router.getCurrent() === "plugin") {
        await this.render({ refreshModel: true });
      }
    }
  },

  async removeInstalledAddon(addon) {
    if (!addon?.url || !this.model?.canEdit || this.busyAddonUrl) {
      return;
    }
    this.busyAddonUrl = addon.url;
    this.installError = "";
    this.installSuccess = "";
    try {
      await addonRepository.removeAddon(addon.url);
      catalogRepository.clearCache();
      this.installSuccess = `Removed: ${addon.name}`;
    } finally {
      this.busyAddonUrl = "";
      if (Router.getCurrent() === "plugin") {
        await this.render({ refreshModel: true });
      }
    }
  },

  async refreshAddons({ refreshCatalogs = false } = {}) {
    if (this.syncing) {
      return;
    }
    this.syncing = true;
    await this.render({ refreshModel: true });
    try {
      await LibrarySyncService.pull();
    } catch (error) {
      console.warn("Addon refresh failed", error);
    } finally {
      // Android emits its manual refresh event even when addon reconciliation fails.
      // Smart has a response cache where Android re-requests the visible catalogs,
      // so refresh enabled manifests and invalidate responses for the explicit action.
      if (refreshCatalogs) {
        try {
          await addonRepository.refreshInstalledAddons();
        } catch (error) {
          console.warn("Addon manifest refresh failed", error);
        }
        catalogRepository.clearCache();
      }
    }
    this.syncing = false;
    if (Router.getCurrent() === "plugin") {
      await this.render({ refreshModel: true });
    }
  },

  setRowColumns(row, cols) {
    this.rowColumns.set(row, cols);
  },

  getAvailableRows() {
    return [...this.rowColumns.keys()].sort((left, right) => left - right);
  },

  getAvailableCols(row) {
    return this.rowColumns.get(row) || [0];
  },

  normalizeFocus() {
    const rows = this.getAvailableRows();
    this.contentRow = rows.includes(this.contentRow) ? this.contentRow : rows[0] || 0;
    const cols = this.getAvailableCols(this.contentRow);
    this.contentCol = cols.includes(this.contentCol) ? this.contentCol : cols[0];
  },

  ensureMainVisibility(target) {
    const container = this.container?.querySelector(".addons-main");
    if (!container || !target) {
      return;
    }
    const anchor =
      target.closest(".addons-installed-card, .addons-large-row, .addons-install-card") || target;
    const rows = this.getAvailableRows();
    const firstRow = rows.length ? rows[0] : 0;
    const isTopRow = Number(target.dataset?.row ?? -1) === firstRow;
    scrollFocusedIntoContainer(container, target, { anchor, pad: 56, isTopRow });
  },

  renderQrCode() {
    if (!this.qrOverlayOpen || !this.model.phoneManagerUrl) {
      return;
    }
    const canvas = this.container?.querySelector(".addons-qr-canvas");
    if (!canvas) {
      return;
    }
    QrCodeGenerator.generate(canvas, this.model.phoneManagerUrl, 440);
  },

  async openQrOverlay() {
    this.qrOverlayOpen = true;
    await this.render({ refreshModel: false });
  },

  async closeQrOverlay() {
    if (!this.qrOverlayOpen) {
      return false;
    }
    this.qrOverlayOpen = false;
    await this.render({ refreshModel: false });
    return true;
  },

  bindContentEvents() {
    const installInput = this.container.querySelector(".addons-install-input");
    const installSurface = this.container.querySelector(".addons-install-surface");
    if (installInput) {
      installInput.addEventListener("input", () => {
        this.installUrlDraft = String(installInput.value || "");
      });
      installInput.addEventListener("focus", () => {
        this.contentRow = 0;
        this.contentCol = 0;
        installSurface?.classList.add("is-editing", "focused");
      });
      installInput.addEventListener("blur", () => {
        installSurface?.classList.remove("is-editing");
      });
    }

    this.container.querySelectorAll(".addons-focusable[data-action-id]").forEach((node) => {
      node.addEventListener("keydown", (event) => {
        if (node.matches("input, textarea")) {
          return;
        }
        const code = Number(event?.keyCode || 0);
        if (code === 32) {
          event.preventDefault();
        }
      });

      node.addEventListener("click", async () => {
        this.contentRow = Number(node.dataset.row || 0);
        this.contentCol = Number(node.dataset.col || 0);
        if (node.matches("input, textarea")) {
          this.container
            .querySelectorAll(".addons-focusable.focused, .focusable.focused")
            .forEach((item) => item.classList.remove("focused"));
          node.classList.add("focused");
          installSurface?.classList.add("is-editing", "focused");
          return;
        }
        this.applyFocus();
        await this.activateFocused();
      });
    });
  },

  async render({ refreshModel = true } = {}) {
    if (refreshModel || !this.model) {
      this.model = await this.collectModel();
    }
    this.rowColumns = new Map();
    this.actionMap = new Map();

    const installedAddons = Array.isArray(this.model.installedAddons)
      ? this.model.installedAddons
      : [];
    const canEdit = Boolean(this.model.canEdit);

    this.setRowColumns(0, [0, 1]);
    this.actionMap.set("focus_install_input", async () => {
      const input = this.container?.querySelector(".addons-install-input");
      input?.focus();
    });
    this.actionMap.set("install_addon", async () => {
      await this.installAddonFromInput();
    });

    let nextRow = 1;
    const installedCardsHtml = installedAddons
      .map((addon, index) => {
        const row = nextRow++;
        const cols = canEdit ? [0, 1, 2] : [0];
        this.setRowColumns(row, cols);
        const isBusy = this.busyAddonUrl === addon.url;

        if (canEdit) {
          this.actionMap.set(`toggle_addon_${index}`, async () => {
            await this.toggleInstalledAddon(addon);
          });
          this.actionMap.set(`refresh_addon_${index}`, async () => {
            await this.refreshInstalledAddon(addon);
          });
          this.actionMap.set(`remove_addon_${index}`, async () => {
            await this.removeInstalledAddon(addon);
          });
        } else {
          this.actionMap.set(`refresh_addon_${index}`, async () => {
            await this.refreshInstalledAddon(addon);
          });
        }

        const metaParts = [
          addon.version ? `v${addon.version}` : "",
          addon.catalogCount
            ? `${addon.catalogCount} catalog${addon.catalogCount === 1 ? "" : "s"}`
            : "",
          addon.enabled
            ? t("addon_status_enabled", "Enabled")
            : t("addon_status_disabled", "Disabled")
        ].filter(Boolean);

        return `
          <article class="addons-installed-card">
            <div class="addons-installed-head">
              <div class="addons-installed-copy">
                <h3>${escapeHtml(addon.name)}</h3>
                <p class="addons-installed-version">${escapeHtml(metaParts.join(" · "))}</p>
              </div>
              <div class="addons-installed-actions">
                ${
                  canEdit
                    ? `<button type="button"
                          class="addons-action-btn addons-focusable"
                          data-zone="content"
                          data-row="${row}"
                          data-col="0"
                          data-action-id="toggle_addon_${index}"
                          title="${escapeHtml(addon.enabled ? "Disable addon" : "Enable addon")}"
                          aria-label="${escapeHtml(addon.enabled ? "Disable addon" : "Enable addon")}"
                          ${isBusy ? "disabled" : ""}
                          tabindex="-1">
                        <span class="material-icons" aria-hidden="true">${addon.enabled ? "toggle_on" : "toggle_off"}</span>
                      </button>`
                    : ""
                }
                <button type="button"
                        class="addons-action-btn addons-focusable"
                        data-zone="content"
                        data-row="${row}"
                        data-col="${canEdit ? 1 : 0}"
                        data-action-id="refresh_addon_${index}"
                        title="${escapeHtml("Refresh manifest")}"
                        aria-label="${escapeHtml("Refresh manifest")}"
                        ${isBusy ? "disabled" : ""}
                        tabindex="-1">
                  <span class="material-icons" aria-hidden="true">${isBusy ? "hourglass_top" : "refresh"}</span>
                </button>
                ${
                  canEdit
                    ? `<button type="button"
                          class="addons-action-btn addons-remove-btn addons-focusable"
                          data-zone="content"
                          data-row="${row}"
                          data-col="2"
                          data-action-id="remove_addon_${index}"
                          ${isBusy ? "disabled" : ""}
                          tabindex="-1">
                        ${escapeHtml(t("addon_remove_btn", "Remove"))}
                      </button>`
                    : ""
                }
              </div>
            </div>
            ${addon.description ? `<p class="addons-installed-description">${escapeHtml(addon.description)}</p>` : ""}
            <p class="addons-installed-meta">${escapeHtml(addon.url)}</p>
          </article>
        `;
      })
      .join("");

    const phoneRow = nextRow++;
    this.setRowColumns(phoneRow, [0]);
    let reorderRow = -1;
    let orderRow = -1;
    let collectionsRow = -1;
    if (!this.model.isEssential) {
      reorderRow = nextRow++;
      orderRow = nextRow++;
      collectionsRow = nextRow++;
      this.setRowColumns(reorderRow, [0]);
      this.setRowColumns(orderRow, [0]);
      this.setRowColumns(collectionsRow, [0]);
    }
    const refreshRow = nextRow++;
    this.setRowColumns(refreshRow, [0]);

    this.actionMap.set("manage_from_phone", async () => {
      await this.openQrOverlay();
    });
    this.actionMap.set("reorder_home_catalogs", async () => {
      Router.navigate("catalogOrder");
    });
    this.actionMap.set("open_addon_order", async () => {
      Router.navigate("addonOrder");
    });
    this.actionMap.set("open_collections", async () => {
      Router.navigate("collections");
    });
    this.actionMap.set("refresh_addons", async () => {
      await this.refreshAddons({ refreshCatalogs: true });
    });
    this.actionMap.set("close_qr_overlay", async () => {
      await this.closeQrOverlay();
    });

    const enterClass = this.pluginRouteEnterPending ? " nuvio-route-fade-enter" : "";
    this.container.innerHTML = `
      <div class="addons-shell addons-route-shell">
        <div class="addons-route-content${enterClass}">
          <main class="home-main addons-main addons-main-centered">
            <div class="addons-panel addons-panel-centered">
              <section class="addons-hero-card">
                <h1 class="addons-title addons-title-centered">${escapeHtml(t("addon_title", "Addons"))}</h1>
                <p class="addons-lede">
                  ${escapeHtml(
                    t(
                      "addon_web_subtitle",
                      "Install your own Stremio-compatible addons by manifest URL or sync from your account"
                    )
                  )}
                </p>
                <p class="addons-meta">${escapeHtml(`${this.model.addonCount} addon${this.model.addonCount === 1 ? "" : "s"} installed`)}</p>
                <p class="addons-sync-status">${escapeHtml(this.buildSyncStatusText())}</p>

                <section class="addons-install-card">
                  <h2 class="addons-install-heading">${escapeHtml(t("addon_install_heading", "Add custom addon"))}</h2>
                  <div class="addons-install-row">
                    <div class="addons-install-surface">
                      <input type="url"
                             class="addons-install-input addons-focusable"
                             data-zone="content"
                             data-row="0"
                             data-col="0"
                             data-action-id="focus_install_input"
                             value="${escapeHtml(this.installUrlDraft || "")}"
                             placeholder="https://example.com/manifest.json"
                             autocomplete="off"
                             spellcheck="false"
                             ${this.installing || !canEdit ? "disabled" : ""} />
                    </div>
                    <button type="button"
                            class="addons-install-btn addons-focusable${this.installing || !canEdit ? " is-disabled" : ""}"
                            data-zone="content"
                            data-row="0"
                            data-col="1"
                            data-action-id="install_addon"
                            ${this.installing || !canEdit ? "disabled" : ""}
                            tabindex="-1">
                      ${escapeHtml(this.installing ? t("addon_installing_btn", "Installing…") : t("addon_install_btn", "Install"))}
                    </button>
                  </div>
                  ${
                    this.installError
                      ? `<p class="addons-install-error" role="alert">${escapeHtml(this.installError)}</p>`
                      : this.installSuccess
                        ? `<p class="addons-install-success" role="status">${escapeHtml(this.installSuccess)}</p>`
                        : ""
                  }
                </section>

                <section class="addons-installed-section">
                  <h2 class="addons-subtitle">${escapeHtml(t("addon_installed_heading", "Installed addons"))}</h2>
                  ${
                    installedAddons.length
                      ? `<div class="addons-installed-list">${installedCardsHtml}</div>`
                      : `<p class="addons-empty">${escapeHtml(t("addon_none_installed", "No addons installed yet."))}</p>`
                  }
                </section>

                <div role="button"
                     class="addons-large-row addons-large-row-centered addons-focusable"
                     data-zone="content"
                     data-row="${phoneRow}"
                     data-col="0"
                     data-action-id="manage_from_phone"
                     tabindex="-1">
                  <span class="addons-large-row-icon material-icons" aria-hidden="true">qr_code_2</span>
                  <span class="addons-large-row-copy">
                    <strong>${escapeHtml(t("addon_manage_from_phone_title", "Manage from phone"))}</strong>
                    <small>${escapeHtml(
                      this.model.isEssential
                        ? t(
                            "addon_manage_addons_only_from_phone_subtitle",
                            "Scan a QR code to install or remove add-ons from your phone"
                          )
                        : t(
                            "addon_manage_from_phone_subtitle",
                            "Scan a QR code to manage addons, catalogs, and collections from your phone"
                          )
                    )}</small>
                  </span>
                  <span class="addons-large-row-tail-group">
                    <span class="addons-large-row-tail material-icons" aria-hidden="true">phone_android</span>
                  </span>
                </div>
                ${
                  this.model.isEssential
                    ? ""
                    : `<div role="button"
                     class="addons-large-row addons-large-row-centered addons-focusable"
                     data-zone="content"
                     data-row="${reorderRow}"
                     data-col="0"
                     data-action-id="reorder_home_catalogs"
                     tabindex="-1">
                  <span class="addons-large-row-icon material-icons" aria-hidden="true">tune</span>
                  <span class="addons-large-row-copy">
                    <strong>${escapeHtml(t("addon_reorder_title", "Reorder home catalogs"))}</strong>
                    <small>${escapeHtml(t("addon_reorder_subtitle", "Controls catalog and collection row order on Home"))}</small>
                  </span>
                  <span class="addons-large-row-tail-group">
                    <span class="addons-large-row-tail material-icons" aria-hidden="true">chevron_right</span>
                  </span>
                </div>
                <div role="button"
                     class="addons-large-row addons-large-row-centered addons-focusable"
                     data-zone="content"
                     data-row="${orderRow}"
                     data-col="0"
                     data-action-id="open_addon_order"
                     tabindex="-1">
                  <span class="addons-large-row-icon material-icons" aria-hidden="true">swap_vert</span>
                  <span class="addons-large-row-copy">
                    <strong>${escapeHtml(t("addon_order_title", "Add-on order"))}</strong>
                    <small>${escapeHtml(t("addon_order_subtitle", "Controls which add-on is asked for sources first."))}</small>
                  </span>
                  <span class="addons-large-row-tail-group">
                    <span class="addons-large-row-tail material-icons" aria-hidden="true">chevron_right</span>
                  </span>
                </div>
                <div role="button"
                     class="addons-large-row addons-large-row-centered addons-focusable"
                     data-zone="content"
                     data-row="${collectionsRow}"
                     data-col="0"
                     data-action-id="open_collections"
                     tabindex="-1">
                  <span class="addons-large-row-icon material-icons" aria-hidden="true">folder_open</span>
                  <span class="addons-large-row-copy">
                    <strong>${escapeHtml(t("collections_card_title", "Collections"))}</strong>
                    <small>${escapeHtml(
                      t(
                        "collections_card_subtitle",
                        "Create custom collections and arrange your folders"
                      )
                    )}</small>
                  </span>
                  <span class="addons-large-row-tail-group">
                    <span class="addons-large-row-tail material-icons" aria-hidden="true">chevron_right</span>
                  </span>
                </div>`
                }
                <div role="button"
                     class="addons-large-row addons-large-row-centered addons-focusable"
                     data-zone="content"
                     data-row="${refreshRow}"
                     data-col="0"
                     data-action-id="refresh_addons"
                     tabindex="-1"
                     aria-disabled="${this.syncing ? "true" : "false"}">
                  <span class="addons-large-row-icon material-icons" aria-hidden="true">${this.syncing ? "hourglass_top" : "sync"}</span>
                  <span class="addons-large-row-copy">
                    <strong>${escapeHtml(this.syncing ? t("addon_refresh_action", "Refreshing…") : t("addon_refresh_action", "Refresh Addons"))}</strong>
                    <small>${escapeHtml(t("addon_refresh_default_subtitle", "Pull latest addon changes for current profile"))}</small>
                  </span>
                  <span class="addons-large-row-tail-group">
                    <span class="addons-large-row-tail material-icons" aria-hidden="true">refresh</span>
                  </span>
                </div>
              </section>
            </div>
          </main>
        </div>
        ${
          this.qrOverlayOpen
            ? `
          <div class="addons-qr-overlay">
            <div class="addons-qr-dialog">
              <p class="addons-qr-instruction">${escapeHtml(
                this.model.isEssential
                  ? t(
                      "addon_qr_addons_only_scan_instruction",
                      "Scan with your phone to install or remove add-ons"
                    )
                  : t(
                      "addon_qr_scan_instruction",
                      "Scan with your phone to manage addons, catalogs, and collections"
                    )
              )}</p>
              <canvas class="addons-qr-canvas" width="440" height="440" aria-label="QR code"></canvas>
              <p class="addons-qr-url">${escapeHtml(this.model.phoneManagerUrl)}</p>
              <div role="button" class="addons-qr-close addons-focusable focused" data-action-id="close_qr_overlay" tabindex="-1">
                <span class="material-icons" aria-hidden="true">close</span>
                <span>${escapeHtml(t("addon_qr_close", "Close"))}</span>
              </div>
            </div>
          </div>
        `
            : ""
        }
      </div>
    `;
    this.pluginRouteEnterPending = false;
    this.bindContentEvents();
    this.normalizeFocus();
    this.applyFocus();
    this.renderQrCode();
  },

  applyFocus() {
    this.container
      .querySelectorAll(
        ".addons-focusable.focused, .focusable.focused, .addons-install-surface.focused"
      )
      .forEach((node) => node.classList.remove("focused"));

    if (this.qrOverlayOpen) {
      const closeButton = this.container.querySelector(".addons-qr-close");
      if (closeButton) {
        closeButton.classList.add("focused");
        closeButton.focus();
      }
      return;
    }

    const target =
      this.container.querySelector(
        `.addons-focusable[data-zone="content"][data-row="${this.contentRow}"][data-col="${this.contentCol}"]`
      ) ||
      this.container.querySelector(
        `.addons-focusable[data-zone="content"][data-row="${this.contentRow}"][data-col="0"]`
      ) ||
      this.container.querySelector(".addons-focusable[data-zone='content']");

    if (target) {
      target.classList.add("focused");
      if (target.matches("input, textarea")) {
        target.closest(".addons-install-surface")?.classList.add("focused");
      }
      focusWithoutScroll(target);
      this.ensureMainVisibility(target);
    }
  },

  moveContent(deltaRow, deltaCol = 0) {
    if (deltaCol !== 0) {
      const cols = this.getAvailableCols(this.contentRow);
      const currentIndex = Math.max(0, cols.indexOf(this.contentCol));
      this.contentCol = cols[clamp(currentIndex + deltaCol, 0, cols.length - 1)];
      this.applyFocus();
      return;
    }

    const rows = this.getAvailableRows();
    const currentIndex = Math.max(0, rows.indexOf(this.contentRow));
    this.contentRow = rows[clamp(currentIndex + deltaRow, 0, rows.length - 1)] || 0;
    const cols = this.getAvailableCols(this.contentRow);
    this.contentCol = cols.includes(this.contentCol) ? this.contentCol : cols[0];
    this.applyFocus();
  },

  async activateFocused() {
    const current = this.container.querySelector(".addons-focusable.focused, .focusable.focused");
    if (!current) {
      return;
    }

    const action = this.actionMap.get(String(current.dataset.actionId || ""));
    if (!action) {
      return;
    }
    await action();
    if (Router.getCurrent() === "plugin") {
      this.normalizeFocus();
      this.applyFocus();
    }
  },

  consumeBackRequest() {
    if (this.qrOverlayOpen) {
      this.closeQrOverlay();
      return true;
    }
    return false;
  },

  isTextInputFocused() {
    const active = document.activeElement;
    return Boolean(
      active && this.container?.contains?.(active) && active.matches?.("input, textarea")
    );
  },

  async onKeyDown(event) {
    if (this.qrOverlayOpen) {
      if (Platform.isBackEvent(event)) {
        event?.preventDefault?.();
        await this.closeQrOverlay();
        return;
      }
      const code = Number(event?.keyCode || 0);
      if (code === 13) {
        event?.preventDefault?.();
        await this.closeQrOverlay();
      }
      return;
    }

    const code = Number(event?.keyCode || 0);

    if (this.isTextInputFocused()) {
      if (code === 13) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        await this.installAddonFromInput();
        return;
      }
      if (code === 27) {
        event?.preventDefault?.();
        document.activeElement?.blur?.();
        return;
      }
      if (code === 38 || code === 40) {
        event?.preventDefault?.();
        document.activeElement?.blur?.();
        this.moveContent(code === 38 ? -1 : 1);
        return;
      }
      return;
    }

    if (Platform.isBackEvent(event)) {
      event?.preventDefault?.();
      await Router.back();
      return;
    }

    if (code === 38 || code === 40 || code === 37 || code === 39) {
      event?.preventDefault?.();
      if (code === 38) this.moveContent(-1);
      else if (code === 40) this.moveContent(1);
      else if (code === 37) {
        if (this.contentCol > 0) {
          this.moveContent(0, -1);
        }
      } else if (code === 39) {
        this.moveContent(0, 1);
      }
      return;
    }

    if (code === 13) {
      // Consume the navigation key before mounting the destination screen.
      // webOS can otherwise deliver its native activation after the new
      // screen has focused its first action button.
      event?.preventDefault?.();
      event?.stopPropagation?.();
      await this.activateFocused();
    }
  },

  cleanup() {
    if (this.initialRefreshTimer) {
      clearTimeout(this.initialRefreshTimer);
      this.initialRefreshTimer = null;
    }
    ScreenUtils.hide(this.container);
  }
};
