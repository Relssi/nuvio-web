/* eslint-disable no-unused-vars */
import * as internals from "./profileSelectionScreen.js";
import { focusWithoutScroll } from "../../ui/navigation/focusWithoutScroll.js";

export function createProfileSelectionScreenMethods04() {
  const {
    getTvRuntimePerformanceProfile,
    PROFILE_BACKGROUND_ANIMATION_MS,
    getDefaultProfileColor,
    escapeHtml,
    parseHexColor,
    mixColors,
    colorToRgba,
    colorsEqual,
    fastOutSlowIn,
    findNearestByHorizontalCenter,
    buildVisualRows
  } = internals;

  return {
    getPreferredEditorAvatarButton(navigationState, referenceNode = null) {
      const avatarButtons = navigationState?.avatarButtons || [];
      if (!avatarButtons.length) {
        return null;
      }
      return (
        avatarButtons.find((node) => node.classList.contains("is-selected")) ||
        findNearestByHorizontalCenter(referenceNode, avatarButtons) ||
        avatarButtons[0] ||
        null
      );
    },
    getAvatarGridPosition(navigationState, node) {
      const rows = buildVisualRows(navigationState?.avatarButtons || []);
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const columnIndex = rows[rowIndex].nodes.indexOf(node);
        if (columnIndex !== -1) {
          return {
            rows,
            rowIndex,
            columnIndex,
            rowNodes: rows[rowIndex].nodes
          };
        }
      }
      return null;
    },
    moveEditorFocus(event, overlayRoot) {
      const code = Number(event?.keyCode || 0);
      const direction = code === 38 ? "up" : code === 40 ? "down" : code === 37 ? "left" : code === 39 ? "right" : null;
      if (!direction) {
        return false;
      }

      const navigationState = this.getEditorNavigationState();
      if (!navigationState) {
        return false;
      }

      const current = overlayRoot.querySelector(".profile-overlay-focusable.focused") || document.activeElement;
      if (!current) {
        return false;
      }

      const preferredTabButton = this.getPreferredEditorTabButton(navigationState);
      const preferredCategoryButton = this.getPreferredEditorCategoryButton(navigationState);
      const preferredContentButton = this.getPreferredEditorContentButton(navigationState, current);
      let target = null;

      if (current === navigationState.submitButton) {
        if (direction === "left") {
          target = navigationState.nameInput;
        } else if (direction === "down" || direction === "right") {
          target = preferredTabButton || preferredCategoryButton;
        }
      } else if (current === navigationState.nameInput) {
        if (direction === "up") {
          target = navigationState.submitButton;
        } else if (direction === "down") {
          target = navigationState.copySourceButton || navigationState.cancelButton || preferredCategoryButton;
        } else if (direction === "right") {
          target = preferredTabButton || preferredCategoryButton;
        }
      } else if (current === navigationState.copySourceButton) {
        if (direction === "up" || direction === "left") {
          target = navigationState.nameInput;
        } else if (direction === "down") {
          target = navigationState.cancelButton || preferredCategoryButton;
        } else if (direction === "right") {
          target = preferredTabButton || preferredCategoryButton;
        }
      } else if (current === navigationState.cancelButton) {
        if (direction === "up") {
          target = navigationState.copySourceButton || navigationState.nameInput;
        } else if (direction === "right" || direction === "down") {
          target = preferredTabButton || preferredCategoryButton;
        } else if (direction === "left") {
          target = navigationState.nameInput;
        }
      } else if (current.matches?.("[data-action='select-editor-tab']")) {
        const index = navigationState.tabButtons.indexOf(current);
        if (direction === "left") {
          target = index > 0 ? navigationState.tabButtons[index - 1] : navigationState.cancelButton;
        } else if (direction === "right") {
          target = navigationState.tabButtons[index + 1] || null;
        } else if (direction === "up") {
          target = navigationState.submitButton;
        } else if (direction === "down") {
          target = preferredContentButton;
        }
      } else if (current.matches?.("[data-action='select-avatar-category']")) {
        const index = navigationState.categoryButtons.indexOf(current);
        if (direction === "left") {
          target = index > 0 ? navigationState.categoryButtons[index - 1] : navigationState.cancelButton;
        } else if (direction === "right") {
          target = navigationState.categoryButtons[index + 1] || null;
        } else if (direction === "up") {
          target = preferredTabButton || navigationState.submitButton;
        } else if (direction === "down") {
          target = this.getPreferredEditorAvatarButton(navigationState, current);
        }
      } else if (current.matches?.("[data-action='select-avatar']")) {
        const position = this.getAvatarGridPosition(navigationState, current);
        if (!position) {
          return false;
        }
        if (direction === "left") {
          target = position.rowNodes[position.columnIndex - 1] || navigationState.cancelButton;
        } else if (direction === "right") {
          target = position.rowNodes[position.columnIndex + 1] || null;
        } else if (direction === "up") {
          const previousRow = position.rows[position.rowIndex - 1];
          target = previousRow
            ? findNearestByHorizontalCenter(current, previousRow.nodes)
            : preferredCategoryButton ||
              this.getEditorCategoryButtonForAvatar(navigationState, current.dataset.avatarId) ||
              findNearestByHorizontalCenter(current, navigationState.categoryButtons) ||
              preferredTabButton;
        } else if (direction === "down") {
          const nextRow = position.rows[position.rowIndex + 1];
          target = nextRow ? findNearestByHorizontalCenter(current, nextRow.nodes) : null;
        }
      } else if (current.matches?.("[data-action='select-background']")) {
        const rows = buildVisualRows(navigationState.backgroundButtons || []);
        const rowIndex = rows.findIndex((row) => row.nodes.includes(current));
        if (rowIndex < 0) {
          return false;
        }
        const row = rows[rowIndex];
        const columnIndex = row.nodes.indexOf(current);
        if (direction === "left") {
          target = row.nodes[columnIndex - 1] || navigationState.cancelButton;
        } else if (direction === "right") {
          target = row.nodes[columnIndex + 1] || null;
        } else if (direction === "up") {
          const previousRow = rows[rowIndex - 1];
          target = previousRow
            ? findNearestByHorizontalCenter(current, previousRow.nodes)
            : preferredTabButton || navigationState.submitButton;
        } else if (direction === "down") {
          const nextRow = rows[rowIndex + 1];
          target = nextRow ? findNearestByHorizontalCenter(current, nextRow.nodes) : null;
        }
      }

      if (!target) {
        return false;
      }

      event?.preventDefault?.();
      target.focus();
      return true;
    },
    moveProfileFocus(event) {
      const code = Number(event?.keyCode || 0);
      const direction = code === 37 ? "left" : code === 39 ? "right" : code === 38 ? "up" : code === 40 ? "down" : null;
      if (!direction) {
        return false;
      }
      if (direction === "up" || direction === "down") {
        return false;
      }

      const cards = Array.from(this.container?.querySelectorAll(".profile-card") || []);
      if (!cards.length) {
        return false;
      }

      const current =
        this.container?.querySelector(".profile-card.focused") ||
        (document.activeElement?.matches?.(".profile-card") ? document.activeElement : null) ||
        cards[0];
      const currentIndex = cards.indexOf(current);
      if (currentIndex === -1) {
        return false;
      }

      const nextIndex = direction === "left" ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= cards.length) {
        event?.preventDefault?.();
        return true;
      }

      event?.preventDefault?.();
      focusWithoutScroll(cards[nextIndex]);
      return true;
    },
    resolveProfileThemeBackground(profile) {
      if (!profile) {
        return {
          accentHex: getDefaultProfileColor(),
          themeColors: this.getBackgroundThemeColors()
        };
      }
      const { ThemeStore, ThemeColors, normalizeCustomThemeColors } = internals;
      let theme = null;
      try {
        theme = ThemeStore?.getForProfile?.(profile.id) || null;
      } catch (_) {
        theme = null;
      }
      const themeName = String(theme?.themeName || "WHITE").toUpperCase();
      const palette = ThemeColors?.getPalette?.(themeName, theme?.customThemeColors) || null;
      const baseThemeColors = this.getBackgroundThemeColors();
      const themeColors = theme?.amoledMode
        ? {
            background: { r: 0, g: 0, b: 0 },
            elevated: { r: 10, g: 10, b: 12 }
          }
        : palette
          ? {
              background: parseHexColor(palette["--bg-color"], baseThemeColors.background),
              elevated: parseHexColor(palette["--bg-elevated"], baseThemeColors.elevated)
            }
          : baseThemeColors;

      let accentHex = profile.avatarColorHex || getDefaultProfileColor();
      if (themeName === "CUSTOM") {
        const [, customAccent] = normalizeCustomThemeColors ? normalizeCustomThemeColors(theme?.customThemeColors) : [];
        if (customAccent) {
          accentHex = customAccent;
        } else if (theme?.accentColor) {
          accentHex = theme.accentColor;
        }
      } else if (themeName !== "WHITE") {
        accentHex = palette?.["--secondary-color"] || theme?.accentColor || accentHex;
      }
      return { accentHex, themeColors };
    },
    updateBackgroundForProfile(profile) {
      const { accentHex, themeColors } = this.resolveProfileThemeBackground(profile);
      this.updateBackground(accentHex, themeColors);
    },
    updateBackground(colorHex, themeColorsOverride = null) {
      const screen = this.container?.querySelector(".profile-screen");
      if (!screen) return;

      const screenChanged = this._bgScreen !== screen;
      this._bgScreen = screen;
      const targetColor = parseHexColor(colorHex, parseHexColor(getDefaultProfileColor()));
      const themeColors = themeColorsOverride || this.getBackgroundThemeColors();
      const themeKey = `${themeColors.background.r},${themeColors.background.g},${themeColors.background.b}|${themeColors.elevated.r},${themeColors.elevated.g},${themeColors.elevated.b}`;
      const themeChanged = this._bgThemeKey !== themeKey;
      this._bgThemeKey = themeKey;
      if (!screenChanged && !themeChanged && colorsEqual(this._bgTargetColor, targetColor)) {
        return;
      }
      if (!this._bgAnimRaf && !themeChanged && colorsEqual(this._bgCurrentColor, targetColor)) {
        this._bgTargetColor = targetColor;
        if (screenChanged) {
          screen.style.background = this.buildBackgroundStyleFromColor(targetColor, themeColors);
        }
        return;
      }
      this._bgTargetColor = targetColor;

      if (this._bgAnimRaf) {
        cancelAnimationFrame(this._bgAnimRaf);
        this._bgAnimRaf = null;
      }

      if (
        getTvRuntimePerformanceProfile().isPerformanceConstrained ||
        globalThis.document?.body?.classList?.contains("performance-constrained")
      ) {
        this._bgCurrentColor = targetColor;
        screen.style.background = this.buildBackgroundStyleFromColor(targetColor, themeColors);
        return;
      }

      const fromColor = this._bgCurrentColor || targetColor;
      this._bgCurrentColor = fromColor;

      const startTime = performance.now();

      const tick = (now) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / PROFILE_BACKGROUND_ANIMATION_MS, 1);
        const eased = fastOutSlowIn(t);
        const animatedColor = {
          r: Math.round(fromColor.r + (targetColor.r - fromColor.r) * eased),
          g: Math.round(fromColor.g + (targetColor.g - fromColor.g) * eased),
          b: Math.round(fromColor.b + (targetColor.b - fromColor.b) * eased)
        };
        this._bgCurrentColor = animatedColor;
        screen.style.background = this.buildBackgroundStyleFromColor(animatedColor, themeColors);
        if (t < 1) {
          this._bgAnimRaf = requestAnimationFrame(tick);
        } else {
          this._bgAnimRaf = null;
        }
      };

      this._bgAnimRaf = requestAnimationFrame(tick);
    },
    updateProfileBackground(profile) {
      const layer = this.container?.querySelector("[data-role='profile-screen-background']");
      if (!layer) {
        return;
      }
      const imageUrl = String(this.getProfileBackgroundImageUrl(profile) || "").trim();
      if (String(layer.dataset.imageUrl || "") === imageUrl) {
        return;
      }
      layer.dataset.imageUrl = imageUrl;
      layer.innerHTML = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" aria-hidden="true"/>` : "";
      layer.classList.toggle("has-image", Boolean(imageUrl));
      if (imageUrl) {
        const image = layer.querySelector("img");
        image?.addEventListener("error", () => {
          if (String(layer.dataset.imageUrl || "") !== imageUrl) {
            return;
          }
          layer.dataset.imageUrl = "";
          layer.classList.remove("has-image");
          layer.innerHTML = "";
        });
      }
    },
    buildBackgroundStyle(colorHex) {
      const accent = parseHexColor(colorHex, parseHexColor(getDefaultProfileColor()));
      return this.buildBackgroundStyleFromColor(accent, this.getBackgroundThemeColors());
    },
    getBackgroundThemeColors() {
      if (this._bgThemeColors) {
        return this._bgThemeColors;
      }
      const rootStyles = getComputedStyle(document.documentElement);
      this._bgThemeColors = {
        background: parseHexColor(rootStyles.getPropertyValue("--bg-color"), {
          r: 13,
          g: 13,
          b: 13
        }),
        elevated: parseHexColor(rootStyles.getPropertyValue("--bg-elevated"), {
          r: 26,
          g: 26,
          b: 26
        })
      };
      return this._bgThemeColors;
    },
    buildBackgroundStyleFromColor(accent, themeColors = null) {
      const { background, elevated } = themeColors || this.getBackgroundThemeColors();
      const gradientTop = mixColors(elevated, accent, 0.3);
      const gradientMid = mixColors(background, accent, 0.14);
      return `
          linear-gradient(90deg, ${colorToRgba(accent, 0.26)} 0%, ${colorToRgba(accent, 0.08)} 45%, rgba(0, 0, 0, 0) 72%, rgba(0, 0, 0, 0) 100%),
          linear-gradient(180deg, ${colorToRgba(gradientTop, 1)} 0%, ${colorToRgba(gradientMid, 1)} 42%, ${colorToRgba(background, 1)} 100%)
        `;
    }
  };
}
